import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { CronExpressionParser } from "cron-parser";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import sharp from "sharp";
import { z } from "zod";
import {
  createPostgresControlPlane,
  MemoryControlPlane,
  type ControlPlane,
  type RequestMetric,
  type RoutingScope,
  type SelectedUpstream,
  type ExpertModel,
  type ExpertModelInput,
  type ExpertModelPatch,
  type UpdateUserInput,
} from "./control-plane.js";
import {
  createPostgresEnterpriseStore,
  MemoryEnterpriseStore,
  renderEmailTemplate,
  type BackupDestinationInput,
  type EmailTemplateTrigger,
  type EnterpriseStore,
  type SearchProviderExecutionConfig,
} from "./enterprise.js";
import { issueSessionToken, verifySessionToken } from "./auth.js";
import { publicRemoteConfig, type LoadBalanceStrategy, type ModelRoute, type RemoteChannel } from "./catalog.js";
import {
  createPostgresConversationStore,
  MemoryConversationStore,
  type ConversationSnapshotInput,
  type ConversationStore,
} from "./conversations.js";
import {
  buildSearchToolDecisionRequest,
  buildSearchGroundingMessage,
  executeWebSearch,
  extractLatestUserQuery,
  injectSearchGrounding,
  injectSearchToolResult,
  parseWebSearchToolCall,
  SearchUnavailableError,
  WEB_SEARCH_TOOL,
  type WebSearchResponse,
} from "./search.js";

const contentSchema = z.union([z.string(), z.array(z.unknown()), z.null()]).optional();
const chatRequestSchema = z.object({
  model: z.string().trim().min(1).max(120).default("chatgpt-lite"),
  // Optional channel context is used only for Expert raw-model routing. Existing
  // OpenAI-compatible callers may omit it without changing their payload contract.
  channel: z.string().trim().min(1).max(120).optional(),
  session_id: z.string().trim().min(1).max(160).optional(),
  message_id: z.string().trim().min(1).max(160).optional(),
  expert_mode: z.boolean().default(false),
  stream: z.boolean().default(false),
  messages: z.array(
    z.object({
      role: z.enum(["system", "developer", "user", "assistant", "tool"]),
      content: contentSchema,
      name: z.string().max(120).optional(),
      tool_call_id: z.string().max(256).optional(),
    }).passthrough(),
  ).min(1).max(100),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().max(16_384).optional(),
  max_completion_tokens: z.number().int().positive().max(16_384).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
}).passthrough();

const keyCreateSchema = z.object({
  name: z.string().trim().min(2).max(64),
  rpmLimit: z.number().int().min(1).max(10_000).default(60),
  dailyLimit: z.number().int().min(1).max(10_000_000).default(100_000),
  userId: z.string().trim().min(1).max(120).nullable().optional(),
});

const userCreateSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().max(80).nullable().optional(),
  role: z.enum(["admin", "standard"]).default("standard"),
  status: z.enum(["active", "suspended"]).default("active"),
  rpmLimit: z.number().int().min(1).max(10_000).default(60),
  dailyLimit: z.number().int().min(1).max(10_000_000).default(100_000),
});

const userPatchSchema = z.object({
  password: z.string().min(8).max(200).optional(),
  displayName: z.string().trim().max(80).nullable().optional(),
  status: z.enum(["active", "suspended"]).optional(),
  role: z.enum(["admin", "standard"]).optional(),
  rpmLimit: z.number().int().min(1).max(10_000).optional(),
  dailyLimit: z.number().int().min(1).max(10_000_000).optional(),
}).refine((value) => Object.keys(value).length > 0);

const profileJsonSchema = z.object({
  displayName: z.string().trim().max(80).nullable().optional(),
  removeAvatar: z.boolean().optional(),
}).refine((value) => value.displayName !== undefined || value.removeAvatar === true);

const providerKeySchema = z.object({
  provider: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),
  label: z.string().trim().min(2).max(120),
  endpoint: z.url().max(1_000),
  secret: z.union([z.string().trim().max(8_000), z.null()]).optional().default(""),
  priority: z.number().int().min(0).max(100_000).default(100),
  bypassAuth: z.boolean().default(false),
}).refine((value) => value.bypassAuth || Boolean(value.secret?.trim()), {
  message: "An API key is required unless Bypass Authentication is enabled.",
  path: ["secret"],
});

const providerKeyPatchSchema = z.object({
  label: z.string().trim().min(2).max(120).optional(),
  endpoint: z.url().max(1_000).optional(),
  secret: z.union([z.string().trim().max(8_000), z.null()]).optional(),
  priority: z.number().int().min(0).max(100_000).optional(),
  bypassAuth: z.boolean().optional(),
  status: z.enum(["active", "disabled"]).optional(),
}).refine((value) => Object.keys(value).length > 0);

const routingSchema = z.object({ strategy: z.enum(["round_robin", "random"]) });
const routingPolicySchema = z.object({
  keyIds: z.array(z.string().trim().min(1).max(120)).min(1).max(32),
});
const modelMappingTargetSchema = z.object({
  provider: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),
  upstreamModel: z.string().trim().min(1).max(256),
  priority: z.coerce.number().int().min(0).max(100_000).default(100),
  enabled: z.boolean().default(true),
});
const modelMappingsReplaceSchema = z.object({
  mappings: z.array(modelMappingTargetSchema).min(1).max(32),
}).superRefine(({ mappings }, context) => {
  const targets = new Set<string>();
  mappings.forEach((mapping, index) => {
    const target = `${mapping.provider}\u0000${mapping.upstreamModel}`;
    if (targets.has(target)) context.addIssue({ code: "custom", path: ["mappings", index], message: "Provider and upstream model targets must be unique." });
    targets.add(target);
  });
});
const expertModelSchema = z.object({
  rawModel: z.string().trim().min(1).max(256),
  label: z.string().trim().max(120).default(""),
  description: z.string().trim().max(500).default(""),
  provider: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),
  priority: z.coerce.number().int().min(0).max(100_000).default(100),
  enabled: z.boolean().default(true),
});
const expertModelPatchSchema = expertModelSchema.partial().refine((value) => Object.keys(value).length > 0);
const loginSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(200),
});
const updateCheckSchema = z.object({
  versionCode: z.number().int().min(1).max(10_000_000),
  versionName: z.string().trim().max(80).optional(),
});
const feedbackSchema = z.object({
  message: z.string().trim().min(3).max(4_000),
  category: z.enum(["general", "bug", "feature", "account"]).default("general"),
  appVersion: z.string().trim().max(80).default(""),
  locale: z.string().trim().min(2).max(40).default("system"),
});
const speechSchema = z.object({
  input: z.string().trim().min(1).max(4_000),
  voice: z.string().trim().regex(/^[a-z]{2,3}-[A-Z]{2,4}-[A-Za-z]+Neural$/).max(96).optional(),
});
const feedbackPatchSchema = z.object({ status: z.enum(["new", "reviewed", "resolved"]) });
const appVersionCreateSchema = z.object({
  versionCode: z.number().int().min(1).max(10_000_000),
  versionName: z.string().trim().min(1).max(80),
  downloadUrl: z.url().max(1_000),
  releaseNotes: z.string().max(8_000).default(""),
  isActive: z.boolean().default(true),
});
const appVersionPatchSchema = appVersionCreateSchema.omit({ versionCode: true }).partial().refine((value) => Object.keys(value).length > 0);

const emailSettingsSchema = z.object({
  host: z.string().trim().max(320),
  port: z.number().int().min(1).max(65_535),
  secure: z.boolean(),
  username: z.string().trim().max(320),
  password: z.string().max(2_000).optional(),
  fromEmail: z.union([z.literal(""), z.email().max(320)]),
  fromName: z.string().trim().min(1).max(160),
  enabled: z.boolean(),
});
const emailTemplatePatchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  subject: z.string().trim().min(1).max(500).optional(),
  htmlBody: z.string().trim().min(1).max(250_000).optional(),
  enabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0);
const emailPreviewSchema = z.object({
  trigger: z.enum(["suspicious_login", "announcement", "version_update"]),
  subject: z.string().max(500).optional(),
  htmlBody: z.string().max(250_000).optional(),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
const announcementSchema = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(10_000),
  groupId: z.string().trim().min(1).max(120).optional(),
});
const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const dynamicModelIdentitySchema = z.object({
  id: z.string().trim().min(2).max(120).regex(/^[a-z0-9][a-z0-9._-]*$/),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
});
const dynamicModelProvisionSchema = dynamicModelIdentitySchema.extend({
  initialUpstreamModel: z.string().trim().min(1).max(256).optional(),
});
const dynamicChannelSchema = z.object({
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
  provider: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),
  endpoint: z.url().max(1_000).optional(),
  secret: z.string().trim().min(1).max(8_000).optional(),
  priority: z.number().int().min(0).max(100_000).default(100),
  iconDataUrl: z.union([z.literal(""), z.string().startsWith("data:image/").max(1_500_000)]).default(""),
  customCss: z.string().max(50_000).default(""),
  backgroundStart: colorSchema,
  backgroundEnd: colorSchema,
  accentColor: colorSchema,
  textColor: colorSchema,
  surfaceColor: colorSchema,
  typography: z.enum(["sans", "serif", "mono"]).default("sans"),
  animatedGradient: z.boolean().default(false),
  models: z.array(dynamicModelProvisionSchema).min(1).max(12)
    .refine((models) => new Set(models.map((model) => model.id)).size === models.length, "Model ids must be unique within a channel."),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
});
const dynamicChannelPatchSchema = dynamicChannelSchema.partial().refine((value) => Object.keys(value).length > 0);
const launcherIconSchema = z.object({
  dataUrl: z.union([
    z.literal(""),
    z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).max(4_100_000),
  ]),
});
const searchProviderSchema = z.object({
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
  displayName: z.string().trim().min(1).max(120),
  kind: z.enum(["duckduckgo", "bing_rss", "tavily", "serpapi"]),
  endpoint: z.url().max(2_000),
  apiKey: z.string().trim().max(8_000).optional(),
  priority: z.number().int().min(0).max(100_000).default(100),
  maxResults: z.number().int().min(1).max(10).default(5),
  enabled: z.boolean().default(false),
});
const searchProviderPatchSchema = searchProviderSchema.partial().refine((value) => Object.keys(value).length > 0);
const conversationAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(500),
  mimeType: z.string().trim().min(1).max(200),
  dataUrl: z.string().startsWith("data:").max(4_000_000),
});
const conversationMessageSchema = z.object({
  id: z.string().trim().min(1).max(160),
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().max(2_000_000).default(""),
  attachments: z.array(conversationAttachmentSchema).max(12).default([]),
  reasoning: z.string().max(2_000_000).default(""),
  modelId: z.string().max(256).default(""),
  generatedByModel: z.string().max(256).default(""),
  errorText: z.string().max(4_000).default(""),
  isStreaming: z.boolean().default(false),
  parentMessageId: z.string().trim().min(1).max(160).nullable().default(null),
  createdAt: z.number().int().positive().max(9_999_999_999_999),
  updatedAt: z.number().int().positive().max(9_999_999_999_999),
});
const conversationSnapshotSchema = z.object({
  title: z.string().trim().min(1).max(500),
  channelId: z.string().trim().min(1).max(120),
  modelId: z.string().trim().min(1).max(256),
  systemPrompt: z.string().max(100_000).default(""),
  createdAt: z.number().int().positive().max(9_999_999_999_999),
  updatedAt: z.number().int().positive().max(9_999_999_999_999),
  messages: z.array(conversationMessageSchema).max(1_000).default([]),
});
const conversationCreateSchema = conversationSnapshotSchema.extend({
  id: z.string().trim().min(1).max(160),
});
const userGroupSchema = z.object({
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  releaseRing: z.enum(["beta", "production"]),
});
const userGroupPatchSchema = userGroupSchema.omit({ slug: true }).partial().refine((value) => Object.keys(value).length > 0);
const userMembershipSchema = z.object({ groupIds: z.array(z.string().trim().min(1).max(120)).max(32) });
const backupCredentialsSchema = z.object({
  encryptionPassphrase: z.string().min(12).max(1_000),
  username: z.string().max(500).optional(),
  password: z.string().max(2_000).optional(),
  accessKeyId: z.string().max(500).optional(),
  secretAccessKey: z.string().max(2_000).optional(),
});
const backupSchema = z.object({
  name: z.string().trim().min(1).max(160),
  protocol: z.enum(["local", "webdav", "s3"]),
  scheduleCron: z.string().trim().min(5).max(120).default("0 2 * * *"),
  enabled: z.boolean().default(true),
  localDirectory: z.string().trim().max(1_000).default("/backups"),
  webdavUrl: z.string().trim().max(2_000).default(""),
  s3Endpoint: z.string().trim().max(2_000).default(""),
  s3Region: z.string().trim().max(120).default("us-east-1"),
  s3Bucket: z.string().trim().max(255).default(""),
  s3Prefix: z.string().trim().max(1_000).default("adaptive-chat"),
  s3ForcePathStyle: z.boolean().default(false),
  credentials: backupCredentialsSchema.optional(),
});
const buildSchema = z.object({
  versionCode: z.coerce.number().int().min(1).max(10_000_000),
  versionName: z.string().trim().min(1).max(80),
  releaseNotes: z.string().max(8_000).default(""),
  timeoutSeconds: z.coerce.number().int().min(60).max(7_200).default(1_800),
});
const releasePublishSchema = z.object({
  artifactId: z.string().trim().min(1).max(120),
  releaseRing: z.enum(["beta", "production"]).optional(),
  ring: z.enum(["beta", "production"]).optional(),
  audienceGroupId: z.string().trim().min(1).max(120).nullable().optional(),
}).refine((value) => value.releaseRing ?? value.ring, { message: "A deployment ring is required.", path: ["releaseRing"] });

