---
id: CRT-0039
title: Overlay hot paths — no per-frame layout thrash while annotations exist, throttled hover, cheap keystrokes and streaming (N-3)
status: done
priority: normal
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-26T00:57:00+08:00
url: null
route: null
session: null
tags: [review-2026-09, performance, overlay, n-3]
files: [packages/overlay/src/ui.ts, packages/overlay/src/component.ts, packages/overlay/src/annotations.ts, packages/overlay/src/chat.ts]
---

## Summary
N-3 says the overlay adds "no measurable jank to the host page when idle". Today it does, as soon as one annotation exists: a `requestAnimationFrame` loop alternates layout reads and style writes for every annotation, every frame, even with the toolbar closed. Hover, typing and streaming also do more work than they need to. This matters because the host page is the developer's own app, and CRT would skew their performance profiling.

## Context
- **Frame loop:** `packages/overlay/src/ui.ts:1430-1442`. `ensureTick` keeps the loop running whenever `store.count() > 0`. Each frame, `positionAll` (`:1457-1500`):
  - reads `getBoundingClientRect` (`:1450`) and writes styles (`:1472-1487`), per annotation;
  - reads `pop.offsetWidth/offsetHeight` and `dock.getBoundingClientRect()` inside that loop (`:1491`, `:1511`);
  - calls `positionDocked`, which reads `offsetHeight` after those writes (`:1266`).
- **Hover:** `ui.ts:1566-1572`. Every `pointermove` calls `elementsFromPoint`, then `setCandidate` (`getBoundingClientRect`, `nearestComponentName`, `innerHTML`). `nearestComponentName` (`component.ts:226`) runs the full `detectComponents`, which reads and parses React 19 `_debugStack.stack` for each owner (`component.ts:99-101`). Reading `.stack` makes V8 format the trace.
- **Keystrokes:** `annotations.ts:120` `setNote` → `persist()` JSON-serialises every annotation (each with up to 2 × 4 KB of outer HTML), per keystroke. Then `render()` rebuilds every marker, badge and pill with new listeners (`ui.ts:1394-1426`). `ChatPanel.snapshot()` copies the whole event log (`chat.ts:244`) once per threaded annotation (`ui.ts:1398`), and twice for the page chat (`:1383`).
- **Streaming:** each `text` delta re-renders the whole accumulated message's markdown and re-queries its bubble (`chat.ts:490-497`), so cost grows with the square of the message length.

## Evidence
No page capture: from the code review in session e145e7ac, 2026-09-24. The frame loop was confirmed by reading `ensureTick` / `tick`.

## Ask
1. **Frame loop:** read every rect first, then write, and only when a value changed (cache the last rect per annotation). Drive updates from capture-phase passive `scroll`, `resize` and a `ResizeObserver` on the anchored elements. Run the per-frame loop only while a popover is open or a drag is in progress.
2. **Hover:** save the pointer position and handle it once per animation frame; skip when the hit element is unchanged. Add a cheap `nearestComponentName` that stops at the first named owner without looking up the source. Keep the full `detectComponents` for Send.
3. **Keystrokes:** debounce `persist` (trailing, ~250 ms, and flush on `pagehide` / before Send). Update markers in place instead of rebuilding them, with one delegated click listener on `.markers`. Add `ChatPanel.status(): { state, taskId }` so `render` never copies event logs.
4. **Streaming:** cache each bubble by message id and re-render the markdown at most once per animation frame.

## Definition of Done
- [x] New e2e test: page with 3 annotations and the toolbar closed. Over 1 s idle, `requestAnimationFrame` callbacks from the overlay are 0, e.g. via an injected counter or a Performance trace.
- [x] New e2e test: scroll the page and resize an anchored element; badge and popover positions still match their elements (as `e2e/capture.spec.ts` / `chat.spec.ts` assert today).
- [x] New unit test next to `test/owner-stack.test.ts`: the cheap name path returns the same name as `detectComponents(el)[0]` on the React 18 and 19 fixtures.
- [x] New e2e test: type into a note, reload within the debounce window after a `pagehide` flush; the note is restored (F-12).
- [x] A streamed 20 KB proposal renders identically to before: the same final DOM text, and the N-30 fold still works.
- [x] `npm run check` green; `npm run e2e` green; `npm run screenshots` output unchanged beyond font rasterisation (N-27).

