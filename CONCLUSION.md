# Conclusion

## Outcome

Adaptive Chat is built and deployed. The Android client, real upstream relay, persistent PostgreSQL/Redis control plane, protected admin console, Docker stack, Nginx routing, and TLS certificates are operational.

## Delivered

- Android Kotlin/Compose app with channel-specific ChatGPT, Gemini, and DeepSeek presentation modes, independent model selection, animated waiting states, and Room-backed history.
- Room-backed local conversation/session persistence and a bounded context window.
- Resilient SSE handling, including DeepSeek `reasoning_content` and streamed `<think>` parsing.
- Hono API exposing `/health`, `/v1/models`, `/v1/config`, and `/v1/chat/completions`.
- OpenAI-compatible gateway with credential-free demo mode, real upstream relay mode, client quotas, persisted model aliases, priority key pools, and protected admin endpoints.
- Next.js administration console for manual users, client keys, provider key pools, routing, connections, and model mappings.
- Docker Compose stack with persistent PostgreSQL and Redis volumes, loopback-only application ports, and restart policies.
- Nginx host configuration and active Let's Encrypt certificates for the public console and API.

## Verification

The following checks completed successfully:

- `./gradlew --no-daemon testDebugUnitTest assembleDebug --stacktrace --console=plain`
- Android unit tests for reasoning parsing and context-window behavior.
- `npm run build` for the API and admin console.
- `npm run test` with four API behavior tests passing.
- API health, protected admin access, DeepSeek SSE streaming, and the Next.js admin proxy through local smoke tests.
- `docker compose config` and `docker compose build api admin`.
- PostgreSQL/Redis-backed container startup, API migration/health checks, and admin-proxy verification.
- A real deployed relay request returned `container relay verified` with `DEMO_MODE=false`.
- A gateway restart retained the persisted request metric, confirming that relay state does not reset with the process.
- Public HTTPS checks for the API and Basic-Auth-protected admin console.

The debug APK is available at `app/build/outputs/apk/debug/app-debug.apk`.

## Access

- Admin console: `https://console.zengjunjie.com`
- API gateway: `https://chatapi.zengjunjie.com`
- Local admin console: `http://127.0.0.1:3000`
- Local API: `http://127.0.0.1:8787`

The admin console requires HTTP Basic Auth. Its username is `admin`; its password is the ignored server-side `ADMIN_API_KEY` value.

## Operating Notes

Run the Android build after loading the repository-local environment:

```bash
source scripts/dev-env.sh
./gradlew --no-daemon testDebugUnitTest assembleDebug --console=plain
```

Run the local services:

```bash
npm install
npm run dev:api
npm run dev:admin
```

Run the containerized stack:

```bash
docker compose up --build
```

`DEMO_MODE=true` is available for credential-free development. The deployed stack uses `DEMO_MODE=false` and loads upstream credentials only into the API container. Provider pool secrets are encrypted at rest with `UPSTREAM_KEY_ENCRYPTION_SECRET` and are never returned by the admin API.

## Remaining Constraints

- Android visual validation is intentionally left to the product owner; no further emulator/headless display work was performed.
- `npm audit --omit=dev` reports three high-severity transitive findings from the latest stable Next.js dependency tree. npm's offered remediation is a downgrade to Next 9.3.3, so it was not applied.
