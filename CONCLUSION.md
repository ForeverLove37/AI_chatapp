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
