package com.zengjunjie.adaptivechat.ui

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.OpenableColumns
import android.speech.RecognizerIntent
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.VolumeUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.DrawerValue
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.zengjunjie.adaptivechat.R
import com.zengjunjie.adaptivechat.BuildConfig
import com.zengjunjie.adaptivechat.data.ChatAttachment
import com.zengjunjie.adaptivechat.data.ChatMessage
import com.zengjunjie.adaptivechat.data.ChatModel
import com.zengjunjie.adaptivechat.data.ChatSession
import com.zengjunjie.adaptivechat.data.MessageRole
import com.zengjunjie.adaptivechat.data.ProviderMode
import com.zengjunjie.adaptivechat.data.SpeechPlayer
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    state: ChatUiState,
    viewModel: ChatViewModel,
    onOpenSettings: () -> Unit,
) {
    val copy = LocalAppCopy.current
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val speechPlayer = remember(context.applicationContext) {
        SpeechPlayer(context.applicationContext, BuildConfig.API_BASE_URL)
    }
    var draft by rememberSaveable { mutableStateOf("") }
    var attachments by remember { mutableStateOf<List<ChatAttachment>>(emptyList()) }
    var sessionPendingDeletion by remember { mutableStateOf<ChatSession?>(null) }
    var attachmentError by remember { mutableStateOf<String?>(null) }

    DisposableEffect(speechPlayer) {
        onDispose { speechPlayer.release() }
    }

    val speechResult = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val transcript = if (result.resultCode == Activity.RESULT_OK) {
            result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()
                ?.trim()
        } else {
            null
        }
        if (!transcript.isNullOrBlank()) {
            draft = listOf(draft.trim(), transcript).filter(String::isNotBlank).joinToString(" ")
        }
    }
    val startSpeechRecognition = {
        runCatching {
            speechResult.launch(
                Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_PROMPT, copy.voiceInput)
                    .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1),
            )
        }.onFailure { attachmentError = copy.speechInputUnavailable }
    }
    val recordAudioPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) startSpeechRecognition() else attachmentError = copy.speechInputUnavailable
    }
    val imagePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { readImageAttachment(context, uri) }
            }.onSuccess { attachment ->
                if (attachments.size >= MAX_IMAGE_ATTACHMENTS) {
                    attachmentError = "You can attach up to $MAX_IMAGE_ATTACHMENTS images at once."
                } else {
                    attachments = attachments + attachment
                }
            }.onFailure { error ->
                attachmentError = error.message ?: copy.attachmentError
            }
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
                SessionDrawer(
                    sessions = state.sessions,
                    selectedSessionId = state.selectedSession?.id,
                    onNewSession = viewModel::createSession,
                    onSelect = { sessionId ->
                        viewModel.selectSession(sessionId)
                        scope.launch { drawerState.close() }
                    },
                    onDelete = { session -> sessionPendingDeletion = session },
                    onOpenSettings = onOpenSettings,
                )
            }
        },
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            ChannelBackdrop(state.provider)
            Scaffold(
                containerColor = Color.Transparent,
                topBar = {
                    TopAppBar(
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
                        navigationIcon = {
                            IconButton(onClick = { scope.launch { drawerState.open() } }) {
                                Icon(Icons.Outlined.Menu, contentDescription = copy.conversations)
                            }
                        },
                        title = {
                            HeaderSelectors(
                                provider = state.provider,
                                model = state.model,
                                onModelSelected = viewModel::selectModel,
                                onProviderSelected = viewModel::selectChannel,
                            )
                        },
                    )
                },
            ) { contentPadding ->
                ChatContent(
                    state = state,
                    draft = draft,
                    onDraftChange = { draft = it },
                    onSend = {
                        viewModel.sendMessage(draft, attachments)
                        draft = ""
                        attachments = emptyList()
                    },
                    onRedo = viewModel::redoTerminalAssistant,
                    onBranch = viewModel::branchConversation,
                    onListen = { markdown -> viewModel.listenToMessage(markdown, speechPlayer) },
                    attachments = attachments,
                    onRemoveAttachment = { attachment -> attachments = attachments - attachment },
                    onAttachFile = { imagePicker.launch(arrayOf("image/*")) },
                    onVoiceInput = {
                        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            startSpeechRecognition()
                        } else {
                            recordAudioPermission.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    },
                    onDismissError = viewModel::dismissError,
                    modifier = Modifier.padding(contentPadding),
                )
            }

            sessionPendingDeletion?.let { session ->
                AlertDialog(
                    onDismissRequest = { sessionPendingDeletion = null },
                    title = { Text(copy.deleteConversation) },
                    text = {
                        Text(
                            copy.deleteConversationPrompt(
                                if (session.title == "New conversation") copy.newConversation else session.title,
                            ),
                        )
                    },
                    dismissButton = {
                        TextButton(onClick = { sessionPendingDeletion = null }) {
                            Text(copy.cancel)
                        }
                    },
                    confirmButton = {
                        TextButton(
                            onClick = {
                                viewModel.deleteSession(session.id)
                                sessionPendingDeletion = null
                            },
                        ) {
                            Text(copy.delete)
                        }
                    },
                )
            }

            attachmentError?.let { message ->
                AlertDialog(
                    onDismissRequest = { attachmentError = null },
                    title = { Text(copy.attachmentError) },
                    text = { Text(copy.localizedError(message)) },
                    confirmButton = {
                        TextButton(onClick = { attachmentError = null }) {
                            Text(copy.close)
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun ChannelBackdrop(provider: ProviderMode) {
    when (provider) {
        ProviderMode.GEMINI -> GeminiGradientBackdrop()
        ProviderMode.DEEPSEEK -> Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background),
        )
        ProviderMode.CHATGPT -> Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background),
        )
    }
}

