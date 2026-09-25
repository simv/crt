---
id: CRT-0039
title: Overlay hot paths — no per-frame layout thrash while annotations exist, throttled hover, cheap keystrokes and streaming (N-3)
status: in_progress
priority: normal
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-25T23:57:00+08:00
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
- [ ] New e2e test: page with 3 annotations and the toolbar closed. Over 1 s idle, `requestAnimationFrame` callbacks from the overlay are 0, e.g. via an injected counter or a Performance trace.
- [ ] New e2e test: scroll the page and resize an anchored element; badge and popover positions still match their elements (as `e2e/capture.spec.ts` / `chat.spec.ts` assert today).
- [ ] New unit test next to `test/owner-stack.test.ts`: the cheap name path returns the same name as `detectComponents(el)[0]` on the React 18 and 19 fixtures.
- [ ] New e2e test: type into a note, reload within the debounce window after a `pagehide` flush; the note is restored (F-12).
- [ ] A streamed 20 KB proposal renders identically to before: the same final DOM text, and the N-30 fold still works.
- [ ] `npm run check` green; `npm run e2e` green; `npm run screenshots` output unchanged beyond font rasterisation (N-27).

## Notes
Needs a markdown unit test before step 4; CRT-0043 adds `markdown.test.ts`. Either land that first, or add the test here.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
- 2026-09-25T23:57+08:00 — claimed by /crt:next, session ecf91d1f-6f24-40b1-8d3c-463d5b303498, branch crt/CRT-0039-overlay-hot-paths (worked in the worktree .claude/worktrees/CRT-0039, off origin/main 0c4e02c)
