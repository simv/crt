---
id: CRT-0043
title: Overlay structure — one /__crt/ API client, shared helpers, tokens everywhere, and ui.ts split into tested modules
status: done
priority: low
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-28T13:56:00+08:00
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
- [x] `markdown.test.ts`, the pure-logic tests and `api.ts` tests (stubbed `fetch`) exist and were green before the move.
- [x] No `fetch(` to a `/__crt/` path outside `api.ts`, `health.ts` and `loader.ts`.
- [x] One `escapeHtml`, one `cssEscape` and one `clamp` in `packages/overlay/src` outside `loader.ts`; no `innerHTML` built from unescaped caller input in `showStatus`.
- [x] No colour literal in `ui.ts` / `chat.ts` that equals a `tokens.ts` value; `brand.test.ts` green.
- [x] `ui.ts` ≤ 700 lines.
- [x] The overlay bundle's gzipped size isn't larger than before (record both); loader ≤ 5 KB gz.
- [x] `npm run check` green; `npm run e2e` green; `npm run screenshots` output unchanged beyond font rasterisation (N-27).

## Notes
- Largest and lowest-urgency task of the review.
- Land CRT-0038 and CRT-0039 first: they touch the same code and are smaller.
- Can be split into two PRs: steps 1–4 and 6, then step 5.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
- 2026-09-28T12:50+08:00 — claimed by /crt:next, session de8d860f-ac0e-498c-bd0c-19c3cc1e310d, branch crt/CRT-0043-overlay-structure (worktree `.claude/worktrees/CRT-0043` off origin/main b87a064). CRT-0041 is lower-numbered and `backlog` on main, but on its own branch it is `blocked` on a Claude login, and `claude auth status --json` still says `loggedIn: false`, so a retry would block again; took CRT-0043 instead. The task's line numbers predate CRT-0038/0039 (ui.ts is now 1942 lines); the concerns it names are all still there.
- 2026-09-28T13:53+08:00 — step 1 (0c4a75f): `markdown.test.ts` gains the XSS boundary (every block kind with `<script>`, handlers and quotes: only the renderer's own tags come out; a fence's info string is dropped; Markdown links, raw anchors and bare URLs stay text); `overlay-labels.test.ts` pins `threadState`, `providerState`, `describeAnnotation`; new `send-plan.ts` (`planSend`, `canQuickNote`) is used by `sendToAgent` and both Quick note buttons. The "include" rule, decided: with include checked, every other unsent annotation needs a note too — the send path always refused otherwise, and the old `canQuickNote` ignored include and offered a send that then failed. `window.__crt.canQuickNote(n)` keeps its signature (include off).
- 2026-09-28T13:53+08:00 — step 2 (4d4d152): `api.ts` has `crtJson` and one function per route; `ChatPanel`'s static API methods, the capture POST and the provider routes moved there. Its `onRequestFailure` listener re-reads health after every failed CRT request (F-81; before, four call sites did). Deliberate behaviour changes: a failed chat reply says `Could not send: …` in the chat instead of `Could not send (409)` / an unhandled rejection; a Stop, Allow or Deny answered with a non-2xx (only a race with the turn's end does that) now says `Could not …` like a network failure already did; `window.__crt.chat.respond/interrupt` reject on a non-2xx as they did on a network error.
- 2026-09-28T13:53+08:00 — steps 3–4 (8aedd31): `dom-util.ts` (`escapeHtml`; `cssEscape` = `CSS.escape` or a backslash before every non-`[\w-]` character, valid in selectors and quoted attribute values alike; `clamp`; `STATE_LABEL`, now shared by the marker pill, the chat head, the session list and the Chat dot); `storage.ts` (`safeGet`, `safeGetJson`, `safeSet`, `safeRemove`) replaces every storage try/catch in ui/annotations/welcome/health; `showStatus(text | parts, { link, error, autoHide })` builds DOM from text, `code` and `b` parts. Colours: every literal equal to a token is interpolated in chat.ts, the stylesheet and welcome.ts; new tokens `FAIL` (`#c00`, 3 sites) and `ACCENT_WASH` / `INK_90` (the two rgba() literals, pinned to ACCENT/INK by a test); the rendered CSS is byte-identical (brand.test's length 21096 and hex counts unchanged; `FAIL: 3` added).
- 2026-09-28T13:53+08:00 — design question for Simon, value unchanged as asked: the chat head draws `idle` in the task green (`PILL.task`) while the marker pill draws `idle` in `PILL.idle` blue. Which is right? (Also noted above `CHAT_CSS`.)
- 2026-09-28T13:53+08:00 — step 5 (258b198): ui.ts 1942 → 653 lines. `styles.ts` (re-exported from ui.ts), `provider-menu.ts`, `threads.ts` (registry, its sessionStorage and the thread lifecycle), `markers.ts` (markers and the N-3 `Positioner`), `launcher.ts` (drag, placement and the F-81 dot), `tools.ts`, plus `popovers.ts` (popover DOM and its delegated listeners) and `session-list.ts` — two modules beyond the Ask's list, needed to get under 700. Pure logic lifted and tested (`overlay-modules.test.ts`): `groupThreads`, `parsePageThreads`, `threadTitle`, `clampLauncher`, `parseLauncherPos`, and storage that never throws. `Threads.drop` lost the `removeAnnotations = false` branch: only Discard ever called it, always with true.
- 2026-09-28T13:53+08:00 — step 6: deleted `ChatPanel.startFromCapture`, `ChatPanel.sessionIdOf`, `OverlayUI.focusNote`, and the overlay's own endpoint constants (`CAPTURES_ENDPOINT`, `SESSIONS_ENDPOINT`, `PROVIDERS_ENDPOINT`, `CONFIG_ENDPOINT`, `HEALTH_ENDPOINT`). Dropped `export` from values used only in their own file: annotations.ts `PERSIST_DEBOUNCE_MS`, `toPageRect`, `elementsInBox`; capture.ts `pageInfo`, `markerFor`; chat.ts `intakeWords` and the type `InitEvent`; component.ts `detectReact`, `detectVue`; console-hook.ts `formatConsoleArgs`; element.ts `rectOf`; health.ts `SERVER_KEY`; markers.ts `anchorRect`; selector.ts `looksGenerated`; tools.ts `normalise`; welcome.ts `WELCOME_KEY_PREFIX`. Kept `export` on types that appear in another export's signature (`AnnotationKind`, `BoxElement`, `ChatCallbacks`, `HealthView`, …) and on loader.ts's `PILL_HOST_ID` (a package entry).
- 2026-09-28T13:53+08:00 — bundle (4d567c8, ac0fdf7): the split first cost ~750 B gzip — more small classes, and the new module order put the stylesheet more than gzip's 32 KB window away from the markup repeating its class names. Won back by: `useDefineForClassFields: false` in packages/overlay/tsconfig.json (the es2020 output called a defineProperty helper per class field; the overlay's classes extend nothing, so [[Set]] behaves the same; noted in build.mjs); ui.ts importing `styles.js` and the popover/list builders first (commented); routes.ts's paths as plain strings, so the overlay imports its five from routes.ts (the PRD reviewer's one note: api.ts had kept copies) and esbuild drops the rest — its `${CRT_PREFIX}` templates survived tree-shaking; index.ts reaching the parts instead of eight one-line delegates.
- 2026-09-28T13:54+08:00 — verified: tests before the move — `markdown.test.ts`, `overlay-labels.test.ts`, `send-plan.test.ts` were committed green in 0c4a75f and `overlay-api.test.ts` (stubbed `fetch`, 9 tests) in 4d4d152, both before the split in 258b198; `npm run check` was green at 8aedd31 (793 tests) and e2e ran at that point too (73/74, the environmental line below).
- 2026-09-28T13:54+08:00 — verified: `overlay-structure.test.ts` › "talks to /__crt/ only from api.ts and health.ts…" — `fetch(` appears only in api.ts, health.ts and screenshot.ts (page stylesheets and fonts, no CRT URL), `crtUrl(` only in api.ts/base.ts/health.ts; the loader has no fetch at all.
- 2026-09-28T13:54+08:00 — verified: `overlay-structure.test.ts` › "defines escapeHtml, cssEscape and clamp once, in dom-util.ts" and › "builds the status line as DOM: showStatus never assigns innerHTML" (it uses `replaceChildren` over text nodes).
- 2026-09-28T13:54+08:00 — verified: `overlay-structure.test.ts` › "repeats no tokens.ts colour as a literal…" scans every overlay module but tokens.ts and loader.ts (ui.ts, chat.ts, styles.ts included) for token hexes and rgba() forms; `brand.test.ts` green, `OVERLAY_CSS` still 21096 characters.
- 2026-09-28T13:54+08:00 — verified: ui.ts is 653 lines; `overlay-structure.test.ts` › "keeps ui.ts to composing its parts: at most 700 lines".
- 2026-09-28T13:54+08:00 — verified: sizes from `npm run build`, gzip at the default level (level 9 in brackets) — before (main b87a064): overlay.js 126,489 B raw, 38,957 B gz (38,865); after (ac0fdf7): 124,523 B raw, 38,890 B gz (38,823). loader.js 6,633 B raw, 2,856 B gz, unchanged (≤ 5 KB, N-20).
- 2026-09-28T13:54+08:00 — verified: `npm run check` green at ac0fdf7 (63 files, 802 tests; one earlier full run lost `providers/antigravity.test.ts`'s interrupt test to load, green twice alone — the known Windows timing flake). `npx playwright test --workers=2`: 73/74 on the final build, twice; the one failure is `embedded.spec.ts:177`'s F-91 line "no dev server on ports 3000, 5173, 8080…", because another session's apps hold :3000 and :8080 here (`netstat`) — environmental, the same failure on main's code in this checkout; CI's ubuntu e2e is the clean run and is checked before merge. `npm run screenshots` on the final build vs a fresh run of main's build (scratch worktree): arrival.png and marker-states.png byte-identical; select.png byte-identical to the committed file (main's own run differed in one 9×17 px spot); landing.png differs only in the footer clock; chat.png differs only in the transcript's scroll offset (6 px, the known `scrolledToStart` flake that main does not reproduce either) and the session id in the footer — no colour or layout change.
- 2026-09-28T13:54+08:00 — ready for review: changed packages/overlay/src (new api.ts, dom-util.ts, storage.ts, send-plan.ts, styles.ts, provider-menu.ts, threads.ts, markers.ts, launcher.ts, tools.ts, popovers.ts, session-list.ts; ui.ts, chat.ts, capture.ts, health.ts, tokens.ts, annotations.ts, welcome.ts, selector.ts, popover.ts, index.ts and a few un-exports), packages/overlay/tsconfig.json and build.mjs, packages/server/src/routes.ts (plain-string paths), and tests (markdown, brand, new overlay-api, overlay-labels, overlay-modules, overlay-structure, send-plan). The reviewer should look at: the include rule for Quick note, the chat's new "Could not …" lines for non-2xx answers, the out-of-order imports in ui.ts and `useDefineForClassFields: false` (both there to keep the bundle from growing), and the `idle` colour question above. The PRD reviewer found nothing blocking.
- 2026-09-28T13:56+08:00 — CI green on 1465ff9: check (ubuntu, windows), e2e (ubuntu) — the clean e2e run, embedded.spec's F-91 line included — and CodeQL.
- 2026-09-28T13:56+08:00 — done; closed in https://github.com/simv/crt/pull/99
