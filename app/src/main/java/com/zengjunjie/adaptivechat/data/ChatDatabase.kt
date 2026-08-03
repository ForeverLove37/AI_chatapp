package com.zengjunjie.adaptivechat.data

import androidx.room.ColumnInfo
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
    @ColumnInfo(defaultValue = "''") val model: String = "",
    @ColumnInfo(defaultValue = "''") val errorText: String = "",
    @ColumnInfo(defaultValue = "''") val parentMessageId: String = "",
    @ColumnInfo(defaultValue = "0") val updatedAt: Long = createdAt,
)

@Dao
interface ChatDao {
    @Query("SELECT * FROM chat_sessions ORDER BY updatedAt DESC")
    fun observeSessions(): Flow<List<ChatSessionEntity>>

    @Query("SELECT * FROM chat_sessions ORDER BY updatedAt DESC")
    suspend fun getSessions(): List<ChatSessionEntity>

    @Query("SELECT * FROM chat_sessions WHERE id = :sessionId LIMIT 1")
    suspend fun getSession(sessionId: String): ChatSessionEntity?

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

    @Query("UPDATE chat_messages SET content = :content, reasoning = :reasoning, model = :model, errorText = :errorText, isStreaming = :isStreaming, updatedAt = :updatedAt WHERE id = :messageId")
    suspend fun updateAssistantMessage(
        messageId: String,
        content: String,
        reasoning: String,
        model: String,
        errorText: String,
        isStreaming: Boolean,
        updatedAt: Long,
    )

    @Query("DELETE FROM chat_messages WHERE id = :messageId AND sessionId = :sessionId")
    suspend fun deleteMessage(sessionId: String, messageId: String): Int

    @Query("DELETE FROM chat_messages WHERE sessionId = :sessionId AND (id = :userMessageId OR parentMessageId = :userMessageId)")
    suspend fun deleteUserMessageAndChildren(sessionId: String, userMessageId: String): Int

    @Query("DELETE FROM chat_messages WHERE sessionId = :sessionId AND createdAt > :createdAt")
    suspend fun deleteMessagesAfter(sessionId: String, createdAt: Long)

    @Query("DELETE FROM chat_messages WHERE sessionId = :sessionId AND createdAt >= :createdAt")
    suspend fun deleteMessagesAtOrAfter(sessionId: String, createdAt: Long)

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

    @Transaction
    suspend fun replaceSessionSnapshot(session: ChatSessionEntity, messages: List<ChatMessageEntity>) {
        upsertSession(session)
        deleteMessagesForSession(session.id)
        upsertMessages(messages)
    }

    @Transaction
    suspend fun deleteMessageAndTouch(sessionId: String, messageId: String, updatedAt: Long): Boolean {
        val deleted = deleteMessage(sessionId, messageId) > 0
        if (deleted) touchSession(sessionId, updatedAt)
        return deleted
    }

    @Transaction
    suspend fun deleteUserMessagePair(sessionId: String, messageId: String, updatedAt: Long): Boolean {
        val messages = getMessages(sessionId)
        val ids = pairedDeletionIds(messages, messageId)
        if (ids.isEmpty()) return false
        ids.forEach { deleteMessage(sessionId, it) }
        touchSession(sessionId, updatedAt)
        return true
    }

    @Transaction
    suspend fun replaceUserMessageAndTail(
        userMessage: ChatMessageEntity,
        assistantMessage: ChatMessageEntity,
        updatedAt: Long,
    ) {
        deleteMessagesAfter(userMessage.sessionId, userMessage.createdAt)
        upsertMessage(userMessage)
        upsertMessage(assistantMessage)
        touchSession(userMessage.sessionId, updatedAt)
    }

    @Transaction
    suspend fun prepareAssistantRegeneration(
        sessionId: String,
        messageId: String,
        createdAt: Long,
        model: String,
        updatedAt: Long,
    ) {
        deleteMessagesAfter(sessionId, createdAt)
        updateAssistantMessage(messageId, "", "", model, "", true, updatedAt)
        touchSession(sessionId, updatedAt)
    }

    @Transaction
    suspend fun restoreMessageTail(
        sessionId: String,
        createdAt: Long,
        messages: List<ChatMessageEntity>,
        updatedAt: Long,
    ) {
        deleteMessagesAtOrAfter(sessionId, createdAt)
        upsertMessages(messages)
        touchSession(sessionId, updatedAt)
    }
}

internal fun pairedDeletionIds(messages: List<ChatMessageEntity>, messageId: String): Set<String> {
    val targetIndex = messages.indexOfFirst { it.id == messageId }
    val target = messages.getOrNull(targetIndex) ?: return emptySet()
    require(target.role == MessageRole.USER.name) { "Only user messages can be deleted with their response." }
    return buildSet {
        add(target.id)
        messages.forEach { message -> if (message.parentMessageId == target.id) add(message.id) }
        messages.getOrNull(targetIndex + 1)
            ?.takeIf { it.role == MessageRole.ASSISTANT.name && it.parentMessageId.isBlank() }
            ?.let { add(it.id) }
    }
}

@Database(
    entities = [ChatSessionEntity::class, ChatMessageEntity::class],
    version = 5,
    exportSchema = false,
)
abstract class ChatDatabase : RoomDatabase() {
    abstract fun chatDao(): ChatDao

    companion object {
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "ALTER TABLE chat_messages ADD COLUMN attachmentsJson TEXT NOT NULL DEFAULT '[]'",
                )
            }
        }

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE chat_messages ADD COLUMN model TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE chat_messages ADD COLUMN errorText TEXT NOT NULL DEFAULT ''")
                db.execSQL(
                    """UPDATE chat_messages
                       SET model = COALESCE(
                           (SELECT model FROM chat_sessions WHERE chat_sessions.id = chat_messages.sessionId),
                           ''
                       )
                       WHERE role = 'ASSISTANT'""".trimIndent(),
                )
            }
        }

        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE chat_messages ADD COLUMN parentMessageId TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE chat_messages ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT 0")
                db.execSQL("UPDATE chat_messages SET updatedAt = createdAt WHERE updatedAt = 0")
                db.execSQL(
                    """UPDATE chat_messages
                       SET parentMessageId = COALESCE(
                           (SELECT user.id FROM chat_messages AS user
                            WHERE user.sessionId = chat_messages.sessionId
                              AND user.role = 'USER'
                              AND user.createdAt < chat_messages.createdAt
                            ORDER BY user.createdAt DESC
                            LIMIT 1),
                           ''
                       )
                       WHERE chat_messages.role = 'ASSISTANT'""".trimIndent(),
                )
            }
        }
    }
}
