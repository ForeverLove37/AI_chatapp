package com.zengjunjie.adaptivechat.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Density
import com.zengjunjie.adaptivechat.data.AppearancePreference
import com.zengjunjie.adaptivechat.data.ProviderMode

val LocalAdaptiveDark = staticCompositionLocalOf { false }

private val ChatGptLight = lightColorScheme(
    primary = Color(0xFF1A1A1A),
    onPrimary = Color.White,
    secondary = Color(0xFF606060),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFF1F1F1),
    background = Color(0xFFFAFAFA),
    outline = Color(0xFFE2E2E2),
)

private val ChatGptDark = darkColorScheme(
    primary = Color(0xFFF3F3F3),
    onPrimary = Color(0xFF202020),
    secondary = Color(0xFFBBBBBB),
    surface = Color(0xFF171717),
    surfaceVariant = Color(0xFF292929),
    background = Color(0xFF101010),
    outline = Color(0xFF363636),
)

private val GeminiLight = lightColorScheme(
    primary = Color(0xFF315FD6),
    onPrimary = Color.White,
    secondary = Color(0xFF8754C5),
    tertiary = Color(0xFF0B8069),
    surface = Color(0xFFFCFBFF),
    surfaceVariant = Color(0xFFF1F0FF),
    background = Color(0xFFF9F9FF),
    outline = Color(0xFFC9C9DF),
)

private val GeminiDark = darkColorScheme(
    primary = Color(0xFFBCC6FF),
    onPrimary = Color(0xFF0A215D),
    secondary = Color(0xFFE3B6FF),
    tertiary = Color(0xFF76E3C9),
    surface = Color(0xFF171829),
    surfaceVariant = Color(0xFF292B44),
    background = Color(0xFF11121F),
    outline = Color(0xFF454764),
)

private val DeepSeekDark = darkColorScheme(
    primary = Color(0xFF45D7BD),
    onPrimary = Color(0xFF00382F),
    secondary = Color(0xFF77B9FF),
    tertiary = Color(0xFFB4C5FF),
    surface = Color(0xFF101821),
    surfaceVariant = Color(0xFF172632),
    background = Color(0xFF071018),
    outline = Color(0xFF294554),
    error = Color(0xFFFFB4AB),
)

private val DeepSeekLight = lightColorScheme(
    primary = Color(0xFF00695C),
    onPrimary = Color.White,
    secondary = Color(0xFF2467A8),
    tertiary = Color(0xFF5A5E90),
    surface = Color(0xFFF8FCFC),
    surfaceVariant = Color(0xFFE2F0EE),
    background = Color(0xFFF4FAF9),
    outline = Color(0xFFB4CBC7),
)

private fun remoteColor(value: String, fallback: Color): Color = runCatching {
    Color(android.graphics.Color.parseColor(value))
}.getOrDefault(fallback)

private fun dynamicScheme(provider: ProviderMode, dark: Boolean) = if (dark) {
    val accent = remoteColor(provider.style.accentColor, Color(0xFF78D7C5))
    darkColorScheme(
        primary = accent,
        onPrimary = Color(0xFF0B1F1B),
        secondary = accent,
        surface = Color(0xFF151A19),
        surfaceVariant = Color(0xFF252C2A),
        background = Color(0xFF0F1312),
        outline = Color(0xFF45504D),
    )
} else {
    val accent = remoteColor(provider.style.accentColor, Color(0xFF087F73))
    val text = remoteColor(provider.style.textColor, Color(0xFF172126))
    val surface = remoteColor(provider.style.surfaceColor, Color.White)
    lightColorScheme(
        primary = accent,
        onPrimary = Color.White,
        secondary = accent,
        onSurface = text,
        onBackground = text,
        surface = surface,
        surfaceVariant = remoteColor(provider.style.backgroundEnd, Color(0xFFEEF3F1)),
        background = remoteColor(provider.style.backgroundStart, Color(0xFFF7F9F8)),
        outline = accent.copy(alpha = 0.42f),
    )
}

private fun typographyFor(provider: ProviderMode): Typography {
    val family = when (provider.style.typography.lowercase()) {
        "mono" -> FontFamily.Monospace
        "serif" -> FontFamily.Serif
        else -> FontFamily.SansSerif
    }
    val base = Typography()
    return base.copy(
        displayLarge = base.displayLarge.copy(fontFamily = family),
        displayMedium = base.displayMedium.copy(fontFamily = family),
        displaySmall = base.displaySmall.copy(fontFamily = family),
        headlineLarge = base.headlineLarge.copy(fontFamily = family),
        headlineMedium = base.headlineMedium.copy(fontFamily = family),
        headlineSmall = base.headlineSmall.copy(fontFamily = family),
        titleLarge = base.titleLarge.copy(fontFamily = family),
        titleMedium = base.titleMedium.copy(fontFamily = family),
        titleSmall = base.titleSmall.copy(fontFamily = family),
        bodyLarge = base.bodyLarge.copy(fontFamily = family),
        bodyMedium = base.bodyMedium.copy(fontFamily = family),
        bodySmall = base.bodySmall.copy(fontFamily = family),
        labelLarge = base.labelLarge.copy(fontFamily = family),
        labelMedium = base.labelMedium.copy(fontFamily = family),
        labelSmall = base.labelSmall.copy(fontFamily = family),
    )
}

@Composable
fun AdaptiveChatTheme(
    provider: ProviderMode,
    appearance: AppearancePreference,
    fontScale: Float,
    content: @Composable () -> Unit,
) {
    val systemDark = isSystemInDarkTheme()
    val dark = when (appearance) {
        AppearancePreference.SYSTEM -> systemDark
        AppearancePreference.LIGHT -> false
        AppearancePreference.DARK -> true
    }
    val colors = when {
        provider.isChatGpt -> if (dark) ChatGptDark else ChatGptLight
        provider.isGemini -> if (dark) GeminiDark else GeminiLight
        provider.isDeepSeek -> if (dark) DeepSeekDark else DeepSeekLight
        else -> dynamicScheme(provider, dark)
    }
    val density = LocalDensity.current

    CompositionLocalProvider(
        LocalAdaptiveDark provides dark,
        LocalDensity provides Density(density.density, fontScale.coerceIn(0.85f, 1.35f)),
    ) {
        MaterialTheme(
            colorScheme = colors,
            typography = typographyFor(provider),
            content = content,
        )
    }
}
