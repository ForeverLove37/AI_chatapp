package com.zengjunjie.adaptivechat.ui

import android.graphics.Bitmap
import android.graphics.Canvas as AndroidCanvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.zengjunjie.adaptivechat.data.ProfileAvatarUpload
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.min
import kotlin.math.roundToInt

internal data class AvatarCropSource(val bitmap: Bitmap)

internal data class CroppedAvatar(
    val upload: ProfileAvatarUpload,
    val previewBytes: ByteArray,
)

internal data class AvatarCropBounds(val left: Int, val top: Int, val size: Int)

internal fun avatarCropBounds(
    width: Int,
    height: Int,
    zoom: Float,
    panX: Float,
    panY: Float,
): AvatarCropBounds {
    val safeZoom = zoom.coerceIn(1f, 3f)
    val cropSize = (min(width, height) / safeZoom).roundToInt().coerceIn(1, min(width, height))
    val remainingX = (width - cropSize).coerceAtLeast(0)
    val remainingY = (height - cropSize).coerceAtLeast(0)
    val left = (remainingX / 2f - panX.coerceIn(-1f, 1f) * remainingX / 2f).roundToInt().coerceIn(0, remainingX)
    val top = (remainingY / 2f - panY.coerceIn(-1f, 1f) * remainingY / 2f).roundToInt().coerceIn(0, remainingY)
    return AvatarCropBounds(left, top, cropSize)
}

private fun cropAvatar(source: AvatarCropSource, zoom: Float, panX: Float, panY: Float): CroppedAvatar {
    val bounds = avatarCropBounds(source.bitmap.width, source.bitmap.height, zoom, panX, panY)
    val output = Bitmap.createBitmap(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, Bitmap.Config.ARGB_8888)
    val canvas = AndroidCanvas(output)
    canvas.drawColor(Color.WHITE)
    canvas.drawBitmap(
        source.bitmap,
        Rect(bounds.left, bounds.top, bounds.left + bounds.size, bounds.top + bounds.size),
        Rect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE),
        Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG),
    )
    val bytes = ByteArrayOutputStream().use { stream ->
        check(output.compress(Bitmap.CompressFormat.JPEG, 88, stream))
        stream.toByteArray()
    }
    output.recycle()
    return CroppedAvatar(
        upload = ProfileAvatarUpload(fileName = "avatar.jpg", mimeType = "image/jpeg", bytes = bytes),
        previewBytes = bytes,
    )
}

@Composable
internal fun AvatarCropDialog(
    source: AvatarCropSource,
    onCancel: () -> Unit,
    onApply: (CroppedAvatar) -> Unit,
) {
    val copy = LocalAppCopy.current
    val scope = rememberCoroutineScope()
    val maxDialogHeight = LocalConfiguration.current.screenHeightDp.dp * 0.94f
    val image = remember(source) { source.bitmap.asImageBitmap() }
    var zoom by remember(source) { mutableFloatStateOf(1f) }
    var panX by remember(source) { mutableFloatStateOf(0f) }
    var panY by remember(source) { mutableFloatStateOf(0f) }
    var processing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    val bounds = avatarCropBounds(source.bitmap.width, source.bitmap.height, zoom, panX, panY)

    Dialog(
        onDismissRequest = { if (!processing) onCancel() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(0.94f).heightIn(max = maxDialogHeight).widthIn(max = 520.dp),
            shape = RoundedCornerShape(8.dp),
            tonalElevation = 4.dp,
        ) {
            Column(
                modifier = Modifier.padding(18.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(copy.cropAvatar, style = MaterialTheme.typography.titleLarge)
                    Text(copy.cropAvatarDetail, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(1f)
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(6.dp)),
                ) {
                    Canvas(
                        modifier = Modifier
                            .fillMaxWidth()
                            .aspectRatio(1f)
                            .pointerInput(source, zoom) {
                                detectDragGestures { change, dragAmount ->
                                    change.consume()
                                    panX = (panX + dragAmount.x / size.width * 2f).coerceIn(-1f, 1f)
                                    panY = (panY + dragAmount.y / size.height * 2f).coerceIn(-1f, 1f)
                                }
                            },
                    ) {
                        drawImage(
                            image = image,
                            srcOffset = IntOffset(bounds.left, bounds.top),
                            srcSize = IntSize(bounds.size, bounds.size),
                            dstSize = IntSize(size.width.roundToInt(), size.height.roundToInt()),
                        )
                        val guide = ComposeColor.White.copy(alpha = 0.62f)
                        drawLine(guide, Offset(size.width / 3f, 0f), Offset(size.width / 3f, size.height), 1.dp.toPx())
                        drawLine(guide, Offset(size.width * 2f / 3f, 0f), Offset(size.width * 2f / 3f, size.height), 1.dp.toPx())
                        drawLine(guide, Offset(0f, size.height / 3f), Offset(size.width, size.height / 3f), 1.dp.toPx())
                        drawLine(guide, Offset(0f, size.height * 2f / 3f), Offset(size.width, size.height * 2f / 3f), 1.dp.toPx())
                        drawRect(guide, style = Stroke(width = 1.dp.toPx()))
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(copy.zoom, style = MaterialTheme.typography.labelMedium)
                    Slider(value = zoom, onValueChange = { zoom = it }, valueRange = 1f..3f)
                }
                if (error) Text(copy.cropAvatarError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    OutlinedButton(
                        enabled = !processing,
                        onClick = { zoom = 1f; panX = 0f; panY = 0f; error = false },
                    ) {
                        Icon(Icons.Outlined.RestartAlt, contentDescription = null, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(copy.resetCrop)
                    }
                    Spacer(Modifier.weight(1f))
                    OutlinedButton(enabled = !processing, onClick = onCancel) { Text(copy.cancel) }
                    Spacer(Modifier.width(8.dp))
                    Button(
                        enabled = !processing,
                        onClick = {
                            processing = true; error = false
                            scope.launch {
                                runCatching { withContext(Dispatchers.Default) { cropAvatar(source, zoom, panX, panY) } }
                                    .onSuccess(onApply)
                                    .onFailure { error = true; processing = false }
                            }
                        },
                    ) {
                        if (processing) CircularProgressIndicator(modifier = Modifier.size(17.dp), strokeWidth = 2.dp)
                        else Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(if (processing) copy.processingCrop else copy.applyCrop)
                    }
                }
            }
        }
    }
}

private const val AVATAR_OUTPUT_SIZE = 512