@Composable
private fun GeminiGradientBackdrop() {
    val dark = LocalAdaptiveDark.current
    val transition = rememberInfiniteTransition(label = "gemini-background")
    val shift by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(9_000, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "gemini-gradient-shift",
    )
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    colors = if (dark) listOf(
                        Color(0xFF101222),
                        Color(0xFF18244A),
                        Color(0xFF2A1945),
                        Color(0xFF103E3A),
                        Color(0xFF101222),
                    ) else listOf(
                        Color(0xFFFDFBFF),
                        Color(0xFFEAF0FF),
                        Color(0xFFF7EEFF),
                        Color(0xFFE9FAF6),
                        Color(0xFFFDFBFF),
                    ),
                    start = Offset(-400f + (shift * 900f), 120f),
                    end = Offset(1_400f + (shift * 900f), 2_400f),
                ),
            ),
    )
}

@Composable
private fun SessionDrawer(
    sessions: List<ChatSession>,
    selectedSessionId: String?,
    onNewSession: () -> Unit,
    onSelect: (String) -> Unit,
    onDelete: (ChatSession) -> Unit,
    onOpenSettings: () -> Unit,
) {
    val copy = LocalAppCopy.current
    Column(
        modifier = Modifier
            .fillMaxHeight()
            .width(304.dp)
            .padding(vertical = 12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(copy.conversations, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            IconButton(onClick = onOpenSettings) {
                Icon(Icons.Outlined.Settings, contentDescription = copy.settings)
            }
            IconButton(onClick = onNewSession) {
                Icon(Icons.Outlined.Add, contentDescription = copy.newConversation)
            }
        }
        Spacer(Modifier.height(8.dp))
        HorizontalDivider()
        LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
            items(sessions, key = ChatSession::id) { session ->
                val selected = session.id == selectedSessionId
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 2.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
                        .clickable { onSelect(session.id) }
                        .padding(start = 10.dp, end = 4.dp, top = 9.dp, bottom = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = providerIcon(session.provider),
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.width(10.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(if (session.title == "New conversation") copy.newConversation else session.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                        Text(copy.modelName(session.model), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                    }
                    IconButton(onClick = { onDelete(session) }, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.Outlined.DeleteOutline, contentDescription = copy.delete, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun HeaderSelectors(
    provider: ProviderMode,
    model: ChatModel,
    onProviderSelected: (ProviderMode) -> Unit,
    onModelSelected: (ChatModel) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        ChannelSelector(
            selected = provider,
            onSelected = onProviderSelected,
            modifier = Modifier.weight(1f),
        )
        ModelSelector(
            provider = provider,
            selected = model,
            onSelected = onModelSelected,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun ChatContent(
    state: ChatUiState,
    draft: String,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onRedo: (String) -> Unit,
    onBranch: (String) -> Unit,
    onListen: (String) -> Unit,
    attachments: List<ChatAttachment>,
    onRemoveAttachment: (ChatAttachment) -> Unit,
    onAttachFile: () -> Unit,
    onVoiceInput: () -> Unit,
    onDismissError: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val copy = LocalAppCopy.current
    val listState = rememberLazyListState()
    val density = LocalDensity.current
    val imeBottom = WindowInsets.ime.getBottom(density)
    LaunchedEffect(
        state.messages.size,
        state.messages.lastOrNull()?.content?.length,
        state.messages.lastOrNull()?.reasoning?.length,
        imeBottom,
    ) {
        if (state.messages.isNotEmpty()) listState.animateScrollToItem(state.messages.lastIndex)
    }

    Column(modifier = modifier.fillMaxSize()) {
        state.errorMessage?.let { message ->
            AlertDialog(
                onDismissRequest = onDismissError,
                confirmButton = { TextButton(onClick = onDismissError) { Text(copy.close) } },
                title = { Text(copy.streamingError) },
                text = { Text(copy.localizedError(message)) },
            )
        }
        AnimatedVisibility(visible = state.isStreaming) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.primary,
                trackColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
            )
        }

        if (state.messages.isEmpty()) {
            WelcomePanel(provider = state.provider, model = state.model, modifier = Modifier.weight(1f))
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 18.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                items(state.messages, key = ChatMessage::id) { message ->
                    MessageItem(
                        message = message,
                        provider = state.provider,
                        isWaitingForFirstToken = state.isWaitingForFirstToken && message.isStreaming,
                        isTerminalAssistant = message.role == MessageRole.ASSISTANT && message.id == state.messages.lastOrNull()?.id,
                        onRedo = onRedo,
                        onBranch = onBranch,
                        onListen = onListen,
                    )
                }
            }
        }

        Composer(
            provider = state.provider,
            draft = draft,
            isStreaming = state.isStreaming,
            onDraftChange = onDraftChange,
            onSend = onSend,
            attachments = attachments,
            onRemoveAttachment = onRemoveAttachment,
            onAttachFile = onAttachFile,
            onVoiceInput = onVoiceInput,
            modifier = Modifier.imePadding(),
        )
    }
}

@Composable
private fun ChannelSelector(
    selected: ProviderMode,
    onSelected: (ProviderMode) -> Unit,
    modifier: Modifier = Modifier,
) {
    val copy = LocalAppCopy.current
    var expanded by remember { mutableStateOf(false) }
    Box(modifier = modifier) {
        Surface(
            shape = selectorShape(selected),
            color = MaterialTheme.colorScheme.surface.copy(alpha = if (selected == ProviderMode.GEMINI) 0.86f else 0.96f),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.56f)),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 44.dp),
        ) {
            TextButton(
                onClick = { expanded = true },
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 8.dp),
            ) {
                Icon(painterResource(providerImage(selected)), contentDescription = null, modifier = Modifier.size(18.dp), tint = Color.Unspecified)
                Spacer(Modifier.width(5.dp))
                Text(copy.providerName(selected), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Icon(Icons.Outlined.KeyboardArrowDown, contentDescription = copy.selectChannel, modifier = Modifier.size(17.dp))
            }
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.widthIn(min = 184.dp, max = 264.dp),
        ) {
            ProviderMode.entries.forEach { provider ->
                DropdownMenuItem(
                    text = {
                        Text(
                            copy.providerName(provider),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    leadingIcon = {
                        Icon(
                            painterResource(providerImage(provider)),
                            contentDescription = null,
                            modifier = Modifier.size(20.dp),
                            tint = Color.Unspecified,
                        )
                    },
                    contentPadding = PaddingValues(horizontal = 14.dp),
                    onClick = {
                        onSelected(provider)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun ModelSelector(
    provider: ProviderMode,
    selected: ChatModel,
    onSelected: (ChatModel) -> Unit,
    modifier: Modifier = Modifier,
) {
    val copy = LocalAppCopy.current
    var expanded by remember { mutableStateOf(false) }
    Box(modifier = modifier) {
        Surface(
            shape = selectorShape(provider),
            color = MaterialTheme.colorScheme.surface.copy(alpha = if (provider == ProviderMode.GEMINI) 0.86f else 0.96f),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.56f)),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 44.dp),
        ) {
            TextButton(
                onClick = { expanded = true },
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 8.dp),
            ) {
                Icon(painterResource(providerImage(provider)), contentDescription = null, modifier = Modifier.size(18.dp), tint = Color.Unspecified)
                Spacer(Modifier.width(5.dp))
                Text(copy.modelName(selected), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Icon(Icons.Outlined.KeyboardArrowDown, contentDescription = copy.selectModel, modifier = Modifier.size(17.dp))
            }
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.widthIn(min = 184.dp, max = 264.dp),
        ) {
            provider.models.forEach { model ->
                DropdownMenuItem(
                    text = {
                        Text(
                            copy.modelName(model),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    leadingIcon = {
                        Icon(
                            painterResource(providerImage(provider)),
                            contentDescription = null,
                            modifier = Modifier.size(20.dp),
                            tint = Color.Unspecified,
                        )
                    },
                    contentPadding = PaddingValues(horizontal = 14.dp),
                    onClick = {
                        onSelected(model)
                        expanded = false
                    },
                )
            }
        }
    }
}

private fun selectorShape(provider: ProviderMode) = when (provider) {
    ProviderMode.GEMINI -> RoundedCornerShape(24.dp)
    ProviderMode.DEEPSEEK -> RoundedCornerShape(6.dp)
    ProviderMode.CHATGPT -> RoundedCornerShape(10.dp)
}

@Composable
private fun WelcomePanel(provider: ProviderMode, model: ChatModel, modifier: Modifier = Modifier) {
    val copy = LocalAppCopy.current
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = if (provider == ProviderMode.GEMINI) 0.74f else 1f),
            modifier = Modifier.size(58.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(painterResource(providerImage(provider)), contentDescription = null, modifier = Modifier.size(30.dp), tint = Color.Unspecified)
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(
            text = copy.welcome(provider),
            style = MaterialTheme.typography.headlineSmall,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = "${copy.providerName(provider)} ${copy.modelName(model)}",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun MessageItem(
    message: ChatMessage,
    provider: ProviderMode,
    isWaitingForFirstToken: Boolean,
    isTerminalAssistant: Boolean,
    onRedo: (String) -> Unit,
    onBranch: (String) -> Unit,
    onListen: (String) -> Unit,
) {
    val fromUser = message.role == MessageRole.USER
    val clipboard = LocalClipboardManager.current
    Column(modifier = Modifier.fillMaxWidth().animateContentSize()) {
        if (!fromUser && message.reasoning.isNotBlank()) {
            ReasoningBlock(
                reasoning = message.reasoning,
                createdAt = message.createdAt,
                isStreaming = message.isStreaming,
            )
            Spacer(Modifier.height(8.dp))
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = if (fromUser) Arrangement.End else Arrangement.Start,
        ) {
            val bubbleColor = when {
                fromUser && provider == ProviderMode.CHATGPT -> MaterialTheme.colorScheme.primary
                fromUser -> MaterialTheme.colorScheme.primaryContainer
                else -> MaterialTheme.colorScheme.surface.copy(alpha = if (provider == ProviderMode.GEMINI) 0.88f else 1f)
            }
            val bubbleContent = when {
                fromUser && provider == ProviderMode.CHATGPT -> MaterialTheme.colorScheme.onPrimary
                fromUser -> MaterialTheme.colorScheme.onPrimaryContainer
                else -> MaterialTheme.colorScheme.onSurface
            }
            Surface(
                color = bubbleColor,
                contentColor = bubbleContent,
                shape = bubbleShape(fromUser, provider),
                border = if (!fromUser && provider == ProviderMode.DEEPSEEK) BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f)) else null,
                modifier = Modifier.fillMaxWidth(if (fromUser) 0.84f else 0.94f).widthIn(max = 760.dp),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    if (message.attachments.isNotEmpty()) {
                        AttachmentSummary(message.attachments)
                        if (message.content.isNotBlank()) Spacer(Modifier.height(8.dp))
                    }
                    if (isWaitingForFirstToken && message.content.isBlank() && message.reasoning.isBlank()) {
                        WaitingForResponse()
                    } else {
                        StreamingMarkdown(text = message.content, provider = provider)
                    }
                    if (!fromUser && !message.isStreaming && message.content.isNotBlank()) {
                        AssistantActionBar(
                            isTerminalAssistant = isTerminalAssistant,
                            onRedo = { onRedo(message.id) },
                            onCopy = { clipboard.setText(AnnotatedString(message.content)) },
                            onBranch = { onBranch(message.id) },
                            onListen = { onListen(message.content) },
                        )
                    }
                }
            }
        }
    }
}

private fun bubbleShape(fromUser: Boolean, provider: ProviderMode) = when (provider) {
    ProviderMode.GEMINI -> RoundedCornerShape(24.dp)
    ProviderMode.DEEPSEEK -> RoundedCornerShape(
        topStart = 6.dp,
        topEnd = 16.dp,
        bottomStart = if (fromUser) 16.dp else 6.dp,
        bottomEnd = if (fromUser) 6.dp else 16.dp,
    )
    ProviderMode.CHATGPT -> RoundedCornerShape(
        topStart = 20.dp,
        topEnd = 20.dp,
        bottomStart = if (fromUser) 20.dp else 6.dp,
        bottomEnd = if (fromUser) 6.dp else 20.dp,
    )
}

@Composable
private fun WaitingForResponse() {
    val copy = LocalAppCopy.current
    val transition = rememberInfiniteTransition(label = "ttfb")
    val alpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(850), RepeatMode.Reverse),
        label = "ttfb-alpha",
    )
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.AutoAwesome, contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary.copy(alpha = alpha))
        Spacer(Modifier.width(8.dp))
        Text(copy.connecting, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = alpha), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun ReasoningBlock(
    reasoning: String,
    createdAt: Long,
    isStreaming: Boolean,
) {
    val copy = LocalAppCopy.current
    var expanded by rememberSaveable { mutableStateOf(false) }
    var currentTime by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(isStreaming) {
        while (isStreaming) {
            currentTime = System.currentTimeMillis()
            delay(1_000)
        }
    }
    val seconds = ((currentTime - createdAt) / 1_000).coerceAtLeast(0)
    val dark = LocalAdaptiveDark.current
    Surface(
        color = if (dark) Color(0xFF0D1E28) else MaterialTheme.colorScheme.secondaryContainer,
        contentColor = if (dark) Color(0xFFD6F4EF) else MaterialTheme.colorScheme.onSecondaryContainer,
        border = BorderStroke(1.dp, if (dark) Color(0xFF2A6670) else MaterialTheme.colorScheme.outline.copy(alpha = 0.64f)),
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.fillMaxWidth().clickable { expanded = !expanded },
    ) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Terminal, contentDescription = null, modifier = Modifier.size(16.dp), tint = if (dark) Color(0xFF45D7BD) else MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(8.dp))
                Text(
                    text = if (isStreaming) copy.reasoning(seconds) else copy.reasoningComplete,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.labelLarge,
                )
                Icon(
                    if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                    contentDescription = copy.reasoningComplete,
                )
            }
            AnimatedVisibility(
                visible = expanded,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                Text(
                    text = reasoning,
                    modifier = Modifier.padding(top = 8.dp),
                    color = if (dark) Color(0xFFA9C8D1) else MaterialTheme.colorScheme.onSecondaryContainer,
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun StreamingMarkdown(text: String, provider: ProviderMode) {
    val dark = LocalAdaptiveDark.current
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        markdownBlocks(text).forEach { block ->
            when (block) {
                is MarkdownBlock.Code -> Surface(
                    color = if (provider == ProviderMode.DEEPSEEK && dark) Color(0xFF071018) else MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(6.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = block.text,
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(10.dp),
                    )
                }
                is MarkdownBlock.ListItem -> Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.Top,
                ) {
                    Text(
                        text = block.marker,
                        modifier = Modifier.width(24.dp),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Text(
                        text = markdownAnnotatedString(block.text),
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
                is MarkdownBlock.Paragraph -> Text(
                    text = markdownAnnotatedString(block.text),
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }
    }
}

@Composable
private fun AssistantActionBar(
    isTerminalAssistant: Boolean,
    onRedo: () -> Unit,
    onCopy: () -> Unit,
    onBranch: () -> Unit,
    onListen: () -> Unit,
) {
    val copy = LocalAppCopy.current
    Row(
        modifier = Modifier.padding(top = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (isTerminalAssistant) {
            IconButton(onClick = onRedo, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Outlined.Refresh, contentDescription = copy.redo, modifier = Modifier.size(18.dp))
            }
        }
        IconButton(onClick = onCopy, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Outlined.ContentCopy, contentDescription = copy.copyMessage, modifier = Modifier.size(18.dp))
        }
        IconButton(onClick = onBranch, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Outlined.AccountTree, contentDescription = copy.branch, modifier = Modifier.size(18.dp))
        }
        IconButton(onClick = onListen, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Outlined.VolumeUp, contentDescription = copy.listen, modifier = Modifier.size(18.dp))
        }
    }
}

private sealed interface MarkdownBlock {
    data class Paragraph(val text: String) : MarkdownBlock
    data class Code(val text: String) : MarkdownBlock
    data class ListItem(val marker: String, val text: String) : MarkdownBlock
}

private val bulletPattern = Regex("^\\s*[-*+]\\s+(.+)$")
private val numberedPattern = Regex("^\\s*(\\d+)[.)]\\s+(.+)$")

private fun markdownBlocks(markdown: String): List<MarkdownBlock> {
    val blocks = mutableListOf<MarkdownBlock>()
    val paragraph = StringBuilder()
    val code = StringBuilder()
    var inCodeBlock = false

    fun flushParagraph() {
        if (paragraph.isNotBlank()) {
            blocks += MarkdownBlock.Paragraph(paragraph.toString().trimEnd())
            paragraph.clear()
        }
    }

    fun flushCode() {
        if (code.isNotEmpty()) {
            blocks += MarkdownBlock.Code(code.toString().trimEnd())
            code.clear()
        }
    }

    markdown.lines().forEach { line ->
        if (line.trimStart().startsWith("```")) {
            if (inCodeBlock) flushCode() else flushParagraph()
            inCodeBlock = !inCodeBlock
        } else if (inCodeBlock) {
            if (code.isNotEmpty()) code.append('\n')
            code.append(line)
        } else {
            val bullet = bulletPattern.matchEntire(line)
            val numbered = numberedPattern.matchEntire(line)
            when {
                bullet != null -> {
                    flushParagraph()
                    blocks += MarkdownBlock.ListItem("•", bullet.groupValues[1])
                }
                numbered != null -> {
                    flushParagraph()
                    blocks += MarkdownBlock.ListItem("${numbered.groupValues[1]}.", numbered.groupValues[2])
                }
                line.isBlank() -> flushParagraph()
                else -> {
                    if (paragraph.isNotEmpty()) paragraph.append('\n')
                    paragraph.append(line.removePrefix("# "))
                }
            }
        }
    }
    if (inCodeBlock) flushCode() else flushParagraph()
    return blocks
}

private fun markdownAnnotatedString(value: String): AnnotatedString = buildAnnotatedString {
    var index = 0
    while (index < value.length) {
        when {
            value.startsWith("**", index) || value.startsWith("__", index) -> {
                val token = value.substring(index, index + 2)
                val end = value.indexOf(token, index + token.length)
                if (end > index + token.length) {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                        append(value.substring(index + token.length, end))
                    }
                    index = end + token.length
                } else {
                    append(token)
                    index += token.length
                }
            }
            value[index] == '`' -> {
                val end = value.indexOf('`', index + 1)
                if (end > index + 1) {
                    withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) {
                        append(value.substring(index + 1, end))
                    }
                    index = end + 1
                } else {
                    append(value[index])
                    index += 1
                }
            }
            value[index] == '*' || value[index] == '_' -> {
                val token = value[index]
                val end = value.indexOf(token, index + 1)
                if (end > index + 1) {
                    withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                        append(value.substring(index + 1, end))
                    }
                    index = end + 1
                } else {
                    append(value[index])
                    index += 1
                }
            }
            else -> {
                append(value[index])
                index += 1
            }
        }
    }
}

@Composable
private fun AttachmentSummary(attachments: List<ChatAttachment>) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        attachments.forEach { attachment ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(6.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.68f))
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.AttachFile, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(
                    attachment.fileName,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}

@Composable
private fun Composer(
    provider: ProviderMode,
    draft: String,
    isStreaming: Boolean,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    attachments: List<ChatAttachment>,
    onRemoveAttachment: (ChatAttachment) -> Unit,
    onAttachFile: () -> Unit,
    onVoiceInput: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val copy = LocalAppCopy.current
    val shape = when (provider) {
        ProviderMode.GEMINI -> RoundedCornerShape(32.dp)
        ProviderMode.DEEPSEEK -> RoundedCornerShape(8.dp)
        ProviderMode.CHATGPT -> RoundedCornerShape(26.dp)
    }
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = if (provider == ProviderMode.GEMINI) 0.92f else 1f),
        shape = shape,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f)),
        tonalElevation = if (provider == ProviderMode.GEMINI) 4.dp else 1.dp,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, top = 4.dp, bottom = 2.dp)) {
            if (attachments.isNotEmpty()) {
                Column(
                    modifier = Modifier.padding(start = 8.dp, end = 4.dp, top = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    attachments.forEach { attachment ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Outlined.AttachFile, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(5.dp))
                            Text(
                                attachment.fileName,
                                modifier = Modifier.weight(1f),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.labelMedium,
                            )
                            IconButton(
                                onClick = { onRemoveAttachment(attachment) },
                                enabled = !isStreaming,
                                modifier = Modifier.size(32.dp),
                            ) {
                                Icon(Icons.Outlined.Close, contentDescription = copy.removeAttachment, modifier = Modifier.size(16.dp))
                            }
                        }
                    }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (provider == ProviderMode.GEMINI) {
                    Icon(Icons.Outlined.AutoAwesome, contentDescription = null, modifier = Modifier.padding(start = 8.dp).size(20.dp), tint = MaterialTheme.colorScheme.primary)
                }
                IconButton(onClick = onAttachFile, enabled = !isStreaming, modifier = Modifier.size(42.dp)) {
                    Icon(Icons.Outlined.AttachFile, contentDescription = copy.attachFile, modifier = Modifier.size(20.dp))
                }
                IconButton(onClick = onVoiceInput, enabled = !isStreaming, modifier = Modifier.size(42.dp)) {
                    Icon(Icons.Outlined.Mic, contentDescription = copy.voiceInput, modifier = Modifier.size(20.dp))
                }
                TextField(
                    value = draft,
                    onValueChange = onDraftChange,
                    modifier = Modifier.weight(1f),
                    enabled = !isStreaming,
                    placeholder = { Text(copy.messagePlaceholder(copy.providerName(provider))) },
                    maxLines = 5,
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        disabledContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        disabledIndicatorColor = Color.Transparent,
                    ),
                )
                IconButton(
                    onClick = onSend,
                    enabled = (draft.isNotBlank() || attachments.isNotEmpty()) && !isStreaming,
                    modifier = Modifier.size(48.dp),
                ) {
                    Icon(Icons.AutoMirrored.Outlined.Send, contentDescription = copy.sendFeedback)
                }
            }
        }
    }
}

