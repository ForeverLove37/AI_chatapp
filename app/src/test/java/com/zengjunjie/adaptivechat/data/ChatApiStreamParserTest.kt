package com.zengjunjie.adaptivechat.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ChatApiStreamParserTest {
    @Test
    fun ignoresNullContentAndReasoningDeltas() {
        val chunk = parseStreamDelta("""{"choices":[{"delta":{"content":null,"reasoning_content":null}}]}""")
        assertNull(chunk)
    }

    @Test
    fun keepsNonNullReasoningDelta() {
        val chunk = parseStreamDelta("""{"choices":[{"delta":{"content":null,"reasoning":"step"}}]}""")
        assertEquals(StreamChunk(reasoning = "step"), chunk)
    }
}
