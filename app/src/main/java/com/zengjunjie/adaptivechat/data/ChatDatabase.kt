package com.zengjunjie.adaptivechat.data

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "chat_sessions")
data class ChatSessionEntity(
    @PrimaryKey val id: String,
    val title: String,
    val provider: String,
    val model: String,
    val systemPrompt: String,
    val updatedAt: Long,
)

@Entity(
    tableName = "chat_messages",
    indices = [Index("sessionId")],
)
data class ChatMessageEntity(
    @PrimaryKey val id: String,
    val sessionId: String,
    val role: String,
    val content: String,
    val attachmentsJson: String,
    val reasoning: String,
    val createdAt: Long,
    val isStreaming: Boolean,
)

@Dao
interface ChatDao {
    @Query("SELECT * FROM chat_sessions ORDER BY updatedAt DESC")
    fun observeSessions(): Flow<List<ChatSessionEntity>>

    @Query("SELECT * FROM chat_sessions ORDER BY updatedAt DESC LIMIT 1")
    suspend fun getLatestSession(): ChatSessionEntity?

    @Query("SELECT * FROM chat_messages WHERE sessionId = :sessionId ORDER BY createdAt ASC")
    fun observeMessages(sessionId: String): Flow<List<ChatMessageEntity>>

    @Query("SELECT * FROM chat_messages WHERE sessionId = :sessionId ORDER BY createdAt ASC")
    suspend fun getMessages(sessionId: String): List<ChatMessageEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSession(session: ChatSessionEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertMessage(message: ChatMessageEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertMessages(messages: List<ChatMessageEntity>)

    @Query("UPDATE chat_sessions SET provider = :provider, model = :model, updatedAt = :updatedAt WHERE id = :sessionId")
    suspend fun updateChannel(sessionId: String, provider: String, model: String, updatedAt: Long)

    @Query("UPDATE chat_sessions SET model = :model, updatedAt = :updatedAt WHERE id = :sessionId")
    suspend fun updateModel(sessionId: String, model: String, updatedAt: Long)

    @Query("UPDATE chat_sessions SET title = :title, updatedAt = :updatedAt WHERE id = :sessionId")
    suspend fun updateTitle(sessionId: String, title: String, updatedAt: Long)

    @Query("UPDATE chat_sessions SET updatedAt = :updatedAt WHERE id = :sessionId")
    suspend fun touchSession(sessionId: String, updatedAt: Long)

    @Query("UPDATE chat_messages SET content = :content, reasoning = :reasoning, isStreaming = :isStreaming WHERE id = :messageId")
    suspend fun updateAssistantMessage(
        messageId: String,
        content: String,
        reasoning: String,
        isStreaming: Boolean,
    )

    @Query("DELETE FROM chat_sessions WHERE id = :sessionId")
    suspend fun deleteSession(sessionId: String)

    @Query("DELETE FROM chat_messages WHERE sessionId = :sessionId")
    suspend fun deleteMessagesForSession(sessionId: String)

    @Transaction
    suspend fun deleteSessionWithMessages(sessionId: String) {
        deleteMessagesForSession(sessionId)
        deleteSession(sessionId)
    }

    @Transaction
    suspend fun createSessionWithMessages(session: ChatSessionEntity, messages: List<ChatMessageEntity>) {
        upsertSession(session)
        upsertMessages(messages)
    }
}

@Database(
    entities = [ChatSessionEntity::class, ChatMessageEntity::class],
    version = 3,
    exportSchema = false,
)
abstract class ChatDatabase : RoomDatabase() {
    abstract fun chatDao(): ChatDao

    companion object {
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    "ALTER TABLE chat_messages ADD COLUMN attachmentsJson TEXT NOT NULL DEFAULT '[]'",
                )
            }
        }
    }
}
