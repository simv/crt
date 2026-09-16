---
id: CRT-0015
title: Anchored threads — popover chat per annotation, marker state, page-level Chat
status: review
priority: high
created: 2026-09-16T13:05:00+08:00
updated: 2026-09-16T14:30:00+08:00
url: http://localhost:4400/
route: /
session: null
provider: claude
tags: [overlay, ux, f-65, f-66, f-67, f-68]
files: [docs/PRD.md, README.md, packages/overlay/src/ui.ts, packages/overlay/src/chat.ts, packages/overlay/src/popover.ts, packages/overlay/src/annotations.ts, packages/overlay/src/capture.ts, packages/overlay/src/index.ts, packages/server/src/capture-schema.ts, packages/server/src/intake-message.ts, packages/server/src/sessions.ts, plugin/skills/intake/SKILL.md, packages/server/e2e/capture.spec.ts, packages/server/e2e/chat.spec.ts, packages/server/e2e/focus.spec.ts, packages/server/test/popover.test.ts]
---

## Summary
The note box and the chat live under the toolbar in the corner, far from the element being pointed at, and only one chat can exist at a time; sending also wipes the markers, so there is no trace on the page of what was asked or how it is going. Move the note and the chat into a popover anchored to the selected element with **Send to <agent>** inside it, keep the marker after sending with the session's live state next to the number, let several threads run concurrently, and give the toolbar a **Chat** button for page-level conversations (PRD §6.2a, F-65…F-68).

## Context
Reported by Simon while dogfooding on the trial Next.js shop (`http://localhost:4400`, screenshot with the popover drawn next to the selected `ProductCard · article.card`). Today `OverlayUI.renderPanel` (`packages/overlay/src/ui.ts`) renders every note as a row in a `.panel` inside the bottom-right `.dock`, the toolbar carries **Quick note** and the split **Send**, `sendToAgent` calls `store.clear()` after the capture is saved, and a single `ChatPanel` (`chat.ts`) is prepended to the dock and remembers one session id in `sessionStorage`. The server already runs any number of sessions concurrently (`sessions.ts` `SessionRegistry`), so the change is overlay-side plus one optional capture field.

## Evidence
Screenshot from Simon (not stored as an asset): `/` of the trial shop with the Brass pen card selected (badge 1), the note box and Send circled where they should sit — beside the card — and the toolbar reduced to tools + Chat.

## Ask
1. `docs/PRD.md` gains §6.2a (F-65 anchored popover, F-66 chat in place, F-67 markers persist with state, F-68 page-level Chat) amending F-11/F-13/F-14 in place.
2. Overlay: one popover per annotation (`popover.ts` placement is a pure function tested from `packages/server/test`), compose → chat in the same popover, one `ChatPanel` per thread, markers with `data-state` and a state pill, toolbar `Select · Box · Pin · count · Clear · Sessions · Agent · Chat`, threads restored on reload from `sessionStorage`.
3. Server: `CaptureBundle.note` (optional, F-68) rendered as `Developer's message:` in the first message and used as the F-30 summary; the intake skill says what a zero-annotation capture means.
4. Tests updated (`capture.spec.ts`, `chat.spec.ts`, `focus.spec.ts`, schema and intake-message unit tests) and `window.__crt` hooks extended (`send({ n, quick, include, message })`, `threads()`, `togglePop`, `togglePageChat`).

## Definition of Done
- [x] Creating a Select/Box/Pin annotation opens a popover beside it with the textarea focused; typing key by key keeps focus (`focus.spec.ts`).
- [x] The popover's **Send to <agent>** captures that annotation, the marker stays, the badge/pill show `thinking…` then `your turn`, and the chat renders inside the same popover (`chat.spec.ts`).
- [x] Two annotations can be sent one after the other; each marker reports its own session state and each popover shows its own transcript (`chat.spec.ts`).
- [x] After a reload every thread re-attaches and the markers show their state again (`chat.spec.ts`).
- [x] **Chat** in the toolbar sends a zero-annotation capture whose `note` reaches the first message as `Developer's message:` (`chat.spec.ts`, `intake-message.test.ts`, `capture-schema.test.ts`).
- [x] Quick note from the popover still writes a task with the panel closed and shows the id on the status line (`chat.spec.ts` F-14 tests).
- [x] `npm run check` and `npm run e2e` pass; overlay gzipped size stays under the N-3 budget.

## Notes
One annotation = one capture = one thread by default; the "include the N other unsent annotations" checkbox keeps F-11 grouping for "these two should match" asks. Clear/delete forget threads locally only — sessions stay in the F-30 list; **Discard** in a chat is the one action that closes a server session. The `.status` line is kept for capture progress, errors and quick-note results.

## Log
- 2026-09-16T13:05+08:00 — created from Simon's screenshot and notes; PRD §6.2a written first; claimed on branch `feat/anchored-chat`.
- 2026-09-16T13:40+08:00 — server: `CaptureBundle.note` (optional) + `Developer's message:` line + zero-annotation wording; skill step 1 sentence; `capture-schema.test.ts` and `intake-message.test.ts` cover it (F-68). Overlay: `popover.ts` (pure placement, `popover.test.ts` 6 cases), `Annotation.sessionId`, `capture(store, { ids, note })`, `ChatPanel` per thread (static session helpers, `watch`, `onChange`/`onAttention`/`onDiscard`), `ui.ts` rewritten around popovers/threads/marker state, toolbar `Select · Box · Pin · count · Clear · Sessions · Agent · Chat`.
- 2026-09-16T13:55+08:00 — found a reload race: every re-attached thread's replayed `permission` event called `show(true)`, so the last replay stole the popover. Fix: the SSE stream now ends its replay with a named `event: live` frame (plain `onmessage` never sees it), the panel only asks for attention on live permissions, and the UI opens the thread only when no other popover is in use (else marker pulses + status line). Markers now render above popovers so a badge under someone else's popover stays clickable. `sessions.test.ts` asserts the `live` frame.
- 2026-09-16T14:00+08:00 — verified: `npm run check` exits 0 (typecheck, 249 unit tests, build; overlay 34 KB gzipped of the 150 KB N-3 budget); `npm run e2e` 40/40 three runs in a row (`focus.spec.ts` F-11/F-65; `capture.spec.ts` popover beside the element, grouped send keeps both markers bound to one session; `chat.spec.ts` new "anchored threads" block: two concurrent threads + reload + Clear, page-level Chat with `Developer's message` and the Chat-button state dot; existing F-14/F-27/F-29/F-30/F-56 tests moved to popover-scoped selectors). `claude plugin validate` passes for both manifests. Manual on the trial shop (:3100 behind the branch build on :4410, real Claude): popover beside the Brass pen card, Send → chat in place, amber `thinking…` pill, second thread on the cart total while the first ran, blue `your turn` on #1, both restored after a reload; page Chat compose docks above the toolbar. Ready for review.
- 2026-09-16T14:30+08:00 — Simon: a selection outline drew over the popover. Popovers are topmost again (markers layer below `.pops`); the e2e thread test closes the open popover with × before clicking a badge under it. e2e 40/40; :4410 restarted on the new build.
