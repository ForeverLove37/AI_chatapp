package com.zengjunjie.adaptivechat

import android.os.Bundle
import androidx.activity.compose.BackHandler
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.zengjunjie.adaptivechat.ui.AdaptiveChatTheme
import com.zengjunjie.adaptivechat.ui.AppDestination
import com.zengjunjie.adaptivechat.ui.AppCopyProvider
import com.zengjunjie.adaptivechat.ui.ChatScreen
import com.zengjunjie.adaptivechat.ui.ChatViewModel
import com.zengjunjie.adaptivechat.ui.LoginScreen
import com.zengjunjie.adaptivechat.ui.SettingsScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val repository = (application as AdaptiveChatApplication).chatRepository
        val preferences = (application as AdaptiveChatApplication).userPreferences

        setContent {
            val viewModel: ChatViewModel = viewModel(
                factory = ChatViewModel.factory(repository, preferences),
            )
            val state = viewModel.uiState.collectAsStateWithLifecycle().value
            AdaptiveChatTheme(
                provider = state.provider,
                appearance = state.account.appearance,
                fontScale = state.account.fontScale,
            ) {
                AppCopyProvider(language = state.account.language) {
                    BackHandler(
                        enabled = state.account.isAuthenticated && state.destination == AppDestination.SETTINGS,
                    ) {
                        viewModel.closeSettings()
                    }
                    AnimatedContent(
                    targetState = when {
                        !state.account.isAuthenticated -> "login"
                        state.destination == AppDestination.SETTINGS -> "settings"
                        else -> "chat-${state.provider.wireName}"
                    },
                    transitionSpec = { fadeIn() togetherWith fadeOut() },
                    label = "app-destination-transition",
                    ) {
                        when {
                        !state.account.isAuthenticated -> LoginScreen(
                            isLoading = state.isLoggingIn,
                            errorMessage = state.loginError,
                            onDismissError = viewModel::dismissLoginError,
                            onLogin = viewModel::login,
                        )
                        state.destination == AppDestination.SETTINGS -> SettingsScreen(
                            state = state,
                            onBack = viewModel::closeSettings,
                            onCheckForUpdates = viewModel::checkForUpdates,
                            onDismissFeedbackState = viewModel::dismissFeedbackState,
                            onLogout = viewModel::logout,
                            onSetAppearance = viewModel::setAppearance,
                            onSetFontScale = viewModel::setFontScale,
                            onSetLanguage = viewModel::setLanguage,
                            onSubmitFeedback = viewModel::submitFeedback,
                        )
                        else -> ChatScreen(
                            state = state,
                            viewModel = viewModel,
                            onOpenSettings = viewModel::openSettings,
                        )
                        }
                    }
                }
            }
        }
    }
}
