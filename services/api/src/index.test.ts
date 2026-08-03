import { describe, expect, it } from "vitest";
import { createApp } from "./index.js";

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
