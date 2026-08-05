package com.zengjunjie.adaptivechat.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.zengjunjie.adaptivechat.BuildConfig
import com.zengjunjie.adaptivechat.data.AppPreferencesState
import com.zengjunjie.adaptivechat.data.AppearancePreference
import com.zengjunjie.adaptivechat.data.ChatAttachment
import com.zengjunjie.adaptivechat.data.ChatMessage
import com.zengjunjie.adaptivechat.data.ChatModel
import com.zengjunjie.adaptivechat.data.ChatRepository
import com.zengjunjie.adaptivechat.data.ChatSession
import com.zengjunjie.adaptivechat.data.LanguagePreference
import com.zengjunjie.adaptivechat.data.MessageRole
import com.zengjunjie.adaptivechat.data.ProviderMode
import com.zengjunjie.adaptivechat.data.ProfileAvatarUpload
import com.zengjunjie.adaptivechat.data.RemoteAppVersion
import com.zengjunjie.adaptivechat.data.SpeechPlayer
import com.zengjunjie.adaptivechat.data.UserPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job

enum class AppDestination {
    CHAT,
    SETTINGS,
}

sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState
    data object UpToDate : UpdateState
    data class Available(val version: RemoteAppVersion) : UpdateState
    data class Failure(val message: String) : UpdateState
}

sealed interface FeedbackState {
    data object Idle : FeedbackState
    data object Sending : FeedbackState
    data object Sent : FeedbackState
    data class Failure(val message: String) : FeedbackState
}

sealed interface ProfileUpdateState {
    data object Idle : ProfileUpdateState
    data object Saving : ProfileUpdateState
    data object Saved : ProfileUpdateState
    data class Failure(val message: String) : ProfileUpdateState
}

