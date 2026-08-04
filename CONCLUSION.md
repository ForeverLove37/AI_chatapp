# Iteration 7 Conclusion

## Outcome

Iteration 7 is implemented, tested, deployed, and pushed as Android version
`1.6.0` (version code `9`). The responsive Web Client is publicly available,
the Gateway now keeps internal search tool calls out of the final SSE stream,
and conversation history is synchronized through persistent PostgreSQL tables.

## Delivered

- Added user-owned session/message APIs and PostgreSQL persistence for shared
  Android/Web history. Whole snapshots use monotonic session timestamps so stale
  clients cannot resurrect deleted content, and ownership is enforced on every
  read, write, and delete.
- Added atomic paired deletion. Deleting a user message removes its explicit
  child AI response, with a legacy adjacent-response fallback; Android and Web
  both require confirmation before the operation.
- Reworked Web Search into a two-stage OpenAI tool flow: private model decision,
  priority search execution, guarded assistant/tool context, and final-only SSE.
  Unsupported tool-history providers retry with system grounding, fragmented
  streams are preserved, and a missing terminal marker is repaired exactly once.
- Added a no-key Bing RSS provider after DuckDuckGo Instant Answers, including
  bounded secure XML parsing. Model-generated queries fall back to the original
  user prompt when needed. Tavily and SerpApi remain available with encrypted
  server-side keys.
- Added the containerized Next.js Web Client with login, synchronized sessions,
  responsive desktop/mobile navigation, channel/model selectors, dynamic theme
  variables, light/dark modes, Markdown, DeepSeek reasoning cards, attachments,
  speech controls, branching, and destructive confirmations.
- Restricted browser CORS to the Console, API, and Web Client production origins.
- Hardened backup creation with an exported PostgreSQL serializable read-only
  snapshot, validated foreign keys, an all-table row manifest, `pg_restore`
  archive coverage checks, encrypted local size verification, and S3 PUT/HEAD
  size plus SHA-256 metadata verification.
- Updated the static restoration guide with complete stop, decrypt, restore,
  foreign-key validation, row-count checks, and restart procedures.

## Verification

- API: 4 test files and 27 tests passed; TypeScript build passed.
- Web Client: Next.js production build and TypeScript checking passed.
- Admin Console: Next.js production compilation and static generation passed.
- Android: 13 unit tests passed; Lint completed with 0 errors; `assembleDebug`
  succeeded. No emulator or headless display stack was used.
- Real conversation E2E: account creation/login/session creation/listing returned
  201/200/201/200; deleting a user message removed exactly two messages and left
  zero. A stale rewrite still returned zero messages, while a newer replacement
  atomically retained its one intended message; temporary accounts were removed.
- Real search E2E: mapped upstream returned HTTP 200 with 20 content chunks,
  exactly one `[DONE]`, and no tool-call or error markers in the client stream.
- Local backup job `job_88e9c036-2643-46` succeeded in one attempt. The encrypted
  53,748-byte archive checksum matched on disk and all 21 active tables were
  present, including users, sessions, messages, channels, and feedbacks.
- S3-compatible backup job `job_8403703c-a071-4d` succeeded against an isolated
  MinIO target. Its 21-table snapshot uploaded successfully and independent HEAD
  size verification passed; the temporary target was removed afterward.
- Public routing: Web Client returns HTTPS 200 with CSP/HSTS; Console immediately
  returns the expected Basic Auth 401 challenge; allowed CORS preflight returns
  204 and an untrusted origin returns 403.
- OTA: checking from version code 8 returns active version `1.6.0`; its public APK
  returns HTTPS 200 with a 20,529,965-byte payload.

`npm audit --omit=dev` reports three high-severity advisories in the bundled
PostCSS/Sharp copies inside the latest available Next.js `16.2.12`. The root
project already pins the current fixed PostCSS `8.5.25` and Sharp `0.35.3`, but
Next's nested copies remain. The proposed audit fix incorrectly downgrades Next
to `9.3.3`, so that breaking downgrade was not applied. Custom CSS is never
compiled server-side and the Web/Admin apps do not use Next image optimization.