function backupValidationError(input: z.infer<typeof backupSchema>) {
  try { CronExpressionParser.parse(input.scheduleCron); }
  catch { return "The backup schedule is not a valid UTC cron expression."; }
  if (input.protocol === "local" && !input.localDirectory) return "A local backup directory is required.";
  if (input.protocol === "webdav") {
    try { new URL(input.webdavUrl); } catch { return "A valid WebDAV URL is required."; }
  }
  if (input.protocol === "s3" && !input.s3Bucket) return "An S3 bucket is required.";
  return undefined;
}

type ChatRequest = z.infer<typeof chatRequestSchema>;

export type CreateAppOptions = {
  controlPlane?: ControlPlane;
  enterpriseStore?: EnterpriseStore;
  conversationStore?: ConversationStore;
  demoMode?: boolean;
  requireClientAuth?: boolean;
  synthesizeSpeech?: (input: string, voice: string) => Promise<Uint8Array>;
  executeSearch?: (providers: SearchProviderExecutionConfig[], query: string) => Promise<WebSearchResponse>;
  avatarStorageDir?: string;
  publicApiBaseUrl?: string;
};

const flag = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : ["1", "true", "yes", "on"].includes(value.toLowerCase());

const nowIso = () => new Date().toISOString();
const requestBearer = (header: string | undefined) => header?.startsWith("Bearer ")
  ? header.slice("Bearer ".length).trim()
  : undefined;

function estimateTokens(messages: ChatRequest["messages"]) {
  const characters = messages.reduce((total, message) => {
    const content = message.content;
    return total + (typeof content === "string" ? content.length : JSON.stringify(content ?? "").length);
  }, 0);
  return Math.ceil(characters / 4);
}

