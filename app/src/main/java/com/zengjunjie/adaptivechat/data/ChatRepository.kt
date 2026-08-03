package com.zengjunjie.adaptivechat.data

import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.map

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

    suspend fun createSession(provider: ProviderMode = ProviderMode.CHATGPT): ChatSession {
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
        return session
    }

    suspend fun updateChannel(sessionId: String, provider: ProviderMode) {
        chatDao.updateChannel(
            sessionId = sessionId,
            provider = provider.wireName,
            model = provider.defaultModel.wireName,
            updatedAt = System.currentTimeMillis(),
        )
    }

    suspend fun updateModel(sessionId: String, model: ChatModel) {
        chatDao.updateModel(sessionId, model.wireName, System.currentTimeMillis())
    }

    suspend fun deleteSession(sessionId: String) {
        chatDao.deleteSessionWithMessages(sessionId)
    }

    suspend fun sendMessage(
        session: ChatSession,
        text: String,
        accessToken: String,
        attachments: List<ChatAttachment> = emptyList(),
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
        )
        chatDao.upsertMessage(userMessage.toEntity())
        chatDao.upsertMessage(assistantMessage.toEntity())
        val title = text.ifBlank { attachments.firstOrNull()?.fileName ?: "New conversation" }
        chatDao.updateTitle(session.id, title.take(52), now)

        val persistedMessages = chatDao.getMessages(session.id)
        streamAssistant(
            session = session,
            assistantMessageId = assistantMessage.id,
            sourceMessages = persistedMessages.filterNot { it.id == assistantMessage.id },
            accessToken = accessToken,
            onFirstToken = onFirstToken,
        )
    }

    suspend fun redoTerminalAssistant(
        session: ChatSession,
        assistantMessageId: String,
        accessToken: String,
        onFirstToken: () -> Unit = {},
    ) {
        val persistedMessages = chatDao.getMessages(session.id)
        val assistantIndex = persistedMessages.indexOfFirst { it.id == assistantMessageId }
        require(assistantIndex == persistedMessages.lastIndex) { "Only the latest response can be redone." }
        val assistant = persistedMessages.getOrNull(assistantIndex)
            ?: throw IllegalArgumentException("The response was not found.")
        require(assistant.role == MessageRole.ASSISTANT.name) { "Only assistant responses can be redone." }
        require(persistedMessages.take(assistantIndex).any { it.role == MessageRole.USER.name }) {
            "A preceding user message is required."
        }

        chatDao.updateAssistantMessage(
            messageId = assistant.id,
            content = "",
            reasoning = "",
            isStreaming = true,
        )
        try {
            streamAssistant(
                session = session,
                assistantMessageId = assistant.id,
                sourceMessages = persistedMessages.take(assistantIndex),
                accessToken = accessToken,
                onFirstToken = onFirstToken,
            )
        } catch (error: Throwable) {
            chatDao.updateAssistantMessage(
                messageId = assistant.id,
                content = assistant.content,
                reasoning = assistant.reasoning,
                isStreaming = false,
            )
            throw error
        }
    }

    suspend fun branchConversation(session: ChatSession, throughMessageId: String): ChatSession {
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
        val copiedMessages = sourceMessages.take(lastIncludedIndex + 1).mapIndexed { index, message ->
            message.copy(
                id = newId(),
                sessionId = branch.id,
                createdAt = now + index,
                isStreaming = false,
            )
        }
        chatDao.createSessionWithMessages(branch.toEntity(), copiedMessages)
        return branch
    }

    private suspend fun streamAssistant(
        session: ChatSession,
        assistantMessageId: String,
        sourceMessages: List<ChatMessageEntity>,
        accessToken: String,
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
        try {
            chatApi.stream(accessToken, session.model, history).collect { chunk ->
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
                    isStreaming = !chunk.completed,
                )
            }
        } finally {
            chatDao.updateAssistantMessage(
                messageId = assistantMessageId,
                content = response,
                reasoning = reasoning,
                isStreaming = false,
            )
            chatDao.touchSession(session.id, System.currentTimeMillis())
        }
    }

    suspend fun login(email: String, password: String): LoginResult = chatApi.login(email, password)

    suspend fun fetchRemoteConfig(): RemoteConfig = chatApi.fetchConfig()

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

internal fun buildContextWindow(
    systemPrompt: String,
    messages: List<ChatMessageEntity>,
): List<RemoteMessage> {
    val window = ArrayDeque<RemoteMessage>()
    var characterCount = 0

    for (message in messages.asReversed()) {
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
