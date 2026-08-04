package com.zengjunjie.adaptivechat.data

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class RemoteMessage(
    val role: String,
    val content: String,
    val attachments: List<ChatAttachment> = emptyList(),
)

data class StreamChunk(
    val content: String = "",
    val reasoning: String = "",
    val completed: Boolean = false,
)

data class LoginResult(
    val accessToken: String,
    val email: String,
    val displayName: String,
    val avatarUrl: String,
)

data class UserProfile(
    val email: String,
    val displayName: String,
    val avatarUrl: String,
)

data class ProfileAvatarUpload(
    val fileName: String,
    val mimeType: String,
    val bytes: ByteArray,
)

data class RemoteAppVersion(
    val versionCode: Int,
    val versionName: String,
    val downloadUrl: String,
    val releaseNotes: String,
)

data class UpdateCheckResult(
    val updateAvailable: Boolean,
    val latest: RemoteAppVersion?,
)

data class RemoteConfig(
    val version: Int,
    val channels: List<ProviderMode>,
    val webSearchEnabled: Boolean,
)

data class RemoteConversationSnapshot(
    val session: ChatSessionEntity,
    val messages: List<ChatMessageEntity>,
)

class ChatApi(baseUrl: String) {
    private val baseEndpoint = baseUrl.trimEnd('/')
    private val endpoint = "$baseEndpoint/v1/chat/completions"
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    fun stream(
        accessToken: String,
        model: ChatModel,
        messages: List<RemoteMessage>,
        webSearchEnabled: Boolean = false,
    ): Flow<StreamChunk> = callbackFlow {
        val payload = JSONObject()
            .put("model", model.wireName)
            .put("stream", true)
            .put(
                "messages",
                JSONArray().apply {
                    messages.forEach { message ->
                        put(
                            JSONObject()
                                .put("role", message.role)
                                .put("content", message.toOpenAiContent()),
                        )
                    }
                },
            )

        val requestBuilder = Request.Builder()
            .url(endpoint)
            .header("Accept", "text/event-stream")
            .header("Authorization", "Bearer $accessToken")
            .post(payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
        if (webSearchEnabled) requestBuilder.header("X-Web-Search", "true")
        val request = requestBuilder.build()

        val eventSource = EventSources.createFactory(client).newEventSource(
            request,
            object : EventSourceListener() {
                private var completed = false

                override fun onEvent(
                    eventSource: EventSource,
                    id: String?,
                    type: String?,
                    data: String,
                ) {
                    if (data == "[DONE]") {
                        completed = true
                        trySend(StreamChunk(completed = true))
                        close()
                        return
                    }

                    val payloadObject = runCatching { JSONObject(data) }.getOrNull() ?: return
                    val delta = payloadObject
                        .optJSONArray("choices")
                        ?.optJSONObject(0)
                        ?.optJSONObject("delta")
                        ?: return
                    val content = delta.optString("content")
                    val reasoning = when {
                        delta.has("reasoning_content") -> delta.optString("reasoning_content")
                        delta.has("reasoning") -> delta.optString("reasoning")
                        else -> ""
                    }

                    if (content.isNotEmpty() || reasoning.isNotEmpty()) {
                        trySend(StreamChunk(content = content, reasoning = reasoning))
                    }
                }

                override fun onClosed(eventSource: EventSource) {
                    if (!completed) trySend(StreamChunk(completed = true))
                    close()
                }

                override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                    val serverMessage = response?.body?.string()?.let { body ->
                        runCatching { JSONObject(body).optJSONObject("error")?.optString("message") }.getOrNull()
                    }?.takeIf(String::isNotBlank)
                    close(t ?: IllegalStateException(serverMessage ?: "Streaming request failed with HTTP ${response?.code}"))
                }
            },
        )

        awaitClose { eventSource.cancel() }
    }

