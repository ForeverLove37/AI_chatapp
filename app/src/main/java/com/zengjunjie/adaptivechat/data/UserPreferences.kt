package com.zengjunjie.adaptivechat.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class LanguagePreference {
    SYSTEM,
    ENGLISH,
    CHINESE,
}

enum class AppearancePreference {
    SYSTEM,
    LIGHT,
    DARK,
}

data class AppPreferencesState(
    val accessToken: String? = null,
    val email: String? = null,
    val displayName: String = "",
    val avatarUrl: String = "",
    val language: LanguagePreference = LanguagePreference.SYSTEM,
    val appearance: AppearancePreference = AppearancePreference.SYSTEM,
    val fontScale: Float = 1f,
    val groups: List<String> = emptyList(),
    val expertModeEnabled: Boolean = false,
) {
    val isAuthenticated: Boolean get() = !accessToken.isNullOrBlank()
    val expertModeAllowed: Boolean get() = groups.any { it.equals("expert", ignoreCase = true) }
}

class UserPreferences(context: Context) {
    private val storage: SharedPreferences = context.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)
    private val mutableState = MutableStateFlow(readState())

    val state: StateFlow<AppPreferencesState> = mutableState.asStateFlow()

    fun saveSession(accessToken: String, email: String, displayName: String = "", avatarUrl: String = "", groups: List<String>? = null) {
        storage.edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_EMAIL, email)
            .putString(KEY_DISPLAY_NAME, displayName)
            .putString(KEY_AVATAR_URL, avatarUrl)
            .apply { if (groups != null) putString(KEY_GROUPS, groups.joinToString(",")) }
            .apply()
        publish()
    }

    fun saveProfile(email: String, displayName: String, avatarUrl: String, groups: List<String>? = null) {
        storage.edit()
            .putString(KEY_EMAIL, email)
            .putString(KEY_DISPLAY_NAME, displayName)
            .putString(KEY_AVATAR_URL, avatarUrl)
            .apply { if (groups != null) putString(KEY_GROUPS, groups.joinToString(",")) }
            .apply()
        publish()
    }

    fun setExpertMode(enabled: Boolean) {
        storage.edit().putBoolean(KEY_EXPERT_MODE, enabled).apply()
        publish()
    }

    fun clearSession() {
        storage.edit()
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_EMAIL)
            .remove(KEY_DISPLAY_NAME)
            .remove(KEY_AVATAR_URL)
            .remove(KEY_GROUPS)
            .remove(KEY_EXPERT_MODE)
            .apply()
        publish()
    }

    fun setLanguage(value: LanguagePreference) {
        storage.edit().putString(KEY_LANGUAGE, value.name).apply()
        publish()
    }

    fun setAppearance(value: AppearancePreference) {
        storage.edit().putString(KEY_APPEARANCE, value.name).apply()
        publish()
    }

    fun setFontScale(value: Float) {
        storage.edit().putFloat(KEY_FONT_SCALE, value.coerceIn(0.85f, 1.35f)).apply()
        publish()
    }

    private fun publish() {
        mutableState.value = readState()
    }

    private fun readState() = AppPreferencesState(
        accessToken = storage.getString(KEY_ACCESS_TOKEN, null),
        email = storage.getString(KEY_EMAIL, null),
        displayName = storage.getString(KEY_DISPLAY_NAME, "").orEmpty(),
        avatarUrl = storage.getString(KEY_AVATAR_URL, "").orEmpty(),
        language = enumValue(storage.getString(KEY_LANGUAGE, null), LanguagePreference.SYSTEM),
        appearance = enumValue(storage.getString(KEY_APPEARANCE, null), AppearancePreference.SYSTEM),
        fontScale = storage.getFloat(KEY_FONT_SCALE, 1f).coerceIn(0.85f, 1.35f),
        groups = storage.getString(KEY_GROUPS, "")
            .orEmpty()
            .split(',')
            .map(String::trim)
            .filter(String::isNotBlank),
        expertModeEnabled = storage.getBoolean(KEY_EXPERT_MODE, false),
    )

    private inline fun <reified T : Enum<T>> enumValue(value: String?, fallback: T): T =
        enumValues<T>().firstOrNull { it.name == value } ?: fallback

    private companion object {
        const val FILE_NAME = "adaptive_chat_preferences"
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_EMAIL = "email"
        const val KEY_DISPLAY_NAME = "display_name"
        const val KEY_AVATAR_URL = "avatar_url"
        const val KEY_LANGUAGE = "language"
        const val KEY_APPEARANCE = "appearance"
        const val KEY_FONT_SCALE = "font_scale"
        const val KEY_GROUPS = "groups"
        const val KEY_EXPERT_MODE = "expert_mode"
    }
}
