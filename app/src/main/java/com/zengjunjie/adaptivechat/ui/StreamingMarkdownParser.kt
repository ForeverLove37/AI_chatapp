package com.zengjunjie.adaptivechat.ui

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle

internal sealed interface RenderedMarkdownBlock {
    data class Paragraph(val content: AnnotatedString) : RenderedMarkdownBlock
    data class Heading(val level: Int, val content: AnnotatedString) : RenderedMarkdownBlock
    data class Code(val code: String) : RenderedMarkdownBlock
    data class ListItem(val marker: String, val content: AnnotatedString) : RenderedMarkdownBlock
}

private data class Fence(val marker: Char, val length: Int)

private val bulletPattern = Regex("^\\s*[-*+]\\s+(.*)$")
private val numberedPattern = Regex("^\\s*(\\d+)[.)]\\s+(.*)$")
private val headingPattern = Regex("^\\s{0,3}(#{1,6})\\s+(.+)$")
private val completeHtmlTag = Regex("</?[A-Za-z][A-Za-z0-9-]*(?:\\s+[^>\\n]{0,256})?/?>")
private val partialHtmlTag = Regex("</?[A-Za-z][^>\n]{0,256}$")

internal fun parseStreamingMarkdown(markdown: String, isStreaming: Boolean): List<RenderedMarkdownBlock> {
    val safeMarkdown = sanitizeMarkdown(markdown, isStreaming)
    val blocks = mutableListOf<RenderedMarkdownBlock>()
    val paragraph = StringBuilder()
    val code = StringBuilder()
    var fence: Fence? = null

    fun flushParagraph() {
        if (paragraph.isNotBlank()) {
            blocks += RenderedMarkdownBlock.Paragraph(parseInlineMarkdown(paragraph.toString().trimEnd(), isStreaming))
            paragraph.clear()
        }
    }

    fun flushCode() {
        blocks += RenderedMarkdownBlock.Code(code.toString().trimEnd())
        code.clear()
    }

    safeMarkdown.lines().forEach { line ->
        val candidate = fenceCandidate(line)
        val activeFence = fence
        if (activeFence != null) {
            if (candidate != null && candidate.marker == activeFence.marker && candidate.length >= activeFence.length) {
                flushCode()
                fence = null
            } else {
                if (code.isNotEmpty()) code.append('\n')
                code.append(line)
            }
            return@forEach
        }
        if (candidate != null) {
            flushParagraph()
            fence = candidate
            return@forEach
        }

        val heading = headingPattern.matchEntire(line)
        val bullet = bulletPattern.matchEntire(line)
        val numbered = numberedPattern.matchEntire(line)
        when {
            heading != null -> {
                flushParagraph()
                blocks += RenderedMarkdownBlock.Heading(
                    level = heading.groupValues[1].length,
                    content = parseInlineMarkdown(heading.groupValues[2], isStreaming),
                )
            }
            bullet != null -> {
                flushParagraph()
                blocks += RenderedMarkdownBlock.ListItem("\u2022", parseInlineMarkdown(bullet.groupValues[1], isStreaming))
            }
            numbered != null -> {
                flushParagraph()
                blocks += RenderedMarkdownBlock.ListItem(
                    "${numbered.groupValues[1]}.",
                    parseInlineMarkdown(numbered.groupValues[2], isStreaming),
                )
            }
            line.isBlank() -> flushParagraph()
            else -> {
                if (paragraph.isNotEmpty()) paragraph.append('\n')
                paragraph.append(line)
            }
        }
    }
    if (fence != null) flushCode() else flushParagraph()
    return blocks
}

private fun fenceCandidate(line: String): Fence? {
    val trimmed = line.dropWhile { it == ' ' }.takeIf { line.length - it.length <= 3 } ?: return null
    val marker = trimmed.firstOrNull()?.takeIf { it == '`' || it == '~' } ?: return null
    val length = trimmed.takeWhile { it == marker }.length
    return if (length >= 3) Fence(marker, length) else null
}

