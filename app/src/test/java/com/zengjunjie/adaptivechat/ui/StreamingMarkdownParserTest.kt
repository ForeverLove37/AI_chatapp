package com.zengjunjie.adaptivechat.ui

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamingMarkdownParserTest {
    @Test
    fun rendersStandardBlocksAndInlineStyles() {
        val blocks = parseStreamingMarkdown(
            """# Result

                |A **bold** and *italic* value with `code`.

                |- first
                |1. second

                |```kotlin
                |val answer = 42
                |```
            """.trimMargin(),
            isStreaming = false,
        )

        assertTrue(blocks[0] is RenderedMarkdownBlock.Heading)
        val paragraph = blocks[1] as RenderedMarkdownBlock.Paragraph
        assertEquals("A bold and italic value with code.", paragraph.content.text)
        assertTrue(paragraph.content.spanStyles.any { it.item.fontWeight == FontWeight.Bold })
        assertTrue(paragraph.content.spanStyles.any { it.item.fontStyle == FontStyle.Italic })
        assertTrue(paragraph.content.spanStyles.any { it.item.fontFamily == FontFamily.Monospace })
        assertEquals("\u2022", (blocks[2] as RenderedMarkdownBlock.ListItem).marker)
        assertEquals("1.", (blocks[3] as RenderedMarkdownBlock.ListItem).marker)
        assertEquals("val answer = 42", (blocks[4] as RenderedMarkdownBlock.Code).code)
    }

    @Test
    fun hidesIncompleteStreamingDelimitersWhileKeepingProgressVisible() {
        val paragraph = parseStreamingMarkdown(
            markdown = "Answer: **still arriving",
            isStreaming = true,
        ).single() as RenderedMarkdownBlock.Paragraph

        assertEquals("Answer: still arriving", paragraph.content.text)
        assertFalse(paragraph.content.text.contains("**"))
        assertTrue(paragraph.content.spanStyles.any { it.item.fontWeight == FontWeight.Bold })
    }

    @Test
    fun suppressesFragmentedHtmlControlTags() {
        val paragraph = parseStreamingMarkdown(
            markdown = "Useful answer <think data-state=\"pending\"",
            isStreaming = true,
        ).single() as RenderedMarkdownBlock.Paragraph

        assertEquals("Useful answer", paragraph.content.text)
        assertFalse(paragraph.content.text.contains('<'))
    }

    @Test
    fun treatsAnUnclosedStreamingFenceAsCodeWithoutExposingTheFence() {
        val block = parseStreamingMarkdown(
            markdown = "```kotlin\nval answer = 42",
            isStreaming = true,
        ).single() as RenderedMarkdownBlock.Code

        assertEquals("val answer = 42", block.code)
        assertFalse(block.code.contains("```"))
    }
}
