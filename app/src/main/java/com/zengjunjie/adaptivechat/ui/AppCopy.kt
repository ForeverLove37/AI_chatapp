package com.zengjunjie.adaptivechat.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalConfiguration
import com.zengjunjie.adaptivechat.data.ChatModel
import com.zengjunjie.adaptivechat.data.LanguagePreference
import com.zengjunjie.adaptivechat.data.ProviderMode

data class AppCopy(
    val signIn: String,
    val signInDescription: String,
    val email: String,
    val password: String,
    val conversations: String,
    val settings: String,
    val profile: String,
    val displayName: String,
    val chooseAvatar: String,
    val removeAvatar: String,
    val saveProfile: String,
    val savingProfile: String,
    val profileSaved: String,
    val avatarError: String,
    val language: String,
    val languageDetail: String,
    val appearance: String,
    val appearanceDetail: String,
    val textSize: String,
    val textSizeDetail: String,
    val updates: String,
    val checkingUpdates: String,
    val upToDate: String,
    val downloadUpdate: String,
    val checkUpdates: String,
    val feedback: String,
    val feedbackDetail: String,
    val feedbackPrompt: String,
    val sendingFeedback: String,
    val feedbackSent: String,
    val sendFeedback: String,
    val dismiss: String,
    val signedIn: String,
    val signOut: String,
    val system: String,
    val english: String,
    val chinese: String,
    val light: String,
    val dark: String,
    val close: String,
    val delete: String,
    val cancel: String,
    val deleteConversation: String,
    val deleteConversationPrompt: (String) -> String,
    val confirm: String,
    val deleteMessageTitle: String,
    val deleteMessagePrompt: String,
    val branchConversationTitle: String,
    val branchConversationPrompt: String,
    val redo: String,
    val copyMessage: String,
    val editMessage: String,
    val editingMessage: String,
    val messageActions: String,
    val branch: String,
    val listen: String,
    val attachFile: String,
    val voiceInput: String,
    val webSearch: String,
    val webSearchEnabled: String,
    val removeAttachment: String,
    val attachmentError: String,
    val speechInputUnavailable: String,
    val selectChannel: String,
    val selectModel: String,
    val streamingError: String,
    val connecting: String,
    val reasoningComplete: String,
    val newConversation: String,
    val currentVersion: (String) -> String,
    val versionAvailable: (String) -> String,
    val reasoning: (Long) -> String,
    val messagePlaceholder: (String) -> String,
    val welcome: (ProviderMode) -> String,
) {
    fun providerName(provider: ProviderMode) = when (provider.wireName) {
        ProviderMode.CHATGPT.wireName -> "ChatGPT"
        ProviderMode.GEMINI.wireName -> "Gemini"
        ProviderMode.DEEPSEEK.wireName -> "DeepSeek"
        else -> provider.displayName
    }

    fun modelName(model: ChatModel) = when (model.wireName) {
        ChatModel.CHATGPT_LITE.wireName -> if (this === ChineseCopy) "轻量" else "Lite"
        ChatModel.CHATGPT_STANDARD.wireName -> if (this === ChineseCopy) "标准" else "Standard"
        ChatModel.CHATGPT_PRO.wireName -> if (this === ChineseCopy) "专业" else "Pro"
        ChatModel.GEMINI_FLASH.wireName -> if (this === ChineseCopy) "极速" else "Flash"
        ChatModel.GEMINI_STANDARD.wireName -> if (this === ChineseCopy) "标准" else "Standard"
        ChatModel.GEMINI_EXTENDED.wireName -> if (this === ChineseCopy) "扩展" else "Extended"
        ChatModel.DEEPSEEK_FLASH.wireName -> if (this === ChineseCopy) "极速" else "Flash"
        ChatModel.DEEPSEEK_EXPERT.wireName -> if (this === ChineseCopy) "专家" else "Expert"
        else -> model.displayName
    }

    fun sessionTitle(title: String): String {
        val branched = title.endsWith(" (branch)")
        val base = if (branched) title.removeSuffix(" (branch)") else title
        val localizedBase = if (base == "New conversation") newConversation else base
        return if (branched) {
            "$localizedBase (${if (this === ChineseCopy) "分支" else "branch"})"
        } else {
            localizedBase
        }
    }

    fun localizedError(message: String) = if (this === ChineseCopy) {
        when {
            message == "Enter your email and an 8-character password." -> "请输入邮箱和至少 8 个字符的密码。"
            message == "Sign-in failed." -> "登录失败。"
            message == "The streaming request failed." -> "流式请求失败。"
            message == "Unable to check for updates." -> "无法检查更新。"
            message == "Unable to send feedback." -> "无法发送反馈。"
            message == "Avatar images must be 2 MB or smaller." -> "头像图片不能超过 2 MB。"
            message == "Choose a JPEG, PNG, or WEBP avatar image." -> "请选择 JPEG、PNG 或 WEBP 头像图片。"
            message == "Choose a valid JPEG, PNG, or WEBP avatar image." -> "请选择有效的 JPEG、PNG 或 WEBP 头像图片。"
            message == "The avatar image could not be decoded." -> "无法解析头像图片。"
            message == "The avatar image could not be processed." -> "无法处理头像图片。"
            message == "Unable to update your profile." -> "无法更新个人资料。"
            message == "Unable to update the user profile." -> "无法更新个人资料。"
            message == "A display name or avatar change is required." -> "请输入显示名称或选择头像变更。"
            message == "Display name must be 80 characters or fewer." -> "显示名称不能超过 80 个字符。"
            message == "The server returned an incomplete sign-in response." -> "服务器返回了不完整的登录响应。"
            message == "The server returned an invalid response." -> "服务器返回了无效响应。"
            message == "Invalid email or password." -> "邮箱或密码无效。"
            message == "Sign in is required to use chat." -> "需要登录后才能使用聊天。"
            message == "Sign in is required for this action." -> "需要登录后才能执行此操作。"
            message == "Your session is no longer active." -> "当前登录会话已失效。"
            message == "Your account has reached its requests-per-minute limit." -> "账户已达到每分钟请求上限。"
            message == "Your account has reached its daily quota." -> "账户已达到每日配额。"
            message == "Invalid chat completion request." -> "聊天请求无效。"
            message == "The upstream request failed." -> "上游请求失败。"
            message == "You can attach up to 3 images at once." -> "一次最多可添加 3 张图片。"
            message == "The selected file has no supported image type." -> "所选文件没有受支持的图片类型。"
            message == "Choose a JPEG, PNG, WEBP, or GIF image." -> "请选择 JPEG、PNG、WEBP 或 GIF 图片。"
            message == "Images must be 4 MB or smaller." -> "图片大小不能超过 4 MB。"
            message == "The selected image could not be read." -> "无法读取所选图片。"
            message == "The response was not found." -> "未找到该回复。"
            message == "Only assistant responses can be redone." -> "只能重新生成助手回复。"
            message == "A preceding user message is required." -> "需要一条在前的用户消息。"
            message == "The message was not found." -> "未找到该消息。"
            message == "Only user messages can be edited." -> "只能编辑用户消息。"
            message == "Only the latest user message can be edited." -> "只能编辑最新一条用户消息。"
            message == "The edited message cannot be empty." -> "编辑后的消息不能为空。"
            message == "Only assistant messages can be deleted." -> "只能删除助手消息。"
            message == "The message could not be deleted." -> "无法删除该消息。"
            message == "The selected message was not found." -> "未找到所选消息。"
            message == "Unable to delete the message." -> "无法删除消息。"
            message == "Unable to create a conversation branch." -> "无法创建会话分支。"
            message == "The server returned invalid configuration." -> "服务器返回了无效配置。"
            message == "The speech service returned no audio." -> "语音服务没有返回音频。"
            message.startsWith("Configuration request failed with HTTP") ->
                "配置请求失败：${message.removePrefix("Configuration request failed with HTTP ")}"
            message.startsWith("Speech request failed with HTTP") ->
                "语音请求失败：${message.removePrefix("Speech request failed with HTTP ")}"
            message.startsWith("Request failed with HTTP") -> "请求失败：${message.removePrefix("Request failed with HTTP ")}"
            message.startsWith("Streaming request failed with HTTP") -> "流式请求失败：${message.removePrefix("Streaming request failed with HTTP ")}"
            message.startsWith("Web search failed:") -> "网页搜索失败，请检查搜索提供商配置。"
            message == "No enabled web search provider is available." -> "没有可用的网页搜索提供商。"
            message.startsWith("Unknown or disabled model:") -> "所选模型不存在或已禁用。"
            message.startsWith("No ") && message.contains(" upstream is configured") -> "所选频道尚未配置可用上游。"
            message.startsWith("Upstream returned HTTP") -> "上游服务请求失败：${message.removePrefix("Upstream returned HTTP ")}"
            else -> message
        }
    } else {
        message
    }
}