private fun sanitizeMarkdown(markdown: String, isStreaming: Boolean): String {
    var sanitized = markdown
        .filter { character -> character == '\n' || character == '\t' || !character.isISOControl() }
        .replace(completeHtmlTag, "")
    if (isStreaming) {
        val possibleTagStart = sanitized.lastIndexOf('<')
        if (possibleTagStart >= 0 && partialHtmlTag.matches(sanitized.substring(possibleTagStart))) {
            sanitized = sanitized.substring(0, possibleTagStart)
        }
    }
    return sanitized
}

private fun parseInlineMarkdown(value: String, isStreaming: Boolean, depth: Int = 0): AnnotatedString {
    if (depth >= MAX_INLINE_NESTING) {
        val stableText = if (isStreaming) value.trimEnd('*', '_', '`', '~') else value
        return AnnotatedString(stableText)
    }
    return buildAnnotatedString {
        var index = 0
        while (index < value.length) {
            when {
                value[index] == '\\' && index + 1 < value.length -> {
                    append(value[index + 1])
                    index += 2
                }
                value[index] == '`' -> {
                    val markerLength = value.substring(index).takeWhile { it == '`' }.length
                    val marker = "`".repeat(markerLength)
                    val end = value.indexOf(marker, index + markerLength)
                    if (end >= index + markerLength) {
                        withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) {
                            append(value.substring(index + markerLength, end))
                        }
                        index = end + markerLength
                    } else if (isStreaming) {
                        withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) {
                            append(value.substring(index + markerLength))
                        }
                        index = value.length
                    } else {
                        append(marker)
                        index += markerLength
                    }
                }
                value.startsWith("**", index) || value.startsWith("__", index) -> {
                    val marker = value.substring(index, index + 2)
                    val end = value.indexOf(marker, index + 2)
                    if (end > index + 2) {
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                            append(parseInlineMarkdown(value.substring(index + 2, end), isStreaming, depth + 1))
                        }
                        index = end + 2
                    } else if (isStreaming) {
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                            append(parseInlineMarkdown(value.substring(index + 2), true, depth + 1))
                        }
                        index = value.length
                    } else {
                        append(marker)
                        index += 2
                    }
                }
                value.startsWith("~~", index) -> {
                    val end = value.indexOf("~~", index + 2)
                    if (end > index + 2) {
                        withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) {
                            append(parseInlineMarkdown(value.substring(index + 2, end), isStreaming, depth + 1))
                        }
                        index = end + 2
                    } else if (isStreaming) {
                        withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) {
                            append(parseInlineMarkdown(value.substring(index + 2), true, depth + 1))
                        }
                        index = value.length
                    } else {
                        append("~~")
                        index += 2
                    }
                }
                value[index] == '*' || value[index] == '_' -> {
                    val marker = value[index]
                    val end = value.indexOf(marker, index + 1)
                    if (end > index + 1) {
                        withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                            append(parseInlineMarkdown(value.substring(index + 1, end), isStreaming, depth + 1))
                        }
                        index = end + 1
                    } else if (isStreaming) {
                        withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                            append(value.substring(index + 1))
                        }
                        index = value.length
                    } else {
                        append(marker)
                        index += 1
                    }
                }
                value[index] == '[' -> {
                    val labelEnd = value.indexOf("](", index + 1)
                    val urlEnd = if (labelEnd >= 0) value.indexOf(')', labelEnd + 2) else -1
                    if (labelEnd > index + 1 && urlEnd > labelEnd + 2) {
                        withStyle(SpanStyle(textDecoration = TextDecoration.Underline)) {
                            append(parseInlineMarkdown(value.substring(index + 1, labelEnd), isStreaming, depth + 1))
                        }
                        index = urlEnd + 1
                    } else {
                        append(value[index])
                        index += 1
                    }
                }
                else -> {
                    append(value[index])
                    index += 1
                }
            }
        }
    }
}

private const val MAX_INLINE_NESTING = 16
