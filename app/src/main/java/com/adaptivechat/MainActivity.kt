package com.adaptivechat

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.adaptivechat.ui.AdaptiveChatTheme
import com.adaptivechat.ui.ChatScreen
import com.adaptivechat.ui.ChatViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val repository = (application as AdaptiveChatApplication).chatRepository

        setContent {
            val viewModel: ChatViewModel = viewModel(
                factory = ChatViewModel.factory(repository),
            )
            val state = viewModel.uiState.collectAsStateWithLifecycle().value
            AdaptiveChatTheme(provider = state.provider) {
                AnimatedContent(
                    targetState = state.provider,
                    transitionSpec = { fadeIn() togetherWith fadeOut() },
                    label = "channel-transition",
                ) {
                    ChatScreen(state = state, viewModel = viewModel)
                }
            }
        }
    }
}
