package com.zengjunjie.adaptivechat.data

import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

class ChatRepository(
    private val chatDao: ChatDao,
    private val chatApi: ChatApi,
) {
    fun observeSessions(): Flow<List<ChatSession>> =
        chatDao.observeSessions().map { sessions -> sessions.map(ChatSessionEntity::toModel) }

    fun observeMessages(sessionId: String): Flow<List<ChatMessage>> =
        chatDao.observeMessages(sessionId).map { messages -> messages.map(ChatMessageEntity::toModel) }

    suspend fun getOrCreateDefaultSession(): ChatSession =
        chatDao.getLatestSession()?.toModel() ?: createSession()

    suspend fun createSession(
        provider: ProviderMode = ProviderMode.CHATGPT,
        accessToken: String? = null,
    ): ChatSession {
        val now = System.currentTimeMillis()
        val session = ChatSession(
            id = newId(),
            title = "New conversation",
            provider = provider,
            model = provider.defaultModel,
            systemPrompt = "You are a helpful AI assistant.",
            updatedAt = now,
        )
        chatDao.upsertSession(session.toEntity())
        if (accessToken != null) runCatching { syncSession(session.id, accessToken) }
        return session
    }

    suspend fun updateChannel(sessionId: String, provider: ProviderMode, accessToken: String? = null) {
        chatDao.updateChannel(
            sessionId = sessionId,
            provider = provider.wireName,
            model = provider.defaultModel.wireName,
            updatedAt = System.currentTimeMillis(),
        )
        if (accessToken != null) runCatching { syncSession(sessionId, accessToken) }
    }

    suspend fun updateModel(sessionId: String, model: ChatModel, accessToken: String? = null) {
        chatDao.updateModel(sessionId, model.wireName, System.currentTimeMillis())
        if (accessToken != null) runCatching { syncSession(sessionId, accessToken) }
    }

    suspend fun deleteSession(sessionId: String, accessToken: String? = null) {
        if (accessToken != null) chatApi.deleteConversation(accessToken, sessionId)
        chatDao.deleteSessionWithMessages(sessionId)
    }

    suspend fun sendMessage(
        session: ChatSession,
        text: String,
        accessToken: String,
        attachments: List<ChatAttachment> = emptyList(),
        webSearchEnabled: Boolean = false,
        onFirstToken: () -> Unit = {},
    ) {
        val now = System.currentTimeMillis()
        val userMessage = ChatMessage(
            id = newId(),
            sessionId = session.id,
            role = MessageRole.USER,
            content = text,
            attachments = attachments,
            reasoning = "",
            createdAt = now,
            isStreaming = false,
            modelId = "",
            errorText = "",
            parentMessageId = "",
            updatedAt = now,
        )
        val assistantMessage = ChatMessage(
            id = newId(),
            sessionId = session.id,
            role = MessageRole.ASSISTANT,
            content = "",
            attachments = emptyList(),
            reasoning = "",
            createdAt = now + 1,
            isStreaming = true,
            modelId = session.model.wireName,
            errorText = "",
            parentMessageId = userMessage.id,
            updatedAt = now + 1,
        )
        chatDao.upsertMessage(userMessage.toEntity())
        chatDao.upsertMessage(assistantMessage.toEntity())
        val title = text.ifBlank { attachments.firstOrNull()?.fileName ?: "New conversation" }
        chatDao.updateTitle(session.id, title.take(52), now)
        runCatching { syncSession(session.id, accessToken) }

        val persistedMessages = chatDao.getMessages(session.id)
        streamAssistant(
            session = session,
            assistantMessageId = assistantMessage.id,
            sourceMessages = persistedMessages.filterNot { it.id == assistantMessage.id },
            accessToken = accessToken,
            webSearchEnabled = webSearchEnabled,
            onFirstToken = onFirstToken,
        )
    }

    suspend fun redoAssistant(
        session: ChatSession,
        assistantMessageId: String,
        accessToken: String,
        onFirstToken: () -> Unit = {},
    ) {
        val persistedMessages = chatDao.getMessages(session.id)
        val assistantIndex = persistedMessages.indexOfFirst { it.id == assistantMessageId }
        val assistant = persistedMessages.getOrNull(assistantIndex)
            ?: throw IllegalArgumentException("The response was not found.")
        require(assistant.role == MessageRole.ASSISTANT.name) { "Only assistant responses can be redone." }
        require(assistantIndex == persistedMessages.lastIndex) {
            "Only the terminal assistant response can be redone."
        }
        require(persistedMessages.take(assistantIndex).any { it.role == MessageRole.USER.name }) {
            "A preceding user message is required."
        }

        val originalTail = persistedMessages.drop(assistantIndex)
        chatDao.prepareAssistantRegeneration(
            sessionId = session.id,
            messageId = assistant.id,
            createdAt = assistant.createdAt,
            model = session.model.wireName,
            updatedAt = System.currentTimeMillis(),
        )
        runCatching { syncSession(session.id, accessToken) }
        try {
            streamAssistant(
                session = session,
                assistantMessageId = assistant.id,
                sourceMessages = persistedMessages.take(assistantIndex),
                accessToken = accessToken,
                onFirstToken = onFirstToken,
            )
        } catch (error: Throwable) {
            val cancelled = error is CancellationException
            val restoredTail = originalTail.mapIndexed { index, message ->
                message.copy(
                    isStreaming = false,
                    errorText = if (index == 0 && !cancelled) error.persistedErrorText() else message.errorText,
                    updatedAt = System.currentTimeMillis() + index,
                )
            }
            withContext(NonCancellable) {
                chatDao.restoreMessageTail(
                    sessionId = session.id,
                    createdAt = assistant.createdAt,
                    messages = restoredTail,
                    updatedAt = System.currentTimeMillis(),
                )
                runCatching { syncSession(session.id, accessToken) }
            }
            throw error
        }
    }

    suspend fun editLatestUserMessage(
        session: ChatSession,
        userMessageId: String,
        text: String,
        attachments: List<ChatAttachment>,
        accessToken: String,
        webSearchEnabled: Boolean = false,
        onFirstToken: () -> Unit = {},
    ) {
        val persistedMessages = chatDao.getMessages(session.id)
        val userIndex = persistedMessages.indexOfFirst { it.id == userMessageId }
        val original = persistedMessages.getOrNull(userIndex)
            ?: throw IllegalArgumentException("The message was not found.")
        require(original.role == MessageRole.USER.name) { "Only user messages can be edited." }
        require(persistedMessages.drop(userIndex + 1).none { it.role == MessageRole.USER.name }) {
            "Only the latest user message can be edited."
        }
        require(text.isNotBlank() || attachments.isNotEmpty()) { "The edited message cannot be empty." }

        val now = System.currentTimeMillis()
        val editedUser = original.copy(
            content = text,
            attachmentsJson = attachments.toJson(),
            isStreaming = false,
            model = "",
            errorText = "",
            updatedAt = now,
        )
        val assistant = ChatMessageEntity(
            id = newId(),
            sessionId = session.id,
            role = MessageRole.ASSISTANT.name,
            content = "",
            attachmentsJson = "[]",
            reasoning = "",
            createdAt = maxOf(original.createdAt + 1, now),
            isStreaming = true,
            model = session.model.wireName,
            errorText = "",
            parentMessageId = original.id,
            updatedAt = now,
        )
        chatDao.replaceUserMessageAndTail(editedUser, assistant, now)
        chatDao.updateTitle(session.id, text.ifBlank { attachments.firstOrNull()?.fileName ?: session.title }.take(52), now)
        runCatching { syncSession(session.id, accessToken) }
        val sourceMessages = chatDao.getMessages(session.id).filterNot { it.id == assistant.id }
        streamAssistant(
            session = session,
            assistantMessageId = assistant.id,
            sourceMessages = sourceMessages,
            accessToken = accessToken,
            webSearchEnabled = webSearchEnabled,
            onFirstToken = onFirstToken,
        )
    }

    suspend fun deleteAssistantMessage(sessionId: String, messageId: String, accessToken: String? = null) {
        val message = chatDao.getMessages(sessionId).firstOrNull { it.id == messageId }
            ?: throw IllegalArgumentException("The message was not found.")
        require(message.role == MessageRole.ASSISTANT.name) { "Only assistant messages can be deleted." }
        if (accessToken != null) chatApi.deleteMessage(accessToken, messageId)
        check(chatDao.deleteMessageAndTouch(sessionId, messageId, System.currentTimeMillis())) {
            "The message could not be deleted."
        }
    }

    suspend fun deleteUserMessage(sessionId: String, messageId: String, accessToken: String? = null) {
        val message = chatDao.getMessages(sessionId).firstOrNull { it.id == messageId }
            ?: throw IllegalArgumentException("The message was not found.")
        require(message.role == MessageRole.USER.name) { "Only user messages can be deleted with their response." }
        if (accessToken != null) chatApi.deleteMessage(accessToken, messageId)
        check(chatDao.deleteUserMessagePair(sessionId, messageId, System.currentTimeMillis())) {
            "The message could not be deleted."
        }
    }

    suspend fun branchConversation(
        session: ChatSession,
        throughMessageId: String,
        accessToken: String? = null,
    ): ChatSession {
        val sourceMessages = chatDao.getMessages(session.id)
        val lastIncludedIndex = sourceMessages.indexOfFirst { it.id == throughMessageId }
        require(lastIncludedIndex >= 0) { "The selected message was not found." }

        val now = System.currentTimeMillis()
        val baseTitle = if (session.title == "New conversation") session.title else session.title.take(44)
        val branch = session.copy(
            id = newId(),
            title = "$baseTitle (branch)",
            updatedAt = now,
        )
        val copiedIds = sourceMessages.take(lastIncludedIndex + 1).associate { it.id to newId() }
        val copiedMessages = sourceMessages.take(lastIncludedIndex + 1).mapIndexed { index, message ->
            message.copy(
                id = copiedIds.getValue(message.id),
                sessionId = branch.id,
                createdAt = now + index,
                isStreaming = false,
                parentMessageId = copiedIds[message.parentMessageId].orEmpty(),
                updatedAt = now + index,
            )
        }
        chatDao.createSessionWithMessages(branch.toEntity(), copiedMessages)
        if (accessToken != null) runCatching { syncSession(branch.id, accessToken) }
        return branch
    }

    private suspend fun streamAssistant(
        session: ChatSession,
        assistantMessageId: String,
        sourceMessages: List<ChatMessageEntity>,
        accessToken: String,
        webSearchEnabled: Boolean = false,
        onFirstToken: () -> Unit,
    ) {
        val history = buildContextWindow(
            systemPrompt = session.systemPrompt,
            messages = sourceMessages,
        )

        val parser = ReasoningStreamParser()
        var response = ""
        var reasoning = ""
        var receivedFirstToken = false
        var streamFailure: Throwable? = null
        try {
            chatApi.stream(accessToken, session.model, history, webSearchEnabled).collect { chunk ->
                if (!receivedFirstToken && (chunk.content.isNotEmpty() || chunk.reasoning.isNotEmpty())) {
                    receivedFirstToken = true
                    onFirstToken()
                }
                if (chunk.reasoning.isNotEmpty()) reasoning += chunk.reasoning
                if (chunk.content.isNotEmpty()) {
                    if (session.provider.isDeepSeek) {
                        val parsed = parser.consume(chunk.content)
                        response += parsed.content
                        reasoning += parsed.reasoning
                    } else {
                        response += chunk.content
                    }
                }
                if (chunk.completed) {
                    if (session.provider.isDeepSeek) {
                        val tail = parser.finish()
                        response += tail.content
                        reasoning += tail.reasoning
                    }
                }
                chatDao.updateAssistantMessage(
                    messageId = assistantMessageId,
                    content = response,
                    reasoning = reasoning,
                    model = session.model.wireName,
                    errorText = "",
                    isStreaming = !chunk.completed,
                    updatedAt = System.currentTimeMillis(),
                )
            }
        } catch (error: Throwable) {
            if (error !is CancellationException) {
                streamFailure = error
                throw error
            }
            throw error
        } finally {
            withContext(NonCancellable) {
                chatDao.updateAssistantMessage(
                    messageId = assistantMessageId,
                    content = response,
                    reasoning = reasoning,
                    model = session.model.wireName,
                    errorText = streamFailure?.persistedErrorText().orEmpty(),
                    isStreaming = false,
                    updatedAt = System.currentTimeMillis(),
                )
                chatDao.touchSession(session.id, System.currentTimeMillis())
                runCatching { syncSession(session.id, accessToken) }
            }
        }
    }

    suspend fun synchronizeFromServer(accessToken: String) {
        val remote = chatApi.fetchConversations(accessToken)
        val remoteById = remote.associateBy { it.session.id }
        val local = chatDao.getSessions()
        for (snapshot in remote) {
            val localSession = local.firstOrNull { it.id == snapshot.session.id }
            if (localSession == null || snapshot.session.updatedAt >= localSession.updatedAt) {
                chatDao.replaceSessionSnapshot(snapshot.session, snapshot.messages)
            } else {
                syncSession(localSession.id, accessToken)
            }
        }
        for (session in local) {
            if (session.id !in remoteById) {
                val messages = chatDao.getMessages(session.id)
                if (remote.isNotEmpty() && messages.isEmpty() && session.title == "New conversation") {
                    chatDao.deleteSessionWithMessages(session.id)
                } else {
                    syncSession(session.id, accessToken)
                }
            }
        }
    }

    private suspend fun syncSession(sessionId: String, accessToken: String) {
        val session = chatDao.getSession(sessionId) ?: return
        chatApi.upsertConversation(accessToken, session, chatDao.getMessages(sessionId))
    }

    suspend fun login(email: String, password: String): LoginResult = chatApi.login(email, password)

    suspend fun fetchProfile(accessToken: String): UserProfile = chatApi.fetchProfile(accessToken)

    suspend fun updateProfile(
        accessToken: String,
        displayName: String,
        avatar: ProfileAvatarUpload?,
        removeAvatar: Boolean,
    ): UserProfile = chatApi.updateProfile(accessToken, displayName, avatar, removeAvatar)

    suspend fun fetchRemoteConfig(accessToken: String? = null, expertMode: Boolean = false): RemoteConfig =
        chatApi.fetchConfig(accessToken, expertMode)

    suspend fun checkForUpdate(accessToken: String, versionCode: Int, versionName: String): UpdateCheckResult =
        chatApi.checkForUpdate(accessToken, versionCode, versionName)

    suspend fun submitFeedback(
        accessToken: String,
        message: String,
        category: String,
        appVersion: String,
        locale: String,
    ) = chatApi.submitFeedback(accessToken, message, category, appVersion, locale)
}

