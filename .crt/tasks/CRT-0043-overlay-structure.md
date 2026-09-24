---
id: CRT-0043
title: Overlay structure — one /__crt/ API client, shared helpers, tokens everywhere, and ui.ts split into tested modules
status: backlog
priority: low
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-24T12:15:00+08:00
url: null
route: null
session: null
tags: [review-2026-09, refactor, overlay, f-112]
files: [packages/overlay/src/ui.ts, packages/overlay/src/chat.ts, packages/overlay/src/capture.ts, packages/overlay/src/health.ts, packages/overlay/src/tokens.ts, packages/overlay/src/api.ts, packages/overlay/src/dom-util.ts, packages/overlay/src/storage.ts, packages/overlay/src/styles.ts, packages/server/test/brand.test.ts]
---

## Summary
`ui.ts` is 1780 lines covering eight concerns, and its pure logic can't be tested because it is tangled with the DOM. One pure rule has already diverged: the Quick note button's enable check and `canQuickNote`. The overlay also:
- talks to `/__crt/` from six places with three different error-handling styles;
- keeps copies of `escapeHtml` (2), `cssEscape` (3) and `clamp` (2);
- wraps storage access in about a dozen hand-written try/catch blocks;
- hard-codes colours that `tokens.ts` already defines;
- has dead code and a markdown renderer (its XSS boundary) with no unit test.

## Context
- **API client:** the pattern `res.json().catch(() => ({}))` + `if (!res.ok || !data.ok) throw …` appears at `capture.ts:126`, `chat.ts:278,291,303` and `ui.ts:997,1094`. `chat.send` only checks `res.ok` (`:381`), `interrupt` and `respond` check nothing (`:386`, `:391`), and `health.ts:75` differs again. `ChatPanel`'s static methods (`createSession`, `warmStart`, `listSessions`, `alive`, `abandon`) are API calls in a UI class.
- **Helpers:**
  - `escapeHtml`: `ui.ts:1774`, `chat.ts:892`.
  - `cssEscape`: `ui.ts:1778`, `chat.ts:896`, `selector.ts:14`, with different fallbacks.
  - `clamp`: `ui.ts:1770`, `popover.ts:53`.
  - Port parsing: `portOf` (`loader.ts:78`), `crtPort` (`health.ts:88`).
  - State labels: `STATE_LABEL` (`ui.ts:1686`) and an inline map at `chat.ts:612`.
  - About 12 storage try/catch blocks in `ui.ts`, `annotations.ts`, `welcome.ts`, `health.ts` and `loader.ts`.
  - `showStatus` takes raw HTML, so each of its about 10 call sites must remember `escapeHtml`.
- **Colours:**
  - `chat.ts:43-46,54,84,92,99,100,105,116-117` use literals equal to `PILL.*`, `INK`, `OK`, `ERROR` and `EXPERIMENTAL`.
  - `#c00` (`ui.ts:114,215`) and `rgba(255,61,113,.08)` (`ui.ts:155,161`, which is `ACCENT` at 8%).
  - The chat header shows `idle` in green (`chat.ts:45`) while the marker pill shows `idle` in `PILL.idle` blue (`ui.ts:150`).
- **`ui.ts` concerns to extract:**
  - the provider menu (`:961-1097`), the thread registry and its sessionStorage (`:539-695`), the session list (`:1099-1150`);
  - launcher drag and placement (`:1234-1320`), the tool layer and keyboard navigation (`:1535-1683`), markers and positioning (`:1394-1518`);
  - `OVERLAY_CSS`.
- **Pure logic to lift out:**
  - `sendToAgent`'s selection and validation (`:454-463`) → `planSend`;
  - the Quick note enable check (`:938`) vs `canQuickNote` (`:512-515`): the button considers "include", `canQuickNote` doesn't;
  - `restoreThreads` grouping (`:650-654`), `readPageThreads` parsing, launcher clamping;
  - `threadState`, `providerState` and `describeAnnotation`, which are exported but untested.
- **Dead code:** `ChatPanel.startFromCapture` (`chat.ts:257`) and `sessionIdOf` (`chat.ts:239`) have no uses anywhere. `focusNote` (`ui.ts:1521`) is an alias.
- **Markdown:** `renderMarkdown` / `inline` (`chat.ts:812-890`) turn agent output into `innerHTML`, with no unit test. `chat.ts` is importable from node (`test/accept-line.test.ts`).
- **Constraints:**
  - Framework-free and Shadow DOM.
  - No globals but `window.__crt`.
  - Colours from `tokens.ts` (F-112); `brand.test.ts` pins hex counts and the `OVERLAY_CSS` length.
  - Loader ≤ 5 KB gz (N-20), so `loader.ts` keeps its own tiny helpers.
  - N-30 fold behaviour unchanged.

## Evidence
No page capture: from the code review in session e145e7ac, 2026-09-24. Dead-code claims were grepped across `packages/` including tests and e2e.

## Ask
1. Tests first:
   - `test/markdown.test.ts`: escaping, `<script>`/attribute injection, fences, lists, links;
   - unit tests for `threadState`, `providerState` and `describeAnnotation`;
   - a new `planSend(items, opts)` and a single `canQuickNote(items, opts)` that both the button and the send path use (decide the "include" rule and record it).
2. `api.ts`: `crtJson<T>(path, init)` plus one typed function per route used by the overlay; `noteFailure` is hooked in there. `ChatPanel` and `OverlayUI` call it; `ChatPanel`'s static API methods move there.
3. `dom-util.ts` (`escapeHtml`, `cssEscape`, `clamp`, state labels) and `storage.ts` (`safeGet`, `safeSet`, `safeRemove`). `loader.ts` stays self-contained. `showStatus(text, { link?, error?, autoHide? })` builds its own DOM, with no raw HTML.
4. Replace the colour literals with `tokens.ts` interpolation, keeping every value the same (`brand.test` hex counts unchanged). Raise the `idle` colour mismatch with Simon as a design question; don't change it silently.
5. Extract from `ui.ts`: `styles.ts` (re-exported from `ui.ts` for `brand.test`), `provider-menu.ts`, `threads.ts`, `markers.ts`, `launcher.ts`, `tools.ts`. `OverlayUI` composes them.
6. Delete `startFromCapture`, `sessionIdOf` and `focusNote`, and drop `export` from exports used only in their own file (list them in the Log).

## Definition of Done
- [ ] `markdown.test.ts`, the pure-logic tests and `api.ts` tests (stubbed `fetch`) exist and were green before the move.
- [ ] No `fetch(` to a `/__crt/` path outside `api.ts`, `health.ts` and `loader.ts`.
- [ ] One `escapeHtml`, one `cssEscape` and one `clamp` in `packages/overlay/src` outside `loader.ts`; no `innerHTML` built from unescaped caller input in `showStatus`.
- [ ] No colour literal in `ui.ts` / `chat.ts` that equals a `tokens.ts` value; `brand.test.ts` green.
- [ ] `ui.ts` ≤ 700 lines.
- [ ] The overlay bundle's gzipped size isn't larger than before (record both); loader ≤ 5 KB gz.
- [ ] `npm run check` green; `npm run e2e` green; `npm run screenshots` output unchanged beyond font rasterisation (N-27).

## Notes
- Largest and lowest-urgency task of the review.
- Land CRT-0038 and CRT-0039 first: they touch the same code and are smaller.
- Can be split into two PRs: steps 1–4 and 6, then step 5.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
