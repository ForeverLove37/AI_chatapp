package com.zengjunjie.adaptivechat.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatRepositoryTest {
    @Test
    fun contextWindowKeepsTheMostRecentTwentyFourMessages() {
        val messages = (1..30).map { index ->
            ChatMessageEntity(
                id = "message-$index",
                sessionId = "session",
                role = if (index % 2 == 0) "ASSISTANT" else "USER",
                content = "message $index",
                attachmentsJson = "[]",
                reasoning = "",
                createdAt = index.toLong(),
                isStreaming = false,
            )
        }

        val window = buildContextWindow("system", messages)

        assertEquals(25, window.size)
        assertEquals("system", window.first().role)
        assertEquals("message 7", window[1].content)
        assertEquals("message 30", window.last().content)
    }

    @Test
    fun contextWindowAlwaysRetainsTheNewestOversizedMessage() {
        val messages = listOf(
            testMessage("old", "old context"),
            testMessage("new", "x".repeat(32_001)),
        )

        val window = buildContextWindow("", messages)

        assertEquals(1, window.size)
        assertEquals(messages.last().content, window.single().content)
        assertTrue(window.single().content.length > 32_000)
    }

    @Test
    fun contextWindowRetainsPersistedImageAttachments() {
        val message = ChatMessageEntity(
            id = "image-message",
            sessionId = "session",
            role = "USER",
            content = "Describe this image",
            attachmentsJson = """[{"fileName":"sample.png","mimeType":"image/png","dataUrl":"data:image/png;base64,AA=="}]""",
            reasoning = "",
            createdAt = 0,
            isStreaming = false,
        )

        val window = buildContextWindow("", listOf(message))

        assertEquals(1, window.size)
        assertEquals("sample.png", window.single().attachments.single().fileName)
        assertEquals("data:image/png;base64,AA==", window.single().attachments.single().dataUrl)
    }

    private fun testMessage(id: String, content: String) = ChatMessageEntity(
        id = id,
        sessionId = "session",
        role = "USER",
        content = content,
        attachmentsJson = "[]",
        reasoning = "",
        createdAt = 0,
        isStreaming = false,
    )
}