function textContent(value: ChatRequest["messages"][number]["content"]) {
  return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

function ssePayload(model: string, delta: Record<string, string>, finishReason: string | null = null, generatedByModel = model) {
  return JSON.stringify({
    id: `chatcmpl_${randomUUID().replaceAll("-", "")}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
    generated_by_model: generatedByModel,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
}

function chunks(value: string, size = 18): string[] {
  const result: string[] = [];
  for (let offset = 0; offset < value.length; offset += size) result.push(value.slice(offset, offset + size));
  return result.length ? result : [""];
}

const delay = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal?.reason ?? new DOMException("The request was aborted.", "AbortError"));
    return;
  }
  let timer: ReturnType<typeof setTimeout>;
  const onAbort = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    reject(signal?.reason ?? new DOMException("The request was aborted.", "AbortError"));
  };
  timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, milliseconds);
  signal?.addEventListener("abort", onAbort, { once: true });
});

const EDGE_TTS_TIMEOUT_MS = 12_000;
const MAX_TTS_BYTES = 8 * 1024 * 1024;
const defaultEdgeVoice = "en-US-AriaNeural";
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_REQUEST_BYTES = MAX_AVATAR_BYTES + 256 * 1024;
const AVATAR_FILE_PATTERN = /^[0-9a-f]{32}\.webp$/;
const PUBLIC_PROFILE_ERRORS = new Set([
  "Avatar images must be 2 MB or smaller.",
  "Choose a JPEG, PNG, or WEBP avatar image.",
  "Choose a valid JPEG, PNG, or WEBP avatar image.",
  "The avatar image could not be decoded.",
  "The avatar image could not be processed.",
  "Unable to update your profile.",
]);

function avatarFilename(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    const filename = new URL(value, "https://avatar.invalid").pathname.split("/").pop();
    return filename && AVATAR_FILE_PATTERN.test(filename) ? filename : undefined;
  } catch {
    return undefined;
  }
}

async function saveAvatar(root: string, file: File) {
  if (!file.size || file.size > MAX_AVATAR_BYTES) throw new Error("Avatar images must be 2 MB or smaller.");
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type.toLowerCase())) {
    throw new Error("Choose a JPEG, PNG, or WEBP avatar image.");
  }
  const input = Buffer.from(await file.arrayBuffer());
  let metadata: { width?: number; height?: number; format?: string };
  try {
    metadata = await sharp(input, { limitInputPixels: 16_777_216 }).metadata();
  } catch {
    throw new Error("The avatar image could not be decoded.");
  }
  if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
    throw new Error("Choose a valid JPEG, PNG, or WEBP avatar image.");
  }
  let output: Buffer;
  try {
    output = await sharp(input, { limitInputPixels: 16_777_216 })
      .rotate()
      .resize(512, 512, { fit: "cover", position: "centre", withoutEnlargement: true })
      .webp({ quality: 86, effort: 4 })
      .toBuffer();
  } catch {
    throw new Error("The avatar image could not be processed.");
  }
  const filename = `${randomUUID().replaceAll("-", "")}.webp`;
  await mkdir(root, { recursive: true, mode: 0o750 });
  await writeFile(join(root, filename), output, { flag: "wx", mode: 0o640 });
  return filename;
}

function escapeSsml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function synthesizeEdgeSpeech(input: string, voice: string): Promise<Uint8Array> {
  const edge = new MsEdgeTTS();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      edge.close();
      reject(new Error("Edge TTS timed out."));
    }, EDGE_TTS_TIMEOUT_MS);
  });

  try {
    const audio = await Promise.race([
      (async () => {
        await edge.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const { audioStream } = edge.toStream(escapeSsml(input));
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of audioStream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > MAX_TTS_BYTES) throw new Error("Edge TTS response exceeded the maximum size.");
          chunks.push(buffer);
        }
        const result = Buffer.concat(chunks);
        if (!result.length) throw new Error("Edge TTS returned no audio.");
        return result;
      })(),
      timeout,
    ]);
    return audio;
  } catch (error) {
    if (timedOut) throw new Error("Edge TTS timed out.");
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    edge.close();
  }
}

function demoAnswer(request: ChatRequest, route: ModelRoute): { reasoning?: string; content: string } {
  const message = [...request.messages].reverse().find((candidate) => candidate.role === "user");
  const prompt = textContent(message?.content).trim() || "your request";
  const concisePrompt = prompt.replace(/\s+/g, " ").slice(0, 180);
  if (route.uiMode === "deepseek") {
    return {
      reasoning: `I will identify the useful part of the request, keep the response scoped, and state the result clearly for: ${concisePrompt}.`,
      content: `Here is a concise DeepSeek-style response to: ${concisePrompt}\n\nThe local demo stream is working. Configure a persistent upstream key pool to route this request to a production model.`,
    };
  }
  return {
    content: `${route.uiMode === "gemini" ? "Gemini-style" : "ChatGPT-style"} response to: ${concisePrompt}\n\nThe API relay is streaming this response locally.`,
  };
}

async function fetchUpstream(upstreams: SelectedUpstream[], body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  let lastError: unknown;
  const { expert_mode: _expertMode, channel: _channel, session_id: _sessionId, message_id: _messageId, ...forwardBody } = body;
  for (const upstream of upstreams) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: forwardBody.stream ? "text/event-stream" : "application/json",
      };
      if (!upstream.bypassAuth && upstream.secret) headers.Authorization = `Bearer ${upstream.secret}`;
      const response = await fetch(upstream.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(forwardBody),
        signal,
      });
      if (response.ok || [400, 404, 422].includes(response.status)) return response;
      await response.body?.cancel().catch(() => undefined);
      lastError = new Error(`Upstream returned HTTP ${response.status}`);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No upstream provider responded");
}

type PreparedSearchRequest = {
  primary: ChatRequest;
  fallback?: ChatRequest;
};

async function prepareSearchRequest(
  request: ChatRequest,
  upstreams: SelectedUpstream[],
  providers: SearchProviderExecutionConfig[],
  search: (providers: SearchProviderExecutionConfig[], query: string) => Promise<WebSearchResponse>,
  signal?: AbortSignal,
): Promise<PreparedSearchRequest> {
  let toolCall;
  try {
    const decision = await fetchUpstream(upstreams, buildSearchToolDecisionRequest(request, upstreams[0].upstreamModel), signal);
    if (decision.ok) toolCall = parseWebSearchToolCall(await decision.json().catch(() => undefined));
    else await decision.body?.cancel().catch(() => undefined);
  } catch (error) {
    if (signal?.aborted) throw error;
    // Tool support differs between OpenAI-compatible providers. Direct grounding below is the compatibility path.
  }
  const originalQuery = extractLatestUserQuery(request.messages);
  const query = toolCall?.query || originalQuery;
  let result: WebSearchResponse;
  try {
    result = await search(providers, query);
  } catch (error) {
    if (!(error instanceof SearchUnavailableError) || !toolCall || query === originalQuery) throw error;
    result = await search(providers, originalQuery);
  }
  const grounding = buildSearchGroundingMessage(result);
  const fallback = {
    ...request,
    messages: injectSearchGrounding(request.messages, grounding) as ChatRequest["messages"],
  } as ChatRequest;
  if (!toolCall) return { primary: fallback };
  return {
    primary: {
      ...request,
      messages: injectSearchToolResult(request.messages, toolCall, grounding) as ChatRequest["messages"],
      tools: [WEB_SEARCH_TOOL],
      tool_choice: "none",
    } as ChatRequest,
    fallback,
  };
}

async function fetchFinalUpstream(
  upstreams: SelectedUpstream[],
  prepared: PreparedSearchRequest,
  signal?: AbortSignal,
) {
  type FinalUpstreamResult = { response: Response; upstream: SelectedUpstream };
  const forward = async (body: ChatRequest) => {
    const { expert_mode: _expertMode, channel: _channel, session_id: _sessionId, message_id: _messageId, ...openAiBody } = body;
    let lastResponse: FinalUpstreamResult | undefined;
    let lastError: unknown;
    for (const upstream of upstreams) {
      try {
        const response = await fetchUpstream([upstream], {
          ...openAiBody,
          model: upstream.upstreamModel,
        }, signal);
        lastResponse = { response, upstream };
        if (response.ok || ![400, 404, 422].includes(response.status)) return lastResponse;
        await response.body?.cancel().catch(() => undefined);
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
      }
    }
    if (lastResponse) return lastResponse;
    throw lastError instanceof Error ? lastError : new Error("No upstream provider responded");
  };
  try {
    const result = await forward(prepared.primary);
    if (!prepared.fallback || ![400, 404, 422].includes(result.response.status)) return result;
    await result.response.body?.cancel().catch(() => undefined);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (!prepared.fallback) throw error;
  }
  return forward(prepared.fallback!);
}

function completionContent(value: unknown) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => part && typeof part === "object" && "text" in part
    ? String((part as Record<string, unknown>).text ?? "")
    : "").join("");
}

function completionJsonAsSse(body: string, model: string) {
  const payload = JSON.parse(body) as Record<string, unknown>;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {};
  const message = first.message && typeof first.message === "object" ? first.message as Record<string, unknown> : {};
  const content = completionContent(message.content);
  const reasoning = typeof message.reasoning_content === "string"
    ? message.reasoning_content
    : typeof message.reasoning === "string" ? message.reasoning : "";
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of chunks(reasoning)) {
        if (piece) controller.enqueue(encoder.encode(`data: ${ssePayload(model, { reasoning_content: piece }, null, model)}\n\n`));
      }
      for (const piece of chunks(content)) {
        if (piece) controller.enqueue(encoder.encode(`data: ${ssePayload(model, { content: piece }, null, model)}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${ssePayload(model, {}, "stop", model)}\n\ndata: [DONE]\n\n`));
      controller.close();
    },
  });
}

function finalizedSseStream(
  source: ReadableStream<Uint8Array>,
  finalize: (status: RequestMetric["status"]) => Promise<void>,
  generatedByModel: string,
  signal?: AbortSignal,
) {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let tail = "";
  let finished = false;
  let metadataSent = false;
  const settle = async (status: RequestMetric["status"]) => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener("abort", onAbort);
    await finalize(status);
  };
  const onAbort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
    void settle("failure");
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!metadataSent) {
          metadataSent = true;
          controller.enqueue(encoder.encode(`data: ${ssePayload(generatedByModel, {}, null, generatedByModel)}\n\n`));
          return;
        }
        const result = await reader.read();
        if (!result.done) {
          tail = `${tail}${decoder.decode(result.value, { stream: true })}`.slice(-1_024);
          controller.enqueue(result.value);
          return;
        }
        tail = `${tail}${decoder.decode()}`.slice(-1_024);
        if (!/(?:^|\n)data:\s*\[DONE\]\s*(?:\n|$)/.test(tail)) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
        await settle("success");
        controller.close();
      } catch (error) {
        await settle("failure");
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      await settle("failure");
    },
  });
}

function usageFromBody(body: string) {
  const usage = (() => {
    try { return JSON.parse(body).usage as Record<string, unknown> | undefined; } catch { return undefined; }
  })();
  return {
    promptTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0,
    completionTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0,
  };
}

function decodeRasterDataUrl(value: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return undefined;
  const body = Buffer.from(match[2], "base64");
  return body.length ? { contentType: match[1], body } : undefined;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono();
  const controlPlane = options.controlPlane ?? new MemoryControlPlane();
  const enterprise = options.enterpriseStore ?? new MemoryEnterpriseStore();
  const conversations = options.conversationStore ?? new MemoryConversationStore();
  const startedAt = Date.now();
  const demoMode = () => options.demoMode ?? flag(process.env.DEMO_MODE, true);
  const adminKey = () => process.env.ADMIN_API_KEY ?? "dev-admin-key";
  const avatarStorageDir = options.avatarStorageDir ?? process.env.AVATAR_STORAGE_DIR ?? "/tmp/adaptive-chat-avatars";
  const configuredPublicApiBase = (options.publicApiBaseUrl ?? process.env.PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
  const allowedOrigins = new Set([
    "https://console.zengjunjie.com",
    "https://chatapi.zengjunjie.com",
    "https://chat.zengjunjie.com",
  ]);

  app.use("*", async (context, next) => {
    const origin = context.req.header("origin");
    if (origin && !allowedOrigins.has(origin)) {
      return context.json({ error: { code: "origin_not_allowed", message: "This request origin is not allowed." } }, 403);
    }
    await next();
  });
  app.use("*", cors({
    origin: (origin) => origin && allowedOrigins.has(origin) ? origin : "",
    allowHeaders: ["Authorization", "Content-Type", "X-Admin-Key", "X-Web-Search"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    maxAge: 600,
  }));
  app.use("*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    await next();
  });

  function requireAdmin(context: Context) {
    const supplied = context.req.header("x-admin-key") ?? requestBearer(context.req.header("authorization"));
    return supplied === adminKey();
  }

  async function canUseRoute(route: ModelRoute) {
    return controlPlane.hasAvailableUpstream(route);
  }

  async function resolveUpstreams(route: ModelRoute) {
    return controlPlane.selectUpstreams(route);
  }

  async function record(metric: RequestMetric) {
    await controlPlane.recordRequest(metric);
  }

  async function bindGeneratedModel(
    policy: Awaited<ReturnType<typeof enforceClientPolicy>>,
    request: ChatRequest,
    generatedByModel: string,
  ) {
    if ("response" in policy || !policy.userId || !request.session_id || !request.message_id) return;
    await conversations.recordGeneratedModel(policy.userId, request.session_id, request.message_id, generatedByModel);
  }

  async function enforceClientPolicy(context: Context) {
    const token = requestBearer(context.req.header("authorization"));
    const requireAuth = options.requireClientAuth ?? flag(process.env.REQUIRE_CLIENT_AUTH, false);
    if (!requireAuth) {
      const session = token ? verifySessionToken(token) : undefined;
      if (session) {
        const authorization = await controlPlane.authorizeUser(session.sub);
        if (!authorization.allowed) return { response: context.json({ error: { message: authorization.message } }, authorization.status) };
        return { clientKeyId: null, userId: authorization.userId };
      }
      return { clientKeyId: null, userId: null };
    }
    if (!token) return { response: context.json({ error: { message: "Sign in is required to use chat." } }, 401) };
    const session = verifySessionToken(token);
    if (session) {
      const authorization = await controlPlane.authorizeUser(session.sub);
      if (!authorization.allowed) return { response: context.json({ error: { message: authorization.message } }, authorization.status) };
      return { clientKeyId: null, userId: authorization.userId };
    }
    const authorization = await controlPlane.authorizeClient(token);
    if (!authorization.allowed) return { response: context.json({ error: { message: authorization.message } }, authorization.status) };
    return { clientKeyId: authorization.clientKeyId, userId: null };
  }

  async function requireSessionUser(context: Context) {
    const token = requestBearer(context.req.header("authorization"));
    const session = token ? verifySessionToken(token) : undefined;
    if (!session) return { response: context.json({ error: { message: "Sign in is required for this action." } }, 401) };
    const user = await controlPlane.getUser(session.sub);
    if (!user || user.status !== "active") {
      return { response: context.json({ error: { message: "Your session is no longer active." } }, 401) };
    }
    return { userId: user.id };
  }

  function clientAddress(context: Context) {
    return context.req.header("x-real-ip")
      ?? context.req.header("cf-connecting-ip")
      ?? context.req.header("x-forwarded-for")?.split(",")[0]?.trim()
      ?? "unknown";
  }

  async function userView(user: (Partial<Awaited<ReturnType<ControlPlane["getUser"]>>> & { id: string }) | undefined) {
    if (!user) return undefined;
    const groups = await enterprise.getUserGroupSlugs(user.id);
    return {
      ...user,
      groups,
      permissions: { expertMode: groups.some((slug) => slug.toLowerCase() === "expert") },
    };
  }

  function channelMatchesProvider(channelId: string, provider: string) {
    const channel = channelId.trim().toLowerCase();
    const upstream = provider.trim().toLowerCase();
    return channel === upstream
      || (channel === "chatgpt" && upstream === "openai")
      || (channel === "openai" && upstream === "chatgpt");
  }

  async function remoteConfig(userId?: string, expertMode = false) {
    const [routes, dynamicChannels] = await Promise.all([
      controlPlane.getModels(),
      enterprise.listDynamicChannels(),
    ]);
    const channels: RemoteChannel[] = dynamicChannels.map((channel) => ({
      id: channel.slug,
      displayName: channel.displayName,
      description: channel.description,
      icon: { type: channel.iconDataUrl ? "data_url" : "builtin", value: channel.iconDataUrl || channel.slug },
      appIconUrl: "",
      style: {
        backgroundStart: channel.backgroundStart,
        backgroundEnd: channel.backgroundEnd,
        accentColor: channel.accentColor,
        textColor: channel.textColor,
        surfaceColor: channel.surfaceColor,
        typography: channel.typography,
        animatedGradient: channel.animatedGradient,
        customCss: channel.customCss,
      },
      models: channel.models.map(({ id, label, description }) => ({ id, label, description })),
    }));
    const standard = publicRemoteConfig(routes, channels);
    const allowed = Boolean(userId && await enterprise.isUserInGroup(userId, "expert"));
    if (expertMode && !allowed) throw new Error("Expert mode is restricted to the Expert user group.");
    if (!expertMode) {
      return { ...standard, expertMode: { allowed, enabled: false, models: [] } };
    }
    const expertModels = await controlPlane.listExpertModels();
    const rawModels = expertModels.map((model) => ({
      id: model.rawModel,
      label: model.label || model.rawModel,
      description: model.description,
      expert: true,
      provider: model.provider,
    }));
    // Expert mode is a distinct catalog: standard aliases are intentionally
    // removed so the client can expose an editable raw-model combobox.
    const expertChannels = standard.channels
      .map((channel) => ({
        ...channel,
        models: rawModels.filter((model) => channelMatchesProvider(channel.id, model.provider)),
      }))
      .filter((channel) => channel.models.length > 0);
    return {
      ...standard,
      channels: expertChannels,
      models: [...standard.models, ...rawModels],
      expertMode: { allowed: true, enabled: true, models: rawModels },
    };
  }

  const updateUser = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = userPatchSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid user update.", details: parsed.error.issues } }, 400);
    const userId = context.req.param("id");
    if (!userId) return context.json({ error: { message: "A user id is required." } }, 400);
    const user = await controlPlane.updateUser(userId, parsed.data);
    return user ? context.json({ data: user }) : context.json({ error: { message: "User was not found." } }, 404);
  };

  const deleteUser = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    try {
      const deleted = await controlPlane.deleteUser(context.req.param("id") ?? "");
      return deleted
        ? context.body(null, 204)
        : context.json({ error: { code: "user_not_found", message: "User was not found." } }, 404);
    } catch (error) {
      return context.json({ error: { code: "user_delete_blocked", message: error instanceof Error ? error.message : "Unable to delete user." } }, 409);
    }
  };

  const listSearchProviders = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await enterprise.listSearchProviders() });
  };

  const createSearchProvider = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = searchProviderSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { code: "invalid_search_provider", message: "Invalid search provider.", details: parsed.error.issues } }, 400);
    if (parsed.data.enabled && !["duckduckgo", "bing_rss"].includes(parsed.data.kind) && !parsed.data.apiKey) {
      return context.json({ error: { code: "search_api_key_required", message: "An API key is required before this search provider can be enabled." } }, 400);
    }
    try {
      return context.json({ data: await enterprise.createSearchProvider(parsed.data) }, 201);
    } catch (error) {
      return context.json({ error: { code: "search_provider_create_failed", message: error instanceof Error ? error.message : "Unable to create search provider." } }, 400);
    }
  };

  const updateSearchProvider = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = searchProviderPatchSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { code: "invalid_search_provider", message: "Invalid search provider update.", details: parsed.error.issues } }, 400);
    const existing = (await enterprise.listSearchProviders()).find((item) => item.id === context.req.param("id"));
    if (!existing) return context.json({ error: { code: "search_provider_not_found", message: "Search provider was not found." } }, 404);
    const enabled = parsed.data.enabled ?? existing.enabled;
    const kind = parsed.data.kind ?? existing.kind;
    const keyConfigured = parsed.data.apiKey !== undefined ? Boolean(parsed.data.apiKey) : existing.apiKeyConfigured;
    if (enabled && !["duckduckgo", "bing_rss"].includes(kind) && !keyConfigured) {
      return context.json({ error: { code: "search_api_key_required", message: "An API key is required before this search provider can be enabled." } }, 400);
    }
    try {
      const provider = await enterprise.updateSearchProvider(existing.id, parsed.data);
      return context.json({ data: provider });
    } catch (error) {
      return context.json({ error: { code: "search_provider_update_failed", message: error instanceof Error ? error.message : "Unable to update search provider." } }, 400);
    }
  };

  const deleteSearchProvider = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const deleted = await enterprise.deleteSearchProvider(context.req.param("id") ?? "");
    return deleted
      ? context.body(null, 204)
      : context.json({ error: { code: "search_provider_not_found", message: "Search provider was not found." } }, 404);
  };

  app.get("/health", async (context) => {
    const [models, mappings, providerKeys, overview] = await Promise.all([
      controlPlane.getModels(),
      controlPlane.listModelMappings(),
      controlPlane.listProviderKeys(),
      controlPlane.getOverview(),
    ]);
    const modelIds = new Set(models.map((model) => model.id));
    const activeProviders = new Set(providerKeys.filter((key) => key.status === "active").map((key) => key.provider));
    const configured = mappings.filter((mapping) => mapping.enabled && modelIds.has(mapping.modelId) && activeProviders.has(mapping.provider));
    return context.json({
      status: "ok",
      mode: demoMode() ? "demo" : "relay",
      storage: overview.storage,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000),
      activeStreams: overview.activeStreams,
      configuredProviders: [...new Set(configured.map((mapping) => mapping.provider))],
    });
  });

  app.get("/v1/models", async (context) => {
    const requestedExpert = context.req.query("expert_mode") === "true";
    let userId: string | undefined;
    if (requestedExpert) {
      const session = await requireSessionUser(context);
      if ("response" in session) return session.response;
      userId = session.userId;
    }
    let config;
    try {
      config = await remoteConfig(userId, requestedExpert);
    } catch (error) {
      return context.json({ error: { code: "expert_access_denied", message: error instanceof Error ? error.message : "Expert mode is not available." } }, 403);
    }
    return context.json({
      object: "list",
      data: config.models.map((model) => ({ id: model.id, object: "model", created: 0, owned_by: "expert" in model && model.expert ? model.provider : "adaptive-chat" })),
    });
  });

  app.get("/v1/config", async (context) => {
    const requestedExpert = context.req.query("expert_mode") === "true";
    let userId: string | undefined;
    if (requestedExpert) {
      const session = await requireSessionUser(context);
      if ("response" in session) return session.response;
      userId = session.userId;
    } else {
      const token = requestBearer(context.req.header("authorization"));
      const session = token ? verifySessionToken(token) : undefined;
      if (session) userId = session.sub;
    }
    try {
      return context.json(await remoteConfig(userId, requestedExpert));
    } catch (error) {
      return context.json({ error: { code: "expert_access_denied", message: error instanceof Error ? error.message : "Expert mode is not available." } }, 403);
    }
  });

  app.get("/v1/config/launcher-icon", async (context) => {
    const image = decodeRasterDataUrl((await enterprise.getLauncherIcon()).dataUrl);
    if (!image) return context.json({ error: { code: "app_icon_not_found", message: "App icon was not found." } }, 404);
    return new Response(image.body, {
      headers: {
        "Content-Type": image.contentType,
        "Content-Length": String(image.body.byteLength),
        "Cache-Control": "public, max-age=300",
      },
    });
  });

  app.post("/v1/auth/login", async (context) => {
    const parsed = loginSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Email and password are required." } }, 400);
    const user = await controlPlane.authenticateUser(parsed.data.email, parsed.data.password);
    if (!user) return context.json({ error: { message: "Invalid email or password." } }, 401);
    const ip = clientAddress(context);
    const loginIp = await enterprise.recordLoginIp(user.id, ip, context.req.header("user-agent") ?? "Unknown device");
    if (loginIp.isNew && !loginIp.isFirst) {
      const [template, settings] = await Promise.all([
        enterprise.getEmailTemplate("suspicious_login"),
        enterprise.getEmailSettings(),
      ]);
      if (template?.enabled && settings.enabled) {
        const rendered = renderEmailTemplate(template, {
          email: user.email,
          ip,
          time: new Date().toISOString(),
          userAgent: context.req.header("user-agent") ?? "Unknown device",
        });
        await enterprise.enqueueJob("email", { to: user.email, ...rendered });
      }
    }
    const token = issueSessionToken(user);
    const session = verifySessionToken(token);
    return context.json({
      token,
      tokenType: "Bearer",
      expiresAt: session ? new Date(session.exp * 1_000).toISOString() : undefined,
      user: await userView(user),
    });
  });

  app.get("/v1/users/avatars/:filename", async (context) => {
    const filename = context.req.param("filename");
    if (!AVATAR_FILE_PATTERN.test(filename)) {
      return context.json({ error: { code: "avatar_not_found", message: "Avatar image was not found." } }, 404);
    }
    try {
      const image = await readFile(join(avatarStorageDir, filename));
      return new Response(new Uint8Array(image), {
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(image.byteLength),
          "Cache-Control": "public, max-age=31536000, immutable",
          "Cross-Origin-Resource-Policy": "cross-origin",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return context.json({ error: { code: "avatar_not_found", message: "Avatar image was not found." } }, 404);
    }
  });

  app.get("/v1/users/profile", async (context) => {
    const session = await requireSessionUser(context);
    if ("response" in session) return session.response;
    const user = await controlPlane.getUser(session.userId);
    return user
      ? context.json({ data: await userView(user) })
      : context.json({ error: { code: "profile_not_found", message: "User profile was not found." } }, 404);
  });

  app.get("/v1/users/me", async (context) => {
    const session = await requireSessionUser(context);
    if ("response" in session) return session.response;
    const user = await controlPlane.getUser(session.userId);
    return user
      ? context.json({ data: await userView(user) })
      : context.json({ error: { code: "profile_not_found", message: "User profile was not found." } }, 404);
  });

  app.patch(
    "/v1/users/profile",
    bodyLimit({
      maxSize: MAX_AVATAR_REQUEST_BYTES,
      onError: (context) => context.json({ error: { code: "avatar_too_large", message: "Avatar images must be 2 MB or smaller." } }, 413),
    }),
    async (context) => {
      const session = await requireSessionUser(context);
      if ("response" in session) return session.response;
      const current = await controlPlane.getUser(session.userId);
      if (!current) return context.json({ error: { code: "profile_not_found", message: "User profile was not found." } }, 404);

      let displayName: string | null | undefined;
      let removeAvatar = false;
      let avatar: File | undefined;
      const contentType = context.req.header("content-type")?.toLowerCase() ?? "";
      if (contentType.startsWith("multipart/form-data")) {
        const body = await context.req.parseBody().catch(() => undefined);
        if (!body) return context.json({ error: { code: "invalid_profile", message: "Invalid profile form data." } }, 400);
        const nameValue = body.displayName;
        const removeValue = body.removeAvatar;
        const avatarValue = body.avatar;
        if (nameValue !== undefined && typeof nameValue !== "string") {
          return context.json({ error: { code: "invalid_display_name", message: "Display name must be text." } }, 400);
        }
        if (avatarValue !== undefined && !(avatarValue instanceof File)) {
          return context.json({ error: { code: "invalid_avatar", message: "Avatar must be an image file." } }, 400);
        }
        if (typeof nameValue === "string") {
          const parsedName = z.string().trim().max(80).safeParse(nameValue);
          if (!parsedName.success) return context.json({ error: { code: "invalid_display_name", message: "Display name must be 80 characters or fewer." } }, 400);
          displayName = parsedName.data || null;
        }
        removeAvatar = removeValue === "true" || removeValue === "1";
        avatar = avatarValue instanceof File ? avatarValue : undefined;
      } else {
        const parsed = profileJsonSchema.safeParse(await context.req.json().catch(() => undefined));
        if (!parsed.success) return context.json({ error: { code: "invalid_profile", message: "Invalid profile update." } }, 400);
        displayName = parsed.data.displayName?.trim() || (parsed.data.displayName === null || parsed.data.displayName === "" ? null : undefined);
        removeAvatar = parsed.data.removeAvatar === true;
      }
      if (displayName === undefined && !removeAvatar && !avatar) {
        return context.json({ error: { code: "empty_profile_update", message: "A display name or avatar change is required." } }, 400);
      }
      if (removeAvatar && avatar) {
        return context.json({ error: { code: "conflicting_avatar_update", message: "Choose either a new avatar or remove the current avatar." } }, 400);
      }

      let newFilename: string | undefined;
      try {
        const patch: UpdateUserInput = {};
        if (displayName !== undefined) patch.displayName = displayName;
        if (avatar) {
          newFilename = await saveAvatar(avatarStorageDir, avatar);
          const requestBase = new URL(context.req.url).origin;
          patch.avatarUrl = `${configuredPublicApiBase || requestBase}/v1/users/avatars/${newFilename}`;
        } else if (removeAvatar) {
          patch.avatarUrl = null;
        }
        const updated = await controlPlane.updateUser(current.id, patch);
        if (!updated) throw new Error("User profile was not found.");
        const previousFilename = avatarFilename(current.avatarUrl);
        if ((avatar || removeAvatar) && previousFilename && previousFilename !== newFilename) {
          await unlink(join(avatarStorageDir, previousFilename)).catch(() => undefined);
        }
        return context.json({ data: await userView(updated) });
      } catch (error) {
        if (newFilename) await unlink(join(avatarStorageDir, newFilename)).catch(() => undefined);
        const message = error instanceof Error && PUBLIC_PROFILE_ERRORS.has(error.message)
          ? error.message
          : "Unable to update your profile.";
        return context.json({
          error: {
            code: "profile_update_failed",
            message,
          },
        }, 400);
      }
    },
  );

  app.get("/v1/sessions", async (context) => {
    const session = await requireSessionUser(context);
    if ("response" in session) return session.response;
    return context.json({ data: await conversations.listSessions(session.userId) });
  });

  app.get("/v1/sessions/:id", async (context) => {
    const session = await requireSessionUser(context);
    if ("response" in session) return session.response;
    const conversation = await conversations.getSession(session.userId, context.req.param("id"));
    return conversation
      ? context.json({ data: conversation })
      : context.json({ error: { code: "session_not_found", message: "Conversation was not found." } }, 404);
  });

  app.post("/v1/sessions", async (context) => {
    const session = await requireSessionUser(context);
    if ("response" in session) return session.response;
    const parsed = conversationCreateSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) {
      return context.json({ error: { code: "invalid_session", message: "Invalid conversation snapshot.", details: parsed.error.issues } }, 400);
    }
    try {
      return context.json({ data: await conversations.upsertSnapshot(session.userId, parsed.data as ConversationSnapshotInput) }, 201);
    } catch (error) {
      return context.json({ error: { code: "session_write_failed", message: error instanceof Error ? error.message : "Unable to save the conversation." } }, 409);
    }
  });

  app.put("/v1/sessions/:id", async (context) => {
    const session = await requireSessionUser(context);
    if ("response" in session) return session.response;
    const parsed = conversationSnapshotSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) {
      return context.json({ error: { code: "invalid_session", message: "Invalid conversation snapshot.", details: parsed.error.issues } }, 400);
    }
    try {
      const snapshot = { id: context.req.param("id"), ...parsed.data } satisfies ConversationSnapshotInput;
      return context.json({ data: await conversations.upsertSnapshot(session.userId, snapshot) });
    } catch (error) {
      return context.json({ error: { code: "session_write_failed", message: error instanceof Error ? error.message : "Unable to save the conversation." } }, 409);
    }
  });

  app.delete("/v1/sessions/:id", async (context) => {
    const session = await requireSessionUser(context);
    if ("response" in session) return session.response;
    return await conversations.deleteSession(session.userId, context.req.param("id"))
      ? context.body(null, 204)
      : context.json({ error: { code: "session_not_found", message: "Conversation was not found." } }, 404);
  });

  app.delete("/v1/messages/:id", async (context) => {
    const session = await requireSessionUser(context);
    if ("response" in session) return session.response;
    const result = await conversations.deleteMessage(session.userId, context.req.param("id"));
    return result
      ? context.json({ data: result })
      : context.json({ error: { code: "message_not_found", message: "Message was not found." } }, 404);
  });

  app.post("/v1/app/check-update", async (context) => {
    const parsed = updateCheckSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid app version." } }, 400);
    const sessionToken = requestBearer(context.req.header("authorization"));
    const session = sessionToken ? verifySessionToken(sessionToken) : undefined;
    const latest = await enterprise.getEligibleAppVersion(session?.sub)
      ?? (options.enterpriseStore ? undefined : await controlPlane.getLatestAppVersion());
    return context.json({
      updateAvailable: Boolean(latest && latest.versionCode > parsed.data.versionCode),
      latest: latest ?? null,
    });
  });

  app.post("/v1/app/feedback", async (context) => {
    const session = await requireSessionUser(context);
    if ("response" in session) return session.response;
    const parsed = feedbackSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid feedback." } }, 400);
    try {
      return context.json({ data: await controlPlane.createFeedback(session.userId, parsed.data) }, 201);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to save feedback." } }, 400);
    }
  });

  app.post("/v1/audio/speech", async (context) => {
    const session = await requireSessionUser(context);
    if ("response" in session) return session.response;
    const parsed = speechSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid speech request." } }, 400);

    try {
      const audio = await (options.synthesizeSpeech ?? synthesizeEdgeSpeech)(
        parsed.data.input,
        parsed.data.voice ?? defaultEdgeVoice,
      );
      return new Response(Buffer.from(audio), {
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(audio.byteLength),
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Edge TTS synthesis failed.";
      const status = /(?:429|rate[ -]?limit)/i.test(message) ? 429 : 503;
      return context.json({ error: { message } }, status);
    }
  });

  app.post("/v1/chat/completions", async (context) => {
    const policy = await enforceClientPolicy(context);
    if ("response" in policy) return policy.response;

    const payload = await context.req.json().catch(() => undefined);
    const parsed = chatRequestSchema.safeParse(payload);
    if (!parsed.success) return context.json({ error: { message: "Invalid chat completion request.", details: parsed.error.issues } }, 400);

    let request = parsed.data;
    let expertModel: ExpertModel | undefined;
    let expertChannel: string | undefined;
    let route = await controlPlane.findModelRoute(request.model);
    if (request.expert_mode) {
      if (!policy.userId || !await enterprise.isUserInGroup(policy.userId, "expert")) {
        return context.json({ error: { code: "expert_access_denied", message: "Expert mode is restricted to the Expert user group." } }, 403);
      }
      expertModel = await controlPlane.findExpertModel(request.model);
      if (expertModel) {
        expertChannel = request.channel?.trim().toLowerCase() || expertModel.provider;
        route = {
          id: expertModel.rawModel,
          label: expertModel.label,
          description: expertModel.description,
          uiMode: expertModel.provider === "openai" ? "chatgpt" : expertModel.provider,
          aliases: [],
          enabled: true,
        };
      } else {
        // Expert users may submit a model that is absent from model_mappings and
        // the administered Expert list. The selected channel determines the key
        // pool; the raw model string is forwarded unchanged to that upstream.
        expertChannel = request.channel?.trim().toLowerCase();
        if (!expertChannel) {
          return context.json({ error: { code: "expert_channel_required", message: "A channel is required when using an unlisted Expert model." } }, 400);
        }
        route = {
          id: request.model,
          label: request.model,
          description: "Expert raw upstream model",
          uiMode: expertChannel,
          aliases: [],
          enabled: true,
        };
      }
    }
    if (!route) return context.json({ error: { message: `Unknown or disabled model: ${request.model}` } }, 404);
    const requestSignal = context.req.raw.signal;
    const requestStartedAt = Date.now();
    let promptTokens = estimateTokens(request.messages);
    let metricProvider = route.uiMode;
    const makeMetric = (status: RequestMetric["status"], completionTokens = 0): RequestMetric => ({
      model: route.id,
      provider: metricProvider,
      clientKeyId: policy.clientKeyId,
      userId: policy.userId,
      status,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - requestStartedAt,
    });
    const isDemo = demoMode();
    const webSearchEnabled = flag(context.req.header("x-web-search"), false);
    let upstreams: SelectedUpstream[] = [];
    let prepared: PreparedSearchRequest = { primary: request };
    if (!isDemo) {
      upstreams = request.expert_mode
        ? await controlPlane.selectExpertUpstreamsForChannel(expertChannel ?? route.uiMode, request.model)
        : await resolveUpstreams(route);
      metricProvider = upstreams[0]?.provider ?? metricProvider;
      if (!upstreams.length) {
        await record(makeMetric("failure"));
        return context.json({ error: { message: `No upstream target is configured for ${route.id}. Add an enabled mapping and provider key in the admin console.` } }, 503);
      }
    }
    if (webSearchEnabled) {
      try {
        const providers = await enterprise.listSearchExecutionConfigs();
        const search = options.executeSearch ?? executeWebSearch;
        if (isDemo) {
          const result = await search(providers, extractLatestUserQuery(request.messages));
          request = {
            ...request,
            messages: injectSearchGrounding(request.messages, buildSearchGroundingMessage(result)) as ChatRequest["messages"],
          };
          prepared = { primary: request };
        } else {
          prepared = await prepareSearchRequest(request, upstreams, providers, search, requestSignal);
          request = prepared.primary;
        }
        promptTokens = estimateTokens(request.messages);
      } catch (error) {
        await record(makeMetric("failure"));
        const message = error instanceof SearchUnavailableError
          ? error.message
          : error instanceof Error ? error.message : "Web search failed.";
        return context.json({ error: { code: "web_search_unavailable", message } }, 502);
      }
    }

    if (isDemo) {
      const answer = demoAnswer(request, route);
      await bindGeneratedModel(policy, request, route.id);
      const completionTokens = Math.ceil(((answer.reasoning?.length ?? 0) + answer.content.length) / 4);
      if (!request.stream) {
        await record(makeMetric("success", completionTokens));
        return context.json({
          id: `chatcmpl_${randomUUID().replaceAll("-", "")}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1_000),
          model: route.id,
          generated_by_model: route.id,
          choices: [{
            index: 0,
            message: { role: "assistant", content: answer.content, ...(answer.reasoning ? { reasoning_content: answer.reasoning } : {}) },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
        });
      }

      return streamSSE(context, async (stream) => {
        await controlPlane.changeActiveStreams(1);
        let success = false;
        try {
          const streamDelay = Math.max(0, Number(process.env.DEMO_STREAM_DELAY_MS ?? 12));
          if (answer.reasoning) {
            for (const piece of chunks(answer.reasoning)) {
              await stream.writeSSE({ data: ssePayload(route.id, { reasoning_content: piece }) });
              await delay(streamDelay, requestSignal);
            }
          }
          for (const piece of chunks(answer.content)) {
            await stream.writeSSE({ data: ssePayload(route.id, { content: piece }) });
            await delay(streamDelay, requestSignal);
          }
          await stream.writeSSE({ data: ssePayload(route.id, {}, "stop") });
          await stream.writeSSE({ data: "[DONE]" });
          success = true;
        } catch (error) {
          await stream.writeSSE({ event: "error", data: JSON.stringify({ error: error instanceof Error ? error.message : "Stream failed" }) });
        } finally {
          await controlPlane.changeActiveStreams(-1);
          await record(makeMetric(success ? "success" : "failure", success ? completionTokens : 0));
        }
      });
    }

    try {
      const upstreamResult = await fetchFinalUpstream(upstreams, prepared, requestSignal);
      const response = upstreamResult.response;
      const generatedByModel = upstreamResult.upstream.upstreamModel;
      await bindGeneratedModel(policy, request, generatedByModel);
      if (!request.stream) {
        const contentType = response.headers.get("content-type") ?? "application/json";
        const body = await response.text();
        const usage = usageFromBody(body);
        await record(makeMetric(response.ok ? "success" : "failure", response.ok ? usage.completionTokens : 0));
        let annotatedBody = body;
        try {
          const payload = JSON.parse(body) as Record<string, unknown>;
          payload.generated_by_model = generatedByModel;
          annotatedBody = JSON.stringify(payload);
        } catch {
          // Preserve non-JSON upstream error bodies while still exposing the header below.
        }
        return new Response(annotatedBody, {
          status: response.status,
          headers: { "Content-Type": contentType },
        });
      }
      if (!response.ok || !response.body) {
        await record(makeMetric("failure"));
        return context.json({ error: { message: `Upstream returned HTTP ${response.status}` } }, 502);
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      const source = contentType.includes("text/event-stream")
        ? response.body
        : completionJsonAsSse(await response.text(), generatedByModel);
      await controlPlane.changeActiveStreams(1);
      let finalized = false;
      const finalize = async (status: RequestMetric["status"]) => {
        if (finalized) return;
        finalized = true;
        await controlPlane.changeActiveStreams(-1);
        await record(makeMetric(status));
      };
      const body = finalizedSseStream(source, finalize, generatedByModel, requestSignal);
      return new Response(body, {
        status: response.status,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    } catch (error) {
      await record(makeMetric("failure"));
      return context.json({ error: { message: error instanceof Error ? error.message : "The upstream request failed." } }, 502);
    }
  });

  app.get("/admin/overview", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const overview = await controlPlane.getOverview();
    const models = await Promise.all(overview.models.map(async (model) => ({
      ...model,
      upstreamConfigured: await canUseRoute(model),
    })));
    return context.json({
      generatedAt: nowIso(),
      storage: overview.storage,
      health: { status: "ok", activeStreams: overview.activeStreams, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000) },
      metrics: overview.metrics,
      models,
      keys: overview.keys,
      users: overview.users,
      providerKeys: overview.providerKeys,
      routing: overview.routing,
    });
  });

  app.get("/admin/search-providers", listSearchProviders);
  app.get("/v1/admin/search-providers", listSearchProviders);
  app.post("/admin/search-providers", createSearchProvider);
  app.post("/v1/admin/search-providers", createSearchProvider);
  app.patch("/admin/search-providers/:id", updateSearchProvider);
  app.patch("/v1/admin/search-providers/:id", updateSearchProvider);
  app.delete("/admin/search-providers/:id", deleteSearchProvider);
  app.delete("/v1/admin/search-providers/:id", deleteSearchProvider);

  app.get("/admin/api-keys", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await controlPlane.listClientKeys() });
  });

  app.post("/admin/api-keys", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = keyCreateSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid API key request.", details: parsed.error.issues } }, 400);
    try {
      const key = await controlPlane.createClientKey(parsed.data);
      return context.json(key, 201);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to issue API key." } }, 400);
    }
  });

  app.delete("/admin/api-keys/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const key = await controlPlane.revokeClientKey(context.req.param("id"));
    return key ? context.json({ data: key }) : context.json({ error: { message: "API key was not found." } }, 404);
  });

  app.get("/admin/users", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await controlPlane.listUsers() });
  });

  app.post("/admin/users", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = userCreateSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid user request.", details: parsed.error.issues } }, 400);
    try {
      const user = await controlPlane.createUser(parsed.data);
      await enterprise.assignDefaultGroup(user.id);
      return context.json({ data: user }, 201);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to create user." } }, 400);
    }
  });

  app.patch("/admin/users/:id", updateUser);
  app.patch("/v1/users/:id", updateUser);
  app.put("/v1/users/:id", updateUser);
  app.delete("/admin/users/:id", deleteUser);
  app.delete("/v1/users/:id", deleteUser);

  app.get("/admin/feedbacks", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await controlPlane.listFeedbacks() });
  });

  app.patch("/admin/feedbacks/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = feedbackPatchSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid feedback update." } }, 400);
    const feedback = await controlPlane.updateFeedbackStatus(context.req.param("id"), parsed.data.status);
    return feedback ? context.json({ data: feedback }) : context.json({ error: { message: "Feedback was not found." } }, 404);
  });

  app.get("/admin/app-versions", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await controlPlane.listAppVersions() });
  });

  app.post("/admin/app-versions", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = appVersionCreateSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid app version." } }, 400);
    try {
      return context.json({ data: await controlPlane.createAppVersion(parsed.data) }, 201);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to publish app version." } }, 400);
    }
  });

  app.patch("/admin/app-versions/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = appVersionPatchSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid app version update." } }, 400);
    try {
      const version = await controlPlane.updateAppVersion(context.req.param("id"), parsed.data);
      return version ? context.json({ data: version }) : context.json({ error: { message: "App version was not found." } }, 404);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to update app version." } }, 400);
    }
  });

  app.get("/admin/provider-keys", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await controlPlane.listProviderKeys() });
  });

  app.post("/admin/provider-keys", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const body = await context.req.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (body && body.bypass_auth !== undefined && body.bypassAuth === undefined) body.bypassAuth = body.bypass_auth;
    const parsed = providerKeySchema.safeParse(body);
    if (!parsed.success) return context.json({ error: { message: "Invalid provider key request.", details: parsed.error.issues } }, 400);
    try {
      return context.json({ data: await controlPlane.createProviderKey({ ...parsed.data, secret: parsed.data.secret ?? "" }) }, 201);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to save provider key." } }, 400);
    }
  });

  app.patch("/admin/provider-keys/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const body = await context.req.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (body && body.bypass_auth !== undefined && body.bypassAuth === undefined) body.bypassAuth = body.bypass_auth;
    const parsed = providerKeyPatchSchema.safeParse(body);
    if (!parsed.success) return context.json({ error: { message: "Invalid provider key update.", details: parsed.error.issues } }, 400);
    try {
      const key = await controlPlane.updateProviderKey(context.req.param("id"), { ...parsed.data, ...(parsed.data.secret === null ? { secret: "" } : {}) });
      return key ? context.json({ data: key }) : context.json({ error: { message: "Provider key was not found." } }, 404);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to update provider key." } }, 400);
    }
  });
  app.put("/admin/provider-keys/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const body = await context.req.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (body && body.bypass_auth !== undefined && body.bypassAuth === undefined) body.bypassAuth = body.bypass_auth;
    const parsed = providerKeyPatchSchema.safeParse(body);
    if (!parsed.success) return context.json({ error: { message: "Invalid provider key update.", details: parsed.error.issues } }, 400);
    try {
      const key = await controlPlane.updateProviderKey(context.req.param("id"), { ...parsed.data, ...(parsed.data.secret === null ? { secret: "" } : {}) });
      return key ? context.json({ data: key }) : context.json({ error: { message: "Provider key was not found." } }, 404);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to update provider key." } }, 400);
    }
  });
  app.delete("/admin/provider-keys/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    try {
      const deleted = await controlPlane.deleteProviderKey(context.req.param("id"));
      return deleted ? context.body(null, 204) : context.json({ error: { message: "Provider key was not found." } }, 404);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to delete provider key." } }, 409);
    }
  });
  app.put("/v1/admin/keys/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const body = await context.req.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (body && body.bypass_auth !== undefined && body.bypassAuth === undefined) body.bypassAuth = body.bypass_auth;
    const parsed = providerKeyPatchSchema.safeParse(body);
    if (!parsed.success) return context.json({ error: { message: "Invalid provider key update.", details: parsed.error.issues } }, 400);
    try {
      const key = await controlPlane.updateProviderKey(context.req.param("id"), { ...parsed.data, ...(parsed.data.secret === null ? { secret: "" } : {}) });
      return key ? context.json({ data: key }) : context.json({ error: { message: "Provider key was not found." } }, 404);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to update provider key." } }, 400);
    }
  });
  app.delete("/v1/admin/keys/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    try {
      const deleted = await controlPlane.deleteProviderKey(context.req.param("id"));
      return deleted ? context.body(null, 204) : context.json({ error: { message: "Provider key was not found." } }, 404);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to delete provider key." } }, 409);
    }
  });

  const mappingGroups = async () => {
    const [models, mappings] = await Promise.all([controlPlane.listModelRoutes(), controlPlane.listModelMappings()]);
    return models.map((model) => ({
      model,
      mappings: mappings.filter((mapping) => mapping.modelId === model.id),
    }));
  };
  const listMappings = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await mappingGroups() });
  };
  const replaceMappings = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const modelId = context.req.param("modelId") ?? "";
    const model = (await controlPlane.listModelRoutes()).find((candidate) => candidate.id === modelId);
    if (!model) return context.json({ error: { message: "Internal model was not found." } }, 404);
    const parsed = modelMappingsReplaceSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid model mappings array.", details: parsed.error.issues } }, 400);
    try {
      const mappings = await controlPlane.replaceModelMappings(model.id, parsed.data.mappings);
      return context.json({ data: { model, mappings } });
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to replace model mappings." } }, 400);
    }
  };
  for (const prefix of ["/admin/mappings", "/v1/admin/mappings"] as const) {
    app.get(prefix, listMappings);
    app.put(`${prefix}/:modelId`, replaceMappings);
  }

  const listExpertModels = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await controlPlane.listExpertModels(true) });
  };
  const createExpertModel = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = expertModelSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid Expert model.", details: parsed.error.issues } }, 400);
    try {
      return context.json({ data: await controlPlane.createExpertModel(parsed.data satisfies ExpertModelInput) }, 201);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to create Expert model." } }, 409);
    }
  };
  const updateExpertModel = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = expertModelPatchSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid Expert model update.", details: parsed.error.issues } }, 400);
    try {
      const model = await controlPlane.updateExpertModel(context.req.param("id") ?? "", parsed.data satisfies ExpertModelPatch);
      return model ? context.json({ data: model }) : context.json({ error: { message: "Expert model was not found." } }, 404);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to update Expert model." } }, 409);
    }
  };
  const deleteExpertModel = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return await controlPlane.deleteExpertModel(context.req.param("id") ?? "")
      ? context.body(null, 204)
      : context.json({ error: { message: "Expert model was not found." } }, 404);
  };
  for (const prefix of ["/admin/expert-models", "/v1/admin/expert-models"] as const) {
    app.get(prefix, listExpertModels);
    app.post(prefix, createExpertModel);
    app.patch(`${prefix}/:id`, updateExpertModel);
    app.put(`${prefix}/:id`, updateExpertModel);
    app.delete(`${prefix}/:id`, deleteExpertModel);
  }

  app.get("/admin/routing", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const [strategy, policies] = await Promise.all([controlPlane.getRoutingStrategy(), controlPlane.listRoutingPolicies()]);
    return context.json({
      data: {
        strategy,
        channelPolicies: policies.filter((policy) => policy.scope === "channel"),
        modelPolicies: policies.filter((policy) => policy.scope === "model"),
      },
    });
  });

  app.patch("/admin/routing", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = routingSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid routing strategy." } }, 400);
    const strategy: LoadBalanceStrategy = await controlPlane.setRoutingStrategy(parsed.data.strategy);
    return context.json({ data: { strategy } });
  });

  app.patch("/admin/routing/:scope/:scopeId", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const scope = z.enum(["channel", "model"]).safeParse(context.req.param("scope"));
    const parsed = routingPolicySchema.safeParse(await context.req.json().catch(() => undefined));
    if (!scope.success || !parsed.success) return context.json({ error: { message: "Invalid routing policy." } }, 400);
    try {
      const policy = await controlPlane.setRoutingPolicy(scope.data as RoutingScope, context.req.param("scopeId"), parsed.data.keyIds);
      return policy ? context.json({ data: policy }) : context.json({ error: { message: "A routing policy requires at least one provider key." } }, 400);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to save routing policy." } }, 400);
    }
  });

  app.delete("/admin/routing/:scope/:scopeId", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const scope = z.enum(["channel", "model"]).safeParse(context.req.param("scope"));
    if (!scope.success) return context.json({ error: { message: "Invalid routing policy." } }, 400);
    const deleted = await controlPlane.deleteRoutingPolicy(scope.data as RoutingScope, context.req.param("scopeId"));
    return deleted ? context.body(null, 204) : context.json({ error: { message: "Routing policy was not found." } }, 404);
  });

  app.get("/admin/config", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json(await remoteConfig());
  });

  app.get("/admin/email/settings", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await enterprise.getEmailSettings() });
  });

  app.put("/admin/email/settings", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = emailSettingsSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid SMTP configuration.", details: parsed.error.issues } }, 400);
    if (parsed.data.enabled && (!parsed.data.host || !parsed.data.fromEmail)) {
      return context.json({ error: { message: "An SMTP host and sender email are required before email can be enabled." } }, 400);
    }
    return context.json({ data: await enterprise.updateEmailSettings(parsed.data) });
  });

  app.get("/admin/email/templates", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await enterprise.listEmailTemplates() });
  });

  app.patch("/admin/email/templates/:trigger", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const trigger = z.enum(["suspicious_login", "announcement", "version_update"]).safeParse(context.req.param("trigger"));
    const parsed = emailTemplatePatchSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!trigger.success || !parsed.success) return context.json({ error: { message: "Invalid email template update." } }, 400);
    const template = await enterprise.updateEmailTemplate(trigger.data, parsed.data);
    return template ? context.json({ data: template }) : context.json({ error: { message: "Email template was not found." } }, 404);
  });

  app.post("/admin/email/preview", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = emailPreviewSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid email preview request." } }, 400);
    const stored = await enterprise.getEmailTemplate(parsed.data.trigger);
    if (!stored) return context.json({ error: { message: "Email template was not found." } }, 404);
    const rendered = renderEmailTemplate({
      subject: parsed.data.subject ?? stored.subject,
      htmlBody: parsed.data.htmlBody ?? stored.htmlBody,
    }, parsed.data.variables);
    return context.json({ data: rendered });
  });

  app.post("/admin/email/test", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = z.object({ to: z.email().max(320) }).safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "A valid test recipient is required." } }, 400);
    const job = await enterprise.enqueueJob("email", {
      to: parsed.data.to,
      subject: "Adaptive Chat SMTP test",
      html: "<!doctype html><html><body><h1>SMTP is configured</h1><p>This message was dispatched by the Adaptive Chat background worker.</p></body></html>",
    });
    return context.json({ data: job }, 202);
  });

  app.post("/admin/email/announcements", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = announcementSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid announcement." } }, 400);
    const template = await enterprise.getEmailTemplate("announcement");
    if (!template?.enabled) return context.json({ error: { message: "The announcement template is disabled." } }, 409);
    const rendered = renderEmailTemplate(template, { title: parsed.data.title, message: parsed.data.message });
    const recipients = await enterprise.listGroupEmails(parsed.data.groupId);
    const jobs = await Promise.all(recipients.map((to) => enterprise.enqueueJob("email", { to, ...rendered })));
    return context.json({ data: { recipientCount: recipients.length, jobIds: jobs.map((job) => job.id) } }, 202);
  });

  app.get("/admin/dynamic-channels", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await enterprise.listDynamicChannels(true) });
  });

  app.get("/admin/launcher-icon", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await enterprise.getLauncherIcon() });
  });

  app.put("/admin/launcher-icon", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = launcherIconSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "A valid PNG, JPEG, or WebP launcher icon is required." } }, 400);
    if (parsed.data.dataUrl) {
      const image = decodeRasterDataUrl(parsed.data.dataUrl);
      try {
        if (!image) throw new Error("invalid_image");
        const metadata = await sharp(image.body, { limitInputPixels: 16_000_000 }).metadata();
        if (!metadata.width || !metadata.height || !["png", "jpeg", "webp"].includes(metadata.format ?? "")) throw new Error("invalid_image");
      } catch {
        return context.json({ error: { message: "A valid PNG, JPEG, or WebP launcher icon is required." } }, 400);
      }
    }
    return context.json({ data: await enterprise.updateLauncherIcon(parsed.data.dataUrl) });
  });

  app.post("/admin/dynamic-channels", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = dynamicChannelSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "A valid channel configuration is required.", details: parsed.error.issues } }, 400);
    if (!parsed.data.endpoint || !parsed.data.secret) return context.json({ error: { message: "An upstream endpoint and API key are required." } }, 400);
    if (parsed.data.models.some((model) => !model.initialUpstreamModel)) return context.json({ error: { message: "Every new internal model requires an initial upstream target." } }, 400);
    try {
      const input = parsed.data;
      const existingRoutes = await controlPlane.listModelRoutes();
      const collision = input.models.find((model) => existingRoutes.some((route) => route.id === model.id));
      if (collision) return context.json({ error: { message: `Model id ${collision.id} is already in use.` } }, 409);
      const key = await controlPlane.createProviderKey({
        provider: input.provider,
        label: `${input.displayName} upstream`,
        endpoint: input.endpoint!,
        secret: input.secret!,
        priority: input.priority,
        bypassAuth: false,
      });
      for (const model of input.models) {
        await controlPlane.createModelRoute({
          id: model.id,
          label: model.label,
          description: model.description,
          uiMode: input.slug,
          aliases: [],
          enabled: input.enabled,
        });
        await controlPlane.replaceModelMappings(model.id, [{
          provider: input.provider,
          upstreamModel: model.initialUpstreamModel!,
          priority: input.priority,
          enabled: input.enabled,
        }]);
      }
      await controlPlane.setRoutingPolicy("channel", input.slug, [key.id]);
      const channelModels = input.models.map(({ initialUpstreamModel: _initialUpstreamModel, ...model }) => model);
      const { endpoint: _endpoint, secret: _secret, priority: _priority, models: _models, ...channelInput } = input;
      const channel = await enterprise.createDynamicChannel({ ...channelInput, models: channelModels, providerKeyId: key.id });
      return context.json({ data: channel }, 201);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to create dynamic channel." } }, 400);
    }
  });

  app.patch("/admin/dynamic-channels/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = dynamicChannelPatchSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid dynamic channel update.", details: parsed.error.issues } }, 400);
    const existing = (await enterprise.listDynamicChannels(true)).find((channel) => channel.id === context.req.param("id"));
    if (!existing) return context.json({ error: { message: "Dynamic channel was not found." } }, 404);
    try {
      const input = parsed.data;
      if ((input.slug && input.slug !== existing.slug) || (input.provider && input.provider !== existing.provider)) {
        return context.json({ error: { message: "Channel and provider identifiers cannot be changed after creation." } }, 409);
      }
      if (existing.providerKeyId && (input.endpoint !== undefined || input.secret !== undefined || input.priority !== undefined)) {
        await controlPlane.updateProviderKey(existing.providerKeyId, {
          endpoint: input.endpoint,
          secret: input.secret,
          priority: input.priority,
        });
      }
      if (input.models) {
        const routes = await controlPlane.listModelRoutes();
        const providerKey = existing.providerKeyId
          ? (await controlPlane.listProviderKeys()).find((key) => key.id === existing.providerKeyId)
          : undefined;
        const mappingPriority = input.priority ?? providerKey?.priority ?? 100;
        const mappingEnabled = input.enabled ?? existing.enabled;
        for (const model of input.models) {
          const route = routes.find((item) => item.id === model.id);
          if (route && route.uiMode !== existing.slug) throw new Error(`Model id ${model.id} is already owned by another channel.`);
        }
        const nextModelIds = new Set(input.models.map((model) => model.id));
        await Promise.all(existing.models
          .filter((model) => !nextModelIds.has(model.id))
          .map((model) => controlPlane.updateModelRoute(model.id, { enabled: false })));
        for (const model of input.models) {
          const route = routes.find((item) => item.id === model.id);
          if (route) {
            await controlPlane.updateModelRoute(model.id, {
              label: model.label,
              description: model.description,
              enabled: mappingEnabled,
            });
          } else {
            if (!model.initialUpstreamModel) throw new Error(`An initial upstream model is required for new model ${model.id}.`);
            await controlPlane.createModelRoute({
              id: model.id,
              label: model.label,
              description: model.description,
              uiMode: existing.slug,
              aliases: [],
              enabled: mappingEnabled,
            });
            await controlPlane.replaceModelMappings(model.id, [{
              provider: existing.provider,
              upstreamModel: model.initialUpstreamModel,
              priority: mappingPriority,
              enabled: mappingEnabled,
            }]);
          }
        }
      } else if (input.enabled !== undefined) {
        await Promise.all(existing.models.map((model) => controlPlane.updateModelRoute(model.id, { enabled: input.enabled })));
      }
      const { endpoint: _endpoint, secret: _secret, priority: _priority, models, ...channelPatch } = input;
      const channelModels = models?.map(({ initialUpstreamModel: _initialUpstreamModel, ...model }) => model);
      const channel = await enterprise.updateDynamicChannel(existing.id, {
        ...channelPatch,
        ...(channelModels ? { models: channelModels } : {}),
      });
      return context.json({ data: channel });
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to update dynamic channel." } }, 400);
    }
  });

  app.delete("/admin/dynamic-channels/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const existing = (await enterprise.listDynamicChannels(true)).find((channel) => channel.id === context.req.param("id"));
    if (!existing) return context.json({ error: { message: "Dynamic channel was not found." } }, 404);
    await Promise.all(existing.models.map((model) => controlPlane.updateModelRoute(model.id, { enabled: false })));
    await controlPlane.deleteRoutingPolicy("channel", existing.slug);
    if (existing.providerKeyId) await controlPlane.updateProviderKey(existing.providerKeyId, { status: "disabled" });
    await enterprise.deleteDynamicChannel(existing.id);
    return context.body(null, 204);
  });

  app.get("/admin/user-groups", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const [groups, users] = await Promise.all([enterprise.listUserGroups(), controlPlane.listUsers()]);
    const memberships = Object.fromEntries(await Promise.all(users.map(async (user) => [user.id, await enterprise.getUserGroupIds(user.id)])));
    return context.json({ data: groups, memberships });
  });

  app.post("/admin/user-groups", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = userGroupSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid user group." } }, 400);
    try { return context.json({ data: await enterprise.createUserGroup(parsed.data) }, 201); }
    catch (error) { return context.json({ error: { message: error instanceof Error ? error.message : "Unable to create user group." } }, 400); }
  });

  app.patch("/admin/user-groups/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = userGroupPatchSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid user group update." } }, 400);
    const group = await enterprise.updateUserGroup(context.req.param("id"), parsed.data);
    return group ? context.json({ data: group }) : context.json({ error: { message: "User group was not found." } }, 404);
  });

  app.put("/admin/users/:id/groups", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = userMembershipSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid user group membership." } }, 400);
    await enterprise.setUserGroups(context.req.param("id"), parsed.data.groupIds);
    return context.json({ data: { userId: context.req.param("id"), groupIds: await enterprise.getUserGroupIds(context.req.param("id")) } });
  });

  app.get("/admin/backups", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await enterprise.listBackupDestinations() });
  });

  app.post("/admin/backups", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = backupSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success || !parsed.data.credentials) return context.json({ error: { message: "A valid backup destination and encryption credentials are required." } }, 400);
    const validationError = backupValidationError(parsed.data);
    if (validationError) return context.json({ error: { message: validationError } }, 400);
    try { return context.json({ data: await enterprise.createBackupDestination(parsed.data as BackupDestinationInput) }, 201); }
    catch (error) { return context.json({ error: { message: error instanceof Error ? error.message : "Unable to create backup destination." } }, 400); }
  });

  app.patch("/admin/backups/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = backupSchema.partial().refine((value) => Object.keys(value).length > 0).safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid backup destination update." } }, 400);
    const existingBackup = (await enterprise.listBackupDestinations()).find((item) => item.id === context.req.param("id"));
    if (!existingBackup) return context.json({ error: { message: "Backup destination was not found." } }, 404);
    const validationError = backupValidationError({ ...existingBackup, ...parsed.data });
    if (validationError) return context.json({ error: { message: validationError } }, 400);
    const backup = await enterprise.updateBackupDestination(context.req.param("id"), parsed.data);
    return backup ? context.json({ data: backup }) : context.json({ error: { message: "Backup destination was not found." } }, 404);
  });

  app.delete("/admin/backups/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return await enterprise.deleteBackupDestination(context.req.param("id"))
      ? context.body(null, 204)
      : context.json({ error: { message: "Backup destination was not found." } }, 404);
  });

  const triggerBackup = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = z.object({ configId: z.string().trim().min(1).max(120) }).safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success || !(await enterprise.getBackupExecutionConfig(parsed.data.configId))) {
      return context.json({ error: { message: "A valid backup destination is required." } }, 400);
    }
    return context.json({ data: await enterprise.enqueueJob("backup", { configId: parsed.data.configId }) }, 202);
  };
  app.post("/admin/backups/trigger", triggerBackup);
  app.post("/v1/admin/backups/trigger", triggerBackup);

  const enqueueBuild = async (context: Context, legacyRing?: "beta" | "production") => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = buildSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid Android build request.", details: parsed.error.issues } }, 400);
    try {
      const artifact = await enterprise.createArtifact(parsed.data);
      const betaGroup = legacyRing === "beta" ? (await enterprise.listUserGroups()).find((group) => group.releaseRing === "beta") : undefined;
      const job = await enterprise.enqueueJob("build", {
        artifactId: artifact.id,
        ...parsed.data,
        ...(legacyRing ? { ring: legacyRing, audienceGroupId: betaGroup?.id ?? null } : {}),
      }, 1);
      const tracked = await enterprise.attachArtifactBuildJob(artifact.id, job.id);
      return context.json({ data: { artifactId: artifact.id, jobId: job.id, artifact: tracked ?? artifact, job, payload: job.payload } }, 202);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to queue Android build." } }, 400);
    }
  };
  const queueBuild = (ring: "beta" | "production") => (context: Context) => enqueueBuild(context, ring);
  app.post("/admin/builds", (context) => enqueueBuild(context));
  app.post("/v1/admin/builds", (context) => enqueueBuild(context));
  app.post("/admin/builds/beta", queueBuild("beta"));
  app.post("/v1/admin/builds/beta", queueBuild("beta"));
  app.post("/admin/builds/production", queueBuild("production"));
  app.post("/v1/admin/builds/production", queueBuild("production"));

  const listArtifacts = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await enterprise.listArtifacts() });
  };
  app.get("/admin/artifacts", listArtifacts);
  app.get("/v1/admin/artifacts", listArtifacts);

  const listPipelineReleases = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await enterprise.listReleases() });
  };
  app.get("/admin/releases", listPipelineReleases);
  app.get("/v1/admin/releases", listPipelineReleases);

  const publishArtifact = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = releasePublishSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid release request.", details: parsed.error.issues } }, 400);
    const releaseRing = parsed.data.releaseRing ?? parsed.data.ring!;
    const betaGroup = releaseRing === "beta"
      ? (await enterprise.listUserGroups()).find((group) => group.id === parsed.data.audienceGroupId || group.releaseRing === "beta")
      : undefined;
    try {
      const alreadyPublished = (await enterprise.listReleases()).some((release) => release.artifactId === parsed.data.artifactId && release.releaseRing === releaseRing);
      const release = await enterprise.publishArtifact(parsed.data.artifactId, releaseRing, betaGroup?.id ?? null);
      if (!alreadyPublished) {
        try {
          const [template, smtp] = await Promise.all([
            enterprise.getEmailTemplate("version_update"),
            enterprise.getSmtpDeliveryConfig(),
          ]);
          if (template?.enabled && smtp.enabled) {
            const recipients = releaseRing === "beta"
              ? (betaGroup ? await enterprise.listGroupEmails(betaGroup.id) : [])
              : await enterprise.listGroupEmails();
            const rendered = renderEmailTemplate(template, {
              versionName: release.versionName,
              releaseNotes: release.releaseNotes,
              downloadUrl: release.downloadUrl,
            });
            await Promise.all(recipients.map((to) => enterprise.enqueueJob("email", { to, ...rendered })));
          }
        } catch (error) {
          console.error("Unable to queue release notifications", error);
        }
      }
      return context.json({ data: release }, alreadyPublished ? 200 : 201);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to publish artifact." } }, 409);
    }
  };
  app.post("/admin/releases", publishArtifact);
  app.post("/v1/admin/releases", publishArtifact);

  const archiveRelease = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const release = await enterprise.getRelease(context.req.param("id") ?? "");
    if (!release) return context.json({ error: { message: "Release was not found." } }, 404);
    if (release.status === "archived") return context.json({ data: release });
    try {
      const job = await enterprise.enqueueJob("archive", { releaseId: release.id }, 1);
      return context.json({ data: { release, job } }, 202);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to queue release archive." } }, 400);
    }
  };
  app.post("/admin/releases/:id/archive", archiveRelease);
  app.post("/v1/admin/releases/:id/archive", archiveRelease);

  app.get("/admin/jobs", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await enterprise.listJobs() });
  });

  const streamJobLogs = async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const jobId = context.req.param("id") ?? "";
    if (!(await enterprise.getJob(jobId))) return context.json({ error: { message: "Job was not found." } }, 404);
    return streamSSE(context, async (stream) => {
      let offset = 0;
      let lastStatus = "";
      while (!context.req.raw.signal.aborted) {
        const job = await enterprise.getJob(jobId);
        if (!job) break;
        for (const line of job.logs.slice(offset)) await stream.writeSSE({ event: "log", data: line });
        offset = job.logs.length;
        if (job.status !== lastStatus) {
          lastStatus = job.status;
          await stream.writeSSE({ event: "status", data: JSON.stringify({ status: job.status, error: job.error, result: job.result }) });
        }
        if (["succeeded", "failed"].includes(job.status)) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
    });
  };
  app.get("/admin/jobs/:id/stream", streamJobLogs);
  app.get("/v1/admin/jobs/:id/stream", streamJobLogs);

  app.notFound((context) => context.json({ error: { message: "Route not found." } }, 404));
  app.onError((error, context) => {
    console.error("API request failed", error);
    return context.json({ error: { message: "The server could not complete the request." } }, 500);
  });
  return app;
}

export async function startServer() {
  // Enterprise tables reference the core routing/user tables, so bootstrap them in order.
  const controlPlane = await createPostgresControlPlane();
  const [enterpriseStore, conversationStore] = await Promise.all([
    createPostgresEnterpriseStore(),
    createPostgresConversationStore(),
  ]);
  const app = createApp({ controlPlane, enterpriseStore, conversationStore });
  const port = Number(process.env.API_PORT ?? 8787);
  const server = serve({ fetch: app.fetch, port });
  console.log(`Adaptive Chat API listening on http://localhost:${port}`);
  const shutdown = async () => {
    server.close();
    await Promise.all([controlPlane.close(), enterpriseStore.close(), conversationStore.close()]);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startServer().catch((error) => {
    console.error("Unable to start Adaptive Chat API", error);
    process.exitCode = 1;
  });
}

export default createApp();