private val EnglishCopy = AppCopy(
    signIn = "Sign in",
    signInDescription = "Use the account created for you in the admin console.",
    email = "Email",
    password = "Password",
    conversations = "Conversations",
    settings = "Settings",
    profile = "Profile",
    displayName = "Display name",
    chooseAvatar = "Choose avatar",
    removeAvatar = "Remove avatar",
    saveProfile = "Save profile",
    savingProfile = "Saving profile",
    profileSaved = "Profile saved.",
    avatarError = "The avatar could not be read.",
    language = "Language",
    languageDetail = "Choose how the app is displayed.",
    appearance = "Appearance",
    appearanceDetail = "Use system colors or choose a light or dark interface.",
    textSize = "Text size",
    textSizeDetail = "Adjust message and interface text.",
    updates = "App updates",
    checkingUpdates = "Checking for updates",
    upToDate = "You are using the latest version.",
    downloadUpdate = "Download update",
    checkUpdates = "Check for updates",
    feedback = "Feedback",
    feedbackDetail = "Send a note directly to the product team.",
    feedbackPrompt = "What would you like to share?",
    sendingFeedback = "Sending feedback",
    feedbackSent = "Feedback sent.",
    sendFeedback = "Send feedback",
    dismiss = "Dismiss",
    signedIn = "Signed in",
    signOut = "Sign out",
    system = "System",
    english = "English",
    chinese = "Chinese",
    light = "Light",
    dark = "Dark",
    close = "Close",
    delete = "Delete",
    cancel = "Cancel",
    deleteConversation = "Delete conversation?",
    deleteConversationPrompt = { title -> "\"$title\" and its messages will be permanently removed." },
    confirm = "Confirm",
    deleteMessageTitle = "Delete message?",
    deleteMessagePrompt = "This message will be permanently removed. Deleting a user message also deletes its paired response.",
    branchConversationTitle = "Create conversation branch?",
    branchConversationPrompt = "A new conversation will be created from this point in the history.",
    redo = "Redo response",
    copyMessage = "Copy raw Markdown",
    editMessage = "Edit message",
    editingMessage = "Editing message",
    messageActions = "Message actions",
    branch = "Branch conversation",
    listen = "Listen",
    attachFile = "Attach image",
    voiceInput = "Voice input",
    webSearch = "Web Search",
    webSearchEnabled = "Web Search enabled for this query",
    removeAttachment = "Remove attachment",
    attachmentError = "Attachment unavailable",
    speechInputUnavailable = "Speech recognition is unavailable on this device.",
    selectChannel = "Select channel",
    selectModel = "Select model",
    streamingError = "Streaming error",
    connecting = "Connecting",
    reasoningComplete = "Reasoning complete",
    newConversation = "New conversation",
    currentVersion = { version -> "Current version $version" },
    versionAvailable = { version -> "Version $version is available." },
    reasoning = { seconds -> "Reasoning ${seconds}s" },
    messagePlaceholder = { provider -> "Message $provider" },
    welcome = { provider -> when {
        provider.isChatGpt -> "How can I help today?"
        provider.isGemini -> "What's next?"
        provider.isDeepSeek -> "Start a precise session"
        else -> "Start a ${provider.displayName} conversation"
    } },
)

