package com.zengjunjie.adaptivechat.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ReasoningStreamParserTest {
    @Test
    fun separatesReasoningAcrossSplitThinkTags() {
        val parser = ReasoningStreamParser()

        assertEquals(ParsedStreamSegment(), parser.consume("<th"))
        assertEquals(ParsedStreamSegment(reasoning = "Step 1"), parser.consume("ink>Step 1"))
        assertEquals(ParsedStreamSegment(), parser.consume("</thi"))
        assertEquals(ParsedStreamSegment(content = "Final answer"), parser.consume("nk>Final answer"))
        assertEquals(ParsedStreamSegment(), parser.finish())
    }

    @Test
    fun preservesAnIncompleteTagWhenTheStreamFinishes() {
        val parser = ReasoningStreamParser()

        assertEquals(ParsedStreamSegment(content = "Answer with "), parser.consume("Answer with <thi"))
        assertEquals(ParsedStreamSegment(content = "<thi"), parser.finish())
    }
}