    suspend fun fetchConfig(): RemoteConfig = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseEndpoint/v1/config")
            .header("Accept", "application/json")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("Configuration request failed with HTTP ${response.code}.")
            val payload = runCatching { JSONObject(body) }.getOrElse { throw IOException("The server returned invalid configuration.") }
            val values = payload.optJSONArray("channels") ?: JSONArray()
            val channels = buildList {
                for (index in 0 until values.length()) {
                    val item = values.optJSONObject(index) ?: continue
                    val id = item.optString("id").trim()
                    val displayName = item.optString("displayName").trim()
                    val modelsJson = item.optJSONArray("models") ?: JSONArray()
                    if (id.isBlank() || displayName.isBlank() || modelsJson.length() == 0) continue
                    val models = buildList {
                        for (modelIndex in 0 until modelsJson.length()) {
                            val model = modelsJson.optJSONObject(modelIndex) ?: continue
                            val modelId = model.optString("id").trim()
                            val label = model.optString("label").trim()
                            if (modelId.isNotBlank() && label.isNotBlank()) {
                                add(ChatModel(modelId, id, label, model.optString("description")))
                            }
                        }
                    }
                    if (models.isEmpty()) continue
                    val style = item.optJSONObject("style") ?: JSONObject()
                    val icon = item.optJSONObject("icon")
                    val baseStyle = ChannelStyle(
                        backgroundStart = style.optString("backgroundStart", "#F7F9F8"),
                        backgroundEnd = style.optString("backgroundEnd", "#EEF3F1"),
                        accentColor = style.optString("accentColor", "#087F73"),
                        textColor = style.optString("textColor", "#172126"),
                        surfaceColor = style.optString("surfaceColor", "#FFFFFF"),
                        typography = style.optString("typography", "sans"),
                        animatedGradient = style.optBoolean("animatedGradient"),
                    )
                    add(
                        ProviderMode(
                            wireName = id,
                            displayName = displayName,
                            description = item.optString("description"),
                            iconDataUrl = icon?.takeIf { it.optString("type") == "data_url" }?.optString("value").orEmpty(),
                            style = NativeChannelCssParser.apply(baseStyle, style.optString("customCss")),
                            models = models,
                            appIconUrl = resolvePublicUrl(item.optString("appIconUrl")),
                        ),
                    )
                }
            }
            RemoteConfig(
                version = payload.optInt("version", 1),
                channels = channels.ifEmpty { ProviderMode.entries },
                webSearchEnabled = payload.optJSONObject("featureFlags")?.optBoolean("webSearch") == true,
            )
        }
    }

    suspend fun fetchConversations(accessToken: String): List<RemoteConversationSnapshot> =
        requestJson(
            path = "/v1/sessions",
            method = "GET",
            accessToken = accessToken,
        ) { body ->
            val values = body.optJSONArray("data") ?: JSONArray()
            buildList {
                for (index in 0 until values.length()) {
                    val value = values.optJSONObject(index) ?: continue
                    val sessionId = value.optString("id")
                    if (sessionId.isBlank()) continue
                    val messagesJson = value.optJSONArray("messages") ?: JSONArray()
                    val messages = buildList {
                        for (messageIndex in 0 until messagesJson.length()) {
                            val message = messagesJson.optJSONObject(messageIndex) ?: continue
                            val messageId = message.optString("id")
                            val role = message.optString("role").uppercase()
                            if (messageId.isBlank() || role !in MessageRole.entries.map { it.name }) continue
                            add(
                                ChatMessageEntity(
                                    id = messageId,
                                    sessionId = sessionId,
                                    role = role,
                                    content = message.optString("content"),
                                    attachmentsJson = (message.optJSONArray("attachments") ?: JSONArray()).toString(),
                                    reasoning = message.optString("reasoning"),
                                    createdAt = message.optLong("createdAt"),
                                    isStreaming = message.optBoolean("isStreaming"),
                                    model = message.optString("modelId"),
                                    errorText = message.optString("errorText"),
                                    parentMessageId = message.optString("parentMessageId"),
                                    updatedAt = message.optLong("updatedAt", message.optLong("createdAt")),
                                ),
                            )
                        }
                    }
                    val updatedAt = value.optLong("updatedAt")
                    add(
                        RemoteConversationSnapshot(
                            session = ChatSessionEntity(
                                id = sessionId,
                                title = value.optString("title", "New conversation"),
                                provider = value.optString("channelId", "chatgpt"),
                                model = value.optString("modelId", "chatgpt-lite"),
                                systemPrompt = value.optString("systemPrompt"),
                                updatedAt = updatedAt,
                            ),
                            messages = messages,
                        ),
                    )
                }
            }
        }

    suspend fun upsertConversation(
        accessToken: String,
        session: ChatSessionEntity,
        messages: List<ChatMessageEntity>,
    ) {
        val createdAt = minOf(
            session.updatedAt,
            messages.minOfOrNull { it.createdAt } ?: session.updatedAt,
        )
        val payload = JSONObject()
            .put("title", session.title)
            .put("channelId", session.provider)
            .put("modelId", session.model)
            .put("systemPrompt", session.systemPrompt)
            .put("createdAt", createdAt.coerceAtLeast(1L))
            .put("updatedAt", session.updatedAt.coerceAtLeast(1L))
            .put(
                "messages",
                JSONArray().apply {
                    messages.forEach { message ->
                        put(
                            JSONObject()
                                .put("id", message.id)
                                .put("role", message.role.lowercase())
                                .put("content", message.content)
                                .put("attachments", runCatching { JSONArray(message.attachmentsJson) }.getOrDefault(JSONArray()))
                                .put("reasoning", message.reasoning)
                                .put("modelId", message.model)
                                .put("errorText", message.errorText)
                                .put("isStreaming", message.isStreaming)
                                .put("parentMessageId", message.parentMessageId.ifBlank { JSONObject.NULL })
                                .put("createdAt", message.createdAt.coerceAtLeast(1L))
                                .put("updatedAt", message.updatedAt.coerceAtLeast(message.createdAt).coerceAtLeast(1L)),
                        )
                    }
                },
            )
        requestJson(
            path = "/v1/sessions/${session.id}",
            method = "PUT",
            payload = payload,
            accessToken = accessToken,
        ) { Unit }
    }

    suspend fun deleteConversation(accessToken: String, sessionId: String) {
        requestJson(
            path = "/v1/sessions/$sessionId",
            method = "DELETE",
            accessToken = accessToken,
            allowNotFound = true,
        ) { Unit }
    }

    suspend fun deleteMessage(accessToken: String, messageId: String): List<String> =
        requestJson(
            path = "/v1/messages/$messageId",
            method = "DELETE",
            accessToken = accessToken,
            allowNotFound = true,
        ) { body ->
            val values = body.optJSONObject("data")?.optJSONArray("deletedIds") ?: JSONArray()
            buildList {
                for (index in 0 until values.length()) values.optString(index).takeIf(String::isNotBlank)?.let(::add)
            }
        }

    private fun resolvePublicUrl(value: String): String = when {
        value.isBlank() -> ""
        value.startsWith("https://") || value.startsWith("http://") -> value
        value.startsWith("/") -> "$baseEndpoint$value"
        else -> "$baseEndpoint/$value"
    }

    suspend fun login(email: String, password: String): LoginResult = postJson(
        path = "/v1/auth/login",
        payload = JSONObject().put("email", email).put("password", password),
    ) { body ->
        val user = body.optJSONObject("user")
        val token = body.optString("token")
        val userEmail = user?.optString("email").orEmpty()
        if (token.isBlank() || userEmail.isBlank()) throw IOException("The server returned an incomplete sign-in response.")
        LoginResult(
            accessToken = token,
            email = userEmail,
            displayName = user?.optString("displayName").orEmpty(),
            avatarUrl = resolvePublicUrl(user?.optString("avatarUrl").orEmpty()),
        )
    }

    suspend fun fetchProfile(accessToken: String): UserProfile = requestJson(
        path = "/v1/users/profile",
        method = "GET",
        accessToken = accessToken,
    ) { body -> parseUserProfile(body.optJSONObject("data")) }

    suspend fun updateProfile(
        accessToken: String,
        displayName: String,
        avatar: ProfileAvatarUpload?,
        removeAvatar: Boolean,
    ): UserProfile = withContext(Dispatchers.IO) {
        val multipart = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("displayName", displayName.trim())
            .apply {
                if (avatar != null) {
                    addFormDataPart(
                        "avatar",
                        avatar.fileName,
                        avatar.bytes.toRequestBody(avatar.mimeType.toMediaType()),
                    )
                }
                if (removeAvatar) addFormDataPart("removeAvatar", "true")
            }
            .build()
        val request = Request.Builder()
            .url("$baseEndpoint/v1/users/profile")
            .header("Accept", "application/json")
            .header("Authorization", "Bearer $accessToken")
            .patch(multipart)
            .build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            val parsed = runCatching { JSONObject(body) }.getOrNull()
            if (!response.isSuccessful) {
                val message = parsed?.optJSONObject("error")?.optString("message")
                    ?.takeIf(String::isNotBlank)
                    ?: "Request failed with HTTP ${response.code}."
                throw IOException(message)
            }
            parseUserProfile(parsed?.optJSONObject("data"))
        }
    }

    suspend fun checkForUpdate(accessToken: String, versionCode: Int, versionName: String): UpdateCheckResult = postJson(
        path = "/v1/app/check-update",
        payload = JSONObject().put("versionCode", versionCode).put("versionName", versionName),
        accessToken = accessToken,
    ) { body ->
        val latest = body.optJSONObject("latest")?.let { item ->
            RemoteAppVersion(
                versionCode = item.optInt("versionCode"),
                versionName = item.optString("versionName"),
                downloadUrl = item.optString("downloadUrl"),
                releaseNotes = item.optString("releaseNotes"),
            )
        }
        UpdateCheckResult(updateAvailable = body.optBoolean("updateAvailable"), latest = latest)
    }

    suspend fun submitFeedback(
        accessToken: String,
        message: String,
        category: String,
        appVersion: String,
        locale: String,
    ) {
        postJson(
            path = "/v1/app/feedback",
            payload = JSONObject()
                .put("message", message)
                .put("category", category)
                .put("appVersion", appVersion)
                .put("locale", locale),
            accessToken = accessToken,
        ) { Unit }
    }

    suspend fun synthesizeSpeech(accessToken: String, input: String, voice: String): ByteArray = withContext(Dispatchers.IO) {
        val payload = JSONObject()
            .put("input", input)
            .put("voice", voice)
        val request = Request.Builder()
            .url("$baseEndpoint/v1/audio/speech")
            .header("Accept", "audio/mpeg")
            .header("Authorization", "Bearer $accessToken")
            .post(payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
            .build()
        client.newBuilder()
            .callTimeout(12, TimeUnit.SECONDS)
            .build()
            .newCall(request)
            .execute()
            .use { response ->
                if (!response.isSuccessful) {
                    val body = response.body?.string().orEmpty()
                    val message = runCatching { JSONObject(body) }.getOrNull()
                        ?.optJSONObject("error")
                        ?.optString("message")
                        ?.takeIf(String::isNotBlank)
                        ?: "Speech request failed with HTTP ${response.code}."
                    throw IOException(message)
                }
                val audio = response.body?.bytes() ?: ByteArray(0)
                if (audio.isEmpty()) throw IOException("The speech service returned no audio.")
                audio
            }
    }

    private suspend fun <T> postJson(
        path: String,
        payload: JSONObject,
        accessToken: String? = null,
        transform: (JSONObject) -> T,
    ): T = requestJson(path, "POST", payload, accessToken = accessToken, transform = transform)

    private suspend fun <T> requestJson(
        path: String,
        method: String,
        payload: JSONObject? = null,
        accessToken: String? = null,
        allowNotFound: Boolean = false,
        transform: (JSONObject) -> T,
    ): T = withContext(Dispatchers.IO) {
        val requestBody = payload?.toString()?.toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url("$baseEndpoint$path")
            .header("Accept", "application/json")
            .apply { if (accessToken != null) header("Authorization", "Bearer $accessToken") }
            .method(method, requestBody)
            .build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            val parsed = runCatching { JSONObject(body) }.getOrNull()
            if (!response.isSuccessful && !(allowNotFound && response.code == 404)) {
                val message = parsed?.optJSONObject("error")?.optString("message")
                    ?.takeIf(String::isNotBlank)
                    ?: "Request failed with HTTP ${response.code}."
                throw IOException(message)
            }
            transform(parsed ?: JSONObject())
        }
    }

    private fun parseUserProfile(user: JSONObject?): UserProfile {
        val email = user?.optString("email").orEmpty()
        if (email.isBlank()) throw IOException("The server returned an incomplete profile response.")
        return UserProfile(
            email = email,
            displayName = user?.optString("displayName").orEmpty(),
            avatarUrl = resolvePublicUrl(user?.optString("avatarUrl").orEmpty()),
        )
    }
}

private fun RemoteMessage.toOpenAiContent(): Any {
    if (attachments.isEmpty()) return content

    return JSONArray().apply {
        if (content.isNotBlank()) {
            put(JSONObject().put("type", "text").put("text", content))
        }
        attachments.forEach { attachment ->
            put(
                JSONObject()
                    .put("type", "image_url")
                    .put(
                        "image_url",
                        JSONObject()
                            .put("url", attachment.dataUrl)
                            .put("detail", "auto"),
                    ),
            )
        }
    }
}
