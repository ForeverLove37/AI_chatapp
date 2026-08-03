# Iteration 5 Conclusion

## Outcome

Iteration 5 is implemented and verified for the Android client. Message rendering,
interaction controls, error persistence, and message mutation now share persisted
Room state and remain consistent across recomposition and app restarts.

## Delivered

- Replaced the legacy in-composition Markdown parser with an asynchronous Compose
  renderer for headings, paragraphs, bold, italics, inline code, fenced code,
  ordered/unordered lists, links, and strikethrough. Fragmented streaming markers
  and partial control tags are suppressed until safe to render.
- Added a Room v3-to-v4 migration that persists the originating model and a
  separate error field on every assistant message. Errors are visible without
  being inserted into the upstream context window.
- Added the permanent AI action set: Redo, Copy, Branch, Listen, and Delete. The
  bar remains present on empty, partial, successful, and failed responses.
- Added Copy and conditional Edit actions to user messages. Edit is available only
  on the latest user prompt, restores its text and attachments to the composer,
  replaces it transactionally, removes its old tail, and generates a new response.
- Added native long-press bottom sheets to all message bubbles. Each sheet is
  generated from the same action list as its visible action bar.
- Added per-response model labels such as `DeepSeek-Expert`, including migrated
  history and dynamically configured channel models.
- Added transactional assistant deletion and safe non-terminal regeneration.
  Failed regeneration restores the original conversation tail and records the
  new error on the selected response.
- Replaced the blocking streaming-error dialog with an inline dismissible status,
  while persisting the same error inside the affected assistant bubble.
- Updated the app to version `1.4.0` (version code `6`) and corrected the existing
  destination animation so its target state drives rendered content.

## Verification

- `:app:testDebugUnitTest`: 10 tests passed, 0 failures. Coverage includes
  fragmented bold input, partial HTML/control tags, unfinished fenced code,
  standard Markdown blocks/styles, DeepSeek reasoning fragments, context-window
  behavior, image attachments, and failed assistant placeholders.
- `:app:lintDebug`: completed successfully.
- `:app:assembleDebug`: completed successfully.
- APK metadata: package `com.zengjunjie.adaptivechat`, version `1.4.0`, version
  code `6`.
- APK SHA-256:
  `9dccf03c0fb303883a85f1d6dc6e4754045a557a0cbf12a7786e9c8d7cb7fcd0`

## APK

- Iteration 5 extraction path:
  `app/build/outputs/apk/iteration5/adaptive-chat-1.4.0-iteration5.apk`
- Canonical build output: `app/build/outputs/apk/debug/app-debug.apk`

Android visual validation remains with the Product Owner. No emulator, Xvfb,
noVNC, Lavapipe, or other headless UI environment was used.
