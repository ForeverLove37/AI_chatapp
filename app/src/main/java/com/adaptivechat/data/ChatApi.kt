package com.adaptivechat.data

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class RemoteMessage(
    val role: String,
    val content: String,
)

data class StreamChunk(
    val content: String = "",
    val reasoning: String = "",
    val completed: Boolean = false,
)

class ChatApi(baseUrl: String) {
    private val endpoint = "${baseUrl.trimEnd('/')}/v1/chat/completions"
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    fun stream(
        model: ChatModel,
        messages: List<RemoteMessage>,
    ): Flow<StreamChunk> = callbackFlow {
        val payload = JSONObject()
            .put("model", model.wireName)
            .put("stream", true)
            .put(
                "messages",
                JSONArray().apply {
                    messages.forEach { message ->
                        put(JSONObject().put("role", message.role).put("content", message.content))
                    }
                },
            )

        val request = Request.Builder()
            .url(endpoint)
            .header("Accept", "text/event-stream")
            .post(payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
            .build()

        val eventSource = EventSources.createFactory(client).newEventSource(
            request,
            object : EventSourceListener() {
                override fun onEvent(
                    eventSource: EventSource,
                    id: String?,
                    type: String?,
                    data: String,
                ) {
                    if (data == "[DONE]") {
                        trySend(StreamChunk(completed = true))
                        close()
                        return
                    }

                    val payloadObject = runCatching { JSONObject(data) }.getOrNull() ?: return
                    val delta = payloadObject
                        .optJSONArray("choices")
                        ?.optJSONObject(0)
                        ?.optJSONObject("delta")
                        ?: return
                    val content = delta.optString("content")
                    val reasoning = when {
                        delta.has("reasoning_content") -> delta.optString("reasoning_content")
                        delta.has("reasoning") -> delta.optString("reasoning")
                        else -> ""
                    }

                    if (content.isNotEmpty() || reasoning.isNotEmpty()) {
                        trySend(StreamChunk(content = content, reasoning = reasoning))
                    }
                }

                override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                    close(t ?: IllegalStateException("Streaming request failed with HTTP ${response?.code}"))
                }
            },
        )

        awaitClose { eventSource.cancel() }
    }
}
