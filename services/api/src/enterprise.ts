import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Pool } from "pg";
import { createClient } from "redis";

export type EmailTemplateTrigger = "suspicious_login" | "announcement" | "version_update";
export type JobType = "email" | "backup" | "build";
export type JobStatus = "queued" | "running" | "retrying" | "succeeded" | "failed";
export type ReleaseRing = "beta" | "production";
export type BackupProtocol = "local" | "webdav" | "s3";

export type EmailSettings = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
  passwordConfigured: boolean;
  updatedAt: string;
};

export type EmailSettingsInput = Omit<EmailSettings, "passwordConfigured" | "updatedAt"> & {
  password?: string;
};

export type EmailTemplate = {
  id: string;
  trigger: EmailTemplateTrigger;
  name: string;
  subject: string;
  htmlBody: string;
  enabled: boolean;
  updatedAt: string;
};

export type DynamicModel = {
  id: string;
  label: string;
  description: string;
  upstreamModel: string;
};

export type DynamicChannel = {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  provider: string;
  providerKeyId: string | null;
  iconDataUrl: string;
  backgroundStart: string;
  backgroundEnd: string;
  accentColor: string;
  textColor: string;
  surfaceColor: string;
  typography: "sans" | "serif" | "mono";
  animatedGradient: boolean;
  models: DynamicModel[];
  enabled: boolean;
  sortOrder: number;
  updatedAt: string;
};

