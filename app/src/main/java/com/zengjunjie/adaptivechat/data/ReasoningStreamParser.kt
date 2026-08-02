package com.zengjunjie.adaptivechat.data

data class ParsedStreamSegment(
    val reasoning: String = "",
    val content: String = "",
)

/** Splits DeepSeek's optional <think> stream without exposing incomplete control tags. */
class ReasoningStreamParser {
    private var insideThink = false
    private var pending = ""

    fun consume(chunk: String): ParsedStreamSegment {
        var remaining = pending + chunk
        pending = ""
        val reasoning = StringBuilder()
        val content = StringBuilder()

        while (remaining.isNotEmpty()) {
            val delimiter = if (insideThink) "</think>" else "<think>"
            val delimiterIndex = remaining.indexOf(delimiter)
            if (delimiterIndex >= 0) {
                append(remaining.substring(0, delimiterIndex), reasoning, content)
                remaining = remaining.substring(delimiterIndex + delimiter.length)
                insideThink = !insideThink
                continue
            }

            val partialLength = trailingDelimiterPrefixLength(remaining, delimiter)
            val safeText = remaining.dropLast(partialLength)
            append(safeText, reasoning, content)
            pending = if (partialLength == 0) "" else remaining.takeLast(partialLength)
            break
        }

        return ParsedStreamSegment(reasoning = reasoning.toString(), content = content.toString())
    }

    fun finish(): ParsedStreamSegment {
        val finalSegment = if (insideThink) {
            ParsedStreamSegment(reasoning = pending)
        } else {
            ParsedStreamSegment(content = pending)
        }
        pending = ""
        return finalSegment
    }

    private fun append(value: String, reasoning: StringBuilder, content: StringBuilder) {
        if (insideThink) reasoning.append(value) else content.append(value)
    }

    private fun trailingDelimiterPrefixLength(value: String, delimiter: String): Int {
        val largestCandidate = minOf(value.length, delimiter.length - 1)
        for (length in largestCandidate downTo 1) {
            if (value.takeLast(length) == delimiter.take(length)) return length
        }
        return 0
    }
}
