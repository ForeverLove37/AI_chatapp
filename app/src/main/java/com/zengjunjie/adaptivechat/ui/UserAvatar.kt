package com.zengjunjie.adaptivechat.ui

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import kotlin.math.absoluteValue

private val avatarClient = OkHttpClient.Builder()
    .connectTimeout(6, TimeUnit.SECONDS)
    .readTimeout(10, TimeUnit.SECONDS)
    .build()
private val avatarCache = LruCache<String, ImageBitmap>(16)
private val avatarColors = listOf(
    Color(0xFF087F73),
    Color(0xFF315FD6),
    Color(0xFF7A4EAB),
    Color(0xFFB5473C),
    Color(0xFF39734E),
    Color(0xFF59636E),
)

@Composable
fun UserAvatar(
    displayName: String,
    email: String,
    avatarUrl: String,
    modifier: Modifier = Modifier,
    previewBytes: ByteArray? = null,
    contentDescription: String? = null,
) {
    val label = displayName.trim().ifBlank { email.trim().ifBlank { "User" } }
    val previewKey = previewBytes?.contentHashCode()
    val preview = remember(previewKey) {
        previewBytes?.let { bytes ->
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }
    }
    val remote by produceState<ImageBitmap?>(initialValue = avatarCache.get(avatarUrl), key1 = avatarUrl) {
        if (avatarUrl.isBlank() || avatarCache.get(avatarUrl) != null) return@produceState
        value = withContext(Dispatchers.IO) {
            runCatching {
                val request = Request.Builder().url(avatarUrl).get().build()
                avatarClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) return@use null
                    response.body?.byteStream()?.use(BitmapFactory::decodeStream)?.asImageBitmap()
                }
            }.getOrNull()?.also { avatarCache.put(avatarUrl, it) }
        }
    }
    val image = preview ?: remote
    val colorIndex = (label.lowercase().hashCode().toLong().absoluteValue % avatarColors.size).toInt()
    val background = avatarColors[colorIndex]

    Surface(
        modifier = modifier,
        shape = CircleShape,
        color = background,
    ) {
        if (image != null) {
            Image(
                bitmap = image,
                contentDescription = contentDescription ?: label,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    text = label.take(1).uppercase(),
                    color = Color.White,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}
