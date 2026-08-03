# Iteration 6 Conclusion

## Outcome

Iteration 6 is implemented, tested, deployed, and published as Android version
`1.5.0` (version code `8`). The production gateway, worker, Admin Console,
PostgreSQL, and Redis services are running, and the production OTA endpoint now
offers 1.5.0 to 1.4.0 clients.

## Delivered

- Added persistent, encrypted search-provider configuration with seeded
  DuckDuckGo Instant Answers, Tavily, and SerpApi integrations. Administrators
  can create, edit, prioritize, enable, disable, and delete providers without
  exposing API keys in responses.
- Added priority-ordered search execution and fallback. The gateway accepts the
  Android-only `X-Web-Search` control header, keeps the OpenAI request JSON
  standard, sanitizes retrieved text and URLs, and injects guarded source context
  ahead of the conversation before calling the mapped upstream model.
- Added the per-query Globe control to the Android composer. Search availability
  is delivered through `/v1/config`, and the selection resets after each send.
- Added blocking confirmations for Admin user/key/channel/search-provider/route/
  backup deletion and Android conversation, assistant-message, and branch
  operations. The backend prevents deletion of the last active administrator.
- Extended the channel builder with launcher-icon uploads, native CSS input, and
  a matching live preview. The Android client safely parses supported colors,
  gradients, typography, and animation duration into Compose styling.
- Added build-time launcher-icon generation for all five Android density buckets,
  including legacy, round, and adaptive foreground assets. Source resources are
  restored after every build, including failure paths.
- Completed the English and Simplified Chinese dictionaries for the new Admin and
  Android flows, including validation and error states.

DuckDuckGo is the no-key instant-answer source and retries directive-heavy prompts
with their first question. General current-events search is provided by Tavily or
SerpApi once an administrator supplies a key and enables that integration.

## Verification

- API: 4 test files and 21 tests passed; TypeScript build passed.
- Admin Console: Next.js production compilation, type checking, and static page
  generation passed.
- Android: 12 unit tests passed, including native CSS parsing; `assembleDebug`
  passed.
- Real end to end: temporary user creation returned 201, login returned 200,
  web-search-enhanced completion returned 200 from mapped model `gpt-5.6-luna`,
  and temporary-user cleanup returned 204.
- Production search: DuckDuckGo returned five normalized sources for the live
  query, beginning with `https://en.wikipedia.org/wiki/OpenAI`.
- Infrastructure: API/PostgreSQL/Redis are healthy; Admin and Worker are running.
  The public Console returns an immediate HTTP Basic Auth challenge, and its
  internal Next.js origin returns 200.
- TLS: both production ECDSA certificates are valid through 2026-10-31.
- OTA: checking from version code 7 returns `updateAvailable: true` and active
  production release `appv_bc66616d-619`.

`npm audit --omit=dev` reports three high-severity advisories in the latest
available Next.js 16.2.12 bundled copies of PostCSS and Sharp. The Admin Console
does not process user CSS through PostCSS or use Next image optimization; uploaded
launcher images are processed by the API's fixed `sharp@0.35.3`. No newer Next.js
release is currently available, so the upstream advisories remain documented.

## Access And APK

- Admin Console: `https://console.zengjunjie.com`
- API Gateway: `https://chatapi.zengjunjie.com`
- Local APK: `app/build/outputs/apk/debug/app-debug.apk`
- Production APK:
  `https://chatapi.zengjunjie.com/downloads/adaptive-chat-1.5.0-production.apk`
- Package: `com.zengjunjie.adaptivechat`
- SHA-256:
  `92ab2267143ea2d7b2332f4010e914beb21cfded82b47729957df2420fcf8316`

Android visual validation remains with the Product Owner. No emulator, Xvfb,
noVNC, Lavapipe, or other headless UI environment was used.
