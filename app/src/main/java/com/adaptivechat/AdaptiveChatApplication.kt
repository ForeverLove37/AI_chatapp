package com.adaptivechat

import android.app.Application
import androidx.room.Room
import com.adaptivechat.data.ChatApi
import com.adaptivechat.data.ChatDatabase
import com.adaptivechat.data.ChatRepository

class AdaptiveChatApplication : Application() {
    private val database by lazy {
        Room.databaseBuilder(this, ChatDatabase::class.java, "adaptive-chat.db")
            .fallbackToDestructiveMigration(dropAllTables = true)
            .build()
    }

    val chatRepository by lazy {
        ChatRepository(
            chatDao = database.chatDao(),
            chatApi = ChatApi(BuildConfig.API_BASE_URL),
        )
    }
}
