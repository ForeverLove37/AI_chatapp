package com.zengjunjie.adaptivechat.data

import android.content.Context
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale

/**
 * Uses the gateway's Edge TTS response when it is available, then degrades to the
 * device engine. The local engine is intentionally the only fallback so no API key
 * or alternate cloud voice service is needed on the client.
 */
class SpeechPlayer(
    context: Context,
    baseUrl: String,
) {
    private val appContext = context.applicationContext
    private val chatApi = ChatApi(baseUrl)
    private var mediaPlayer: MediaPlayer? = null
    private var audioFile: File? = null
    private var deviceTts: TextToSpeech? = null
    private var pendingDeviceText: String? = null
    private var released = false
    private var playbackGeneration = 0

    suspend fun speak(accessToken: String, markdown: String) {
        val text = markdown.trim()
        if (text.isBlank() || released) return

        val generation = withContext(Dispatchers.Main.immediate) {
            playbackGeneration += 1
            stop()
            playbackGeneration
        }
        val audio = runCatching {
            chatApi.synthesizeSpeech(accessToken, text, edgeVoiceFor(Locale.getDefault()))
        }.getOrNull()

        withContext(Dispatchers.Main.immediate) {
            if (released || generation != playbackGeneration) return@withContext
            if (audio == null) speakWithDevice(text) else playRemoteAudio(audio, text)
        }
    }

    fun stop() {
        mediaPlayer?.runCatching {
            setOnCompletionListener(null)
            setOnErrorListener(null)
            stop()
            release()
        }
        mediaPlayer = null
        audioFile?.delete()
        audioFile = null
        deviceTts?.stop()
        pendingDeviceText = null
    }

    fun release() {
        if (released) return
        released = true
        playbackGeneration += 1
        stop()
        deviceTts?.shutdown()
        deviceTts = null
    }

    private fun playRemoteAudio(audio: ByteArray, fallbackText: String) {
        val file = runCatching {
            File.createTempFile("adaptive-chat-tts-", ".mp3", appContext.cacheDir).apply {
                outputStream().use { it.write(audio) }
            }
        }.getOrElse {
            speakWithDevice(fallbackText)
            return
        }
        audioFile = file

        runCatching {
            MediaPlayer().also { player ->
                mediaPlayer = player
                player.setDataSource(file.absolutePath)
                player.setOnPreparedListener { prepared ->
                    if (prepared === mediaPlayer && !released) prepared.start() else prepared.release()
                }
                player.setOnCompletionListener {
                    releaseRemoteAudio()
                }
                player.setOnErrorListener { _, _, _ ->
                    releaseRemoteAudio()
                    speakWithDevice(fallbackText)
                    true
                }
                player.prepareAsync()
            }
        }.onFailure {
            releaseRemoteAudio()
            speakWithDevice(fallbackText)
        }
    }

    private fun releaseRemoteAudio() {
        mediaPlayer?.runCatching {
            setOnCompletionListener(null)
            setOnErrorListener(null)
            release()
        }
        mediaPlayer = null
        audioFile?.delete()
        audioFile = null
    }

    private fun speakWithDevice(text: String) {
        val existing = deviceTts
        if (existing != null) {
            startDeviceSpeech(existing, text)
            return
        }

        pendingDeviceText = text
        deviceTts = TextToSpeech(appContext) { status ->
            val pending = pendingDeviceText
            pendingDeviceText = null
            if (status == TextToSpeech.SUCCESS && pending != null && !released) {
                deviceTts?.let { startDeviceSpeech(it, pending) }
            }
        }
    }

    private fun startDeviceSpeech(engine: TextToSpeech, text: String) {
        engine.language = Locale.getDefault()
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "adaptive-chat-response")
    }

    private fun edgeVoiceFor(locale: Locale): String = when (locale.language.lowercase()) {
        "zh" -> "zh-CN-XiaoxiaoNeural"
        else -> "en-US-AriaNeural"
    }
}
