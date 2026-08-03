# Iteration 3 Conclusion

## Outcome

Iteration 3 is implemented, verified, and deployed. The Android client now has
the requested UX corrections, Markdown and multimodal input, persisted response
branching, and network-to-device speech fallback. The Admin Console can edit
existing users and reset passwords through the persistent PostgreSQL control
plane.

## Delivered

- Recalibrated channel/model selectors with bounded widths, explicit margins,
  balanced spacing, and fixed 18-20 dp icon sizing based on the supplied visual
  anomaly.
- Settings now consumes system back navigation, conversation deletion requires
  a blocking confirmation, and the chat composer plus newest message react to
  IME insets without being obscured by the keyboard.
- Assistant messages render basic Markdown (bold, italic, inline/fenced code,
  and lists) and expose Copy, Branch, Listen, and terminal-only Redo actions.
- Room schema version 3 persists image attachments. Branching clones history
  through the selected message in one transaction into an independent session;
  Redo overwrites only the terminal assistant response and restores it if the
  network retry fails.
- Native Android speech recognition populates the composer. JPEG, PNG, WEBP,
  and GIF attachments use OpenAI Chat Completions content arrays with data URL
  `image_url` parts and remain available to the sliding context window.
- Authenticated `/v1/audio/speech` uses Edge TTS with a 12-second server/client
  deadline. Android falls back to the device `TextToSpeech` engine for network
  errors, timeouts, rate limits, empty audio, or playback failures.
- The Admin Console edits role, status, quotas, and optional replacement
  passwords. Protected `PATCH`/`PUT /v1/users/{id}` endpoints hash replacement
  passwords before PostgreSQL persistence and never return password material.
- The npm production tree pins patched PostCSS and sharp releases. The final
  production audit reports no known vulnerabilities.

## Verification

- Android: 5 unit tests passed; `testDebugUnitTest` and `assembleDebug` completed
  successfully. The APK is `com.zengjunjie.adaptivechat`, version code 4,
  version name `1.2.0`, target SDK 36, and includes the microphone permission
  plus adaptive launcher icons.
- APK SHA-256:
  `0d18184a51df53b25c6c1f295a3db4140fde47544df9a422244fd8167ba73558`.
  The local and publicly downloaded files match exactly.
- Gateway: TypeScript build passed and all 9 API tests passed, including the
  protected password-update and TTS contracts.
- Admin: Next.js production build and TypeScript validation passed with the
  patched dependency tree. `npm audit --omit=dev` reports 0 vulnerabilities.
- Production: PostgreSQL and Redis remained healthy; the recreated API reports
  relay mode with OpenAI, Gemini, and DeepSeek providers configured. The Admin
  Console returns an immediate Basic Auth challenge and HTTP 200 after valid
  authentication.
- A controlled production account test rejected the old password immediately
  after reset, accepted the replacement password, completed a real OpenAI-format
  image request with HTTP 200, and received 16,992 bytes of `audio/mpeg` from
  Edge TTS. The verification account was suspended afterward.
- The active release record is version `1.2.0`: version code 3 receives an
  update, while version code 4 is reported current.

## Access

- Admin Console: `https://console.zengjunjie.com`
- API Gateway: `https://chatapi.zengjunjie.com`
- APK download:
  `https://chatapi.zengjunjie.com/downloads/adaptive-chat-1.2.0.apk`
- Local APK: `app/build/outputs/apk/debug/app-debug.apk`

Android visual validation remains with the Product Owner. No emulator, Xvfb,
noVNC, Lavapipe, or other headless UI environment was used.
