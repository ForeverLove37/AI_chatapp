package com.zengjunjie.adaptivechat

import android.app.Application
import androidx.room.Room
import com.zengjunjie.adaptivechat.data.ChatApi
import com.zengjunjie.adaptivechat.data.ChatDatabase
import com.zengjunjie.adaptivechat.data.ChatRepository
import com.zengjunjie.adaptivechat.data.UserPreferences

class AdaptiveChatApplication : Application() {
    private val database by lazy {
        Room.databaseBuilder(this, ChatDatabase::class.java, "adaptive-chat.db")
            .addMigrations(ChatDatabase.MIGRATION_2_3)
            .build()
    }

    val chatRepository by lazy {
        ChatRepository(
            chatDao = database.chatDao(),
            chatApi = ChatApi(BuildConfig.API_BASE_URL),
        )
    }

    val userPreferences by lazy { UserPreferences(this) }
}