data class ChatUiState(
    val sessions: List<ChatSession> = emptyList(),
    val selectedSession: ChatSession? = null,
    val messages: List<ChatMessage> = emptyList(),
    val provider: ProviderMode = ProviderMode.CHATGPT,
    val model: ChatModel = ChatModel.CHATGPT_LITE,
    val channels: List<ProviderMode> = ProviderMode.entries,
    val webSearchAvailable: Boolean = false,
    val account: AppPreferencesState = AppPreferencesState(),
    val destination: AppDestination = AppDestination.CHAT,
    val isLoggingIn: Boolean = false,
    val loginError: String? = null,
    val isStreaming: Boolean = false,
    val isWaitingForFirstToken: Boolean = false,
    val errorMessage: String? = null,
    val updateState: UpdateState = UpdateState.Idle,
    val feedbackState: FeedbackState = FeedbackState.Idle,
    val profileUpdateState: ProfileUpdateState = ProfileUpdateState.Idle,
)

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModel(
    private val repository: ChatRepository,
    private val preferences: UserPreferences,
) : ViewModel() {
    private val selectedSessionId = MutableStateFlow<String?>(null)
    private val isStreaming = MutableStateFlow(false)
    private val isWaitingForFirstToken = MutableStateFlow(false)
    private val errorMessage = MutableStateFlow<String?>(null)
    private val destination = MutableStateFlow(AppDestination.CHAT)
    private val isLoggingIn = MutableStateFlow(false)
    private val loginError = MutableStateFlow<String?>(null)
    private val updateState = MutableStateFlow<UpdateState>(UpdateState.Idle)
    private val feedbackState = MutableStateFlow<FeedbackState>(FeedbackState.Idle)
    private val profileUpdateState = MutableStateFlow<ProfileUpdateState>(ProfileUpdateState.Idle)
    private val channelCatalog = MutableStateFlow(ProviderMode.entries)
    private val webSearchAvailable = MutableStateFlow(false)
    private var generationJob: Job? = null

    private val sessions = repository.observeSessions().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = emptyList(),
    )

    private val messages: Flow<List<ChatMessage>> = selectedSessionId.flatMapLatest { sessionId ->
        if (sessionId == null) flowOf(emptyList()) else repository.observeMessages(sessionId)
    }

    val uiState: StateFlow<ChatUiState> = combine(sessions, selectedSessionId, messages, preferences.state, channelCatalog) {
            availableSessions,
            currentSessionId,
            currentMessages,
            account,
            channels,
            ->
        fun resolveSession(session: ChatSession): ChatSession {
            val provider = channels.firstOrNull { it.wireName == session.provider.wireName } ?: session.provider
            val model = provider.models.firstOrNull { it.wireName == session.model.wireName } ?: provider.defaultModel
            return session.copy(provider = provider, model = model)
        }
        val resolvedSessions = availableSessions.map(::resolveSession)
        val selected = resolvedSessions.firstOrNull { it.id == currentSessionId }
        ChatUiState(
            sessions = resolvedSessions,
            selectedSession = selected,
            messages = currentMessages,
            provider = selected?.provider ?: ProviderMode.CHATGPT,
            model = selected?.model ?: ChatModel.CHATGPT_LITE,
            channels = channels,
            account = account,
        )
    }.combine(isStreaming) { state, streaming ->
        state.copy(isStreaming = streaming)
    }.combine(isWaitingForFirstToken) { state, waiting ->
        state.copy(isWaitingForFirstToken = waiting)
    }.combine(errorMessage) { state, error ->
        state.copy(errorMessage = error)
    }.combine(destination) { state, currentDestination ->
        state.copy(destination = currentDestination)
    }.combine(isLoggingIn) { state, pending ->
        state.copy(isLoggingIn = pending)
    }.combine(loginError) { state, error ->
        state.copy(loginError = error)
    }.combine(updateState) { state, update ->
        state.copy(updateState = update)
    }.combine(feedbackState) { state, feedback ->
        state.copy(feedbackState = feedback)
    }.combine(profileUpdateState) { state, profileUpdate ->
        state.copy(profileUpdateState = profileUpdate)
    }.combine(webSearchAvailable) { state, available ->
        state.copy(webSearchAvailable = available)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = ChatUiState(),
    )

    init {
        viewModelScope.launch(Dispatchers.IO) {
            selectedSessionId.value = repository.getOrCreateDefaultSession().id
        }
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { repository.fetchRemoteConfig() }
                .onSuccess { config ->
                    channelCatalog.value = config.channels
                    webSearchAvailable.value = config.webSearchEnabled
                }
        }
        viewModelScope.launch(Dispatchers.IO) {
            preferences.state
                .map { it.accessToken }
                .distinctUntilChanged()
                .collectLatest { accessToken ->
                    if (!accessToken.isNullOrBlank()) {
                        runCatching { repository.fetchProfile(accessToken) }
                            .onSuccess { profile -> preferences.saveProfile(profile.email, profile.displayName, profile.avatarUrl) }
                        runCatching {
                            repository.synchronizeFromServer(accessToken)
                            repository.getOrCreateDefaultSession()
                        }.onSuccess { session -> selectedSessionId.value = session.id }
                    }
                }
        }
    }

    fun login(email: String, password: String) {
        if (isLoggingIn.value) return
        val normalizedEmail = email.trim()
        if (normalizedEmail.isBlank() || password.length < 8) {
            loginError.value = "Enter your email and an 8-character password."
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            isLoggingIn.value = true
            loginError.value = null
            runCatching { repository.login(normalizedEmail, password) }
                .onSuccess { session ->
                    preferences.saveSession(session.accessToken, session.email, session.displayName, session.avatarUrl)
                }
                .onFailure { error -> loginError.value = error.message ?: "Sign-in failed." }
            isLoggingIn.value = false
        }
    }

    fun logout() {
        preferences.clearSession()
        destination.value = AppDestination.CHAT
        errorMessage.value = null
        loginError.value = null
        updateState.value = UpdateState.Idle
        feedbackState.value = FeedbackState.Idle
        profileUpdateState.value = ProfileUpdateState.Idle
    }

    fun selectSession(sessionId: String) {
        selectedSessionId.value = sessionId
        errorMessage.value = null
    }

    fun createSession() {
        viewModelScope.launch(Dispatchers.IO) {
            selectedSessionId.value = repository.createSession(
                uiState.value.provider,
                uiState.value.account.accessToken,
            ).id
        }
    }

    fun deleteSession(sessionId: String) {
        viewModelScope.launch(Dispatchers.IO) {
            repository.deleteSession(sessionId, uiState.value.account.accessToken)
            if (selectedSessionId.value == sessionId) {
                selectedSessionId.value = repository.getOrCreateDefaultSession().id
            }
        }
    }

    fun selectChannel(provider: ProviderMode) {
        val sessionId = selectedSessionId.value ?: return
        viewModelScope.launch(Dispatchers.IO) {
            repository.updateChannel(sessionId, provider, uiState.value.account.accessToken)
        }
    }

    fun selectModel(model: ChatModel) {
        val sessionId = selectedSessionId.value ?: return
        if (model.channelWireName != uiState.value.provider.wireName) return
        viewModelScope.launch(Dispatchers.IO) {
            repository.updateModel(sessionId, model, uiState.value.account.accessToken)
        }
    }

    fun sendMessage(
        text: String,
        attachments: List<ChatAttachment> = emptyList(),
        webSearchEnabled: Boolean = false,
    ) {
        val session = uiState.value.selectedSession ?: return
        val accessToken = uiState.value.account.accessToken ?: return
        if (isStreaming.value || (text.isBlank() && attachments.isEmpty())) return

        generationJob = viewModelScope.launch(Dispatchers.IO) {
            isStreaming.value = true
            isWaitingForFirstToken.value = true
            errorMessage.value = null
            runCatching {
                repository.sendMessage(
                    session = session,
                    text = text.trim(),
                    accessToken = accessToken,
                    attachments = attachments,
                    webSearchEnabled = webSearchEnabled,
                ) {
                    isWaitingForFirstToken.value = false
                }
            }
                .onFailure { error -> if (error !is CancellationException) errorMessage.value = error.message ?: "The streaming request failed." }
            isWaitingForFirstToken.value = false
            isStreaming.value = false
        }
    }

    fun redoAssistant(messageId: String) {
        val session = uiState.value.selectedSession ?: return
        val accessToken = uiState.value.account.accessToken ?: return
        if (isStreaming.value) return
        val terminal = uiState.value.messages.lastOrNull()
        if (terminal?.id != messageId || terminal.role != MessageRole.ASSISTANT) return

        generationJob = viewModelScope.launch(Dispatchers.IO) {
            isStreaming.value = true
            isWaitingForFirstToken.value = true
            errorMessage.value = null
            runCatching {
                repository.redoAssistant(session, messageId, accessToken) {
                    isWaitingForFirstToken.value = false
                }
            }.onFailure { error -> if (error !is CancellationException) errorMessage.value = error.message ?: "The streaming request failed." }
            isWaitingForFirstToken.value = false
            isStreaming.value = false
        }
    }

    fun editLatestUserMessage(
        messageId: String,
        text: String,
        attachments: List<ChatAttachment> = emptyList(),
        webSearchEnabled: Boolean = false,
    ) {
        val session = uiState.value.selectedSession ?: return
        val accessToken = uiState.value.account.accessToken ?: return
        if (isStreaming.value || (text.isBlank() && attachments.isEmpty())) return

        generationJob = viewModelScope.launch(Dispatchers.IO) {
            isStreaming.value = true
            isWaitingForFirstToken.value = true
            errorMessage.value = null
            runCatching {
                repository.editLatestUserMessage(
                    session = session,
                    userMessageId = messageId,
                    text = text.trim(),
                    attachments = attachments,
                    accessToken = accessToken,
                    webSearchEnabled = webSearchEnabled,
                ) {
                    isWaitingForFirstToken.value = false
                }
            }.onFailure { error -> if (error !is CancellationException) errorMessage.value = error.message ?: "The streaming request failed." }
            isWaitingForFirstToken.value = false
            isStreaming.value = false
        }
    }

    fun stopGeneration() {
        generationJob?.cancel()
        generationJob = null
        isWaitingForFirstToken.value = false
        isStreaming.value = false
    }

    fun deleteMessage(messageId: String) {
        val sessionId = uiState.value.selectedSession?.id ?: return
        val accessToken = uiState.value.account.accessToken
        val message = uiState.value.messages.firstOrNull { it.id == messageId } ?: return
        if (isStreaming.value) return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                if (message.role == com.zengjunjie.adaptivechat.data.MessageRole.USER) {
                    repository.deleteUserMessage(sessionId, messageId, accessToken)
                } else {
                    repository.deleteAssistantMessage(sessionId, messageId, accessToken)
                }
            }
                .onSuccess { errorMessage.value = null }
                .onFailure { errorMessage.value = it.message ?: "Unable to delete the message." }
        }
    }

    fun branchConversation(messageId: String) {
        val session = uiState.value.selectedSession ?: return
        if (isStreaming.value) return

        viewModelScope.launch(Dispatchers.IO) {
            runCatching { repository.branchConversation(session, messageId, uiState.value.account.accessToken) }
                .onSuccess { branch -> selectedSessionId.value = branch.id }
                .onFailure { errorMessage.value = it.message ?: "Unable to create a conversation branch." }
        }
    }

    fun listenToMessage(markdown: String, speechPlayer: SpeechPlayer) {
        val accessToken = uiState.value.account.accessToken ?: return
        if (markdown.isBlank()) return
        viewModelScope.launch(Dispatchers.IO) {
            speechPlayer.speak(accessToken, markdown)
        }
    }

    fun openSettings() {
        destination.value = AppDestination.SETTINGS
        updateState.value = UpdateState.Idle
        feedbackState.value = FeedbackState.Idle
        profileUpdateState.value = ProfileUpdateState.Idle
        refreshProfile()
    }

    fun closeSettings() {
        destination.value = AppDestination.CHAT
    }

    fun setLanguage(value: LanguagePreference) = preferences.setLanguage(value)

    fun setAppearance(value: AppearancePreference) = preferences.setAppearance(value)

    fun setFontScale(value: Float) = preferences.setFontScale(value)

    fun updateProfile(displayName: String, avatar: ProfileAvatarUpload?, removeAvatar: Boolean) {
        val token = uiState.value.account.accessToken ?: return
        if (profileUpdateState.value is ProfileUpdateState.Saving) return
        viewModelScope.launch(Dispatchers.IO) {
            profileUpdateState.value = ProfileUpdateState.Saving
            runCatching { repository.updateProfile(token, displayName.trim(), avatar, removeAvatar) }
                .onSuccess { profile ->
                    preferences.saveProfile(profile.email, profile.displayName, profile.avatarUrl)
                    profileUpdateState.value = ProfileUpdateState.Saved
                }
                .onFailure { error ->
                    profileUpdateState.value = ProfileUpdateState.Failure(error.message ?: "Unable to update your profile.")
                }
        }
    }

    fun dismissProfileUpdateState() {
        profileUpdateState.value = ProfileUpdateState.Idle
    }

    fun checkForUpdates() {
        if (updateState.value is UpdateState.Checking) return
        val accessToken = uiState.value.account.accessToken ?: return
        viewModelScope.launch(Dispatchers.IO) {
            updateState.value = UpdateState.Checking
            runCatching { repository.checkForUpdate(accessToken, BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME) }
                .onSuccess { result ->
                    updateState.value = when {
                        result.updateAvailable && result.latest != null -> UpdateState.Available(result.latest)
                        else -> UpdateState.UpToDate
                    }
                }
                .onFailure { error -> updateState.value = UpdateState.Failure(error.message ?: "Unable to check for updates.") }
        }
    }

    fun submitFeedback(message: String, category: String = "general") {
        val token = uiState.value.account.accessToken ?: return
        if (message.trim().length < 3 || feedbackState.value is FeedbackState.Sending) return
        viewModelScope.launch(Dispatchers.IO) {
            feedbackState.value = FeedbackState.Sending
            runCatching {
                repository.submitFeedback(
                    accessToken = token,
                    message = message.trim(),
                    category = category,
                    appVersion = BuildConfig.VERSION_NAME,
                    locale = localeTag(uiState.value.account.language),
                )
            }.onSuccess {
                feedbackState.value = FeedbackState.Sent
            }.onFailure { error ->
                feedbackState.value = FeedbackState.Failure(error.message ?: "Unable to send feedback.")
            }
        }
    }

    fun dismissError() {
        errorMessage.value = null
    }

    fun dismissLoginError() {
        loginError.value = null
    }

    fun dismissFeedbackState() {
        feedbackState.value = FeedbackState.Idle
    }

    private fun refreshProfile() {
        val token = uiState.value.account.accessToken ?: return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { repository.fetchProfile(token) }
                .onSuccess { profile -> preferences.saveProfile(profile.email, profile.displayName, profile.avatarUrl) }
        }
    }

    private fun localeTag(preference: LanguagePreference) = when (preference) {
        LanguagePreference.SYSTEM -> "system"
        LanguagePreference.ENGLISH -> "en"
        LanguagePreference.CHINESE -> "zh-CN"
    }

    companion object {
        fun factory(repository: ChatRepository, preferences: UserPreferences): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                require(modelClass.isAssignableFrom(ChatViewModel::class.java))
                return ChatViewModel(repository, preferences) as T
            }
        }
    }
}