export type UserGroup = {
  id: string;
  slug: string;
  name: string;
  description: string;
  releaseRing: ReleaseRing;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type BackupDestination = {
  id: string;
  name: string;
  protocol: BackupProtocol;
  scheduleCron: string;
  enabled: boolean;
  localDirectory: string;
  webdavUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3Prefix: string;
  s3ForcePathStyle: boolean;
  credentialsConfigured: boolean;
  lastScheduledAt: string | null;
  updatedAt: string;
};

export type BackupCredentials = {
  encryptionPassphrase: string;
  username?: string;
  password?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export type BackupDestinationInput = Omit<BackupDestination, "id" | "credentialsConfigured" | "lastScheduledAt" | "updatedAt"> & {
  credentials?: BackupCredentials;
};

export type BackgroundJob = {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  logs: string[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type EligibleAppVersion = {
  id: string;
  versionCode: number;
  versionName: string;
  downloadUrl: string;
  releaseNotes: string;
  isActive: boolean;
  releaseRing: ReleaseRing;
  audienceGroupId: string | null;
  publishedAt: string;
};

export type SmtpDeliveryConfig = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
};

export type BackupExecutionConfig = BackupDestination & { credentials: BackupCredentials };

export interface EnterpriseStore {
  start(): Promise<void>;
  close(): Promise<void>;
  getEmailSettings(): Promise<EmailSettings>;
  updateEmailSettings(input: EmailSettingsInput): Promise<EmailSettings>;
  getSmtpDeliveryConfig(): Promise<SmtpDeliveryConfig>;
  listEmailTemplates(): Promise<EmailTemplate[]>;
  getEmailTemplate(trigger: EmailTemplateTrigger): Promise<EmailTemplate | undefined>;
  updateEmailTemplate(trigger: EmailTemplateTrigger, patch: Partial<Pick<EmailTemplate, "name" | "subject" | "htmlBody" | "enabled">>): Promise<EmailTemplate | undefined>;
  recordLoginIp(userId: string, ip: string, userAgent: string): Promise<{ isNew: boolean; isFirst: boolean }>;
  listDynamicChannels(includeDisabled?: boolean): Promise<DynamicChannel[]>;
  createDynamicChannel(input: Omit<DynamicChannel, "id" | "updatedAt">): Promise<DynamicChannel>;
  updateDynamicChannel(id: string, patch: Partial<Omit<DynamicChannel, "id" | "updatedAt">>): Promise<DynamicChannel | undefined>;
  deleteDynamicChannel(id: string): Promise<boolean>;
  listUserGroups(): Promise<UserGroup[]>;
  createUserGroup(input: Pick<UserGroup, "slug" | "name" | "description" | "releaseRing">): Promise<UserGroup>;
  updateUserGroup(id: string, patch: Partial<Pick<UserGroup, "name" | "description" | "releaseRing">>): Promise<UserGroup | undefined>;
  setUserGroups(userId: string, groupIds: string[]): Promise<void>;
  getUserGroupIds(userId: string): Promise<string[]>;
  assignDefaultGroup(userId: string): Promise<void>;
  listBackupDestinations(): Promise<BackupDestination[]>;
  createBackupDestination(input: BackupDestinationInput): Promise<BackupDestination>;
  updateBackupDestination(id: string, patch: Partial<BackupDestinationInput>): Promise<BackupDestination | undefined>;
  deleteBackupDestination(id: string): Promise<boolean>;
  getBackupExecutionConfig(id: string): Promise<BackupExecutionConfig | undefined>;
  markBackupScheduled(id: string, at: string): Promise<void>;
  startBackupRun(configId: string, jobId: string): Promise<string>;
  finishBackupRun(id: string, result: { status: "succeeded" | "failed"; location?: string; bytes?: number; checksum?: string; error?: string }): Promise<void>;
  enqueueJob(type: JobType, payload: Record<string, unknown>, maxAttempts?: number): Promise<BackgroundJob>;
  listJobs(limit?: number): Promise<BackgroundJob[]>;
  waitForJob(timeoutSeconds?: number): Promise<string | undefined>;
  claimJob(id: string): Promise<BackgroundJob | undefined>;
  appendJobLog(id: string, line: string): Promise<void>;
  completeJob(id: string, result: Record<string, unknown>): Promise<void>;
  failJob(id: string, error: string): Promise<void>;
  getEligibleAppVersion(userId?: string): Promise<EligibleAppVersion | undefined>;
  createRelease(input: Omit<EligibleAppVersion, "id" | "publishedAt">): Promise<EligibleAppVersion>;
  listGroupEmails(groupId?: string): Promise<string[]>;
}

const nowIso = () => new Date().toISOString();
const isoValue = (value: unknown) => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const numberValue = (value: unknown) => typeof value === "number" ? value : Number(value ?? 0);

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderEmailTemplate(template: Pick<EmailTemplate, "subject" | "htmlBody">, variables: Record<string, unknown>) {
  const replace = (value: string) => value.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => escapeHtml(variables[key]));
  return { subject: replace(template.subject), html: replace(template.htmlBody) };
}

const defaultTemplates: Array<Omit<EmailTemplate, "updatedAt">> = [
  {
    id: "email_suspicious_login",
    trigger: "suspicious_login",
    name: "Suspicious IP login",
    subject: "New sign-in to Adaptive Chat from {{ip}}",
    enabled: true,
    htmlBody: `<!doctype html><html><body style="margin:0;background:#f5f7f8;font-family:Arial,sans-serif;color:#172126"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border:1px solid #dfe5e7;border-radius:8px"><tr><td style="padding:28px"><div style="font-size:14px;color:#087f73;font-weight:700">ADAPTIVE CHAT SECURITY</div><h1 style="font-size:24px;margin:14px 0">New sign-in detected</h1><p>We noticed a successful sign-in to <strong>{{email}}</strong> from an IP address that has not been used on this account before.</p><table role="presentation" width="100%" style="background:#f5f7f8;border-radius:6px;margin:22px 0"><tr><td style="padding:16px"><strong>IP address</strong><br>{{ip}}<br><br><strong>Time</strong><br>{{time}}<br><br><strong>Device</strong><br>{{userAgent}}</td></tr></table><p>If this was you, no action is required. If not, contact your administrator and reset your password immediately.</p></td></tr></table></td></tr></table></body></html>`,
  },
  {
    id: "email_announcement",
    trigger: "announcement",
    name: "Product announcement",
    subject: "{{title}}",
    enabled: true,
    htmlBody: `<!doctype html><html><body style="margin:0;background:#f5f7f8;font-family:Arial,sans-serif;color:#172126"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border:1px solid #dfe5e7;border-radius:8px"><tr><td style="padding:28px"><div style="font-size:14px;color:#087f73;font-weight:700">ADAPTIVE CHAT</div><h1 style="font-size:24px">{{title}}</h1><p style="line-height:1.65">{{message}}</p></td></tr></table></td></tr></table></body></html>`,
  },
  {
    id: "email_version_update",
    trigger: "version_update",
    name: "Application update",
    subject: "Adaptive Chat {{versionName}} is ready",
    enabled: true,
    htmlBody: `<!doctype html><html><body style="margin:0;background:#f5f7f8;font-family:Arial,sans-serif;color:#172126"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border:1px solid #dfe5e7;border-radius:8px"><tr><td style="padding:28px"><div style="font-size:14px;color:#087f73;font-weight:700">ADAPTIVE CHAT UPDATE</div><h1 style="font-size:24px">Version {{versionName}}</h1><p style="line-height:1.65">{{releaseNotes}}</p><p><a href="{{downloadUrl}}" style="display:inline-block;background:#087f73;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px">Download APK</a></p></td></tr></table></td></tr></table></body></html>`,
  },
];

class SecretBox {
  private readonly key: Buffer;

  constructor(secret?: string) {
    this.key = createHash("sha256")
      .update(secret ?? process.env.UPSTREAM_KEY_ENCRYPTION_SECRET ?? process.env.ADMIN_API_KEY ?? "development-only-admin-key")
      .digest();
  }

  encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  decrypt(value: string) {
    if (!value) return "";
    const [version, iv, tag, encrypted] = value.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Stored enterprise secret cannot be decrypted.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  }
}

function emailSettingsFromRow(row: Record<string, unknown>): EmailSettings {
  return {
    host: String(row.host ?? ""),
    port: numberValue(row.port || 587),
    secure: Boolean(row.secure),
    username: String(row.username ?? ""),
    fromEmail: String(row.from_email ?? ""),
    fromName: String(row.from_name ?? "Adaptive Chat"),
    enabled: Boolean(row.enabled),
    passwordConfigured: Boolean(row.encrypted_password),
    updatedAt: isoValue(row.updated_at),
  };
}

function emailTemplateFromRow(row: Record<string, unknown>): EmailTemplate {
  return {
    id: String(row.id),
    trigger: String(row.trigger) as EmailTemplateTrigger,
    name: String(row.name),
    subject: String(row.subject),
    htmlBody: String(row.html_body),
    enabled: Boolean(row.enabled),
    updatedAt: isoValue(row.updated_at),
  };
}

function dynamicChannelFromRow(row: Record<string, unknown>): DynamicChannel {
  const models = Array.isArray(row.models) ? row.models : [];
  return {
    id: String(row.id),
    slug: String(row.slug),
    displayName: String(row.display_name),
    description: String(row.description),
    provider: String(row.provider),
    providerKeyId: row.provider_key_id ? String(row.provider_key_id) : null,
    iconDataUrl: String(row.icon_data_url ?? ""),
    backgroundStart: String(row.background_start),
    backgroundEnd: String(row.background_end),
    accentColor: String(row.accent_color),
    textColor: String(row.text_color),
    surfaceColor: String(row.surface_color),
    typography: String(row.typography) as DynamicChannel["typography"],
    animatedGradient: Boolean(row.animated_gradient),
    models: models as DynamicModel[],
    enabled: Boolean(row.enabled),
    sortOrder: numberValue(row.sort_order),
    updatedAt: isoValue(row.updated_at),
  };
}

function groupFromRow(row: Record<string, unknown>): UserGroup {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description),
    releaseRing: String(row.release_ring) as ReleaseRing,
    memberCount: numberValue(row.member_count),
    createdAt: isoValue(row.created_at),
    updatedAt: isoValue(row.updated_at),
  };
}

