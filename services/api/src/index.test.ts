import { describe, expect, it } from "vitest";
import { createApp } from "./index.js";
import { MemoryEnterpriseStore } from "./enterprise.js";

describe("Adaptive Chat API", () => {
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
    expect((await config.json()).featureFlags.reasoningBlocks).toBe(true);
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
        models: [{ id: "qwen-standard", label: "Standard", description: "Balanced", upstreamModel: "qwen-max" }],
        enabled: true,
        sortOrder: 40,
      }),
    });
    expect(create.status).toBe(201);
    const createText = await create.text();
    expect(createText).not.toContain("qwen-server-only-secret");
    const channelId = JSON.parse(createText).data.id as string;

    const config = await app.request("/v1/config");
    const payload = await config.json();
    expect(payload.version).toBe(4);
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

    const replaceModel = await app.request(`/admin/dynamic-channels/${channelId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        models: [{ id: "qwen-expert", label: "Expert", description: "Deep analysis", upstreamModel: "qwen-max" }],
      }),
    });
    expect(replaceModel.status).toBe(200);
    const routes = await app.request("/admin/models", { headers });
    expect((await routes.json()).data.find((route: { id: string }) => route.id === "qwen-standard").enabled).toBe(false);
    const updatedConfig = await app.request("/v1/config");
    expect((await updatedConfig.json()).channels.find((channel: { id: string }) => channel.id === "qwen").models)
      .toEqual([{ id: "qwen-expert", label: "Expert", description: "Deep analysis" }]);
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
