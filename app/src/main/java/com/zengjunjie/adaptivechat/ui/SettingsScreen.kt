package com.zengjunjie.adaptivechat.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material.icons.outlined.TextFields
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.AutoAwesome
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
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.zengjunjie.adaptivechat.BuildConfig
import com.zengjunjie.adaptivechat.data.AppearancePreference
import com.zengjunjie.adaptivechat.data.LanguagePreference
import com.zengjunjie.adaptivechat.data.ProfileAvatarUpload
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    state: ChatUiState,
    onBack: () -> Unit,
    onCheckForUpdates: () -> Unit,
    onDismissFeedbackState: () -> Unit,
    onLogout: () -> Unit,
    onSetAppearance: (AppearancePreference) -> Unit,
    onSetExpertMode: (Boolean) -> Unit,
    onSetFontScale: (Float) -> Unit,
    onSetLanguage: (LanguagePreference) -> Unit,
    onSubmitFeedback: (String) -> Unit,
    onUpdateProfile: (String, ProfileAvatarUpload?, Boolean) -> Unit,
    onDismissProfileState: () -> Unit,
) {
    val copy = LocalAppCopy.current
    val uriHandler = LocalUriHandler.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var feedback by rememberSaveable { mutableStateOf("") }
    var displayName by rememberSaveable { mutableStateOf(state.account.displayName) }
    var avatarUpload by remember { mutableStateOf<ProfileAvatarUpload?>(null) }
    var avatarPreview by remember { mutableStateOf<ByteArray?>(null) }
    var avatarCropSource by remember { mutableStateOf<AvatarCropSource?>(null) }
    var removeAvatar by rememberSaveable { mutableStateOf(false) }
    var avatarError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(state.account.displayName) { displayName = state.account.displayName }
    LaunchedEffect(state.profileUpdateState) {
        if (state.profileUpdateState is ProfileUpdateState.Saved) {
            avatarUpload = null
            avatarPreview = null
            removeAvatar = false
            avatarError = null
        }
    }
    val avatarPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { readProfileAvatar(context, uri) } }
                .onSuccess {
                    avatarCropSource?.bitmap?.recycle()
                    avatarCropSource = it
                    avatarError = null
                }
                .onFailure { avatarError = it.message ?: copy.avatarError }
        }
    }

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
                    icon = { Icon(Icons.Outlined.Image, contentDescription = null) },
                    title = copy.profile,
                    detail = state.account.email.orEmpty(),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        UserAvatar(
                            displayName = displayName,
                            email = state.account.email.orEmpty(),
                            avatarUrl = if (removeAvatar) "" else state.account.avatarUrl,
                            previewBytes = avatarPreview,
                            modifier = Modifier.size(68.dp),
                        )
                        Spacer(Modifier.width(14.dp))
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(
                                value = displayName,
                                onValueChange = { displayName = it.take(80); onDismissProfileState() },
                                modifier = Modifier.fillMaxWidth(),
                                label = { Text(copy.displayName) },
                                singleLine = true,
                            )
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(
                                    onClick = { avatarPicker.launch(arrayOf("image/jpeg", "image/png", "image/webp")) },
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Icon(Icons.Outlined.Image, contentDescription = null, modifier = Modifier.size(17.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text(copy.chooseAvatar)
                                }
                                if (state.account.avatarUrl.isNotBlank() || avatarUpload != null) {
                                    OutlinedButton(
                                        onClick = {
                                            avatarUpload = null
                                            avatarPreview = null
                                            removeAvatar = true
                                            onDismissProfileState()
                                        },
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Icon(Icons.Outlined.DeleteOutline, contentDescription = null, modifier = Modifier.size(17.dp))
                                        Spacer(Modifier.width(6.dp))
                                        Text(copy.removeAvatar)
                                    }
                                }
                            }
                        }
                    }
                    avatarError?.let { Text(copy.localizedError(it), color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
                    when (val profileState = state.profileUpdateState) {
                        ProfileUpdateState.Saving -> Row(modifier = Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(10.dp))
                            Text(copy.savingProfile)
                        }
                        ProfileUpdateState.Saved -> Text(copy.profileSaved, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 10.dp))
                        is ProfileUpdateState.Failure -> Text(copy.localizedError(profileState.message), color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 10.dp))
                        ProfileUpdateState.Idle -> Unit
                    }
                    Button(
                        onClick = {
                            onUpdateProfile(displayName, avatarUpload, removeAvatar)
                        },
                        enabled = state.profileUpdateState !is ProfileUpdateState.Saving,
                        modifier = Modifier.padding(top = 10.dp),
                    ) { Text(copy.saveProfile) }
                }
            }
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
            if (state.expertModeAllowed) {
                item {
                    SettingsSection(
                        icon = { Icon(Icons.Outlined.AutoAwesome, contentDescription = null) },
                        title = copy.expertMode,
                        detail = copy.expertModeDetail,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                if (state.expertModeEnabled) copy.expertModeOn else copy.expertModeOff,
                                modifier = Modifier.weight(1f),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Switch(
                                checked = state.expertModeEnabled,
                                onCheckedChange = onSetExpertMode,
                            )
                        }
                    }
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
                            Text(state.account.displayName.ifBlank { state.account.email.orEmpty() }, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                            Text(state.account.email.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                            Text(copy.signedIn, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        UserAvatar(
                            displayName = state.account.displayName,
                            email = state.account.email.orEmpty(),
                            avatarUrl = state.account.avatarUrl,
                            modifier = Modifier.size(38.dp).padding(end = 8.dp),
                        )
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
    avatarCropSource?.let { source ->
        AvatarCropDialog(
            source = source,
            onCancel = {
                source.bitmap.recycle()
                avatarCropSource = null
            },
            onApply = { cropped ->
                avatarUpload = cropped.upload
                avatarPreview = cropped.previewBytes
                removeAvatar = false
                avatarError = null
                onDismissProfileState()
                source.bitmap.recycle()
                avatarCropSource = null
            },
        )
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

private const val MAX_PROFILE_AVATAR_BYTES = 2 * 1024 * 1024

private fun readProfileAvatar(context: Context, uri: Uri): AvatarCropSource {
    val resolver = context.contentResolver
    val mimeType = resolver.getType(uri)?.lowercase()?.substringBefore(';')
        ?: when (uri.toString().substringBefore('?').substringAfterLast('.').lowercase()) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "webp" -> "image/webp"
            else -> ""
        }
    if (mimeType !in setOf("image/jpeg", "image/png", "image/webp")) {
        throw IllegalArgumentException("Choose a JPEG, PNG, or WEBP avatar image.")
    }
    val bytes = ByteArrayOutputStream().use { output ->
        resolver.openInputStream(uri)?.use { input ->
            val buffer = ByteArray(16 * 1024)
            var total = 0
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                if (total > MAX_PROFILE_AVATAR_BYTES) {
                    throw IllegalArgumentException("Avatar images must be 2 MB or smaller.")
                }
                output.write(buffer, 0, count)
            }
        } ?: throw IllegalArgumentException("The avatar could not be read.")
        output.toByteArray()
    }
    if (bytes.isEmpty()) {
        throw IllegalArgumentException("Choose a valid JPEG, PNG, or WEBP avatar image.")
    }
    return AvatarCropSource(decodeAvatarBitmap(bytes))
}

private fun decodeAvatarBitmap(bytes: ByteArray): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
        throw IllegalArgumentException("Choose a valid JPEG, PNG, or WEBP avatar image.")
    }
    var sampleSize = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sampleSize > MAX_PROFILE_AVATAR_DIMENSION) sampleSize *= 2
    val bitmap = BitmapFactory.decodeByteArray(
        bytes,
        0,
        bytes.size,
        BitmapFactory.Options().apply { inSampleSize = sampleSize },
    ) ?: throw IllegalArgumentException("Choose a valid JPEG, PNG, or WEBP avatar image.")
    val orientation = runCatching {
        ByteArrayInputStream(bytes).use { input ->
            ExifInterface(input).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        }
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    val rotation = when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90, ExifInterface.ORIENTATION_TRANSPOSE -> 90f
        ExifInterface.ORIENTATION_ROTATE_180, ExifInterface.ORIENTATION_FLIP_VERTICAL -> 180f
        ExifInterface.ORIENTATION_ROTATE_270, ExifInterface.ORIENTATION_TRANSVERSE -> 270f
        else -> 0f
    }
    val flipped = orientation in setOf(
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL,
        ExifInterface.ORIENTATION_FLIP_VERTICAL,
        ExifInterface.ORIENTATION_TRANSPOSE,
        ExifInterface.ORIENTATION_TRANSVERSE,
    )
    if (rotation == 0f && !flipped) return bitmap
    val matrix = Matrix().apply {
        if (flipped) postScale(-1f, 1f)
        if (rotation != 0f) postRotate(rotation)
    }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true).also {
        if (it !== bitmap) bitmap.recycle()
    }
}

private const val MAX_PROFILE_AVATAR_DIMENSION = 2048
