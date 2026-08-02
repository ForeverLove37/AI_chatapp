package com.adaptivechat.ui

import androidx.compose.animation.AnimatedContent
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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
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
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.DrawerValue
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.adaptivechat.data.ChatMessage
import com.adaptivechat.data.ChatModel
import com.adaptivechat.data.ChatSession
import com.adaptivechat.data.MessageRole
import com.adaptivechat.data.ProviderMode
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    state: ChatUiState,
    viewModel: ChatViewModel,
) {
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var draft by rememberSaveable { mutableStateOf("") }

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
                    onDelete = viewModel::deleteSession,
                )
            }
        },
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            ChannelBackdrop(state.provider)
            Scaffold(
                containerColor = Color.Transparent,
                topBar = {
                    CenterAlignedTopAppBar(
                        colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Color.Transparent),
                        navigationIcon = {
                            IconButton(onClick = { scope.launch { drawerState.open() } }) {
                                Icon(Icons.Outlined.Menu, contentDescription = "Open conversations")
                            }
                        },
                        title = {
                            ChannelSelector(
                                selected = state.provider,
                                onSelected = viewModel::selectChannel,
                            )
                        },
                        actions = {
                            IconButton(onClick = viewModel::createSession) {
                                Icon(Icons.Outlined.Add, contentDescription = "New conversation")
                            }
                        },
                    )
                },
            ) { contentPadding ->
                ChatContent(
                    state = state,
                    draft = draft,
                    onDraftChange = { draft = it },
                    onSend = {
                        viewModel.sendMessage(draft)
                        draft = ""
                    },
                    onModelSelected = viewModel::selectModel,
                    onDismissError = viewModel::dismissError,
                    modifier = Modifier.padding(contentPadding),
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
                .background(Color(0xFF071018)),
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
                    colors = listOf(
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
    onDelete: (String) -> Unit,
) {
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
            Text("Conversations", modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            IconButton(onClick = onNewSession) {
                Icon(Icons.Outlined.Add, contentDescription = "New conversation")
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
                        Text(session.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                        Text(session.model.displayName, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                    }
                    IconButton(onClick = { onDelete(session.id) }, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.Outlined.DeleteOutline, contentDescription = "Delete conversation", modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun ChannelSelector(
    selected: ProviderMode,
    onSelected: (ProviderMode) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        Surface(
            shape = RoundedCornerShape(if (selected == ProviderMode.GEMINI) 24.dp else 10.dp),
            color = if (selected == ProviderMode.GEMINI) MaterialTheme.colorScheme.surface.copy(alpha = 0.84f) else Color.Transparent,
        ) {
            TextButton(onClick = { expanded = true }) {
                Icon(providerIcon(selected), contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(7.dp))
                Text(selected.displayName)
                Icon(Icons.Outlined.KeyboardArrowDown, contentDescription = "Choose channel")
            }
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            ProviderMode.entries.forEach { provider ->
                DropdownMenuItem(
                    text = { Text(provider.displayName) },
                    leadingIcon = { Icon(providerIcon(provider), contentDescription = null) },
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
private fun ChatContent(
    state: ChatUiState,
    draft: String,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onModelSelected: (ChatModel) -> Unit,
    onDismissError: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val listState = rememberLazyListState()
    LaunchedEffect(state.messages.size, state.messages.lastOrNull()?.content?.length, state.messages.lastOrNull()?.reasoning?.length) {
        if (state.messages.isNotEmpty()) listState.animateScrollToItem(state.messages.lastIndex)
    }

    Column(modifier = modifier.fillMaxSize()) {
        state.errorMessage?.let { message ->
            AlertDialog(
                onDismissRequest = onDismissError,
                confirmButton = { TextButton(onClick = onDismissError) { Text("Close") } },
                title = { Text("Streaming error") },
                text = { Text(message) },
            )
        }
        ModelChooser(provider = state.provider, selectedModel = state.model, onModelSelected = onModelSelected)
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
        )
    }
}

@Composable
private fun ModelChooser(
    provider: ProviderMode,
    selectedModel: ChatModel,
    onModelSelected: (ChatModel) -> Unit,
) {
    AnimatedContent(targetState = provider, label = "channel-models") { channel ->
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 5.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            channel.models.forEach { model ->
                FilterChip(
                    selected = model == selectedModel,
                    onClick = { onModelSelected(model) },
                    label = { Text(model.displayName) },
                    leadingIcon = if (channel == ProviderMode.DEEPSEEK) {
                        { Icon(Icons.Outlined.Terminal, contentDescription = null, modifier = Modifier.size(15.dp)) }
                    } else null,
                )
            }
        }
    }
}

@Composable
private fun WelcomePanel(provider: ProviderMode, model: ChatModel, modifier: Modifier = Modifier) {
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
                Icon(providerIcon(provider), contentDescription = null, modifier = Modifier.size(28.dp), tint = MaterialTheme.colorScheme.primary)
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(
            text = when (provider) {
                ProviderMode.CHATGPT -> "How can I help today?"
                ProviderMode.GEMINI -> "What's next?"
                ProviderMode.DEEPSEEK -> "Start a precise session"
            },
            style = MaterialTheme.typography.headlineSmall,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = "${provider.displayName} ${model.displayName}",
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
) {
    val fromUser = message.role == MessageRole.USER
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
                    if (isWaitingForFirstToken && message.content.isBlank() && message.reasoning.isBlank()) {
                        WaitingForResponse()
                    } else {
                        StreamingMarkdown(text = message.content, provider = provider)
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
        Text("Connecting", color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = alpha), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun ReasoningBlock(
    reasoning: String,
    createdAt: Long,
    isStreaming: Boolean,
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    var currentTime by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(isStreaming) {
        while (isStreaming) {
            currentTime = System.currentTimeMillis()
            delay(1_000)
        }
    }
    val seconds = ((currentTime - createdAt) / 1_000).coerceAtLeast(0)
    Surface(
        color = Color(0xFF0D1E28),
        contentColor = Color(0xFFD6F4EF),
        border = BorderStroke(1.dp, Color(0xFF2A6670)),
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.fillMaxWidth().clickable { expanded = !expanded },
    ) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Terminal, contentDescription = null, modifier = Modifier.size(16.dp), tint = Color(0xFF45D7BD))
                Spacer(Modifier.width(8.dp))
                Text(
                    text = if (isStreaming) "Reasoning ${seconds}s" else "Reasoning complete",
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.labelLarge,
                )
                Icon(
                    if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                    contentDescription = if (expanded) "Collapse reasoning" else "Expand reasoning",
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
                    color = Color(0xFFA9C8D1),
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun StreamingMarkdown(text: String, provider: ProviderMode) {
    var inCodeBlock = false
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        text.split('\n').forEach { line ->
            if (line.trimStart().startsWith("```")) {
                inCodeBlock = !inCodeBlock
            } else if (inCodeBlock) {
                Text(
                    text = line,
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (provider == ProviderMode.DEEPSEEK) Color(0xFF071018) else MaterialTheme.colorScheme.surfaceVariant)
                        .padding(9.dp),
                )
            } else if (line.isNotBlank()) {
                Text(text = line, style = MaterialTheme.typography.bodyLarge)
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
) {
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
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (provider == ProviderMode.GEMINI) {
                Icon(Icons.Outlined.AutoAwesome, contentDescription = null, modifier = Modifier.padding(start = 8.dp).size(20.dp), tint = MaterialTheme.colorScheme.primary)
            }
            TextField(
                value = draft,
                onValueChange = onDraftChange,
                modifier = Modifier.weight(1f),
                enabled = !isStreaming,
                placeholder = { Text("Message ${provider.displayName}") },
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
                enabled = draft.isNotBlank() && !isStreaming,
                modifier = Modifier.size(48.dp),
            ) {
                Icon(Icons.AutoMirrored.Outlined.Send, contentDescription = "Send message")
            }
        }
    }
}

private fun providerIcon(provider: ProviderMode): ImageVector = when (provider) {
    ProviderMode.CHATGPT -> Icons.Outlined.ChatBubbleOutline
    ProviderMode.GEMINI -> Icons.Outlined.AutoAwesome
    ProviderMode.DEEPSEEK -> Icons.Outlined.Terminal
}