private const val MAX_CONTEXT_MESSAGES = 24
private const val MAX_CONTEXT_CHARACTERS = 32_000

private fun Throwable.persistedErrorText(): String =
    (message?.trim().takeUnless { it.isNullOrBlank() } ?: "The streaming request failed.").take(1_000)

internal fun buildContextWindow(
    systemPrompt: String,
    messages: List<ChatMessageEntity>,
): List<RemoteMessage> {
    val window = ArrayDeque<RemoteMessage>()
    var characterCount = 0

    for (message in messages.asReversed()) {
        if (message.role == MessageRole.ASSISTANT.name && message.content.isBlank()) continue
        val length = message.content.length + message.attachmentsJson.length
        if (window.isNotEmpty() && (window.size >= MAX_CONTEXT_MESSAGES || characterCount + length > MAX_CONTEXT_CHARACTERS)) {
            break
        }
        window.addFirst(
            RemoteMessage(
                role = message.role.lowercase(),
                content = message.content,
                attachments = message.attachments(),
            ),
        )
        characterCount += length
    }

    return buildList {
        if (systemPrompt.isNotBlank()) add(RemoteMessage("system", systemPrompt))
        addAll(window)
    }
}

private fun ChatSessionEntity.toModel() = ChatSession(
    id = id,
    title = title,
    provider = ProviderMode.fromWireName(provider),
    model = ChatModel.fromWireName(model, ProviderMode.fromWireName(provider)),
    systemPrompt = systemPrompt,
    updatedAt = updatedAt,
)

