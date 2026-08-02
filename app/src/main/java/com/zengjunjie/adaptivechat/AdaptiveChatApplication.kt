package com.zengjunjie.adaptivechat

import android.app.Application
import androidx.room.Room
import com.zengjunjie.adaptivechat.data.ChatApi
import com.zengjunjie.adaptivechat.data.ChatDatabase
import com.zengjunjie.adaptivechat.data.ChatRepository

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
