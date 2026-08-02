package com.zengjunjie.adaptivechat.data

import java.util.UUID

enum class ChatModel(
    val wireName: String,
    val channelWireName: String,
    val displayName: String,
) {
    CHATGPT_LITE("chatgpt-lite", "openai", "Lite"),
    CHATGPT_STANDARD("chatgpt-standard", "openai", "Standard"),
    CHATGPT_PRO("chatgpt-pro", "openai", "Pro"),
    GEMINI_FLASH("gemini-flash", "gemini", "Flash"),
    GEMINI_STANDARD("gemini-standard", "gemini", "Standard"),
    GEMINI_EXTENDED("gemini-extended", "gemini", "Extended"),
    DEEPSEEK_FLASH("deepseek-flash", "deepseek", "Flash"),
    DEEPSEEK_EXPERT("deepseek-expert", "deepseek", "Expert");

    companion object {
        fun fromWireName(value: String, fallback: ProviderMode): ChatModel =
            entries.firstOrNull { it.wireName == value && it.channelWireName == fallback.wireName }
                ?: fallback.defaultModel
    }
}

enum class ProviderMode(
    val wireName: String,
    val displayName: String,
    val defaultModel: ChatModel,
) {
    CHATGPT("openai", "ChatGPT", ChatModel.CHATGPT_LITE),
    GEMINI("gemini", "Gemini", ChatModel.GEMINI_FLASH),
    DEEPSEEK("deepseek", "DeepSeek", ChatModel.DEEPSEEK_FLASH);

    val models: List<ChatModel>
        get() = ChatModel.entries.filter { it.channelWireName == wireName }

    companion object {
        fun fromWireName(value: String): ProviderMode =
            entries.firstOrNull { it.wireName == value } ?: CHATGPT
    }
}

enum class MessageRole {
    SYSTEM,
    USER,
    ASSISTANT,
}

data class ChatSession(
    val id: String,
    val title: String,
    val provider: ProviderMode,
    val model: ChatModel,
    val systemPrompt: String,
    val updatedAt: Long,
)

data class ChatMessage(
    val id: String,
    val sessionId: String,
    val role: MessageRole,
    val content: String,
    val reasoning: String,
    val createdAt: Long,
    val isStreaming: Boolean,
)

fun newId(): String = UUID.randomUUID().toString()
