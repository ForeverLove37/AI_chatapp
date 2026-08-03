import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { CronExpressionParser } from "cron-parser";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { z } from "zod";
import {
  createPostgresControlPlane,
  MemoryControlPlane,
  type ControlPlane,
  type RequestMetric,
  type RoutingScope,
  type SelectedUpstream,
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
  buildSearchGroundingMessage,
  executeWebSearch,
  extractLatestUserQuery,
  injectSearchGrounding,
  SearchUnavailableError,
  type WebSearchResponse,
} from "./search.js";

const contentSchema = z.union([z.string(), z.array(z.unknown()), z.null()]).optional();
const chatRequestSchema = z.object({
  model: z.string().trim().min(1).max(120).default("chatgpt-lite"),
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
  role: z.enum(["admin", "standard"]).default("standard"),
  status: z.enum(["active", "suspended"]).default("active"),
  rpmLimit: z.number().int().min(1).max(10_000).default(60),
  dailyLimit: z.number().int().min(1).max(10_000_000).default(100_000),
});

const userPatchSchema = z.object({
  password: z.string().min(8).max(200).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  role: z.enum(["admin", "standard"]).optional(),
  rpmLimit: z.number().int().min(1).max(10_000).optional(),
  dailyLimit: z.number().int().min(1).max(10_000_000).optional(),
}).refine((value) => Object.keys(value).length > 0);

const providerKeySchema = z.object({
  provider: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),
  label: z.string().trim().min(2).max(120),
  endpoint: z.url().max(1_000),
  secret: z.string().trim().min(1).max(8_000),
  priority: z.number().int().min(0).max(100_000).default(100),
});

const providerKeyPatchSchema = z.object({
  label: z.string().trim().min(2).max(120).optional(),
  endpoint: z.url().max(1_000).optional(),
  secret: z.string().trim().min(1).max(8_000).optional(),
  priority: z.number().int().min(0).max(100_000).optional(),
  status: z.enum(["active", "disabled"]).optional(),
}).refine((value) => Object.keys(value).length > 0);

const modelRouteCreateSchema = z.object({
  id: z.string().trim().min(2).max(120).regex(/^[a-z0-9][a-z0-9._-]*$/),
  provider: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),
  upstreamModel: z.string().trim().min(1).max(256),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
  uiMode: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),
  aliases: z.array(z.string().trim().min(1).max(120)).max(24).default([]),
  enabled: z.boolean().default(true),
});

const modelRoutePatchSchema = modelRouteCreateSchema.omit({ id: true, uiMode: true }).partial().extend({
  enabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0);

const routingSchema = z.object({ strategy: z.enum(["round_robin", "random"]) });
const routingPolicySchema = z.object({
  keyIds: z.array(z.string().trim().min(1).max(120)).min(1).max(32),
});
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
const dynamicModelSchema = z.object({
  id: z.string().trim().min(2).max(120).regex(/^[a-z0-9][a-z0-9._-]*$/),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
  upstreamModel: z.string().trim().min(1).max(256),
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
  appIconDataUrl: z.union([
    z.literal(""),
    z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).max(4_000_000),
  ]).default(""),
  customCss: z.string().max(50_000).default(""),
  backgroundStart: colorSchema,
  backgroundEnd: colorSchema,
  accentColor: colorSchema,
  textColor: colorSchema,
  surfaceColor: colorSchema,
  typography: z.enum(["sans", "serif", "mono"]).default("sans"),
  animatedGradient: z.boolean().default(false),
  models: z.array(dynamicModelSchema).min(1).max(12)
    .refine((models) => new Set(models.map((model) => model.id)).size === models.length, "Model ids must be unique within a channel."),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
});
const dynamicChannelPatchSchema = dynamicChannelSchema.partial().refine((value) => Object.keys(value).length > 0);
const searchProviderSchema = z.object({
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
  displayName: z.string().trim().min(1).max(120),
  kind: z.enum(["duckduckgo", "tavily", "serpapi"]),
  endpoint: z.url().max(2_000),
  apiKey: z.string().trim().max(8_000).optional(),
  priority: z.number().int().min(0).max(100_000).default(100),
  maxResults: z.number().int().min(1).max(10).default(5),
  enabled: z.boolean().default(false),
});
const searchProviderPatchSchema = searchProviderSchema.partial().refine((value) => Object.keys(value).length > 0);
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
  versionCode: z.number().int().min(1).max(10_000_000),
  versionName: z.string().trim().min(1).max(80),
  releaseNotes: z.string().max(8_000).default(""),
});

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
  demoMode?: boolean;
  requireClientAuth?: boolean;
  synthesizeSpeech?: (input: string, voice: string) => Promise<Uint8Array>;
  executeSearch?: (providers: SearchProviderExecutionConfig[], query: string) => Promise<WebSearchResponse>;
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

