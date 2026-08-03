# Adaptive Chat Platform

Adaptive Chat is a multi-channel Android client, an OpenAI-compatible SSE gateway, and a protected operations console.

## Client

The Kotlin/Compose client persists conversations in Room and keeps the selected channel separate from the selected model. Channel switching changes the visual system, while the model selection changes only the `/v1/chat/completions` payload.

- ChatGPT: Lite, Standard, and Pro in a minimal neutral interface.
- Gemini: Flash, Standard, and Extended in a Material 3 capsule interface with an animated full-surface color gradient.
- DeepSeek: Flash and Expert in a dense technical interface with separate, expandable `<think>` / `reasoning_content` cards.

The client keeps a bounded local context window and exposes an animated time-to-first-token waiting state. It never receives upstream provider credentials.

The distributable debug APK is `app/build/outputs/apk/debug/app-debug.apk`. It is version `1.2.0`, uses the application identity `com.zengjunjie.adaptivechat`, and packages adaptive plus `mdpi` through `xxxhdpi` launcher icons generated from `icons/logo.png`.

It supports image attachments using OpenAI Chat Completions `content` arrays, native speech-to-text, Edge TTS with an Android `TextToSpeech` fallback, Markdown response rendering, response copy/redo/listen actions, and persisted conversation branches.

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
- `GET /health`

The production control plane uses PostgreSQL for users, hashed client keys, encrypted provider key pools, model mappings, routing settings, and request metrics. Redis provides quota counters, active-stream state, and round-robin routing cursors.

The Next.js admin console supports manual user creation, client-key issuance/revocation, write-only provider-key pools, model-to-upstream mapping, priority tiers, and round-robin or randomized balancing for equal-priority keys. There is no public registration route.

Run local development services:

```bash
npm install
npm run dev:api
npm run dev:admin
```

`npm run dev:api:real` starts the gateway with `DEMO_MODE=false` and loads the root `.env`. The admin development launcher strips all upstream credentials before starting Next.js.

## Deployment

Docker Compose persists PostgreSQL and Redis volumes and publishes the API/admin ports only to loopback for Nginx:

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

The console is protected by HTTP Basic Auth with username `admin` and the `ADMIN_API_KEY` value in the server `.env`. Certbot uses `CERTBOT_EMAIL` when supplied; otherwise it runs in explicit no-email mode and retains its scheduled renewal task.

The console proxy and its internal admin API relay use bounded connection/read deadlines, so a dependency stall produces an actionable error instead of an indefinite browser loading state.