## Notes
Needs a markdown unit test before step 4; CRT-0043 adds `markdown.test.ts`. Either land that first, or add the test here.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
- 2026-09-25T23:57+08:00 — claimed by /crt:next, session ecf91d1f-6f24-40b1-8d3c-463d5b303498, branch crt/CRT-0039-overlay-hot-paths (worked in the worktree .claude/worktrees/CRT-0039, off origin/main 0c4e02c)
- 2026-09-26T00:10+08:00 — decisions: (1) positions follow a capture-phase passive `scroll` on `document`, `resize`, and one ResizeObserver on every Select annotation's element plus `document.documentElement` (content growing above an anchor moves it without resizing it; box and pin annotations are document-anchored, so scroll covers them); the per-frame loop runs while a popover is open with the toolbar up or while the launcher is dragged; `positionAll` reads every rect, the popover size, the dock rect and the docked bottom first, then writes, a marker only when its `x,y,w,h,detached` key changed. (2) Hover keeps the last pointer position and hit-tests in one rAF, skipping an unchanged element; a pointerup flushes a pending hit test so the click commits what is under it; `hoverAt` (tests, arrow keys) stays synchronous. `nearestComponentName` walks the owner chain to the first named owner, then the parent tree, then Vue, and never calls `sourceOf`. (3) Only `setNote` is debounced (250 ms, `PERSIST_DEBOUNCE_MS`); add/remove/clear/setSession still persist at once; `flush()` runs on `pagehide` and at the start of `sendToAgent`. (4) `ChatPanel` keeps bubbles in a map and dirty ids in a set; every non-`text` event renders pending text first, so `assistant_end`/`result` fold fully rendered text. Added `test/markdown.test.ts` here (Notes), before relying on it.
- 2026-09-26T00:53+08:00 — verified: idle frames — `e2e/capture.spec.ts` › overlay hot paths › "with 3 annotations and the toolbar closed, the overlay requests no animation frame over 1 s idle (N-3)": an init script counts `requestAnimationFrame` calls whose stack names `/__crt/overlay.js`; > 0 while the markers are placed (the counter works), then 0 over 1 s.
- 2026-09-26T00:53+08:00 — verified: positions — "markers follow a resized element, the content it pushes down, and a scroll; the open popover follows too (F-65)": toolbar closed, growing `#heading` moves its marker and the price's below it, a scroll moves both; the popover opens beside the price and tracks a scroll and a padding change; after closing it, removing `#heading` dims its marker (`detached`).
- 2026-09-26T00:53+08:00 — verified: cheap name — `test/component-name.test.ts` (9 tests): React 18 (`_debugSource`: function, class, forwardRef, memo, unnamed owners, production parent-tree fallback, fiber-but-no-name with Vue above) and React 19 (`_debugStack` getters counted: 0 reads on the cheap path, > 0 on `detectComponents`; server-component owners, an unnamed one skipped) fixtures, Vue 2/3 and plain; each equals `detectComponents(el).components[0]?.name`. e2e "the hover label names the component the capture names first, on the React 18 page (F-8, F-18)". On the real trial app (tool-validation, Next 16.3.5 / React 19.2.8, this build's `crt serve` on :4400): 45 hovered elements, 6 names (Header, LinkComponent, HomePage, Shop, ProductCard, CartSummary), 0 mismatches with `componentsFor(el).components[0]`.
- 2026-09-26T00:53+08:00 — verified: note flush — "a note typed just before a reload is kept: its debounced write is flushed on pagehide (F-12)": the page clock is paused, the note is typed key by key into the popover's textarea, sessionStorage does not hold it yet, reload, the note is restored.
- 2026-09-26T00:53+08:00 — verified: streaming — `e2e/chat.spec.ts` › streaming (N-3) › "a 20 KB proposal streamed word by word renders exactly as it does in one piece…": a scripted EventSource feeds two sessions the same 21 KB proposal (240 checklist items), one in a single delta and one in ~3,900 word deltas across macrotasks; the bubbles' innerHTML and textContent are equal before the fold and after it; the streamed bubble was rendered fewer than deltas/10 times; the pill reads `Definition of done · 240 items` and opens all 240 items. The existing F-120 / N-30 fold tests pass unchanged. `test/markdown.test.ts` (7 tests) pins `renderMarkdown`.
- 2026-09-26T00:53+08:00 — verified: `npm run check` exit 0 (typecheck, lint, 54 files / 728 unit tests, build); `npm run e2e` 74/74 at the default workers (1.0 min) and 74/74 at `--workers=2`, the four hot-path tests re-run green after the last edit; `npm run screenshots` 5/5: `select.png` and `marker-states.png` byte-identical to the committed files, `arrival.png` differs only in the welcome card's project path and `landing.png` only in its clock readings (both expected, docs/images/README.md). `chat.png` differs in the session id and a 1-CSS-px taller `Capture` pill. A baseline build of origin/main 0c4e02c in a scratch worktree renders that pill exactly as this branch does, so the committed image predates this change. The same baseline leaves the transcript 4–14 px scrolled in 4 of 4 runs (the smooth-scroll flake; flagged as a separate follow-up). Regenerated PNGs not committed. Overlay bundle 38.0 KB gz (N-3 budget 150 KB).
- 2026-09-26T00:53+08:00 — ready for review: changed packages/overlay/src/{ui,component,annotations,chat}.ts, packages/server/e2e/{capture,chat}.spec.ts, new packages/server/test/{component-name,markdown}.test.ts. Reviewer notes: markers now follow scroll, resize and ResizeObserver entries (the anchor, the document) instead of every frame. An element that moves without resizing and without changing the document's size (a sibling's transform, an absolutely positioned shift) keeps a stale marker until the next scroll/resize or until its popover opens. That is the Ask's design; the prd-reviewer agent flagged it too. `setNote` still notifies listeners on every keystroke (render is now in place and cheap); only the sessionStorage write is debounced. The `crt serve` run in tool-validation pruned 5 captures older than 7 days there (F-23 on server start; gitignored files).
- 2026-09-26T00:57+08:00 — done; closed in https://github.com/simv/crt/pull/95 (CI green on 01024ea)
