import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./index.js";
import { MemoryEnterpriseStore } from "./enterprise.js";
import { MemoryControlPlane } from "./control-plane.js";
import { SearchUnavailableError } from "./search.js";

describe("Adaptive Chat API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("supports multiple prioritized upstream mappings for one internal model", async () => {
    const control = new MemoryControlPlane();
    const first = await control.createProviderKey({ provider: "openai", label: "Provider A", endpoint: "https://a.example.test/v1", secret: "a-secret", priority: 1, bypassAuth: false });
    const second = await control.createProviderKey({ provider: "gemini", label: "Provider B", endpoint: "https://b.example.test/v1", secret: "b-secret", priority: 1, bypassAuth: false });
    await control.replaceModelMappings("deepseek-expert", [
      { provider: "openai", upstreamModel: "provider-a-expert", priority: 10, enabled: true },
      { provider: "gemini", upstreamModel: "provider-b-expert", priority: 20, enabled: true },
    ]);
    const route = await control.findModelRoute("deepseek-expert");
    expect(route).toBeDefined();
    const selected = await control.selectUpstreams(route!);
    expect(selected.map((item) => item.keyId)).toEqual([first.id, second.id]);
    expect(selected.map((item) => item.upstreamModel)).toEqual(["provider-a-expert", "provider-b-expert"]);
  });

  it("exposes only grouped array-based mapping administration", async () => {
    const app = createApp();
    const headers = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    expect((await app.request("/v1/admin/mappings")).status).toBe(401);

    const initial = await app.request("/v1/admin/mappings", { headers });
    expect(initial.status).toBe(200);
    const initialGroups = (await initial.json()).data as Array<{ model: { id: string }; mappings: Array<{ provider: string; upstreamModel: string }> }>;
    expect(initialGroups.find((group) => group.model.id === "chatgpt-lite")?.mappings).toHaveLength(1);

    const replaced = await app.request("/v1/admin/mappings/chatgpt-lite", {
      method: "PUT",
      headers,
      body: JSON.stringify({ mappings: [
        { provider: "openai", upstreamModel: "gpt-primary", priority: 10, enabled: true },
        { provider: "gemini", upstreamModel: "gemini-fallback", priority: 20, enabled: true },
      ] }),
    });
    expect(replaced.status).toBe(200);
    expect((await replaced.json()).data.mappings).toMatchObject([
      { provider: "openai", upstreamModel: "gpt-primary", priority: 10 },
      { provider: "gemini", upstreamModel: "gemini-fallback", priority: 20 },
    ]);

    const invalid = await app.request("/v1/admin/mappings/chatgpt-lite", {
      method: "PUT",
      headers,
      body: JSON.stringify({ mappings: [] }),
    });
    expect(invalid.status).toBe(400);
    const unchanged = await app.request("/admin/mappings", { headers });
    expect((await unchanged.json()).data.find((group: { model: { id: string }; mappings: unknown[] }) => group.model.id === "chatgpt-lite").mappings).toHaveLength(2);

    expect((await app.request("/admin/models", { headers })).status).toBe(404);
    expect((await app.request("/admin/model-mappings", { headers })).status).toBe(404);
  });

  it("serves the advertised models and remote configuration", async () => {
    const app = createApp();
    const models = await app.request("/v1/models");
    const config = await app.request("/v1/config");

    expect(models.status).toBe(200);
    const advertised = (await models.json()).data.map((model: { id: string }) => model.id);
    expect(advertised).toEqual(expect.arrayContaining([
      "chatgpt-lite",
      "chatgpt-standard",
      "chatgpt-pro",
      "gemini-flash",
      "gemini-standard",
      "gemini-extended",
      "deepseek-flash",
      "deepseek-expert",
    ]));
    expect(config.status).toBe(200);
    const configPayload = await config.json();
    expect(configPayload.featureFlags.reasoningBlocks).toBe(true);
    expect(configPayload.models[0]).not.toHaveProperty("defaultMapping");
    expect(configPayload.models[0]).not.toHaveProperty("upstreamModel");
  });

  it("publishes no-code channels through config without exposing upstream credentials", async () => {
    const app = createApp();
    const headers = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    const create = await app.request("/admin/dynamic-channels", {
      method: "POST",
      headers,
      body: JSON.stringify({
        slug: "qwen",
        displayName: "Qwen",
        description: "Enterprise Qwen channel",
        provider: "qwen",
        endpoint: "https://qwen.example.test/v1",
        secret: "qwen-server-only-secret",
        priority: 20,
        iconDataUrl: "",
        backgroundStart: "#FFF3A6",
        backgroundEnd: "#FFE066",
        accentColor: "#B7791F",
        textColor: "#2D2600",
        surfaceColor: "#FFFFFF",
        typography: "sans",
        animatedGradient: true,
        models: [{ id: "qwen-standard", label: "Standard", description: "Balanced", initialUpstreamModel: "qwen-max" }],
        enabled: true,
        sortOrder: 40,
      }),
    });
    expect(create.status).toBe(201);
    const createText = await create.text();
    expect(createText).not.toContain("qwen-server-only-secret");
    expect(createText).not.toContain("qwen-max");
    const channelId = JSON.parse(createText).data.id as string;

    const config = await app.request("/v1/config");
    const payload = await config.json();
    expect(payload.version).toBe(5);
    expect(payload.channels.find((channel: { id: string }) => channel.id === "qwen")).toMatchObject({
      displayName: "Qwen",
      style: { backgroundStart: "#FFF3A6", animatedGradient: true },
      models: [{ id: "qwen-standard", label: "Standard" }],
    });
    expect(JSON.stringify(payload)).not.toContain("qwen-max");
    expect(JSON.stringify(payload)).not.toContain("qwen-server-only-secret");

    const immutableProvider = await app.request(`/admin/dynamic-channels/${channelId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ provider: "different-provider" }),
    });
    expect(immutableProvider.status).toBe(409);

    const configureMultiple = await app.request("/admin/mappings/qwen-standard", {
      method: "PUT",
      headers,
      body: JSON.stringify({ mappings: [
        { provider: "qwen", upstreamModel: "qwen-max", priority: 10, enabled: true },
        { provider: "qwen", upstreamModel: "qwen-fallback", priority: 20, enabled: true },
      ] }),
    });
    expect(configureMultiple.status).toBe(200);
    const styleUpdate = await app.request(`/admin/dynamic-channels/${channelId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        accentColor: "#A16207",
        models: [{ id: "qwen-standard", label: "Standard", description: "Balanced" }],
      }),
    });
    expect(styleUpdate.status).toBe(200);
    const preserved = await app.request("/admin/mappings", { headers });
    expect((await preserved.json()).data.find((group: { model: { id: string }; mappings: unknown[] }) => group.model.id === "qwen-standard").mappings).toHaveLength(2);

    const replaceModel = await app.request(`/admin/dynamic-channels/${channelId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        models: [{ id: "qwen-expert", label: "Expert", description: "Deep analysis", initialUpstreamModel: "qwen-max" }],
      }),
    });
    expect(replaceModel.status).toBe(200);
    const mappings = await app.request("/admin/mappings", { headers });
    expect((await mappings.json()).data.find((group: { model: { id: string; enabled: boolean } }) => group.model.id === "qwen-standard").model.enabled).toBe(false);
    const updatedConfig = await app.request("/v1/config");
    expect((await updatedConfig.json()).channels.find((channel: { id: string }) => channel.id === "qwen").models)
      .toEqual([{ id: "qwen-expert", label: "Expert", description: "Deep analysis" }]);
  });

  it("manages one global launcher icon independently from dynamic channels", async () => {
    const enterprise = new MemoryEnterpriseStore();
    const app = createApp({ enterpriseStore: enterprise });
    const headers = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    expect((await app.request("/admin/launcher-icon")).status).toBe(401);
    const saved = await app.request("/admin/launcher-icon", {
      method: "PUT",
      headers,
      body: JSON.stringify({ dataUrl }),
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()).data).toMatchObject({ dataUrl });
    expect(await enterprise.listDynamicChannels(true)).toEqual([]);

    const image = await app.request("/v1/config/launcher-icon");
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("manages prioritized search providers without exposing API keys", async () => {
    const app = createApp();
    const headers = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    const seeded = await app.request("/v1/admin/search-providers", { headers });
    expect(seeded.status).toBe(200);
    expect((await seeded.json()).data.map((item: { kind: string }) => item.kind))
      .toEqual(expect.arrayContaining(["duckduckgo", "bing_rss", "tavily", "serpapi"]));

    const created = await app.request("/v1/admin/search-providers", {
      method: "POST",
      headers,
      body: JSON.stringify({
        slug: "tavily-backup",
        displayName: "Tavily Backup",
        kind: "tavily",
        endpoint: "https://api.tavily.com/search",
        apiKey: "private-search-key",
        priority: 50,
        maxResults: 4,
        enabled: true,
      }),
    });
    expect(created.status).toBe(201);
    const responseText = await created.text();
    expect(responseText).not.toContain("private-search-key");
    expect(JSON.parse(responseText).data.apiKeyConfigured).toBe(true);
  });

  it("injects web results into an otherwise standard OpenAI request", async () => {
    const upstream = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        stream: boolean;
        messages: Array<{ role: string; content: string }>;
        tools?: unknown[];
      };
      if (upstream.mock.calls.length === 1) {
        expect(body.stream).toBe(false);
        expect(body.tools).toHaveLength(1);
        return new Response(JSON.stringify({ error: { message: "Tools are not supported." } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      expect(body.messages.map((message) => message.role)).toEqual(["system", "user"]);
      expect(body.messages[0].content).toContain("untrusted external evidence");
      expect(body.messages[0].content).toContain("https://news.example.test/current");
      expect(body).not.toHaveProperty("web_search");
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Grounded answer" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstream);
    const app = createApp({
      demoMode: false,
      executeSearch: async (_providers, query) => ({
        providerId: "search_test",
        providerName: "Test Search",
        query,
        results: [{ title: "Current report", url: "https://news.example.test/current", snippet: "Current verified report" }],
      }),
    });
    const adminHeaders = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    await app.request("/admin/provider-keys", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ provider: "openai", label: "Test upstream", endpoint: "https://llm.example.test/chat", secret: "llm-key", priority: 1 }),
    });
    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Web-Search": "true" },
      body: JSON.stringify({ model: "chatgpt-lite", messages: [{ role: "user", content: "What happened today?" }] }),
    });
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("keeps internal tool calls out of the final SSE stream and appends a terminal event", async () => {
    const upstream = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        stream: boolean;
        messages: Array<Record<string, unknown>>;
        tool_choice?: string;
      };
      if (upstream.mock.calls.length === 1) {
        expect(body.stream).toBe(false);
        return new Response(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call_gateway_search",
                type: "function",
                function: { name: "web_search", arguments: JSON.stringify({ query: "verified current status" }) },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      expect(body.stream).toBe(true);
      expect(body.tool_choice).toBe("none");
      expect(body.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
      expect(String(body.messages[2].content)).toContain("https://source.example.test/status");
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"Ground"));
          controller.enqueue(encoder.encode("ed response\"},\"finish_reason\":null}]}\n\n"));
          controller.close();
        },
      }), { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", upstream);
    const executeSearch = vi.fn()
      .mockRejectedValueOnce(new SearchUnavailableError(["generated query returned no results"]))
      .mockResolvedValueOnce({
        providerId: "search_test",
        providerName: "Test Search",
        query: "Check status",
        results: [{ title: "Current status", url: "https://source.example.test/status", snippet: "Verified status" }],
      });
    const app = createApp({
      demoMode: false,
      executeSearch,
    });
    const adminHeaders = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    await app.request("/admin/provider-keys", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ provider: "openai", label: "SSE upstream", endpoint: "https://llm.example.test/chat", secret: "llm-key", priority: 1 }),
    });
    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Web-Search": "true" },
      body: JSON.stringify({ model: "chatgpt-lite", stream: true, messages: [{ role: "user", content: "Check status" }] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const stream = await response.text();
    expect(stream).toContain("Grounded response");
    expect(stream).toContain("data: [DONE]");
    expect(stream).not.toContain("call_gateway_search");
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(executeSearch).toHaveBeenNthCalledWith(1, expect.any(Array), "verified current status");
    expect(executeSearch).toHaveBeenNthCalledWith(2, expect.any(Array), "Check status");
  });

  it("synchronizes user-owned conversations and cascades paired response deletion", async () => {
    const app = createApp();
    const adminHeaders = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    await app.request("/admin/users", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        email: "sync@example.test",
        password: "synchronized-password",
        role: "standard",
        rpmLimit: 60,
        dailyLimit: 1_000,
      }),
    });
    const login = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "sync@example.test", password: "synchronized-password" }),
    });
    const token = (await login.json()).token as string;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const createdAt = 1_800_000_000_000;
    const snapshot = {
      id: "session-sync-test",
      title: "Shared history",
      channelId: "deepseek",
      modelId: "deepseek-expert",
      systemPrompt: "Be precise.",
      createdAt,
      updatedAt: createdAt + 10,
      messages: [
        {
          id: "message-user",
          role: "user",
          content: "Explain the result",
          attachments: [],
          reasoning: "",
          modelId: "",
          errorText: "",
          parentMessageId: null,
          createdAt: createdAt + 1,
          updatedAt: createdAt + 1,
        },
        {
          id: "message-assistant",
          role: "assistant",
          content: "The result is synchronized.",
          attachments: [],
          reasoning: "Checked the constraints.",
          modelId: "deepseek-expert",
          errorText: "",
          parentMessageId: "message-user",
          createdAt: createdAt + 2,
          updatedAt: createdAt + 2,
        },
      ],
    };
    expect((await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify(snapshot) })).status).toBe(201);
    const synchronized = await app.request("/v1/sessions", { headers });
    expect((await synchronized.json()).data[0]).toMatchObject({
      id: "session-sync-test",
      messages: [
        { id: "message-user", role: "user" },
        { id: "message-assistant", role: "assistant", parentMessageId: "message-user" },
      ],
    });

    const deletion = await app.request("/v1/messages/message-user", { method: "DELETE", headers });
    expect(deletion.status).toBe(200);
    expect((await deletion.json()).data.deletedIds.sort()).toEqual(["message-assistant", "message-user"]);
    const afterDelete = await app.request("/v1/sessions/session-sync-test", { headers });
    expect((await afterDelete.json()).data.messages).toEqual([]);

    const staleWrite = await app.request("/v1/sessions/session-sync-test", {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...snapshot, id: undefined }),
    });
    expect(staleWrite.status).toBe(200);
    expect((await staleWrite.json()).data.messages).toEqual([]);

    const replacementAt = snapshot.updatedAt + 5_000;
    const replacement = {
      ...snapshot,
      id: undefined,
      updatedAt: replacementAt,
      messages: [{ ...snapshot.messages[0], updatedAt: replacementAt }],
    };
    const replaced = await app.request("/v1/sessions/session-sync-test", {
      method: "PUT",
      headers,
      body: JSON.stringify(replacement),
    });
    expect(replaced.status).toBe(200);
    expect((await replaced.json()).data.messages.map((message: { id: string }) => message.id)).toEqual(["message-user"]);
  });

  it("allows only the three production browser origins", async () => {
    const app = createApp();
    const allowed = await app.request("/v1/config", { headers: { Origin: "https://chat.zengjunjie.com" } });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://chat.zengjunjie.com");

    const denied = await app.request("/v1/config", { headers: { Origin: "https://untrusted.example.test" } });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("requires explicit API confirmation flow support and protects the final administrator", async () => {
    const app = createApp();
    const headers = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    const created = await app.request("/admin/users", {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "delete-me@example.test", password: "delete-me-password", role: "standard", rpmLimit: 60, dailyLimit: 1000 }),
    });
    const userId = (await created.json()).data.id;
    expect((await app.request(`/admin/users/${userId}`, { method: "DELETE", headers })).status).toBe(204);
    expect((await app.request("/admin/users/usr_admin", { method: "DELETE", headers })).status).toBe(409);
  });

  it("queues the exact rendered security alert after a successful login from a new IP", async () => {
    const enterprise = new MemoryEnterpriseStore();
    const app = createApp({ enterpriseStore: enterprise });
    const headers = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    await app.request("/admin/email/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({ host: "smtp.example.test", port: 587, secure: false, username: "mailer", password: "smtp-secret", fromEmail: "security@example.test", fromName: "Adaptive Chat", enabled: true }),
    });
    const settings = await app.request("/admin/email/settings", { headers });
    expect(await settings.text()).not.toContain("smtp-secret");
    await app.request("/admin/users", {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "security@example.test", password: "security-password", role: "standard", rpmLimit: 60, dailyLimit: 1_000 }),
    });
    const loginBody = JSON.stringify({ email: "security@example.test", password: "security-password" });
    expect((await app.request("/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": "192.0.2.10" }, body: loginBody })).status).toBe(200);
    expect((await app.request("/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": "203.0.113.42", "user-agent": "Test Android" }, body: loginBody })).status).toBe(200);
    const jobs = await app.request("/admin/jobs", { headers });
    const queued = (await jobs.json()).data;
    expect(queued).toHaveLength(1);
    expect(queued[0].type).toBe("email");
    expect(queued[0].payload.html).toContain("203.0.113.42");
    expect(queued[0].payload.html).toContain("Test Android");
  });

  it("queues beta builds and manual encrypted backups through protected worker endpoints", async () => {
    const app = createApp();
    const headers = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    const backup = await app.request("/admin/backups", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Local recovery",
        protocol: "local",
        scheduleCron: "0 2 * * *",
        enabled: true,
        localDirectory: "/backups",
        webdavUrl: "",
        s3Endpoint: "",
        s3Region: "us-east-1",
        s3Bucket: "",
        s3Prefix: "adaptive-chat",
        s3ForcePathStyle: false,
        credentials: { encryptionPassphrase: "strong-test-passphrase" },
      }),
    });
    expect(backup.status).toBe(201);
    const configId = (await backup.json()).data.id;
    expect((await app.request("/v1/admin/backups/trigger", { method: "POST", headers, body: JSON.stringify({ configId }) })).status).toBe(202);
    const build = await app.request("/v1/admin/builds/beta", {
      method: "POST",
      headers,
      body: JSON.stringify({ versionCode: 20, versionName: "2.0.0-beta.1", releaseNotes: "Beta ring" }),
    });
    expect(build.status).toBe(202);
    expect((await build.json()).data.payload).toMatchObject({ ring: "beta", audienceGroupId: "grp_beta" });
  });

  it("streams DeepSeek reasoning separately from response content in demo mode", async () => {
    const app = createApp();
    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        stream: true,
        messages: [{ role: "user", content: "Explain streaming." }],
      }),
    });

    const body = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("reasoning_content");
    expect(body).toContain("[DONE]");
  });

  it("requires the administrator key for management data", async () => {
    const app = createApp();
    expect((await app.request("/admin/overview")).status).toBe(401);
    expect((await app.request("/admin/overview", { headers: { "x-admin-key": "dev-admin-key" } })).status).toBe(200);
  });

  it("persists routing settings and provider-key metadata through the control-plane API", async () => {
    const app = createApp();
    const headers = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    const key = await app.request("/admin/provider-keys", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: "openai",
        label: "Primary relay",
        endpoint: "https://example.test/v1",
        secret: "server-only-secret",
        priority: 10,
      }),
    });
    expect(key.status).toBe(201);
    expect(await key.text()).not.toContain("server-only-secret");

    const routing = await app.request("/admin/routing", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ strategy: "random" }),
    });
    expect(routing.status).toBe(200);
    expect((await routing.json()).data.strategy).toBe("random");
  });

  it("supports keyless provider CRUD and omits Authorization for the selected upstream", async () => {
    const upstream = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.has("authorization")).toBe(false);
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "keyless response" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstream);
    const app = createApp({ demoMode: false });
    const adminHeaders = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    const created = await app.request("/admin/provider-keys", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ provider: "openai", label: "IP allowlisted relay", endpoint: "https://allowlisted.example.test/v1/chat/completions", secret: "", bypassAuth: true, priority: 5 }),
    });
    expect(created.status).toBe(201);
    const key = (await created.json()).data as { id: string; bypassAuth: boolean };
    expect(key.bypassAuth).toBe(true);

    const updated = await app.request(`/v1/admin/keys/${key.id}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ endpoint: "https://allowlisted.example.test/v1/chat/completions", secret: null, bypass_auth: true, priority: 1 }),
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()).data.bypassAuth).toBe(true);

    const completion = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "chatgpt-lite", messages: [{ role: "user", content: "hello" }] }),
    });
    expect(completion.status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();

    const deleted = await app.request(`/v1/admin/keys/${key.id}`, { method: "DELETE", headers: adminHeaders });
    expect(deleted.status).toBe(204);
    expect((await app.request("/admin/provider-keys", { headers: adminHeaders })).status).toBe(200);
  });

  it("gates Expert raw models by group membership and forwards the exact upstream name", async () => {
    const control = new MemoryControlPlane();
    const enterprise = new MemoryEnterpriseStore();
    const upstream = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(["deepseek-coder", "gpt-5.6-experimental"]).toContain(body.model);
      expect(body).not.toHaveProperty("expert_mode");
      expect(body).not.toHaveProperty("channel");
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "expert response" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstream);
    const app = createApp({ controlPlane: control, enterpriseStore: enterprise, demoMode: false, requireClientAuth: true });
    const adminHeaders = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    const created = await app.request("/admin/users", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ email: "expert@example.test", password: "expert-password", role: "standard" }),
    });
    const userId = (await created.json()).data.id as string;
    const groups = await app.request("/admin/user-groups", { headers: adminHeaders });
    const expertGroup = (await groups.json()).data.find((group: { slug: string }) => group.slug === "expert");
    await app.request(`/admin/users/${userId}/groups`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ groupIds: [expertGroup.id] }),
    });
    await app.request("/admin/provider-keys", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ provider: "deepseek", label: "Expert relay", endpoint: "https://deepseek.example.test/v1", secret: "expert-secret", priority: 1 }),
    });
    const denied = await app.request("/v1/config?expert_mode=true");
    expect(denied.status).toBe(401);
    const login = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "expert@example.test", password: "expert-password" }),
    });
    const token = (await login.json()).token as string;
    const config = await app.request("/v1/config?expert_mode=true", { headers: { Authorization: `Bearer ${token}` } });
    expect(config.status).toBe(200);
    expect((await config.json()).channels.flatMap((channel: { models: Array<{ id: string }> }) => channel.models).some((model: { id: string }) => model.id === "deepseek-coder")).toBe(true);
    const completion = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: "deepseek-coder", expert_mode: true, messages: [{ role: "user", content: "write code" }] }),
    });
    expect(completion.status).toBe(200);
    expect((await completion.json()).choices[0].message.content).toBe("expert response");
    const arbitrary = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: "gpt-5.6-experimental", channel: "deepseek", expert_mode: true, messages: [{ role: "user", content: "try new model" }] }),
    });
    expect(arbitrary.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("tracks Build, Publish, and Archive as separate persisted stages", async () => {
    const enterprise = new MemoryEnterpriseStore();
    const app = createApp({ enterpriseStore: enterprise });
    const headers = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    const build = await app.request("/v1/admin/builds", {
      method: "POST",
      headers,
      body: JSON.stringify({ versionCode: "42", versionName: "4.2.0", releaseNotes: "Pipeline test" }),
    });
    expect(build.status).toBe(202);
    const buildData = (await build.json()).data as { artifactId: string; job: { type: string } };
    expect(buildData.job.type).toBe("build");
    expect((await enterprise.getArtifact(buildData.artifactId))?.status).toBe("building");

    await enterprise.markArtifactBuilt(buildData.artifactId, {
      fileName: "adaptive-chat-4.2.0.apk",
      localPath: "/artifacts/adaptive-chat-4.2.0.apk",
      downloadUrl: "https://chatapi.zengjunjie.com/downloads/adaptive-chat-4.2.0.apk",
      sha256: "a".repeat(64),
      bytes: 123,
    });
    const published = await app.request("/v1/admin/releases", {
      method: "POST",
      headers,
      body: JSON.stringify({ artifactId: buildData.artifactId, releaseRing: "beta" }),
    });
    expect(published.status).toBe(201);
    const release = (await published.json()).data as { id: string; releaseRing: string; status: string };
    expect(release).toMatchObject({ releaseRing: "beta", status: "published" });

    const archive = await app.request(`/v1/admin/releases/${release.id}/archive`, { method: "POST", headers });
    expect(archive.status).toBe(202);
    expect((await archive.json()).data.job.type).toBe("archive");
  });

  it("supports ordered channel defaults and model-specific routing overrides", async () => {
    const app = createApp();
    const headers = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    const ids: string[] = [];
    for (const label of ["Key A", "Key B", "Key C"]) {
      const response = await app.request("/admin/provider-keys", {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider: "openai",
          label,
          endpoint: "https://example.test/v1",
          secret: `secret-${label}`,
          priority: 100,
        }),
      });
      ids.push((await response.json()).data.id);
    }

    const channel = await app.request("/admin/routing/channel/chatgpt", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ keyIds: ids }),
    });
    expect(channel.status).toBe(200);
    expect((await channel.json()).data.keyIds).toEqual(ids);

    const override = await app.request("/admin/routing/model/chatgpt-pro", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ keyIds: [ids[2], ids[0], ids[1]] }),
    });
    expect(override.status).toBe(200);
    expect((await override.json()).data.keyIds).toEqual([ids[2], ids[0], ids[1]]);

    const routing = await app.request("/admin/routing", { headers });
    const data = (await routing.json()).data;
    expect(data.channelPolicies[0].keyIds).toEqual(ids);
    expect(data.modelPolicies[0].keyIds).toEqual([ids[2], ids[0], ids[1]]);
  });

  it("requires an administrator-created password and issues a session token for login", async () => {
    const app = createApp({ requireClientAuth: true });
    const adminHeaders = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    const create = await app.request("/admin/users", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        email: "member@example.test",
        password: "password-for-member",
        role: "standard",
        rpmLimit: 60,
        dailyLimit: 1000,
      }),
    });
    expect(create.status).toBe(201);
    expect(await create.text()).not.toContain("password-for-member");

    const unauthenticated = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "chatgpt-lite", messages: [{ role: "user", content: "hello" }] }),
    });
    expect(unauthenticated.status).toBe(401);

    const login = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "member@example.test", password: "password-for-member" }),
    });
    expect(login.status).toBe(200);
    const token = (await login.json()).token as string;
    expect(token.split(".")).toHaveLength(3);

    const chat = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: "chatgpt-lite", messages: [{ role: "user", content: "hello" }] }),
    });
    expect(chat.status).toBe(200);
  });

  it("updates presentation profiles without changing email authentication", async () => {
    const avatarStorageDir = await mkdtemp(join(tmpdir(), "adaptive-chat-avatar-test-"));
    try {
      const app = createApp({
        requireClientAuth: true,
        avatarStorageDir,
        publicApiBaseUrl: "https://chatapi.example.test",
      });
      const adminHeaders = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
      await app.request("/admin/users", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          email: "profile@example.test",
          password: "profile-password",
          role: "standard",
          rpmLimit: 60,
          dailyLimit: 1_000,
        }),
      });
      const login = await app.request("/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "profile@example.test", password: "profile-password" }),
      });
      const loginBody = await login.json();
      const token = loginBody.token as string;
      expect(loginBody.user).toMatchObject({
        email: "profile@example.test",
        displayName: null,
        avatarUrl: null,
      });
      expect((await app.request("/v1/users/profile")).status).toBe(401);

      const avatar = await sharp({
        create: { width: 96, height: 64, channels: 4, background: "#087f73" },
      }).png().toBuffer();
      const form = new FormData();
      form.set("displayName", "Ada Lovelace");
      form.set("avatar", new File([avatar], "avatar.png", { type: "image/png" }));
      const updated = await app.request("/v1/users/profile", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      expect(updated.status).toBe(200);
      const profile = (await updated.json()).data;
      expect(profile).toMatchObject({ email: "profile@example.test", displayName: "Ada Lovelace" });
      expect(profile.avatarUrl).toMatch(/^https:\/\/chatapi\.example\.test\/v1\/users\/avatars\/[0-9a-f]{32}\.webp$/);

      const avatarResponse = await app.request(new URL(profile.avatarUrl).pathname);
      expect(avatarResponse.status).toBe(200);
      expect(avatarResponse.headers.get("content-type")).toBe("image/webp");
      expect((await avatarResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);

      const displayNameLogin = await app.request("/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "Ada Lovelace", password: "profile-password" }),
      });
      expect(displayNameLogin.status).toBe(400);
      const originalEmailLogin = await app.request("/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "profile@example.test", password: "profile-password" }),
      });
      expect(originalEmailLogin.status).toBe(200);
      expect((await originalEmailLogin.json()).user).toMatchObject({ displayName: "Ada Lovelace", avatarUrl: profile.avatarUrl });

      const removed = await app.request("/v1/users/profile", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ removeAvatar: true }),
      });
      expect(removed.status).toBe(200);
      expect((await removed.json()).data.avatarUrl).toBeNull();
      expect((await app.request(new URL(profile.avatarUrl).pathname)).status).toBe(404);
    } finally {
      await rm(avatarStorageDir, { recursive: true, force: true });
    }
  });

  it("updates a user password through the protected v1 user endpoint", async () => {
    const app = createApp();
    const adminHeaders = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    const created = await app.request("/admin/users", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        email: "reset@example.test",
        password: "old-password-value",
        role: "standard",
        rpmLimit: 60,
        dailyLimit: 1000,
      }),
    });
    const userId = (await created.json()).data.id as string;

    const update = await app.request(`/v1/users/${userId}`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ password: "new-password-value" }),
    });
    expect(update.status).toBe(200);
    expect(await update.text()).not.toContain("new-password-value");

    const oldLogin = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "reset@example.test", password: "old-password-value" }),
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "reset@example.test", password: "new-password-value" }),
    });
    expect(newLogin.status).toBe(200);
  });

  it("serves an authenticated Edge TTS response without invoking a real network synthesizer", async () => {
    const app = createApp({ synthesizeSpeech: async () => new Uint8Array([1, 2, 3, 4]) });
    const adminHeaders = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    await app.request("/admin/users", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        email: "speech@example.test",
        password: "speech-password",
        role: "standard",
        rpmLimit: 60,
        dailyLimit: 1000,
      }),
    });
    const login = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "speech@example.test", password: "speech-password" }),
    });
    const token = (await login.json()).token as string;
    const speech = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ input: "Read this response." }),
    });
    expect(speech.status).toBe(200);
    expect(speech.headers.get("content-type")).toBe("audio/mpeg");
    expect([...new Uint8Array(await speech.arrayBuffer())]).toEqual([1, 2, 3, 4]);
  });

  it("persists authenticated feedback and serves active app update metadata", async () => {
    const app = createApp();
    const adminHeaders = { "x-admin-key": "dev-admin-key", "Content-Type": "application/json" };
    await app.request("/admin/users", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        email: "feedback@example.test",
        password: "feedback-password",
        role: "standard",
        rpmLimit: 60,
        dailyLimit: 1000,
      }),
    });
    const login = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "feedback@example.test", password: "feedback-password" }),
    });
    const token = (await login.json()).token as string;

    const feedback = await app.request("/v1/app/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "The settings page needs an update check.", category: "feature", appVersion: "1.1.0", locale: "en" }),
    });
    expect(feedback.status).toBe(201);
    const feedbacks = await app.request("/admin/feedbacks", { headers: adminHeaders });
    expect((await feedbacks.json()).data).toHaveLength(1);

    const publish = await app.request("/admin/app-versions", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        versionCode: 7,
        versionName: "1.2.0",
        downloadUrl: "https://downloads.example.test/adaptive-chat.apk",
        releaseNotes: "Security and settings improvements.",
        isActive: true,
      }),
    });
    expect(publish.status).toBe(201);
    const update = await app.request("/v1/app/check-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionCode: 6, versionName: "1.1.0" }),
    });
    const updatePayload = await update.json();
    expect(updatePayload.updateAvailable).toBe(true);
    expect(updatePayload.latest.versionCode).toBe(7);
  });
});