function backupFromRow(row: Record<string, unknown>): BackupDestination {
  return {
    id: String(row.id),
    name: String(row.name),
    protocol: String(row.protocol) as BackupProtocol,
    scheduleCron: String(row.schedule_cron),
    enabled: Boolean(row.enabled),
    localDirectory: String(row.local_directory ?? ""),
    webdavUrl: String(row.webdav_url ?? ""),
    s3Endpoint: String(row.s3_endpoint ?? ""),
    s3Region: String(row.s3_region ?? ""),
    s3Bucket: String(row.s3_bucket ?? ""),
    s3Prefix: String(row.s3_prefix ?? ""),
    s3ForcePathStyle: Boolean(row.s3_force_path_style),
    credentialsConfigured: Boolean(row.encrypted_credentials),
    lastScheduledAt: row.last_scheduled_at ? isoValue(row.last_scheduled_at) : null,
    updatedAt: isoValue(row.updated_at),
  };
}

function jobFromRow(row: Record<string, unknown>): BackgroundJob {
  return {
    id: String(row.id),
    type: String(row.type) as JobType,
    status: String(row.status) as JobStatus,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    result: row.result ? row.result as Record<string, unknown> : null,
    error: row.error ? String(row.error) : null,
    attempts: numberValue(row.attempts),
    maxAttempts: numberValue(row.max_attempts),
    logs: Array.isArray(row.logs) ? row.logs.map(String) : [],
    createdAt: isoValue(row.created_at),
    startedAt: row.started_at ? isoValue(row.started_at) : null,
    finishedAt: row.finished_at ? isoValue(row.finished_at) : null,
  };
}

function releaseFromRow(row: Record<string, unknown>): EligibleAppVersion {
  return {
    id: String(row.id),
    versionCode: numberValue(row.version_code),
    versionName: String(row.version_name),
    downloadUrl: String(row.download_url),
    releaseNotes: String(row.release_notes),
    isActive: Boolean(row.is_active),
    releaseRing: String(row.release_ring ?? "production") as ReleaseRing,
    audienceGroupId: row.audience_group_id ? String(row.audience_group_id) : null,
    publishedAt: isoValue(row.published_at),
  };
}

export class PostgresEnterpriseStore implements EnterpriseStore {
  private readonly pool: Pool;
  private readonly redis: ReturnType<typeof createClient>;
  private readonly secrets: SecretBox;
  private readonly queueKey = "adaptive-chat:jobs:pending";

  constructor(databaseUrl: string, redisUrl: string, encryptionSecret?: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.redis = createClient({ url: redisUrl });
    this.secrets = new SecretBox(encryptionSecret);
  }

  async start() {
    await this.pool.query("SELECT 1");
    if (!this.redis.isOpen) await this.redis.connect();
    await this.migrate();
    await this.seed();
    await this.recoverJobs();
  }

  async close() {
    if (this.redis.isOpen) await this.redis.quit();
    await this.pool.end();
  }