private fun ChatSession.toEntity() = ChatSessionEntity(
    id = id,
    title = title,
    provider = provider.wireName,
    model = model.wireName,
    systemPrompt = systemPrompt,
    updatedAt = updatedAt,
)

private fun ChatMessageEntity.toModel() = ChatMessage(
    id = id,
    sessionId = sessionId,
    role = MessageRole.valueOf(role),
    content = content,
    attachments = attachments(),
    reasoning = reasoning,
    createdAt = createdAt,
    isStreaming = isStreaming,
    modelId = model,
    errorText = errorText,
    parentMessageId = parentMessageId,
    updatedAt = updatedAt,
)

private fun ChatMessage.toEntity() = ChatMessageEntity(
    id = id,
    sessionId = sessionId,
    role = role.name,
    content = content,
    attachmentsJson = attachments.toJson(),
    reasoning = reasoning,
    createdAt = createdAt,
    isStreaming = isStreaming,
    model = modelId,
    errorText = errorText,
    parentMessageId = parentMessageId,
    updatedAt = updatedAt,
)

private fun List<ChatAttachment>.toJson(): String = JSONArray().apply {
    forEach { attachment ->
        put(
            JSONObject()
                .put("fileName", attachment.fileName)
                .put("mimeType", attachment.mimeType)
                .put("dataUrl", attachment.dataUrl),
        )
    }
}.toString()

private fun ChatMessageEntity.attachments(): List<ChatAttachment> = runCatching {
    val values = JSONArray(attachmentsJson)
    buildList {
        for (index in 0 until values.length()) {
            val value = values.optJSONObject(index) ?: continue
            val fileName = value.optString("fileName")
            val mimeType = value.optString("mimeType")
            val dataUrl = value.optString("dataUrl")
            if (fileName.isNotBlank() && mimeType.isNotBlank() && dataUrl.isNotBlank()) {
                add(ChatAttachment(fileName, mimeType, dataUrl))
            }
        }
    }
}.getOrDefault(emptyList())