## Access And Artifacts

- Web Client: `https://chat.zengjunjie.com`
- Admin Console: `https://console.zengjunjie.com`
- API Gateway: `https://chatapi.zengjunjie.com`
- Local APK: `app/build/outputs/apk/debug/app-debug.apk`
- Production APK:
  `https://chatapi.zengjunjie.com/downloads/adaptive-chat-1.6.0-production.apk`
- Package: `com.zengjunjie.adaptivechat`
- APK SHA-256:
  `a17a83196b2bee3d45cd8b19c992359fdd55b9c5338fc50300be33e2e8bb4575`

Android visual validation remains with the Product Owner. No emulator, Xvfb,
noVNC, Lavapipe, or other headless Android UI environment was used.

# Iteration 8 Hotfix

The Web Client layout now keeps the channel/model header and composer in fixed
grid rows, with only the message history owning vertical overflow. The former
document-level `scrollIntoView` loop was removed. Automatic following is now
limited to active SSE streaming, pauses immediately when the user scrolls more
than 56 px from the bottom, and resumes only after returning to the edge.

Dropdown controls use a full-surface native select with decorative icons set to
`pointer-events: none`; the off-screen mobile drawer is also removed from hit
testing until opened. The root HTML response is marked `no-store` to prevent a
cached document from hydrating against an older JavaScript chunk set.

Verification: Web TypeScript checking and the production Next.js build passed;
the rebuilt Docker service is healthy, `https://chat.zengjunjie.com/` returns
HTTPS 200 with the no-store header, and `https://chatapi.zengjunjie.com/health`
returns 200. A browser binary is not installed in this server environment, so
final visual and pointer verification remains available at the public URL.

# Iteration 9 Conclusion

Iteration 9 is implemented, tested, deployed, and pushed. Branch confirmation
now uses fork/branch iconography in both Android and Web; trash icons remain
exclusive to destructive actions. The Web Client now provides Settings parity
for system/English/Chinese language, system/light/dark appearance, font scaling,
and authenticated feedback submission.

Presentation profiles are persisted in PostgreSQL through nullable
`display_name` and `avatar_url` columns. Authenticated users can read and update
their own profile through `GET|PATCH /v1/users/profile`; multipart JPEG, PNG, and
WebP uploads are capped at 2 MB, decoded with bounded pixel limits, normalized to
WebP, and stored in a dedicated persistent Docker volume. Randomized filenames,
strict path validation, MIME validation, and image decoding prevent arbitrary
file storage or traversal. Neither endpoint can mutate email, role, or session
identity.

Android and Web display the profile in user messages, navigation/account areas,
and Settings. Both clients fall back to a deterministic colored initial when no
avatar is configured. Android keeps profile data in account preferences and
refreshes it from the Gateway; the Web client persists only presentation and
Settings state locally while the server remains authoritative.

Verification completed:

- API: 4 test files and 28 tests passed; TypeScript build passed.
- Web Client and Admin Console: production Next.js builds passed.
- Android: unit tests, lint (0 errors), and `assembleDebug` passed. No emulator
  or headless display environment was used.
- Live profile E2E: disposable account creation, email login, multipart avatar
  upload, normalized public WebP delivery, display-name login rejection,
  original-email login retention, avatar removal, and cleanup all passed.
- PostgreSQL contains both profile columns; the API runs in relay mode with
  PostgreSQL + Redis, all services are running, and the health-checked API,
  PostgreSQL, and Redis containers are healthy.
- `https://chat.zengjunjie.com` returns HTTPS 200 with CSP permission restricted
  to profile images from `https://chatapi.zengjunjie.com`.

The Iteration 9 APK is `app/build/outputs/apk/debug/app-debug.apk` with SHA-256
`1559b28b54ef52fcf4489f2a7ad5b8924c10e2dc043834207a0bde61af85e8f7`.
