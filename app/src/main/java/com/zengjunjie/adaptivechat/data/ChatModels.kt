package com.zengjunjie.adaptivechat.data

import java.util.UUID

data class ChatModel(
    val wireName: String,
    val channelWireName: String,
    val displayName: String,
    val description: String = "",
    val isExpertRaw: Boolean = false,
) {
    companion object {
        val CHATGPT_LITE = ChatModel("chatgpt-lite", "chatgpt", "Lite")
        val CHATGPT_STANDARD = ChatModel("chatgpt-standard", "chatgpt", "Standard")
        val CHATGPT_PRO = ChatModel("chatgpt-pro", "chatgpt", "Pro")
        val GEMINI_FLASH = ChatModel("gemini-flash", "gemini", "Flash")
        val GEMINI_STANDARD = ChatModel("gemini-standard", "gemini", "Standard")
        val GEMINI_EXTENDED = ChatModel("gemini-extended", "gemini", "Extended")
        val DEEPSEEK_FLASH = ChatModel("deepseek-flash", "deepseek", "Flash")
        val DEEPSEEK_EXPERT = ChatModel("deepseek-expert", "deepseek", "Expert")
        val entries = listOf(
            CHATGPT_LITE, CHATGPT_STANDARD, CHATGPT_PRO,
            GEMINI_FLASH, GEMINI_STANDARD, GEMINI_EXTENDED,
            DEEPSEEK_FLASH, DEEPSEEK_EXPERT,
        )

        fun fromWireName(value: String, fallback: ProviderMode): ChatModel =
            entries.firstOrNull { it.wireName == value && it.channelWireName == fallback.wireName }
                ?: fallback.models.firstOrNull { it.wireName == value }
                ?: ChatModel(
                    wireName = value,
                    channelWireName = fallback.wireName,
                    displayName = value,
                    isExpertRaw = true,
                )
    }
}

data class ChannelStyle(
    val backgroundStart: String,
    val backgroundEnd: String,
    val accentColor: String,
    val textColor: String,
    val surfaceColor: String,
    val typography: String = "sans",
    val animatedGradient: Boolean = false,
    val gradientColors: List<String> = listOf(backgroundStart, backgroundEnd),
    val gradientAngleDegrees: Float = 135f,
    val animationDurationMillis: Int = 8_000,
    val customCss: String = "",
)

data class ProviderMode(
    val wireName: String,
    val displayName: String,
    val description: String,
    val iconDataUrl: String,
    val style: ChannelStyle,
    val models: List<ChatModel>,
    val appIconUrl: String = "",
) {
    val defaultModel: ChatModel get() = models.first()
    val isChatGpt: Boolean get() = wireName == "chatgpt"
    val isGemini: Boolean get() = wireName == "gemini"
    val isDeepSeek: Boolean get() = wireName == "deepseek"

    companion object {
        val CHATGPT = ProviderMode(
            wireName = "chatgpt",
            displayName = "ChatGPT",
            description = "Minimal and focused",
            iconDataUrl = "",
            style = ChannelStyle("#FAFAFA", "#FAFAFA", "#1A1A1A", "#202123", "#FFFFFF"),
            models = listOf(ChatModel.CHATGPT_LITE, ChatModel.CHATGPT_STANDARD, ChatModel.CHATGPT_PRO),
        )
        val GEMINI = ProviderMode(
            wireName = "gemini",
            displayName = "Gemini",
            description = "Colorful Material intelligence",
            iconDataUrl = "",
            style = ChannelStyle("#EAF0FF", "#F7EEFF", "#315FD6", "#202124", "#FCFBFF", animatedGradient = true),
            models = listOf(ChatModel.GEMINI_FLASH, ChatModel.GEMINI_STANDARD, ChatModel.GEMINI_EXTENDED),
        )
        val DEEPSEEK = ProviderMode(
            wireName = "deepseek",
            displayName = "DeepSeek",
            description = "Technical reasoning workspace",
            iconDataUrl = "",
            style = ChannelStyle("#F4FAF9", "#E2F0EE", "#00695C", "#17213A", "#F8FCFC", typography = "mono"),
            models = listOf(ChatModel.DEEPSEEK_FLASH, ChatModel.DEEPSEEK_EXPERT),
        )
        val entries = listOf(CHATGPT, GEMINI, DEEPSEEK)

        fun fromWireName(value: String): ProviderMode =
            entries.firstOrNull { it.wireName == value || (value == "openai" && it.isChatGpt) }
                ?: ProviderMode(
                    wireName = value,
                    displayName = value.replace('-', ' ').replaceFirstChar(Char::uppercase),
                    description = "",
                    iconDataUrl = "",
                    style = ChannelStyle("#F7F9F8", "#EEF3F1", "#087F73", "#172126", "#FFFFFF"),
                    models = listOf(ChatModel("$value-standard", value, "Standard")),
                )
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
    val attachments: List<ChatAttachment>,
    val reasoning: String,
    val createdAt: Long,
    val isStreaming: Boolean,
    val modelId: String,
    val errorText: String,
    val parentMessageId: String = "",
    val updatedAt: Long = createdAt,
)

/**
 * A vision attachment persisted with its user message. [dataUrl] is passed through to
 * OpenAI-compatible upstreams as an image_url content part.
 */
data class ChatAttachment(
    val fileName: String,
    val mimeType: String,
    val dataUrl: String,
)

fun newId(): String = UUID.randomUUID().toString()
