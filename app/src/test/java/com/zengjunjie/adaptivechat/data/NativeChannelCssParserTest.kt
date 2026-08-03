package com.zengjunjie.adaptivechat.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeChannelCssParserTest {
    private val base = ChannelStyle(
        backgroundStart = "#FFFFFF",
        backgroundEnd = "#EEEEEE",
        accentColor = "#008877",
        textColor = "#111111",
        surfaceColor = "#FAFAFA",
    )

    @Test
    fun parsesSafeNativeGradientAndTypographyTokens() {
        val result = NativeChannelCssParser.apply(
            base,
            """
                .chat {
                  background: linear-gradient(210deg, #112233, #445566, #778899);
                  --chat-accent: #AABBCC;
                  --chat-text: #010203;
                  --chat-surface: #F0F1F2;
                  --chat-font-family: monospace;
                  animation: flow 4.5s linear infinite;
                }
            """.trimIndent(),
        )

        assertEquals(listOf("#112233", "#445566", "#778899"), result.gradientColors)
        assertEquals(210f, result.gradientAngleDegrees)
        assertEquals(4_500, result.animationDurationMillis)
        assertEquals("#AABBCC", result.accentColor)
        assertEquals("#010203", result.textColor)
        assertEquals("#F0F1F2", result.surfaceColor)
        assertEquals("mono", result.typography)
        assertTrue(result.animatedGradient)
    }

    @Test
    fun rejectsUnsupportedValuesAndKeepsFallbacks() {
        val result = NativeChannelCssParser.apply(
            base,
            "--chat-text: expression(alert(1)); --chat-accent: red; background: url(javascript:bad);",
        )

        assertEquals(base.textColor, result.textColor)
        assertEquals(base.accentColor, result.accentColor)
        assertEquals(listOf(base.backgroundStart, base.backgroundEnd), result.gradientColors)
    }
}