function ssePayload(model: string, delta: Record<string, string>, finishReason: string | null = null) {
  return JSON.stringify({
    id: `chatcmpl_${randomUUID().replaceAll("-", "")}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
}

function chunks(value: string, size = 18): string[] {
  const result: string[] = [];
  for (let offset = 0; offset < value.length; offset += size) result.push(value.slice(offset, offset + size));
  return result.length ? result : [""];
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const EDGE_TTS_TIMEOUT_MS = 12_000;
const MAX_TTS_BYTES = 8 * 1024 * 1024;
const defaultEdgeVoice = "en-US-AriaNeural";

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
  if (route.provider === "deepseek") {
    return {
      reasoning: `I will identify the useful part of the request, keep the response scoped, and state the result clearly for: ${concisePrompt}.`,
      content: `Here is a concise DeepSeek-style response to: ${concisePrompt}\n\nThe local demo stream is working. Configure a persistent upstream key pool to route this request to a production model.`,
    };
  }
  return {
    content: `${route.provider === "gemini" ? "Gemini-style" : "ChatGPT-style"} response to: ${concisePrompt}\n\nThe API relay is streaming this response locally.`,
  };
}

async function fetchUpstream(upstreams: SelectedUpstream[], body: Record<string, unknown>): Promise<Response> {
  let lastError: unknown;
  for (const upstream of upstreams) {
    try {
      const response = await fetch(upstream.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${upstream.secret}`,
          "Content-Type": "application/json",
          Accept: body.stream ? "text/event-stream" : "application/json",
        },
        body: JSON.stringify(body),
      });
      if (response.ok || response.status < 500) return response;
      lastError = new Error(`Upstream returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No upstream provider responded");
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
  const startedAt = Date.now();
  const demoMode = () => options.demoMode ?? flag(process.env.DEMO_MODE, true);
  const adminKey = () => process.env.ADMIN_API_KEY ?? "dev-admin-key";
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use("*", cors({
    origin: (origin) => !origin || allowedOrigins.includes(origin) ? origin || allowedOrigins[0] : "",
    allowHeaders: ["Authorization", "Content-Type", "X-Admin-Key", "X-Web-Search"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
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

  async function enforceClientPolicy(context: Context) {
    if (!(options.requireClientAuth ?? flag(process.env.REQUIRE_CLIENT_AUTH, false))) return { clientKeyId: null, userId: null };
    const token = requestBearer(context.req.header("authorization"));
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
    const authorization = await controlPlane.authorizeUser(session.sub);
    if (!authorization.allowed) return { response: context.json({ error: { message: authorization.message } }, authorization.status) };
    return { userId: authorization.userId };
  }

  function clientAddress(context: Context) {
    return context.req.header("x-real-ip")
      ?? context.req.header("cf-connecting-ip")
      ?? context.req.header("x-forwarded-for")?.split(",")[0]?.trim()
      ?? "unknown";
  }

  async function remoteConfig() {
    const [routes, dynamicChannels] = await Promise.all([
      controlPlane.getModels(),
      enterprise.listDynamicChannels(),
    ]);
    const channels: RemoteChannel[] = dynamicChannels.map((channel) => ({
      id: channel.slug,
      displayName: channel.displayName,
      description: channel.description,
      icon: { type: channel.iconDataUrl ? "data_url" : "builtin", value: channel.iconDataUrl || channel.slug },
      appIconUrl: channel.appIconDataUrl ? `/v1/config/app-icons/${encodeURIComponent(channel.slug)}` : "",
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
    return publicRemoteConfig(routes, channels);
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
    if (parsed.data.enabled && parsed.data.kind !== "duckduckgo" && !parsed.data.apiKey) {
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
    if (enabled && kind !== "duckduckgo" && !keyConfigured) {
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
    const models = await controlPlane.getModels();
    const configured = await Promise.all(models.map(async (model) => (await canUseRoute(model) ? model.provider : undefined)));
    const overview = await controlPlane.getOverview();
    return context.json({
      status: "ok",
      mode: demoMode() ? "demo" : "relay",
      storage: overview.storage,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000),
      activeStreams: overview.activeStreams,
      configuredProviders: [...new Set(configured.filter(Boolean))],
    });
  });

  app.get("/v1/models", async (context) => {
    const models = await controlPlane.getModels();
    return context.json({
      object: "list",
      data: models.map((model) => ({ id: model.id, object: "model", created: 0, owned_by: model.provider })),
    });
  });

  app.get("/v1/config", async (context) => context.json(await remoteConfig()));

  app.get("/v1/config/app-icons/:slug", async (context) => {
    const channel = (await enterprise.listDynamicChannels()).find((item) => item.slug === context.req.param("slug"));
    const image = channel ? decodeRasterDataUrl(channel.appIconDataUrl) : undefined;
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
      user,
    });
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
    const webSearchEnabled = flag(context.req.header("x-web-search"), false);
    if (webSearchEnabled) {
      try {
        const query = extractLatestUserQuery(request.messages);
        const search = await (options.executeSearch ?? executeWebSearch)(
          await enterprise.listSearchExecutionConfigs(),
          query,
        );
        request = {
          ...request,
          messages: injectSearchGrounding(request.messages, buildSearchGroundingMessage(search)) as ChatRequest["messages"],
        };
      } catch (error) {
        const message = error instanceof SearchUnavailableError
          ? error.message
          : error instanceof Error ? error.message : "Web search failed.";
        return context.json({ error: { code: "web_search_unavailable", message } }, 502);
      }
    }
    const route = await controlPlane.findModelRoute(request.model);
    if (!route) return context.json({ error: { message: `Unknown or disabled model: ${request.model}` } }, 404);
    const requestStartedAt = Date.now();
    const promptTokens = estimateTokens(request.messages);
    const makeMetric = (status: RequestMetric["status"], completionTokens = 0): RequestMetric => ({
      model: route.id,
      provider: route.provider,
      clientKeyId: policy.clientKeyId,
      userId: policy.userId,
      status,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - requestStartedAt,
    });

    if (demoMode()) {
      const answer = demoAnswer(request, route);
      const completionTokens = Math.ceil(((answer.reasoning?.length ?? 0) + answer.content.length) / 4);
      if (!request.stream) {
        await record(makeMetric("success", completionTokens));
        return context.json({
          id: `chatcmpl_${randomUUID().replaceAll("-", "")}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1_000),
          model: route.id,
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
              await delay(streamDelay);
            }
          }
          for (const piece of chunks(answer.content)) {
            await stream.writeSSE({ data: ssePayload(route.id, { content: piece }) });
            await delay(streamDelay);
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

    const upstreams = await resolveUpstreams(route);
    if (!upstreams.length) {
      await record(makeMetric("failure"));
      return context.json({ error: { message: `No ${route.provider} upstream is configured. Add an active provider key and routing policy in the admin console.` } }, 503);
    }

    try {
      const response = await fetchUpstream(upstreams, { ...request, model: route.upstreamModel });
      if (!request.stream) {
        const contentType = response.headers.get("content-type") ?? "application/json";
        const body = await response.text();
        const usage = usageFromBody(body);
        await record(makeMetric(response.ok ? "success" : "failure", response.ok ? usage.completionTokens : 0));
        return new Response(body, { status: response.status, headers: { "Content-Type": contentType } });
      }
      if (!response.ok || !response.body) {
        await record(makeMetric("failure"));
        return context.json({ error: { message: `Upstream returned HTTP ${response.status}` } }, 502);
      }

      await controlPlane.changeActiveStreams(1);
      let finalized = false;
      const finalize = async (status: RequestMetric["status"]) => {
        if (finalized) return;
        finalized = true;
        await controlPlane.changeActiveStreams(-1);
        await record(makeMetric(status));
      };
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) { controller.enqueue(chunk); },
        async flush() { await finalize("success"); },
      }));
      return new Response(body, {
        status: response.status,
        headers: {
          "Content-Type": response.headers.get("content-type") ?? "text/event-stream",
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
    const parsed = providerKeySchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid provider key request.", details: parsed.error.issues } }, 400);
    try {
      return context.json({ data: await controlPlane.createProviderKey(parsed.data) }, 201);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to save provider key." } }, 400);
    }
  });

  app.patch("/admin/provider-keys/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = providerKeyPatchSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid provider key update.", details: parsed.error.issues } }, 400);
    try {
      const key = await controlPlane.updateProviderKey(context.req.param("id"), parsed.data);
      return key ? context.json({ data: key }) : context.json({ error: { message: "Provider key was not found." } }, 404);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to update provider key." } }, 400);
    }
  });

  app.get("/admin/models", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await controlPlane.listModelRoutes() });
  });

  app.post("/admin/models", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = modelRouteCreateSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid model mapping.", details: parsed.error.issues } }, 400);
    try {
      return context.json({ data: await controlPlane.createModelRoute(parsed.data) }, 201);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to create model mapping." } }, 400);
    }
  });

  app.patch("/admin/models/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = modelRoutePatchSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid model mapping update.", details: parsed.error.issues } }, 400);
    const model = await controlPlane.updateModelRoute(context.req.param("id"), parsed.data);
    return model ? context.json({ data: model }) : context.json({ error: { message: "Model mapping was not found." } }, 404);
  });

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

  app.post("/admin/dynamic-channels", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = dynamicChannelSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success || !parsed.data.endpoint || !parsed.data.secret) {
      return context.json({ error: { message: "A valid channel, upstream endpoint, and API key are required.", details: parsed.success ? undefined : parsed.error.issues } }, 400);
    }
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
      });
      for (const model of input.models) {
        await controlPlane.createModelRoute({ ...model, provider: input.provider, uiMode: input.slug, aliases: [], enabled: input.enabled });
      }
      await controlPlane.setRoutingPolicy("channel", input.slug, [key.id]);
      const { endpoint: _endpoint, secret: _secret, priority: _priority, ...channelInput } = input;
      const channel = await enterprise.createDynamicChannel({ ...channelInput, providerKeyId: key.id });
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
              provider: existing.provider,
              upstreamModel: model.upstreamModel,
              label: model.label,
              description: model.description,
              enabled: input.enabled ?? existing.enabled,
            });
          } else {
            await controlPlane.createModelRoute({
              ...model,
              provider: existing.provider,
              uiMode: existing.slug,
              aliases: [],
              enabled: input.enabled ?? existing.enabled,
            });
          }
        }
      } else if (input.enabled !== undefined) {
        await Promise.all(existing.models.map((model) => controlPlane.updateModelRoute(model.id, { enabled: input.enabled })));
      }
      const { endpoint: _endpoint, secret: _secret, priority: _priority, ...channelPatch } = input;
      const channel = await enterprise.updateDynamicChannel(existing.id, channelPatch);
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

  const queueBuild = (ring: "beta" | "production") => async (context: Context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = buildSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid Android build request." } }, 400);
    const betaGroup = ring === "beta" ? (await enterprise.listUserGroups()).find((group) => group.releaseRing === "beta") : undefined;
    const job = await enterprise.enqueueJob("build", {
      ...parsed.data,
      ring,
      audienceGroupId: betaGroup?.id ?? null,
    }, 1);
    return context.json({ data: job }, 202);
  };
  const queueBetaBuild = queueBuild("beta");
  const queueProductionBuild = queueBuild("production");
  app.post("/admin/builds/beta", queueBetaBuild);
  app.post("/v1/admin/builds/beta", queueBetaBuild);
  app.post("/admin/builds/production", queueProductionBuild);
  app.post("/v1/admin/builds/production", queueProductionBuild);

  app.get("/admin/jobs", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    return context.json({ data: await enterprise.listJobs() });
  });

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
  const enterpriseStore = await createPostgresEnterpriseStore();
  const app = createApp({ controlPlane, enterpriseStore });
  const port = Number(process.env.API_PORT ?? 8787);
  const server = serve({ fetch: app.fetch, port });
  console.log(`Adaptive Chat API listening on http://localhost:${port}`);
  const shutdown = async () => {
    server.close();
    await Promise.all([controlPlane.close(), enterpriseStore.close()]);
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
