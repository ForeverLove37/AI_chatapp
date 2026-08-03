import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  createPostgresControlPlane,
  MemoryControlPlane,
  type ControlPlane,
  type RequestMetric,
  type RoutingScope,
  type SelectedUpstream,
} from "./control-plane.js";
import { issueSessionToken, verifySessionToken } from "./auth.js";
import { publicRemoteConfig, type LoadBalanceStrategy, type ModelRoute } from "./catalog.js";

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
  status: z.enum(["active", "suspended"]).optional(),
  role: z.enum(["admin", "standard"]).optional(),
  rpmLimit: z.number().int().min(1).max(10_000).optional(),
  dailyLimit: z.number().int().min(1).max(10_000_000).optional(),
}).refine((value) => Object.keys(value).length > 0);

const providerKeySchema = z.object({
  provider: z.enum(["openai", "gemini", "deepseek"]),
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
  provider: z.enum(["openai", "gemini", "deepseek"]),
  upstreamModel: z.string().trim().min(1).max(256),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
  uiMode: z.enum(["chatgpt", "gemini", "deepseek"]),
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
const feedbackPatchSchema = z.object({ status: z.enum(["new", "reviewed", "resolved"]) });
const appVersionCreateSchema = z.object({
  versionCode: z.number().int().min(1).max(10_000_000),
  versionName: z.string().trim().min(1).max(80),
  downloadUrl: z.url().max(1_000),
  releaseNotes: z.string().max(8_000).default(""),
  isActive: z.boolean().default(true),
});
const appVersionPatchSchema = appVersionCreateSchema.omit({ versionCode: true }).partial().refine((value) => Object.keys(value).length > 0);

type ChatRequest = z.infer<typeof chatRequestSchema>;

export type CreateAppOptions = {
  controlPlane?: ControlPlane;
  demoMode?: boolean;
  requireClientAuth?: boolean;
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

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono();
  const controlPlane = options.controlPlane ?? new MemoryControlPlane();
  const startedAt = Date.now();
  const demoMode = () => options.demoMode ?? flag(process.env.DEMO_MODE, true);
  const adminKey = () => process.env.ADMIN_API_KEY ?? "dev-admin-key";
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use("*", cors({
    origin: (origin) => !origin || allowedOrigins.includes(origin) ? origin || allowedOrigins[0] : "",
    allowHeaders: ["Authorization", "Content-Type", "X-Admin-Key"],
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

  app.get("/v1/config", async (context) => context.json(publicRemoteConfig(await controlPlane.getModels())));

  app.post("/v1/auth/login", async (context) => {
    const parsed = loginSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Email and password are required." } }, 400);
    const user = await controlPlane.authenticateUser(parsed.data.email, parsed.data.password);
    if (!user) return context.json({ error: { message: "Invalid email or password." } }, 401);
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
    const latest = await controlPlane.getLatestAppVersion();
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

  app.post("/v1/chat/completions", async (context) => {
    const policy = await enforceClientPolicy(context);
    if ("response" in policy) return policy.response;

    const payload = await context.req.json().catch(() => undefined);
    const parsed = chatRequestSchema.safeParse(payload);
    if (!parsed.success) return context.json({ error: { message: "Invalid chat completion request.", details: parsed.error.issues } }, 400);

    const request = parsed.data;
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
      return context.json({ data: await controlPlane.createUser(parsed.data) }, 201);
    } catch (error) {
      return context.json({ error: { message: error instanceof Error ? error.message : "Unable to create user." } }, 400);
    }
  });

  app.patch("/admin/users/:id", async (context) => {
    if (!requireAdmin(context)) return context.json({ error: { message: "Administrator authorization required." } }, 401);
    const parsed = userPatchSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return context.json({ error: { message: "Invalid user update.", details: parsed.error.issues } }, 400);
    const user = await controlPlane.updateUser(context.req.param("id"), parsed.data);
    return user ? context.json({ data: user }) : context.json({ error: { message: "User was not found." } }, 404);
  });

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
    return context.json(publicRemoteConfig(await controlPlane.getModels()));
  });

  app.notFound((context) => context.json({ error: { message: "Route not found." } }, 404));
  app.onError((error, context) => {
    console.error("API request failed", error);
    return context.json({ error: { message: "The server could not complete the request." } }, 500);
  });
  return app;
}

export async function startServer() {
  const controlPlane = await createPostgresControlPlane();
  const app = createApp({ controlPlane });
  const port = Number(process.env.API_PORT ?? 8787);
  const server = serve({ fetch: app.fetch, port });
  console.log(`Adaptive Chat API listening on http://localhost:${port}`);
  const shutdown = async () => {
    server.close();
    await controlPlane.close();
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