private const val MAX_IMAGE_ATTACHMENTS = 3
private const val MAX_IMAGE_ATTACHMENT_BYTES = 4 * 1024 * 1024
private val supportedImageMimeTypes = setOf("image/jpeg", "image/png", "image/webp", "image/gif")

private fun readImageAttachment(context: Context, uri: Uri): ChatAttachment {
    val mimeType = context.contentResolver.getType(uri)?.lowercase()
        ?: throw IllegalArgumentException("The selected file has no supported image type.")
    require(mimeType in supportedImageMimeTypes) {
        "Choose a JPEG, PNG, WEBP, or GIF image."
    }
    val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
            require(output.size() <= MAX_IMAGE_ATTACHMENT_BYTES) {
                "Images must be 4 MB or smaller."
            }
        }
        output.toByteArray()
    } ?: throw IllegalArgumentException("The selected image could not be read.")
    val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (cursor.moveToFirst() && index >= 0) cursor.getString(index) else null
        }
        ?.takeIf(String::isNotBlank)
        ?: "attachment.${mimeType.substringAfter('/') }"
    return ChatAttachment(
        fileName = name,
        mimeType = mimeType,
        dataUrl = "data:$mimeType;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}",
    )
}

private fun providerIcon(provider: ProviderMode): ImageVector = when (provider) {
    ProviderMode.CHATGPT -> Icons.Outlined.ChatBubbleOutline
    ProviderMode.GEMINI -> Icons.Outlined.AutoAwesome
    ProviderMode.DEEPSEEK -> Icons.Outlined.Terminal
}

private fun providerImage(provider: ProviderMode) = when (provider) {
    ProviderMode.CHATGPT -> R.drawable.model_gpt
    ProviderMode.GEMINI -> R.drawable.model_gemini
    ProviderMode.DEEPSEEK -> R.drawable.model_deepseek
}
