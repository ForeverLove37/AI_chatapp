# Adaptive Chat Platform

Adaptive Chat is a synchronized multi-channel Android/Web client, an OpenAI-compatible SSE gateway, and a protected operations console.

## Client

The Kotlin/Compose client persists conversations in Room and keeps the selected channel separate from the selected model. Channel switching changes the visual system, while the model selection changes only the `/v1/chat/completions` payload.

- ChatGPT: Lite, Standard, and Pro in a minimal neutral interface.
- Gemini: Flash, Standard, and Extended in a Material 3 capsule interface with an animated full-surface color gradient.
- DeepSeek: Flash and Expert in a dense technical interface with separate, expandable `<think>` / `reasoning_content` cards.

The client keeps a bounded local context window, synchronizes user-owned sessions through the Gateway, and exposes an animated time-to-first-token waiting state. It never receives upstream provider credentials.

The distributable debug APK is `app/build/outputs/apk/debug/app-debug.apk`. It is version `1.6.0`, uses the application identity `com.zengjunjie.adaptivechat`, and packages adaptive plus `mdpi` through `xxxhdpi` launcher icons generated from `icons/logo.png` or from the first enabled dynamic channel assigned to a queued build.

It supports image attachments using OpenAI Chat Completions `content` arrays, native speech-to-text, Edge TTS with an Android `TextToSpeech` fallback, Markdown response rendering, response copy/redo/listen actions, persisted conversation branches, and a per-query Web Search control. Destructive conversation and message operations require explicit confirmation; deleting a user message atomically deletes its paired AI response.

The responsive Next.js Web Client mirrors channel/model selection, dynamic theme variables, ChatGPT/Gemini/DeepSeek presentation, Markdown, DeepSeek reasoning cards, attachments, speech controls, branching, destructive confirmations, and synchronized history. Its Settings dialog persists language, light/dark/system appearance, and font scaling, and provides feedback plus profile editing. Android and Web both render the user's display name and avatar with deterministic initial fallbacks while authentication remains tied to the immutable account email and ID.

Build the Android client without launching an emulator:

```bash
source scripts/dev-env.sh
./gradlew --no-daemon testDebugUnitTest assembleDebug --console=plain
```

## Gateway and Admin

The Node/Hono gateway exposes OpenAI-compatible endpoints:

- `POST /v1/chat/completions`
- `GET /v1/models`
- `GET /v1/config`
- `GET|PATCH /v1/users/profile`
- `GET /v1/users/avatars/:filename`
- `GET|POST|PUT|DELETE /v1/sessions[/:id]`
- `DELETE /v1/messages/:id`
- `GET /health`

The production control plane uses PostgreSQL for users, hashed client keys, encrypted provider key pools, model mappings, routing settings, and request metrics. Redis provides quota counters, active-stream state, and round-robin routing cursors.

The Next.js admin console supports manual user creation, client-key issuance/revocation, write-only provider-key pools, model-to-upstream mapping, priority tiers, and round-robin or randomized balancing for equal-priority keys. Search-provider management supports DuckDuckGo, no-key Bing RSS, Tavily, and SerpApi with encrypted credentials and priority fallback. The dynamic channel builder publishes native CSS styling and can assign an uploaded launcher icon to Beta or Production builds. There is no public registration route, and destructive operations require confirmation.

Clients enable Web Search with the `X-Web-Search: true` request header while preserving an OpenAI-standard `/v1/chat/completions` JSON body. The Gateway resolves model tool calls internally, executes priority-ordered search, injects guarded tool/source context, and relays only the final completion SSE. Empty Instant Answers results fall through to the enabled no-key RSS provider.

Run local development services:

```bash
npm install
npm run dev:api
npm run dev:admin
npm run dev --workspace @adaptive-chat/web
```

`npm run dev:api:real` starts the gateway with `DEMO_MODE=false` and loads the root `.env`. The admin development launcher strips all upstream credentials before starting Next.js.

## Deployment

Docker Compose persists PostgreSQL, Redis, backup artifacts, and normalized profile avatars in dedicated volumes and publishes the API/admin ports only to loopback for Nginx:

```bash
docker compose up -d --build
```

Set the required production secrets in `.env` from `.env.example`; `.env` is excluded from Git and Docker build contexts. The deployment script creates the Nginx Basic Auth file, provisions certificates, and installs the domain routes:

```bash
scripts/deploy-production.sh
```

Production endpoints:

- Admin console: `https://console.zengjunjie.com`
- API gateway: `https://chatapi.zengjunjie.com`
- Web client: `https://chat.zengjunjie.com`
- Production APK: `https://chatapi.zengjunjie.com/downloads/adaptive-chat-1.6.0-production.apk`

The console is protected by HTTP Basic Auth with username `admin` and the `ADMIN_API_KEY` value in the server `.env`. Certbot uses `CERTBOT_EMAIL` when supplied; otherwise it runs in explicit no-email mode and retains its scheduled renewal task.

The console proxy and its internal admin API relay use bounded connection/read deadlines, so a dependency stall produces an actionable error instead of an indefinite browser loading state.
