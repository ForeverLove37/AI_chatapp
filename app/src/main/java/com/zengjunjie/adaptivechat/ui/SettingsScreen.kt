package com.zengjunjie.adaptivechat.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Feedback
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material.icons.outlined.TextFields
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.zengjunjie.adaptivechat.BuildConfig
import com.zengjunjie.adaptivechat.data.AppearancePreference
import com.zengjunjie.adaptivechat.data.LanguagePreference

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    state: ChatUiState,
    onBack: () -> Unit,
    onCheckForUpdates: () -> Unit,
    onDismissFeedbackState: () -> Unit,
    onLogout: () -> Unit,
    onSetAppearance: (AppearancePreference) -> Unit,
    onSetFontScale: (Float) -> Unit,
    onSetLanguage: (LanguagePreference) -> Unit,
    onSubmitFeedback: (String) -> Unit,
) {
    val copy = LocalAppCopy.current
    val uriHandler = LocalUriHandler.current
    var feedback by rememberSaveable { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(copy.settings) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = copy.close)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                SettingsSection(
                    icon = { Icon(Icons.Outlined.Language, contentDescription = null) },
                    title = copy.language,
                    detail = copy.languageDetail,
                ) {
                    ChoiceRow(
                        options = listOf(
                            LanguagePreference.SYSTEM to copy.system,
                            LanguagePreference.ENGLISH to copy.english,
                            LanguagePreference.CHINESE to copy.chinese,
                        ),
                        selected = state.account.language,
                        onSelected = onSetLanguage,
                    )
                }
            }
            item {
                SettingsSection(
                    icon = { Icon(Icons.Outlined.Palette, contentDescription = null) },
                    title = copy.appearance,
                    detail = copy.appearanceDetail,
                ) {
                    ChoiceRow(
                        options = listOf(
                            AppearancePreference.SYSTEM to copy.system,
                            AppearancePreference.LIGHT to copy.light,
                            AppearancePreference.DARK to copy.dark,
                        ),
                        selected = state.account.appearance,
                        onSelected = onSetAppearance,
                    )
                }
            }
            item {
                SettingsSection(
                    icon = { Icon(Icons.Outlined.TextFields, contentDescription = null) },
                    title = copy.textSize,
                    detail = copy.textSizeDetail,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("A", style = MaterialTheme.typography.labelMedium)
                        Slider(
                            value = state.account.fontScale,
                            onValueChange = onSetFontScale,
                            valueRange = 0.85f..1.35f,
                            steps = 4,
                            modifier = Modifier.weight(1f).padding(horizontal = 10.dp),
                        )
                        Text("A", style = MaterialTheme.typography.titleLarge)
                    }
                }
            }
            item {
                SettingsSection(
                    icon = { Icon(Icons.Outlined.SystemUpdate, contentDescription = null) },
                    title = copy.updates,
                    detail = copy.currentVersion(BuildConfig.VERSION_NAME),
                ) {
                    when (val update = state.updateState) {
                        UpdateState.Checking -> Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(10.dp))
                            Text(copy.checkingUpdates)
                        }
                        UpdateState.UpToDate -> Text(copy.upToDate, color = MaterialTheme.colorScheme.primary)
                        is UpdateState.Available -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(copy.versionAvailable(update.version.versionName), fontWeight = FontWeight.SemiBold)
                            if (update.version.releaseNotes.isNotBlank()) Text(update.version.releaseNotes, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Button(onClick = { uriHandler.openUri(update.version.downloadUrl) }) {
                                Icon(Icons.Outlined.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(7.dp))
                                Text(copy.downloadUpdate)
                            }
                        }
                        is UpdateState.Failure -> Text(copy.localizedError(update.message), color = MaterialTheme.colorScheme.error)
                        UpdateState.Idle -> Unit
                    }
                    if (state.updateState !is UpdateState.Checking) {
                        OutlinedButton(onClick = onCheckForUpdates, modifier = Modifier.padding(top = 10.dp)) {
                            Text(copy.checkUpdates)
                        }
                    }
                }
            }
            item {
                SettingsSection(
                    icon = { Icon(Icons.Outlined.Feedback, contentDescription = null) },
                    title = copy.feedback,
                    detail = copy.feedbackDetail,
                ) {
                    OutlinedTextField(
                        value = feedback,
                        onValueChange = { feedback = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text(copy.feedbackPrompt) },
                        minLines = 3,
                        maxLines = 6,
                    )
                    when (val feedbackState = state.feedbackState) {
                        FeedbackState.Sending -> Row(modifier = Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(10.dp))
                            Text(copy.sendingFeedback)
                        }
                        FeedbackState.Sent -> Text(
                            copy.feedbackSent,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(top = 10.dp),
                        )
                        is FeedbackState.Failure -> Text(
                            copy.localizedError(feedbackState.message),
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(top = 10.dp),
                        )
                        FeedbackState.Idle -> Unit
                    }
                    Row(modifier = Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                onSubmitFeedback(feedback)
                                if (feedback.trim().length >= 3) feedback = ""
                            },
                            enabled = feedback.trim().length >= 3 && state.feedbackState !is FeedbackState.Sending,
                        ) { Text(copy.sendFeedback) }
                        if (state.feedbackState !is FeedbackState.Idle) {
                            OutlinedButton(onClick = onDismissFeedbackState) { Text(copy.dismiss) }
                        }
                    }
                }
            }
            item {
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(state.account.email.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                            Text(copy.signedIn, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        OutlinedButton(onClick = onLogout) {
                            Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, modifier = Modifier.size(17.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(copy.signOut)
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(12.dp)) }
        }
    }
}

@Composable
private fun SettingsSection(
    icon: @Composable () -> Unit,
    title: String,
    detail: String,
    content: @Composable () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.small,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                icon()
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(title, style = MaterialTheme.typography.titleMedium)
                    Text(detail, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
            }
            Spacer(Modifier.height(14.dp))
            content()
        }
    }
}

@Composable
private fun <T> ChoiceRow(
    options: List<Pair<T, String>>,
    selected: T,
    onSelected: (T) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (value, label) ->
            FilterChip(
                selected = selected == value,
                onClick = { onSelected(value) },
                label = { Text(label) },
            )
        }
    }
}
