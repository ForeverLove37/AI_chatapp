# Iteration 2 Conclusion

## Outcome

Iteration 2 is implemented and deployed. The platform now has persistent
credential-backed routing, mandatory Android account authentication, app
settings and OTA APIs, a localized Admin Console, and the redesigned adaptive
mobile UI.

## Delivered

- Upstream credentials are stored only as encrypted PostgreSQL provider-key
  records. The deployment `.env` has no generic provider URL or API-key values.
- Channel default routing and model-specific ordered overrides are persisted in
  PostgreSQL. The Admin Console supports explicit fallback chains and
  round-robin or random balancing for equal-priority keys.
- Administrator-created users require scrypt password hashes. `/v1/auth/login`
  issues signed session tokens, and production chat requests require a valid
  authenticated session or client key.
- Feedback and OTA release records are persisted in PostgreSQL. The active
  `1.1.0` release is available through the update-check endpoint.
- Android has login, settings for language, appearance, font scale, updates,
  feedback, Room history, context-window management, and persisted settings.
- The chat header uses equal-width channel and model dropdowns. ChatGPT,
  Gemini, and DeepSeek each adapt to light and dark mode; Gemini keeps its
  animated gradient and DeepSeek retains a separate reasoning card.
- Android and the Admin Console support persisted English and Simplified
  Chinese UI selection. The model icon assets are included in the Android app.
- Docker, PostgreSQL, Redis, Nginx, TLS routing, HTTP Basic Auth, and the APK
  download route are configured for the public deployment.

## Verification

- API test suite: 7 passing tests, including routing overrides, password login,
  authenticated chat, feedback, and OTA metadata.
- Admin TypeScript check and production Next.js build passed.
- Android debug build passed for `com.zengjunjie.adaptivechat`, version code 3,
  version name `1.1.0`, with cleartext traffic disabled.
- Public HTTPS checks passed for the API health endpoint, Admin Console Basic
  Auth challenge, and APK download route.
- An isolated temporary account completed login, feedback submission, and a
  real authenticated upstream completion. Its feedback was resolved and the
  account was suspended after verification.
- The running API reports relay mode with PostgreSQL and Redis and has no
  generic upstream `KEY` or `URL` environment variables.

## Access

- Admin Console: `https://console.zengjunjie.com`
- API Gateway: `https://chatapi.zengjunjie.com`
- APK download: `https://chatapi.zengjunjie.com/downloads/adaptive-chat-1.1.0.apk`
- Local APK: `app/build/outputs/apk/debug/app-debug.apk`

The console is protected by HTTP Basic Auth. Android visual validation remains
with the Product Owner; no emulator or headless display environment was used.