  private async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS smtp_configs (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        host TEXT NOT NULL DEFAULT '',
        port INTEGER NOT NULL DEFAULT 587 CHECK (port > 0 AND port <= 65535),
        secure BOOLEAN NOT NULL DEFAULT FALSE,
        username TEXT NOT NULL DEFAULT '',
        encrypted_password TEXT NOT NULL DEFAULT '',
        from_email TEXT NOT NULL DEFAULT '',
        from_name TEXT NOT NULL DEFAULT 'Adaptive Chat',
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS email_templates (
        id TEXT PRIMARY KEY,
        trigger TEXT NOT NULL UNIQUE CHECK (trigger IN ('suspicious_login', 'announcement', 'version_update')),
        name TEXT NOT NULL,
        subject TEXT NOT NULL,
        html_body TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS user_login_ips (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ip_address TEXT NOT NULL,
        user_agent TEXT NOT NULL DEFAULT '',
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, ip_address)
      );
      CREATE TABLE IF NOT EXISTS dynamic_channels (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL,
        provider_key_id TEXT REFERENCES provider_keys(id) ON DELETE SET NULL,
        icon_data_url TEXT NOT NULL DEFAULT '',
        background_start TEXT NOT NULL DEFAULT '#FFFFFF',
        background_end TEXT NOT NULL DEFAULT '#F4F6F8',
        accent_color TEXT NOT NULL DEFAULT '#087F73',
        text_color TEXT NOT NULL DEFAULT '#172126',
        surface_color TEXT NOT NULL DEFAULT '#FFFFFF',
        typography TEXT NOT NULL CHECK (typography IN ('sans', 'serif', 'mono')) DEFAULT 'sans',
        animated_gradient BOOLEAN NOT NULL DEFAULT FALSE,
        models JSONB NOT NULL DEFAULT '[]'::jsonb,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 100,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS dynamic_channels_order_idx ON dynamic_channels(enabled, sort_order, slug);
      CREATE TABLE IF NOT EXISTS user_groups (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        release_ring TEXT NOT NULL CHECK (release_ring IN ('beta', 'production')) DEFAULT 'production',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS user_group_members (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, group_id)
      );
      CREATE INDEX IF NOT EXISTS user_group_members_group_idx ON user_group_members(group_id, user_id);
      CREATE TABLE IF NOT EXISTS backup_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        protocol TEXT NOT NULL CHECK (protocol IN ('local', 'webdav', 's3')),
        schedule_cron TEXT NOT NULL DEFAULT '0 2 * * *',
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        local_directory TEXT NOT NULL DEFAULT '/backups',
        webdav_url TEXT NOT NULL DEFAULT '',
        s3_endpoint TEXT NOT NULL DEFAULT '',
        s3_region TEXT NOT NULL DEFAULT 'us-east-1',
        s3_bucket TEXT NOT NULL DEFAULT '',
        s3_prefix TEXT NOT NULL DEFAULT 'adaptive-chat',
        s3_force_path_style BOOLEAN NOT NULL DEFAULT FALSE,
        encrypted_credentials TEXT NOT NULL DEFAULT '',
        last_scheduled_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS background_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('email', 'backup', 'build')),
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'retrying', 'succeeded', 'failed')) DEFAULT 'queued',
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        result JSONB,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        logs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS background_jobs_status_idx ON background_jobs(status, created_at DESC);
      CREATE TABLE IF NOT EXISTS backup_runs (
        id TEXT PRIMARY KEY,
        config_id TEXT NOT NULL REFERENCES backup_configs(id) ON DELETE CASCADE,
        job_id TEXT REFERENCES background_jobs(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        location TEXT,
        bytes BIGINT NOT NULL DEFAULT 0,
        checksum TEXT,
        error TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      );
      ALTER TABLE app_versions ADD COLUMN IF NOT EXISTS release_ring TEXT NOT NULL DEFAULT 'production';
      ALTER TABLE app_versions ADD COLUMN IF NOT EXISTS audience_group_id TEXT REFERENCES user_groups(id) ON DELETE SET NULL;
      ALTER TABLE app_versions ADD COLUMN IF NOT EXISTS build_job_id TEXT REFERENCES background_jobs(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS app_versions_ring_idx ON app_versions(is_active, release_ring, version_code DESC);
    `);
  }

  private async seed() {
    await this.pool.query("INSERT INTO smtp_configs (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
    for (const template of defaultTemplates) {
      await this.pool.query(
        `INSERT INTO email_templates (id, trigger, name, subject, html_body, enabled)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (trigger) DO NOTHING`,
        [template.id, template.trigger, template.name, template.subject, template.htmlBody, template.enabled],
      );
    }
    await this.pool.query(
      `INSERT INTO user_groups (id, slug, name, description, release_ring) VALUES
       ('grp_standard', 'standard', 'Standard', 'Production release audience', 'production'),
       ('grp_beta', 'beta-testers', 'Beta Testers', 'Early-access testing audience', 'beta')
       ON CONFLICT (id) DO NOTHING`,
    );
    await this.pool.query(
      `INSERT INTO user_group_members (user_id, group_id)
       SELECT users.id, 'grp_standard' FROM users
       ON CONFLICT (user_id, group_id) DO NOTHING`,
    );
  }

  private async recoverJobs() {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE background_jobs SET status = 'queued', started_at = NULL,
       logs = array_append(logs, 'Recovered after worker restart')
       WHERE status IN ('queued', 'retrying') OR (status = 'running' AND started_at < NOW() - INTERVAL '15 minutes')
       RETURNING id`,
    );
    if (result.rows.length) await this.redis.lPush(this.queueKey, result.rows.map((row) => row.id));
  }

  async getEmailSettings() {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM smtp_configs WHERE id = 1");
    return emailSettingsFromRow(result.rows[0]);
  }

  async updateEmailSettings(input: EmailSettingsInput) {
    const existing = await this.pool.query<{ encrypted_password: string }>("SELECT encrypted_password FROM smtp_configs WHERE id = 1");
    const encryptedPassword = input.password !== undefined
      ? this.secrets.encrypt(input.password)
      : existing.rows[0]?.encrypted_password ?? "";
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE smtp_configs SET host = $1, port = $2, secure = $3, username = $4,
       encrypted_password = $5, from_email = $6, from_name = $7, enabled = $8, updated_at = NOW()
       WHERE id = 1 RETURNING *`,
      [input.host, input.port, input.secure, input.username, encryptedPassword, input.fromEmail, input.fromName, input.enabled],
    );
    return emailSettingsFromRow(result.rows[0]);
  }

  async getSmtpDeliveryConfig() {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM smtp_configs WHERE id = 1");
    const row = result.rows[0];
    return {
      host: String(row.host ?? ""), port: numberValue(row.port), secure: Boolean(row.secure), username: String(row.username ?? ""),
      password: row.encrypted_password ? this.secrets.decrypt(String(row.encrypted_password)) : "",
      fromEmail: String(row.from_email ?? ""), fromName: String(row.from_name ?? "Adaptive Chat"), enabled: Boolean(row.enabled),
    };
  }

  async listEmailTemplates() {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM email_templates ORDER BY trigger");
    return result.rows.map(emailTemplateFromRow);
  }

  async getEmailTemplate(trigger: EmailTemplateTrigger) {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM email_templates WHERE trigger = $1", [trigger]);
    return result.rows[0] ? emailTemplateFromRow(result.rows[0]) : undefined;
  }

  async updateEmailTemplate(trigger: EmailTemplateTrigger, patch: Partial<Pick<EmailTemplate, "name" | "subject" | "htmlBody" | "enabled">>) {
    const fields: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => { values.push(value); fields.push(`${column} = $${values.length}`); };
    if (patch.name !== undefined) add("name", patch.name);
    if (patch.subject !== undefined) add("subject", patch.subject);
    if (patch.htmlBody !== undefined) add("html_body", patch.htmlBody);
    if (patch.enabled !== undefined) add("enabled", patch.enabled);
    if (!fields.length) return this.getEmailTemplate(trigger);
    values.push(trigger);
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE email_templates SET ${fields.join(", ")}, updated_at = NOW() WHERE trigger = $${values.length} RETURNING *`, values,
    );
    return result.rows[0] ? emailTemplateFromRow(result.rows[0]) : undefined;
  }

  async recordLoginIp(userId: string, ip: string, userAgent: string) {
    const normalizedIp = ip.trim().slice(0, 128) || "unknown";
    const count = await this.pool.query<{ count: string }>("SELECT COUNT(*)::int AS count FROM user_login_ips WHERE user_id = $1", [userId]);
    const existing = await this.pool.query("SELECT 1 FROM user_login_ips WHERE user_id = $1 AND ip_address = $2", [userId, normalizedIp]);
    await this.pool.query(
      `INSERT INTO user_login_ips (user_id, ip_address, user_agent) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, ip_address) DO UPDATE SET user_agent = EXCLUDED.user_agent, last_seen_at = NOW()`,
      [userId, normalizedIp, userAgent.slice(0, 1_000)],
    );
    return { isNew: (existing.rowCount ?? 0) === 0, isFirst: numberValue(count.rows[0]?.count) === 0 };
  }

  async listDynamicChannels(includeDisabled = false) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM dynamic_channels ${includeDisabled ? "" : "WHERE enabled = TRUE"} ORDER BY sort_order, slug`,
    );
    return result.rows.map(dynamicChannelFromRow);
  }

  async createDynamicChannel(input: Omit<DynamicChannel, "id" | "updatedAt">) {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO dynamic_channels (id, slug, display_name, description, provider, provider_key_id, icon_data_url,
       background_start, background_end, accent_color, text_color, surface_color, typography, animated_gradient, models, enabled, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17) RETURNING *`,
      [`chn_${randomUUID().slice(0, 12)}`, input.slug, input.displayName, input.description, input.provider, input.providerKeyId,
        input.iconDataUrl, input.backgroundStart, input.backgroundEnd, input.accentColor, input.textColor, input.surfaceColor,
        input.typography, input.animatedGradient, JSON.stringify(input.models), input.enabled, input.sortOrder],
    );
    return dynamicChannelFromRow(result.rows[0]);
  }

  async updateDynamicChannel(id: string, patch: Partial<Omit<DynamicChannel, "id" | "updatedAt">>) {
    const columns: Record<string, string> = {
      slug: "slug", displayName: "display_name", description: "description", provider: "provider", providerKeyId: "provider_key_id",
      iconDataUrl: "icon_data_url", backgroundStart: "background_start", backgroundEnd: "background_end", accentColor: "accent_color",
      textColor: "text_color", surfaceColor: "surface_color", typography: "typography", animatedGradient: "animated_gradient",
      models: "models", enabled: "enabled", sortOrder: "sort_order",
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue;
      const value = patch[key as keyof typeof patch];
      values.push(key === "models" ? JSON.stringify(value) : value);
      fields.push(`${column} = $${values.length}${key === "models" ? "::jsonb" : ""}`);
    }
    if (!fields.length) {
      const existing = await this.pool.query<Record<string, unknown>>("SELECT * FROM dynamic_channels WHERE id = $1", [id]);
      return existing.rows[0] ? dynamicChannelFromRow(existing.rows[0]) : undefined;
    }
    values.push(id);
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE dynamic_channels SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values,
    );
    return result.rows[0] ? dynamicChannelFromRow(result.rows[0]) : undefined;
  }

  async deleteDynamicChannel(id: string) {
    return (await this.pool.query("DELETE FROM dynamic_channels WHERE id = $1", [id])).rowCount === 1;
  }

  async listUserGroups() {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT user_groups.*, COUNT(user_group_members.user_id)::int AS member_count FROM user_groups
       LEFT JOIN user_group_members ON user_group_members.group_id = user_groups.id
       GROUP BY user_groups.id ORDER BY user_groups.name`,
    );
    return result.rows.map(groupFromRow);
  }

  async createUserGroup(input: Pick<UserGroup, "slug" | "name" | "description" | "releaseRing">) {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO user_groups (id, slug, name, description, release_ring) VALUES ($1,$2,$3,$4,$5)
       RETURNING *, 0::int AS member_count`,
      [`grp_${randomUUID().slice(0, 12)}`, input.slug, input.name, input.description, input.releaseRing],
    );
    return groupFromRow(result.rows[0]);
  }

  async updateUserGroup(id: string, patch: Partial<Pick<UserGroup, "name" | "description" | "releaseRing">>) {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) { values.push(patch.name); fields.push(`name = $${values.length}`); }
    if (patch.description !== undefined) { values.push(patch.description); fields.push(`description = $${values.length}`); }
    if (patch.releaseRing !== undefined) { values.push(patch.releaseRing); fields.push(`release_ring = $${values.length}`); }
    if (!fields.length) return (await this.listUserGroups()).find((group) => group.id === id);
    values.push(id);
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE user_groups SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $${values.length}
       RETURNING *, (SELECT COUNT(*)::int FROM user_group_members WHERE group_id = user_groups.id) AS member_count`, values,
    );
    return result.rows[0] ? groupFromRow(result.rows[0]) : undefined;
  }

  async setUserGroups(userId: string, groupIds: string[]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM user_group_members WHERE user_id = $1", [userId]);
      if (groupIds.length) {
        await client.query(
          `INSERT INTO user_group_members (user_id, group_id)
           SELECT $1, id FROM user_groups WHERE id = ANY($2::text[])`, [userId, groupIds],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getUserGroupIds(userId: string) {
    const result = await this.pool.query<{ group_id: string }>("SELECT group_id FROM user_group_members WHERE user_id = $1 ORDER BY group_id", [userId]);
    return result.rows.map((row) => row.group_id);
  }

  async assignDefaultGroup(userId: string) {
    await this.pool.query(
      "INSERT INTO user_group_members (user_id, group_id) VALUES ($1, 'grp_standard') ON CONFLICT DO NOTHING", [userId],
    );
  }

  async listBackupDestinations() {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM backup_configs ORDER BY name");
    return result.rows.map(backupFromRow);
  }

  async createBackupDestination(input: BackupDestinationInput) {
    if (!input.credentials?.encryptionPassphrase) throw new Error("An encryption passphrase is required for every backup destination.");
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO backup_configs (id,name,protocol,schedule_cron,enabled,local_directory,webdav_url,s3_endpoint,s3_region,s3_bucket,s3_prefix,s3_force_path_style,encrypted_credentials,last_scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()) RETURNING *`,
      [`bkp_${randomUUID().slice(0, 12)}`, input.name, input.protocol, input.scheduleCron, input.enabled, input.localDirectory,
        input.webdavUrl, input.s3Endpoint, input.s3Region, input.s3Bucket, input.s3Prefix, input.s3ForcePathStyle,
        this.secrets.encrypt(JSON.stringify(input.credentials))],
    );
    return backupFromRow(result.rows[0]);
  }

  async updateBackupDestination(id: string, patch: Partial<BackupDestinationInput>) {
    const columns: Record<string, string> = {
      name: "name", protocol: "protocol", scheduleCron: "schedule_cron", enabled: "enabled", localDirectory: "local_directory",
      webdavUrl: "webdav_url", s3Endpoint: "s3_endpoint", s3Region: "s3_region", s3Bucket: "s3_bucket",
      s3Prefix: "s3_prefix", s3ForcePathStyle: "s3_force_path_style",
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue;
      values.push(patch[key as keyof typeof patch]);
      fields.push(`${column} = $${values.length}`);
    }
    if (patch.credentials !== undefined) {
      if (!patch.credentials.encryptionPassphrase) throw new Error("An encryption passphrase is required.");
      values.push(this.secrets.encrypt(JSON.stringify(patch.credentials)));
      fields.push(`encrypted_credentials = $${values.length}`);
    }
    if (!fields.length) return (await this.listBackupDestinations()).find((item) => item.id === id);
    values.push(id);
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE backup_configs SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values,
    );
    return result.rows[0] ? backupFromRow(result.rows[0]) : undefined;
  }

  async deleteBackupDestination(id: string) {
    return (await this.pool.query("DELETE FROM backup_configs WHERE id = $1", [id])).rowCount === 1;
  }

  async getBackupExecutionConfig(id: string) {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM backup_configs WHERE id = $1", [id]);
    if (!result.rows[0]) return undefined;
    const row = result.rows[0];
    const credentials = JSON.parse(this.secrets.decrypt(String(row.encrypted_credentials))) as BackupCredentials;
    return { ...backupFromRow(row), credentials };
  }

  async markBackupScheduled(id: string, at: string) {
    await this.pool.query("UPDATE backup_configs SET last_scheduled_at = $1 WHERE id = $2", [at, id]);
  }

  async startBackupRun(configId: string, jobId: string) {
    const id = `bkr_${randomUUID().slice(0, 16)}`;
    await this.pool.query(
      "INSERT INTO backup_runs (id, config_id, job_id, status) VALUES ($1, $2, $3, 'running')", [id, configId, jobId],
    );
    return id;
  }

  async finishBackupRun(id: string, result: { status: "succeeded" | "failed"; location?: string; bytes?: number; checksum?: string; error?: string }) {
    await this.pool.query(
      `UPDATE backup_runs SET status = $1, location = $2, bytes = $3, checksum = $4, error = $5, finished_at = NOW() WHERE id = $6`,
      [result.status, result.location ?? null, result.bytes ?? 0, result.checksum ?? null, result.error ?? null, id],
    );
  }

  async enqueueJob(type: JobType, payload: Record<string, unknown>, maxAttempts = 3) {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO background_jobs (id, type, payload, max_attempts) VALUES ($1,$2,$3::jsonb,$4) RETURNING *`,
      [`job_${randomUUID().slice(0, 16)}`, type, JSON.stringify(payload), maxAttempts],
    );
    const job = jobFromRow(result.rows[0]);
    await this.redis.lPush(this.queueKey, job.id);
    return job;
  }

  async listJobs(limit = 100) {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM background_jobs ORDER BY created_at DESC LIMIT $1", [Math.min(Math.max(limit, 1), 500)],
    );
    return result.rows.map(jobFromRow);
  }

  async waitForJob(timeoutSeconds = 5) {
    const result = await this.redis.brPop(this.queueKey, timeoutSeconds);
    return result?.element;
  }

  async claimJob(id: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE background_jobs SET status = 'running', attempts = attempts + 1, started_at = NOW(), finished_at = NULL, error = NULL
       WHERE id = $1 AND status IN ('queued', 'retrying') RETURNING *`, [id],
    );
    return result.rows[0] ? jobFromRow(result.rows[0]) : undefined;
  }

  async appendJobLog(id: string, line: string) {
    await this.pool.query("UPDATE background_jobs SET logs = array_append(logs, $1) WHERE id = $2", [line.slice(0, 4_000), id]);
  }

  async completeJob(id: string, result: Record<string, unknown>) {
    await this.pool.query(
      "UPDATE background_jobs SET status = 'succeeded', result = $1::jsonb, finished_at = NOW() WHERE id = $2",
      [JSON.stringify(result), id],
    );
  }

  async failJob(id: string, error: string) {
    const result = await this.pool.query<{ attempts: number; max_attempts: number }>(
      `UPDATE background_jobs SET status = CASE WHEN attempts < max_attempts THEN 'retrying' ELSE 'failed' END,
       error = $1, finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE NOW() END
       WHERE id = $2 RETURNING attempts, max_attempts`, [error.slice(0, 8_000), id],
    );
    const row = result.rows[0];
    if (row && row.attempts < row.max_attempts) await this.redis.lPush(this.queueKey, id);
  }

  async getEligibleAppVersion(userId?: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT app_versions.* FROM app_versions
       WHERE app_versions.is_active = TRUE AND (
         app_versions.release_ring = 'production'
         OR ($1::text IS NOT NULL AND app_versions.release_ring = 'beta' AND EXISTS (
           SELECT 1 FROM user_group_members
           JOIN user_groups ON user_groups.id = user_group_members.group_id
           WHERE user_group_members.user_id = $1 AND user_groups.release_ring = 'beta'
           AND (app_versions.audience_group_id IS NULL OR app_versions.audience_group_id = user_groups.id)
         ))
       ) ORDER BY app_versions.version_code DESC LIMIT 1`, [userId ?? null],
    );
    return result.rows[0] ? releaseFromRow(result.rows[0]) : undefined;
  }

  async createRelease(input: Omit<EligibleAppVersion, "id" | "publishedAt">) {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO app_versions (id,version_code,version_name,download_url,release_notes,is_active,release_ring,audience_group_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [`appv_${randomUUID().slice(0, 12)}`, input.versionCode, input.versionName, input.downloadUrl, input.releaseNotes,
        input.isActive, input.releaseRing, input.audienceGroupId],
    );
    return releaseFromRow(result.rows[0]);
  }

  async listGroupEmails(groupId?: string) {
    const result = groupId
      ? await this.pool.query<{ email: string }>(
        `SELECT DISTINCT users.email FROM users JOIN user_group_members ON user_group_members.user_id = users.id
         WHERE users.status = 'active' AND user_group_members.group_id = $1 ORDER BY users.email`, [groupId],
      )
      : await this.pool.query<{ email: string }>("SELECT email FROM users WHERE status = 'active' ORDER BY email");
    return result.rows.map((row) => row.email);
  }
}

/** In-process adapter for unit tests; production always uses PostgresEnterpriseStore. */
export class MemoryEnterpriseStore implements EnterpriseStore {
  private email: EmailSettings = { host: "", port: 587, secure: false, username: "", fromEmail: "", fromName: "Adaptive Chat", enabled: false, passwordConfigured: false, updatedAt: nowIso() };
  private password = "";
  private templates = new Map(defaultTemplates.map((template) => [template.trigger, { ...template, updatedAt: nowIso() }]));
  private channels = new Map<string, DynamicChannel>();
  private groups = new Map<string, UserGroup>([
    ["grp_standard", { id: "grp_standard", slug: "standard", name: "Standard", description: "Production release audience", releaseRing: "production", memberCount: 0, createdAt: nowIso(), updatedAt: nowIso() }],
    ["grp_beta", { id: "grp_beta", slug: "beta-testers", name: "Beta Testers", description: "Early-access testing audience", releaseRing: "beta", memberCount: 0, createdAt: nowIso(), updatedAt: nowIso() }],
  ]);
  private memberships = new Map<string, string[]>();
  private loginIps = new Map<string, Set<string>>();
  private backups = new Map<string, BackupExecutionConfig>();
  private jobs = new Map<string, BackgroundJob>();
  private queue: string[] = [];
  private releases: EligibleAppVersion[] = [];
  private emails = new Map<string, string>();

  async start() {}
  async close() {}
  async getEmailSettings() { return { ...this.email }; }
  async updateEmailSettings(input: EmailSettingsInput) {
    if (input.password !== undefined) this.password = input.password;
    this.email = { ...input, passwordConfigured: Boolean(this.password), updatedAt: nowIso() };
    delete (this.email as Partial<EmailSettingsInput>).password;
    return { ...this.email };
  }
  async getSmtpDeliveryConfig() { return { ...this.email, password: this.password }; }
  async listEmailTemplates() { return [...this.templates.values()].map((item) => ({ ...item })); }
  async getEmailTemplate(trigger: EmailTemplateTrigger) { const item = this.templates.get(trigger); return item ? { ...item } : undefined; }
  async updateEmailTemplate(trigger: EmailTemplateTrigger, patch: Partial<Pick<EmailTemplate, "name" | "subject" | "htmlBody" | "enabled">>) {
    const item = this.templates.get(trigger); if (!item) return undefined;
    const updated = { ...item, ...patch, updatedAt: nowIso() }; this.templates.set(trigger, updated); return { ...updated };
  }
  async recordLoginIp(userId: string, ip: string, _userAgent: string) {
    const values = this.loginIps.get(userId) ?? new Set<string>(); const isFirst = values.size === 0; const isNew = !values.has(ip);
    values.add(ip); this.loginIps.set(userId, values); return { isNew, isFirst };
  }
  async listDynamicChannels(includeDisabled = false) { return [...this.channels.values()].filter((item) => includeDisabled || item.enabled); }
  async createDynamicChannel(input: Omit<DynamicChannel, "id" | "updatedAt">) { const item = { id: `chn_${randomUUID().slice(0, 12)}`, ...input, updatedAt: nowIso() }; this.channels.set(item.id, item); return item; }
  async updateDynamicChannel(id: string, patch: Partial<Omit<DynamicChannel, "id" | "updatedAt">>) { const item = this.channels.get(id); if (!item) return undefined; const updated = { ...item, ...patch, updatedAt: nowIso() }; this.channels.set(id, updated); return updated; }
  async deleteDynamicChannel(id: string) { return this.channels.delete(id); }
  async listUserGroups() { return [...this.groups.values()]; }
  async createUserGroup(input: Pick<UserGroup, "slug" | "name" | "description" | "releaseRing">) { const item = { id: `grp_${randomUUID().slice(0, 12)}`, ...input, memberCount: 0, createdAt: nowIso(), updatedAt: nowIso() }; this.groups.set(item.id, item); return item; }
  async updateUserGroup(id: string, patch: Partial<Pick<UserGroup, "name" | "description" | "releaseRing">>) { const item = this.groups.get(id); if (!item) return undefined; const updated = { ...item, ...patch, updatedAt: nowIso() }; this.groups.set(id, updated); return updated; }
  async setUserGroups(userId: string, groupIds: string[]) { this.memberships.set(userId, [...groupIds]); }
  async getUserGroupIds(userId: string) { return this.memberships.get(userId) ?? []; }
  async assignDefaultGroup(userId: string) { this.memberships.set(userId, ["grp_standard"]); }
  async listBackupDestinations() { return [...this.backups.values()].map(({ credentials: _credentials, ...item }) => item); }
  async createBackupDestination(input: BackupDestinationInput) { if (!input.credentials) throw new Error("Backup credentials are required."); const item: BackupExecutionConfig = { id: `bkp_${randomUUID().slice(0, 12)}`, ...input, credentials: input.credentials, credentialsConfigured: true, lastScheduledAt: null, updatedAt: nowIso() }; this.backups.set(item.id, item); const { credentials: _credentials, ...view } = item; return view; }
  async updateBackupDestination(id: string, patch: Partial<BackupDestinationInput>) { const item = this.backups.get(id); if (!item) return undefined; const updated = { ...item, ...patch, credentials: patch.credentials ?? item.credentials, credentialsConfigured: true, updatedAt: nowIso() }; this.backups.set(id, updated); const { credentials: _credentials, ...view } = updated; return view; }
  async deleteBackupDestination(id: string) { return this.backups.delete(id); }
  async getBackupExecutionConfig(id: string) { return this.backups.get(id); }
  async markBackupScheduled(id: string, at: string) { const item = this.backups.get(id); if (item) this.backups.set(id, { ...item, lastScheduledAt: at }); }
  async startBackupRun(_configId: string, _jobId: string) { return `bkr_${randomUUID().slice(0, 16)}`; }
  async finishBackupRun(_id: string, _result: { status: "succeeded" | "failed"; location?: string; bytes?: number; checksum?: string; error?: string }) {}
  async enqueueJob(type: JobType, payload: Record<string, unknown>, maxAttempts = 3) { const item: BackgroundJob = { id: `job_${randomUUID().slice(0, 16)}`, type, status: "queued", payload, result: null, error: null, attempts: 0, maxAttempts, logs: [], createdAt: nowIso(), startedAt: null, finishedAt: null }; this.jobs.set(item.id, item); this.queue.push(item.id); return item; }
  async listJobs(limit = 100) { return [...this.jobs.values()].slice(-limit).reverse(); }
  async waitForJob(_timeoutSeconds = 5) { return this.queue.shift(); }
  async claimJob(id: string) { const item = this.jobs.get(id); if (!item || !["queued", "retrying"].includes(item.status)) return undefined; Object.assign(item, { status: "running", attempts: item.attempts + 1, startedAt: nowIso(), error: null }); return item; }
  async appendJobLog(id: string, line: string) { this.jobs.get(id)?.logs.push(line); }
  async completeJob(id: string, result: Record<string, unknown>) { const item = this.jobs.get(id); if (item) Object.assign(item, { status: "succeeded", result, finishedAt: nowIso() }); }
  async failJob(id: string, error: string) { const item = this.jobs.get(id); if (!item) return; item.error = error; item.status = item.attempts < item.maxAttempts ? "retrying" : "failed"; if (item.status === "retrying") this.queue.push(id); else item.finishedAt = nowIso(); }
  async getEligibleAppVersion(userId?: string) { const beta = userId && (this.memberships.get(userId) ?? []).includes("grp_beta"); return this.releases.filter((item) => item.isActive && (item.releaseRing === "production" || beta)).sort((a, b) => b.versionCode - a.versionCode)[0]; }
  async createRelease(input: Omit<EligibleAppVersion, "id" | "publishedAt">) { const item = { id: `appv_${randomUUID().slice(0, 12)}`, ...input, publishedAt: nowIso() }; this.releases.push(item); return item; }
  async listGroupEmails(groupId?: string) { return [...this.emails.entries()].filter(([id]) => !groupId || (this.memberships.get(id) ?? []).includes(groupId)).map(([, email]) => email); }
}

export async function createPostgresEnterpriseStore(options: { databaseUrl?: string; redisUrl?: string; encryptionSecret?: string } = {}) {
  const store = new PostgresEnterpriseStore(
    options.databaseUrl ?? process.env.DATABASE_URL ?? "postgresql://adaptive_chat:adaptive_chat@localhost:5432/adaptive_chat",
    options.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379",
    options.encryptionSecret,
  );
  await store.start();
  return store;
}
