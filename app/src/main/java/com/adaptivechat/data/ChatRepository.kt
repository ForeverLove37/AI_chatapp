package com.adaptivechat.data

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
        chatDao.deleteMessagesForSession(sessionId)
        chatDao.deleteSession(sessionId)
    }

    suspend fun sendMessage(
        session: ChatSession,
        text: String,
        onFirstToken: () -> Unit = {},
    ) {
        val now = System.currentTimeMillis()
        val userMessage = ChatMessage(
            id = newId(),
            sessionId = session.id,
            role = MessageRole.USER,
            content = text,
            reasoning = "",
            createdAt = now,
            isStreaming = false,
        )
        val assistantMessage = ChatMessage(
            id = newId(),
            sessionId = session.id,
            role = MessageRole.ASSISTANT,
            content = "",
            reasoning = "",
            createdAt = now + 1,
            isStreaming = true,
        )
        chatDao.upsertMessage(userMessage.toEntity())
        chatDao.upsertMessage(assistantMessage.toEntity())
        chatDao.updateTitle(session.id, text.take(52), now)

        val persistedMessages = chatDao.getMessages(session.id)
        val history = buildContextWindow(
            systemPrompt = session.systemPrompt,
            messages = persistedMessages.filterNot { it.id == assistantMessage.id },
        )

        val parser = ReasoningStreamParser()
        var response = ""
        var reasoning = ""
        var receivedFirstToken = false
        try {
            chatApi.stream(session.model, history).collect { chunk ->
                if (!receivedFirstToken && (chunk.content.isNotEmpty() || chunk.reasoning.isNotEmpty())) {
                    receivedFirstToken = true
                    onFirstToken()
                }
                if (chunk.reasoning.isNotEmpty()) reasoning += chunk.reasoning
                if (chunk.content.isNotEmpty()) {
                    val parsed = parser.consume(chunk.content)
                    response += parsed.content
                    reasoning += parsed.reasoning
                }
                if (chunk.completed) {
                    val tail = parser.finish()
                    response += tail.content
                    reasoning += tail.reasoning
                }
                chatDao.updateAssistantMessage(
                    messageId = assistantMessage.id,
                    content = response,
                    reasoning = reasoning,
                    isStreaming = !chunk.completed,
                )
            }
        } finally {
            chatDao.updateAssistantMessage(
                messageId = assistantMessage.id,
                content = response,
                reasoning = reasoning,
                isStreaming = false,
            )
            chatDao.touchSession(session.id, System.currentTimeMillis())
        }
    }
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
        val length = message.content.length
        if (window.isNotEmpty() && (window.size >= MAX_CONTEXT_MESSAGES || characterCount + length > MAX_CONTEXT_CHARACTERS)) {
            break
        }
        window.addFirst(RemoteMessage(message.role.lowercase(), message.content))
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
    reasoning = reasoning,
    createdAt = createdAt,
    isStreaming = isStreaming,
)

private fun ChatMessage.toEntity() = ChatMessageEntity(
    id = id,
    sessionId = sessionId,
    role = role.name,
    content = content,
    reasoning = reasoning,
    createdAt = createdAt,
    isStreaming = isStreaming,
)
