package com.adaptivechat.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.adaptivechat.data.ChatMessage
import com.adaptivechat.data.ChatModel
import com.adaptivechat.data.ChatRepository
import com.adaptivechat.data.ChatSession
import com.adaptivechat.data.ProviderMode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class ChatUiState(
    val sessions: List<ChatSession> = emptyList(),
    val selectedSession: ChatSession? = null,
    val messages: List<ChatMessage> = emptyList(),
    val provider: ProviderMode = ProviderMode.CHATGPT,
    val model: ChatModel = ChatModel.CHATGPT_LITE,
    val isStreaming: Boolean = false,
    val isWaitingForFirstToken: Boolean = false,
    val errorMessage: String? = null,
)

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModel(
    private val repository: ChatRepository,
) : ViewModel() {
    private val selectedSessionId = MutableStateFlow<String?>(null)
    private val isStreaming = MutableStateFlow(false)
    private val isWaitingForFirstToken = MutableStateFlow(false)
    private val errorMessage = MutableStateFlow<String?>(null)

    private val sessions = repository.observeSessions().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = emptyList(),
    )

    private val messages: Flow<List<ChatMessage>> = selectedSessionId.flatMapLatest { sessionId ->
        if (sessionId == null) flowOf(emptyList()) else repository.observeMessages(sessionId)
    }

    val uiState: StateFlow<ChatUiState> = combine(sessions, selectedSessionId, messages) {
            availableSessions,
            currentSessionId,
            currentMessages,
            ->
        val selected = availableSessions.firstOrNull { it.id == currentSessionId }
        ChatUiState(
            sessions = availableSessions,
            selectedSession = selected,
            messages = currentMessages,
            provider = selected?.provider ?: ProviderMode.CHATGPT,
            model = selected?.model ?: ChatModel.CHATGPT_LITE,
        )
    }.combine(isStreaming) { state, streaming ->
        state.copy(isStreaming = streaming)
    }.combine(isWaitingForFirstToken) { state, waiting ->
        state.copy(isWaitingForFirstToken = waiting)
    }.combine(errorMessage) { state, error ->
        state.copy(errorMessage = error)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = ChatUiState(),
    )

    init {
        viewModelScope.launch(Dispatchers.IO) {
            selectedSessionId.value = repository.getOrCreateDefaultSession().id
        }
    }

    fun selectSession(sessionId: String) {
        selectedSessionId.value = sessionId
        errorMessage.value = null
    }

    fun createSession() {
        viewModelScope.launch(Dispatchers.IO) {
            selectedSessionId.value = repository.createSession(uiState.value.provider).id
        }
    }

    fun deleteSession(sessionId: String) {
        viewModelScope.launch(Dispatchers.IO) {
            repository.deleteSession(sessionId)
            if (selectedSessionId.value == sessionId) {
                selectedSessionId.value = repository.getOrCreateDefaultSession().id
            }
        }
    }

    fun selectChannel(provider: ProviderMode) {
        val sessionId = selectedSessionId.value ?: return
        viewModelScope.launch(Dispatchers.IO) {
            repository.updateChannel(sessionId, provider)
        }
    }

    fun selectModel(model: ChatModel) {
        val sessionId = selectedSessionId.value ?: return
        if (model.channelWireName != uiState.value.provider.wireName) return
        viewModelScope.launch(Dispatchers.IO) {
            repository.updateModel(sessionId, model)
        }
    }

    fun sendMessage(text: String) {
        val session = uiState.value.selectedSession ?: return
        if (isStreaming.value || text.isBlank()) return

        viewModelScope.launch(Dispatchers.IO) {
            isStreaming.value = true
            isWaitingForFirstToken.value = true
            errorMessage.value = null
            runCatching {
                repository.sendMessage(session, text.trim()) {
                    isWaitingForFirstToken.value = false
                }
            }
                .onFailure { errorMessage.value = it.message ?: "The streaming request failed." }
            isWaitingForFirstToken.value = false
            isStreaming.value = false
        }
    }

    fun dismissError() {
        errorMessage.value = null
    }

    companion object {
        fun factory(repository: ChatRepository): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                require(modelClass.isAssignableFrom(ChatViewModel::class.java))
                return ChatViewModel(repository) as T
            }
        }
    }
}
