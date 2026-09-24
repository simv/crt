---
id: CRT-0038
title: Overlay bugs — duplicate pulse keyframes, the status auto-hide timer, and CRT's own failures in the page's captured logs
status: backlog
priority: normal
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-24T12:15:00+08:00
url: null
route: null
session: null
tags: [review-2026-09, bug, overlay, f-21]
files: [packages/overlay/src/ui.ts, packages/overlay/src/chat.ts, packages/overlay/src/network-hook.ts, packages/overlay/src/console-hook.ts, packages/overlay/src/capture.ts, packages/overlay/src/screenshot.ts, packages/server/test/brand.test.ts]
---

## Summary
Three small overlay defects the review confirmed:
1. The launcher's "checking" dot doesn't pulse, because a second `@keyframes crt-pulse` overrides it.
2. A persistent error message can vanish early, hidden by the timer of an earlier auto-hiding message.
3. CRT's own failed fetches and unhandled rejections land in the page's captured console and network logs (F-21). The agent then sees them as the app's errors.

## Context
- **Keyframes:** `packages/overlay/src/ui.ts:78` defines `@keyframes crt-pulse` (an opacity pulse for `.launcher[data-health="checking"] .health`). `:181` redefines the same name for the number badges (a `box-shadow` pulse using `var(--st)`). The later definition wins for the whole stylesheet.
- **Status timer:** `ui.ts:1530`, `showStatus(…, autoHide)` calls `setTimeout(() => status.hidden = true, 15_000)` and never stores or clears it.
- **Network log:** `capture.ts:79-81` snapshots the logs before rasterising, which protects only the current capture. But the font fetches in `screenshot.ts:139,170` and modern-screenshot's own fetches go through the hooked `window.fetch` (`network-hook.ts:73`). Their failures (for example a CORS-blocked font) appear in the next capture.
- **Console log:** `chat.ts:667,679` call `void this.respond()` and `void this.interrupt()`, which reject on network errors. The overlay's own hook (`console-hook.ts:99`) records those as the page's `unhandledrejection`.

## Evidence
No page capture: from the code review in session e145e7ac, 2026-09-24. Keyframes and timer were confirmed by reading `ui.ts`.

## Ask
1. Rename the badge animation to `crt-badge-pulse`, and update `OVERLAY_CSS`'s length pin in `test/brand.test.ts` deliberately.
2. Keep the status timer id; clear it on every `showStatus` call and when the status is hidden another way.
3. Give the network hook a suppression depth that `record()` checks; `takeScreenshots` enters it and leaves it in `finally`. Add `.catch()` to the fire-and-forget `respond` / `interrupt` calls, surfacing failure through the chat's existing error path rather than silently.

## Definition of Done
- [ ] One `@keyframes` per name in `OVERLAY_CSS`. New unit test in `brand.test.ts`: no duplicate keyframe names.
- [ ] New e2e test (fake clock): an auto-hiding status, then within 15 s an error status. The error is still visible 16 s after the first.
- [ ] New e2e test: capture a page whose font is CORS-blocked, then capture again. The second bundle's `network` has no font entries from CRT's rasteriser, and a real page fetch failure is still recorded (F-21).
- [ ] A failed `respond` / `interrupt` adds no `unhandledrejection` entry to the console log.
- [ ] `npm run check` green; `npm run e2e` green.

## Notes
Three independent fixes, one PR. Land before CRT-0039 and CRT-0043, which touch the same files.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
