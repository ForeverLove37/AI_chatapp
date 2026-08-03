package com.zengjunjie.adaptivechat.data

/** Converts a small, declarative CSS subset into native Compose style tokens. */
object NativeChannelCssParser {
    private val declarationPattern = Regex("""([\w-]{1,64})\s*:\s*([^;{}]{0,512})""")
    private val gradientPattern = Regex(
        """linear-gradient\(\s*(-?\d+(?:\.\d+)?deg)?\s*,?([^)]{0,2000})\)""",
        RegexOption.IGNORE_CASE,
    )
    private val colorPattern = Regex("#[0-9a-fA-F]{6}")
    private val exactColorPattern = Regex("^#[0-9a-fA-F]{6}$")

    fun apply(base: ChannelStyle, css: String): ChannelStyle {
        val source = css.take(50_000).replace(Regex("/\\*.*?\\*/", setOf(RegexOption.DOT_MATCHES_ALL)), " ")
        if (source.isBlank()) return base.copy(customCss = "")
        val declarations = declarationPattern.findAll(source).associate {
            it.groupValues[1].lowercase() to it.groupValues[2].trim()
        }
        fun color(name: String, fallback: String): String = declarations[name]
            ?.takeIf(exactColorPattern::matches)
            ?.uppercase()
            ?: fallback

        val gradient = gradientPattern.find(source)
        val parsedColors = gradient
            ?.groupValues
            ?.getOrNull(2)
            ?.let { colorPattern.findAll(it) }
            ?.map { it.value.uppercase() }
            ?.take(6)
            ?.toList()
            .orEmpty()
        val start = color("--chat-background-start", base.backgroundStart)
        val end = color("--chat-background-end", base.backgroundEnd)
        val angle = gradient?.groupValues?.getOrNull(1)
            ?.removeSuffix("deg")
            ?.toFloatOrNull()
            ?.let { ((it % 360f) + 360f) % 360f }
            ?: base.gradientAngleDegrees
        val duration = parseDuration(
            declarations["--chat-animation-duration"]
                ?: declarations["animation-duration"]
                ?: declarations["animation"]?.split(Regex("\\s+"))?.firstOrNull { it.endsWith("ms") || it.endsWith("s") },
            base.animationDurationMillis,
        )
        val font = declarations["--chat-font-family"] ?: declarations["font-family"]
        val typography = when {
            font?.contains("mono", ignoreCase = true) == true -> "mono"
            font?.contains("serif", ignoreCase = true) == true -> "serif"
            font != null -> "sans"
            else -> base.typography
        }
        val animated = when (declarations["--chat-animated"]?.lowercase()) {
            "false", "0", "no" -> false
            "true", "1", "yes" -> true
            else -> base.animatedGradient || declarations.containsKey("animation") || declarations.containsKey("animation-duration")
        }
        return base.copy(
            backgroundStart = parsedColors.firstOrNull() ?: start,
            backgroundEnd = parsedColors.lastOrNull() ?: end,
            accentColor = color("--chat-accent", base.accentColor),
            textColor = color("--chat-text", base.textColor),
            surfaceColor = color("--chat-surface", base.surfaceColor),
            typography = typography,
            animatedGradient = animated,
            gradientColors = parsedColors.takeIf { it.size >= 2 } ?: listOf(start, end),
            gradientAngleDegrees = angle,
            animationDurationMillis = duration,
            customCss = source,
        )
    }

    private fun parseDuration(value: String?, fallback: Int): Int {
        val normalized = value?.trim()?.lowercase() ?: return fallback
        val millis = when {
            normalized.endsWith("ms") -> normalized.removeSuffix("ms").toFloatOrNull()
            normalized.endsWith("s") -> normalized.removeSuffix("s").toFloatOrNull()?.times(1_000f)
            else -> null
        } ?: return fallback
        return millis.toInt().coerceIn(1_000, 60_000)
    }
}
