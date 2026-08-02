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
});
