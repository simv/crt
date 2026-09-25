---
id: CRT-0038
title: Overlay bugs — duplicate pulse keyframes, the status auto-hide timer, and CRT's own failures in the page's captured logs
status: done
priority: normal
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-25T12:43:00+08:00
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
- [x] One `@keyframes` per name in `OVERLAY_CSS`. New unit test in `brand.test.ts`: no duplicate keyframe names.
- [x] New e2e test (fake clock): an auto-hiding status, then within 15 s an error status. The error is still visible 16 s after the first.
- [x] New e2e test: capture a page whose font is CORS-blocked, then capture again. The second bundle's `network` has no font entries from CRT's rasteriser, and a real page fetch failure is still recorded (F-21).
- [x] A failed `respond` / `interrupt` adds no `unhandledrejection` entry to the console log.
- [x] `npm run check` green; `npm run e2e` green.

## Notes
Three independent fixes, one PR. Land before CRT-0039 and CRT-0043, which touch the same files.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
- 2026-09-25T12:19+08:00 — claimed by /crt:next, session a10e8114-8d06-4f6d-863f-f9f8fb496104, branch crt/CRT-0038-overlay-small-bugs (worked in the worktree .claude/worktrees/CRT-0038, off origin/main f56d300)
- 2026-09-25T12:33+08:00 — decision: the suppression depth lives on the shared `window.__crt.__network` state (`paused`, optional, so an older copy's state reads as 0) and `record()` checks it when a fetch/XHR settles; `takeScreenshots` wraps `rasteriseViewport()`, the only part that fetches, and every fetch in it settles before its `finally` (modern-screenshot aborts its own on timeout). A page request that settles during those few hundred ms is dropped too; nothing tells the two apart. An app still on an older `claude-review-tool/loader` package runs the old hooks, which ignore the depth, until it updates. `/__crt/loader.js` and proxy mode's `early.js` always come from the running server.
- 2026-09-25T12:33+08:00 — finding: in embedded mode the loader adds the overlay tag cross-origin without `crossorigin`, so the overlay's script errors are muted and Chromium never dispatches `unhandledrejection` for promises it leaves rejected. The respond/interrupt bug shows only in proxy mode (same-origin overlay), so its e2e lives in `proxy.spec.ts`. The first draft in `chat.spec.ts` passed on the unfixed code; in proxy mode the unfixed code records two "Unhandled promise rejection: Failed to fetch" entries.
- 2026-09-25T12:33+08:00 — out of scope, not changed: `chat.ts`'s `void this.send(…)` (Enter and Accept) rejects the same way on a network error. The Ask names only `respond` / `interrupt`.
- 2026-09-25T12:33+08:00 — verified: keyframes — `test/brand.test.ts` "defines each @keyframes name once, and every animation names one of them — the launcher's checking dot pulses (F-81, CRT-0038)" passes; the length pin moved 21084 → 21096 on purpose (two renames, +6 chars each).
- 2026-09-25T12:33+08:00 — verified: status timer — `e2e/capture.spec.ts` "an error status stays up when an earlier status's auto-hide comes due, and a later auto-hiding status still hides (F-13, CRT-0038)" (`page.clock.install`, a successful Send, then a Send aborted by `page.route`, then `fastForward(16_000)`) passes. On the unfixed sources it fails: `<div hidden class="status error">Send failed…`.
- 2026-09-25T12:33+08:00 — verified: F-21 — `e2e/capture.spec.ts` "the rasteriser's own failed fetch of a CORS-blocked font sheet stays out of the next capture; a page failure in between is still recorded (F-21, CRT-0038)" passes on the new fixture route `/fonts`: a sheet on the other loopback host without Access-Control-Allow-Origin, over local() fonts. On the unfixed sources the first capture leaves a `fetch GET …/fonts.css — TypeError: Failed to fetch` entry.
- 2026-09-25T12:33+08:00 — verified: respond/interrupt — `e2e/proxy.spec.ts` "a Deny or Stop whose request fails says so in the chat and adds no unhandled rejection to the page's console log (F-20, F-26, F-29, CRT-0038)" passes: the rejection list is unchanged, and the chat shows "Could not answer the permission request: …" and "Could not interrupt the turn: …". On the unfixed sources it fails with two extra rejections.
- 2026-09-25T12:33+08:00 — verified: `npm run check` green (52 files, 712 passed, 2 skipped; lint, build). `npx playwright test --workers=2` gave 68/69. The one failure is `embedded.spec.ts` "the ES module loader bundled into a page…", whose F-91 line expects no dev server on the probed ports; another session's Apex admin was up on :3001 (`next start -p 3001`, started 12:28 during the run), and something was briefly on :8080. That is environmental and touches no changed code; the CI e2e job (ubuntu) is the clean run. The prd-reviewer subagent answered PR-READY WITH NOTES. Its one note, a missing requirement ID on the status test title, is fixed (F-13).
- 2026-09-25T12:33+08:00 — ready for review: changed packages/overlay/src/{ui,chat,network-hook,screenshot}.ts, packages/server/test/brand.test.ts, packages/server/e2e/{capture,proxy}.spec.ts, packages/server/e2e/fixture/server.mjs (new `/fonts`, `/fonts.css`). The font test needs a local Arial / Liberation Sans / DejaVu Sans / Helvetica; its first poll fails loudly if none is there.
- 2026-09-25T12:43+08:00 — CI: all 7 checks green on decae58. `e2e (ubuntu)` ran 69/69 on the first attempt, the four new tests and `embedded.spec.ts` included, so the local-font fixture works on the Linux runner.
- 2026-09-25T12:43+08:00 — done; closed in https://github.com/simv/crt/pull/94 (CI green on decae58)