private val ChineseCopy = AppCopy(
    signIn = "登录",
    signInDescription = "使用管理员为你创建的账户登录。",
    email = "邮箱",
    password = "密码",
    conversations = "会话",
    settings = "设置",
    profile = "个人资料",
    displayName = "显示名称",
    chooseAvatar = "选择头像",
    removeAvatar = "移除头像",
    saveProfile = "保存资料",
    savingProfile = "正在保存资料",
    profileSaved = "个人资料已保存。",
    avatarError = "无法读取头像图片。",
    language = "语言",
    languageDetail = "选择应用显示语言。",
    appearance = "外观",
    appearanceDetail = "跟随系统，或选择浅色和深色界面。",
    textSize = "文字大小",
    textSizeDetail = "调整消息和界面文字。",
    updates = "应用更新",
    checkingUpdates = "正在检查更新",
    upToDate = "你正在使用最新版本。",
    downloadUpdate = "下载更新",
    checkUpdates = "检查更新",
    feedback = "反馈",
    feedbackDetail = "直接向产品团队发送反馈。",
    feedbackPrompt = "想和我们分享什么？",
    sendingFeedback = "正在发送反馈",
    feedbackSent = "反馈已发送。",
    sendFeedback = "发送反馈",
    dismiss = "关闭",
    signedIn = "已登录",
    signOut = "退出登录",
    system = "跟随系统",
    english = "English",
    chinese = "中文",
    light = "浅色",
    dark = "深色",
    close = "关闭",
    delete = "删除",
    cancel = "取消",
    deleteConversation = "删除会话？",
    deleteConversationPrompt = { title -> "\"$title\" 及其所有消息将被永久删除。" },
    confirm = "确认",
    deleteMessageTitle = "删除消息？",
    deleteMessagePrompt = "该消息将被永久删除。删除用户消息时，其配对的 AI 回复也会一并删除。",
    branchConversationTitle = "创建会话分支？",
    branchConversationPrompt = "将从当前历史位置创建一个新会话。",
    redo = "重新生成",
    copyMessage = "复制 Markdown 原文",
    editMessage = "编辑消息",
    editingMessage = "正在编辑消息",
    messageActions = "消息操作",
    branch = "创建分支会话",
    listen = "朗读",
    attachFile = "添加图片",
    voiceInput = "语音输入",
    webSearch = "网页搜索",
    webSearchEnabled = "本次提问已启用网页搜索",
    removeAttachment = "移除附件",
    attachmentError = "附件不可用",
    speechInputUnavailable = "此设备无法使用语音识别。",
    selectChannel = "选择频道",
    selectModel = "选择模型",
    streamingError = "流式响应错误",
    connecting = "正在连接",
    reasoningComplete = "推理完成",
    newConversation = "新会话",
    currentVersion = { version -> "当前版本 $version" },
    versionAvailable = { version -> "发现新版本 $version。" },
    reasoning = { seconds -> "正在推理 ${seconds}秒" },
    messagePlaceholder = { provider -> "向 $provider 发送消息" },
    welcome = { provider -> when {
        provider.isChatGpt -> "今天想聊些什么？"
        provider.isGemini -> "接下来做什么？"
        provider.isDeepSeek -> "开始一次精确对话"
        else -> "开始 ${provider.displayName} 会话"
    } },
)

val LocalAppCopy = staticCompositionLocalOf { EnglishCopy }

@Composable
fun AppCopyProvider(language: LanguagePreference, content: @Composable () -> Unit) {
    val systemLanguage = LocalConfiguration.current.locales[0].language
    val copy = when (language) {
        LanguagePreference.SYSTEM -> if (systemLanguage.equals("zh", ignoreCase = true)) ChineseCopy else EnglishCopy
        LanguagePreference.ENGLISH -> EnglishCopy
        LanguagePreference.CHINESE -> ChineseCopy
    }
    CompositionLocalProvider(LocalAppCopy provides copy, content = content)
}
