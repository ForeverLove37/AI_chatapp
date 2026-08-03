package com.zengjunjie.adaptivechat.data

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
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

        val request = Request.Builder()
            .url(endpoint)
            .header("Accept", "text/event-stream")
            .header("Authorization", "Bearer $accessToken")
            .post(payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
            .build()

        val eventSource = EventSources.createFactory(client).newEventSource(
            request,
            object : EventSourceListener() {
                override fun onEvent(
                    eventSource: EventSource,
                    id: String?,
                    type: String?,
                    data: String,
                ) {
                    if (data == "[DONE]") {
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

                override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                    close(t ?: IllegalStateException("Streaming request failed with HTTP ${response?.code}"))
                }
            },
        )

        awaitClose { eventSource.cancel() }
    }

    suspend fun login(email: String, password: String): LoginResult = postJson(
        path = "/v1/auth/login",
        payload = JSONObject().put("email", email).put("password", password),
    ) { body ->
        val user = body.optJSONObject("user")
        val token = body.optString("token")
        val userEmail = user?.optString("email").orEmpty()
        if (token.isBlank() || userEmail.isBlank()) throw IOException("The server returned an incomplete sign-in response.")
        LoginResult(accessToken = token, email = userEmail)
    }

    suspend fun checkForUpdate(versionCode: Int, versionName: String): UpdateCheckResult = postJson(
        path = "/v1/app/check-update",
        payload = JSONObject().put("versionCode", versionCode).put("versionName", versionName),
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
    ): T = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseEndpoint$path")
            .header("Accept", "application/json")
            .apply { if (accessToken != null) header("Authorization", "Bearer $accessToken") }
            .post(payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
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
            transform(parsed ?: throw IOException("The server returned an invalid response."))
        }
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
