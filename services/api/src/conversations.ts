import { Pool, type PoolClient } from "pg";

export type ConversationRole = "system" | "user" | "assistant";

export type ConversationAttachment = {
  fileName: string;
  mimeType: string;
  dataUrl: string;
};

export type ConversationMessage = {
  id: string;
  sessionId: string;
  role: ConversationRole;
  content: string;
  attachments: ConversationAttachment[];
  reasoning: string;
  modelId: string;
  generatedByModel: string;
  errorText: string;
  isStreaming: boolean;
  parentMessageId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ConversationSession = {
  id: string;
  title: string;
  channelId: string;
  modelId: string;
  systemPrompt: string;
  createdAt: number;
  updatedAt: number;
  messages: ConversationMessage[];
};

export type ConversationSnapshotInput = Omit<ConversationSession, "messages"> & {
  messages: Array<Omit<ConversationMessage, "sessionId">>;
};

export type MessageDeletion = {
  sessionId: string;
  deletedIds: string[];
  updatedAt: number;
};

export interface ConversationStore {
  start(): Promise<void>;
  close(): Promise<void>;
  listSessions(userId: string): Promise<ConversationSession[]>;
  getSession(userId: string, sessionId: string): Promise<ConversationSession | undefined>;
  upsertSnapshot(userId: string, snapshot: ConversationSnapshotInput): Promise<ConversationSession>;
  deleteSession(userId: string, sessionId: string): Promise<boolean>;
  deleteMessage(userId: string, messageId: string): Promise<MessageDeletion | undefined>;
  recordGeneratedModel(userId: string, sessionId: string, messageId: string, generatedByModel: string): Promise<boolean>;
}

const now = () => Date.now();

function inferParents(messages: ConversationSnapshotInput["messages"]) {
  let latestUserId: string | null = null;
  return [...messages]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map((message) => {
      if (message.role === "user") latestUserId = message.id;
      return {
        ...message,
        parentMessageId: message.role === "assistant"
          ? message.parentMessageId ?? latestUserId
          : null,
      };
    });
}

/** Isolated adapter used by API tests. Production always uses PostgreSQL. */
export class MemoryConversationStore implements ConversationStore {
  private readonly owners = new Map<string, string>();
  private readonly sessions = new Map<string, ConversationSession>();

  async start() {}
  async close() {}

  async listSessions(userId: string) {
    return [...this.sessions.values()]
      .filter((session) => this.owners.get(session.id) === userId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((session) => structuredClone(session));
  }

  async getSession(userId: string, sessionId: string) {
    const session = this.owners.get(sessionId) === userId ? this.sessions.get(sessionId) : undefined;
    return session ? structuredClone(session) : undefined;
  }

  async upsertSnapshot(userId: string, snapshot: ConversationSnapshotInput) {
    const owner = this.owners.get(snapshot.id);
    if (owner && owner !== userId) throw new Error("The conversation id is already in use.");
    const existing = this.sessions.get(snapshot.id);
    if (existing && snapshot.updatedAt < existing.updatedAt) return structuredClone(existing);
    const messages = inferParents(snapshot.messages).map((message) => {
      const previous = existing?.messages.find((candidate) => candidate.id === message.id);
      return {
        ...message,
        generatedByModel: message.generatedByModel || previous?.generatedByModel || "",
        sessionId: snapshot.id,
      };
    });
    for (const message of messages) {
      const collision = [...this.sessions.values()].some((session) =>
        session.id !== snapshot.id && session.messages.some((candidate) => candidate.id === message.id));
      if (collision) throw new Error("The message id is already in use.");
    }
    const resolved = { ...snapshot, messages };
    resolved.messages.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    this.owners.set(snapshot.id, userId);
    this.sessions.set(snapshot.id, structuredClone(resolved));
    return structuredClone(resolved);
  }

  async deleteSession(userId: string, sessionId: string) {
    if (this.owners.get(sessionId) !== userId) return false;
    this.owners.delete(sessionId);
    return this.sessions.delete(sessionId);
  }

  async deleteMessage(userId: string, messageId: string) {
    const session = [...this.sessions.values()].find((candidate) =>
      this.owners.get(candidate.id) === userId && candidate.messages.some((message) => message.id === messageId));
    if (!session) return undefined;
    const targetIndex = session.messages.findIndex((message) => message.id === messageId);
    const target = session.messages[targetIndex];
    const deleted = new Set([target.id]);
    if (target.role === "user") {
      for (const message of session.messages) {
        if (message.parentMessageId === target.id) deleted.add(message.id);
      }
      const next = session.messages[targetIndex + 1];
      if (next?.role === "assistant") deleted.add(next.id);
    }
    session.messages = session.messages.filter((message) => !deleted.has(message.id));
    session.updatedAt = Math.max(now(), session.updatedAt + 1);
    return { sessionId: session.id, deletedIds: [...deleted], updatedAt: session.updatedAt };
  }

  async recordGeneratedModel(userId: string, sessionId: string, messageId: string, generatedByModel: string) {
    const session = this.sessions.get(sessionId);
    if (!session || this.owners.get(sessionId) !== userId) return false;
    const message = session.messages.find((candidate) => candidate.id === messageId);
    if (!message || message.role !== "assistant") return false;
    message.generatedByModel = generatedByModel.trim();
    return true;
  }
}

function milliseconds(value: unknown) {
  return value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
}

function messageFromRow(row: Record<string, unknown>): ConversationMessage {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    role: String(row.role) as ConversationRole,
    content: String(row.content ?? ""),
    attachments: Array.isArray(row.attachments) ? row.attachments as ConversationAttachment[] : [],
    reasoning: String(row.reasoning ?? ""),
    modelId: String(row.model_id ?? ""),
    generatedByModel: String(row.generated_by_model ?? ""),
    errorText: String(row.error_text ?? ""),
    isStreaming: Boolean(row.is_streaming),
    parentMessageId: row.parent_message_id ? String(row.parent_message_id) : null,
    createdAt: milliseconds(row.created_at),
    updatedAt: milliseconds(row.updated_at),
  };
}

function sessionFromRow(row: Record<string, unknown>, messages: ConversationMessage[]): ConversationSession {
  return {
    id: String(row.id),
    title: String(row.title),
    channelId: String(row.channel_id),
    modelId: String(row.model_id),
    systemPrompt: String(row.system_prompt),
    createdAt: milliseconds(row.created_at),
    updatedAt: milliseconds(row.updated_at),
    messages,
  };
}

export class PostgresConversationStore implements ConversationStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async start() {
    await this.pool.query("SELECT 1");
    await this.migrate();
  }

  async close() {
    await this.pool.end();
  }

  private async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        system_prompt TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chat_sessions_user_updated_idx
        ON chat_sessions(user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
        content TEXT NOT NULL DEFAULT '',
        attachments JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(attachments) = 'array'),
        reasoning TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        generated_by_model TEXT NOT NULL DEFAULT '',
        error_text TEXT NOT NULL DEFAULT '',
        is_streaming BOOLEAN NOT NULL DEFAULT FALSE,
        parent_message_id TEXT REFERENCES chat_messages(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chat_messages_session_created_idx
        ON chat_messages(session_id, created_at, id);
      CREATE INDEX IF NOT EXISTS chat_messages_parent_idx
        ON chat_messages(parent_message_id) WHERE parent_message_id IS NOT NULL;
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_streaming BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS generated_by_model TEXT NOT NULL DEFAULT '';
    `);
  }

  private async loadSessions(client: Pool | PoolClient, userId: string, sessionId?: string) {
    const sessions = await client.query<Record<string, unknown>>(
      `SELECT * FROM chat_sessions
       WHERE user_id = $1 ${sessionId ? "AND id = $2" : ""}
       ORDER BY updated_at DESC`,
      sessionId ? [userId, sessionId] : [userId],
    );
    if (!sessions.rows.length) return [];
    const ids = sessions.rows.map((row) => String(row.id));
    const messages = await client.query<Record<string, unknown>>(
      `SELECT chat_messages.*
       FROM chat_messages
       JOIN chat_sessions ON chat_sessions.id = chat_messages.session_id
       WHERE chat_sessions.user_id = $1 AND chat_messages.session_id = ANY($2::text[])
       ORDER BY chat_messages.created_at, chat_messages.id`,
      [userId, ids],
    );
    const grouped = new Map<string, ConversationMessage[]>();
    for (const row of messages.rows) {
      const message = messageFromRow(row);
      const values = grouped.get(message.sessionId) ?? [];
      values.push(message);
      grouped.set(message.sessionId, values);
    }
    return sessions.rows.map((row) => sessionFromRow(row, grouped.get(String(row.id)) ?? []));
  }

  async listSessions(userId: string) {
    return this.loadSessions(this.pool, userId);
  }

  async getSession(userId: string, sessionId: string) {
    return (await this.loadSessions(this.pool, userId, sessionId))[0];
  }

  async upsertSnapshot(userId: string, snapshot: ConversationSnapshotInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const owner = await client.query<{ user_id: string; updated_at: Date }>(
        "SELECT user_id, updated_at FROM chat_sessions WHERE id = $1 FOR UPDATE",
        [snapshot.id],
      );
      if (owner.rows[0] && owner.rows[0].user_id !== userId) throw new Error("The conversation id is already in use.");
      if (owner.rows[0] && milliseconds(owner.rows[0].updated_at) > snapshot.updatedAt) {
        const current = (await this.loadSessions(client, userId, snapshot.id))[0];
        await client.query("COMMIT");
        if (!current) throw new Error("The conversation could not be loaded.");
        return current;
      }
      await client.query(
        `INSERT INTO chat_sessions
          (id, user_id, title, channel_id, model_id, system_prompt, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), to_timestamp($8 / 1000.0))
         ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          channel_id = EXCLUDED.channel_id,
          model_id = EXCLUDED.model_id,
          system_prompt = EXCLUDED.system_prompt,
          updated_at = EXCLUDED.updated_at
         WHERE chat_sessions.user_id = EXCLUDED.user_id
           AND EXCLUDED.updated_at >= chat_sessions.updated_at`,
        [snapshot.id, userId, snapshot.title, snapshot.channelId, snapshot.modelId, snapshot.systemPrompt, snapshot.createdAt, snapshot.updatedAt],
      );

      const messages = inferParents(snapshot.messages);
      await client.query(
        "DELETE FROM chat_messages WHERE session_id = $1 AND NOT (id = ANY($2::text[]))",
        [snapshot.id, messages.map((message) => message.id)],
      );
      for (const message of messages) {
        const result = await client.query(
          `INSERT INTO chat_messages
          (id, session_id, role, content, attachments, reasoning, model_id, error_text,
             generated_by_model, is_streaming, parent_message_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, NULL,
             to_timestamp($11 / 1000.0), to_timestamp($12 / 1000.0))
           ON CONFLICT (id) DO UPDATE SET
             role = EXCLUDED.role,
             content = EXCLUDED.content,
             attachments = EXCLUDED.attachments,
             reasoning = EXCLUDED.reasoning,
             model_id = EXCLUDED.model_id,
             generated_by_model = CASE WHEN chat_messages.generated_by_model <> '' THEN chat_messages.generated_by_model ELSE EXCLUDED.generated_by_model END,
             error_text = EXCLUDED.error_text,
             is_streaming = EXCLUDED.is_streaming,
             updated_at = EXCLUDED.updated_at
           WHERE chat_messages.session_id = EXCLUDED.session_id
             AND EXCLUDED.updated_at >= chat_messages.updated_at`,
          [
            message.id,
            snapshot.id,
            message.role,
            message.content,
            JSON.stringify(message.attachments),
            message.reasoning,
            message.modelId,
            message.errorText,
            message.generatedByModel,
            message.isStreaming,
            message.createdAt,
            message.updatedAt,
          ],
        );
        if (!result.rowCount) {
          const collision = await client.query("SELECT 1 FROM chat_messages WHERE id = $1 AND session_id <> $2", [message.id, snapshot.id]);
          if (collision.rowCount) throw new Error("The message id is already in use.");
        }
      }
      for (const message of messages) {
        if (message.parentMessageId) {
          const parent = await client.query(
            "SELECT 1 FROM chat_messages WHERE id = $1 AND session_id = $2 AND role = 'user'",
            [message.parentMessageId, snapshot.id],
          );
          if (!parent.rowCount) throw new Error("An assistant response references an invalid user message.");
        }
        await client.query(
          `UPDATE chat_messages SET parent_message_id = $1
           WHERE id = $2 AND session_id = $3 AND updated_at <= to_timestamp($4 / 1000.0)`,
          [message.parentMessageId, message.id, snapshot.id, message.updatedAt],
        );
      }
      const saved = (await this.loadSessions(client, userId, snapshot.id))[0];
      if (!saved) throw new Error("The conversation could not be saved.");
      await client.query("COMMIT");
      return saved;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteSession(userId: string, sessionId: string) {
    const result = await this.pool.query(
      "DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2",
      [sessionId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteMessage(userId: string, messageId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query<Record<string, unknown>>(
        `SELECT chat_messages.*
         FROM chat_messages
         JOIN chat_sessions ON chat_sessions.id = chat_messages.session_id
         WHERE chat_messages.id = $1 AND chat_sessions.user_id = $2
         FOR UPDATE OF chat_messages`,
        [messageId, userId],
      );
      if (!target.rows[0]) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const message = messageFromRow(target.rows[0]);
      const deletedIds = new Set([message.id]);
      if (message.role === "user") {
        const paired = await client.query<{ id: string }>(
          `SELECT id FROM chat_messages
           WHERE session_id = $1 AND parent_message_id = $2
           UNION
           SELECT id FROM (
             SELECT id, role FROM chat_messages
             WHERE session_id = $1 AND created_at > to_timestamp($3 / 1000.0)
             ORDER BY created_at, id LIMIT 1
           ) AS immediate_next
           WHERE role = 'assistant'`,
          [message.sessionId, message.id, message.createdAt],
        );
        for (const row of paired.rows) deletedIds.add(row.id);
      }
      await client.query(
        "DELETE FROM chat_messages WHERE session_id = $1 AND id = ANY($2::text[])",
        [message.sessionId, [...deletedIds]],
      );
      const updated = await client.query<{ updated_at: Date }>(
        `UPDATE chat_sessions
         SET updated_at = GREATEST(NOW(), updated_at + INTERVAL '1 millisecond')
         WHERE id = $1 RETURNING updated_at`,
        [message.sessionId],
      );
      const updatedAt = milliseconds(updated.rows[0]?.updated_at);
      await client.query("COMMIT");
      return { sessionId: message.sessionId, deletedIds: [...deletedIds], updatedAt };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordGeneratedModel(userId: string, sessionId: string, messageId: string, generatedByModel: string) {
    const result = await this.pool.query(
      `UPDATE chat_messages
       SET generated_by_model = $1
       FROM chat_sessions
       WHERE chat_messages.id = $2
         AND chat_messages.session_id = $3
         AND chat_messages.session_id = chat_sessions.id
         AND chat_sessions.user_id = $4
         AND chat_messages.role = 'assistant'`,
      [generatedByModel.trim(), messageId, sessionId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

export async function createPostgresConversationStore(databaseUrl = process.env.DATABASE_URL
  ?? "postgresql://adaptive_chat:adaptive_chat@localhost:5432/adaptive_chat") {
  const store = new PostgresConversationStore(databaseUrl);
  await store.start();
  return store;
}
