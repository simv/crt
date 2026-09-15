---
id: CRT-0007
title: Note textarea loses focus on every keystroke
status: done
priority: high
created: 2026-09-15T13:20:00+08:00
updated: 2026-09-15T13:40:00+08:00
url: null
route: null
session: null
tags: [bug, overlay, f-11]
files: [packages/overlay/src/ui.ts, packages/server/e2e/focus.spec.ts, packages/server/e2e/chat.spec.ts]
---

## Summary
After selecting an element on the page, typing into its note textarea in the CRT panel drops focus after every keypress, so a note can only be written one character at a time. Blocking for the core annotate → note → send flow (F-11).

## Context
Reported by Simon while dogfooding CRT. Every `input` event on a note calls `store.setNote`, the store notifies its subscriber, `Overlay.render()` runs and `renderPanel()` rebuilt the panel with `this.panel.replaceChildren(frag)`. The rows were reused, but removing a focused node from the document blurs it even if the same node is re-inserted a moment later — so the caret was lost on each keystroke. The existing e2e note test used Playwright `fill()`, which fires a single `input` event, so it never exercised this.

## Evidence
`packages/server/e2e/focus.spec.ts` (new) clicks a note, presses keys one at a time and asserts the shadow root's `activeElement` is still that textarea after each press. Before the fix it failed on the first key: `Expected: "1", Received: null`.

## Ask
Make `renderPanel()` reconcile rows in place: drop rows whose annotation is gone, patch number/label/value on the ones that remain, create missing ones, and only call `insertBefore` for a row whose index actually changed. Never detach the focused row. Add a per-keystroke e2e test for the note textarea, and make the chat spec type its reply key by key so the chat textarea is covered the same way.

## Definition of Done
- [x] Typing a multi-character note through real key presses keeps focus and produces the full string (`e2e/focus.spec.ts`).
- [x] Chat textarea reply is typed key by key in `e2e/chat.spec.ts` and stays focused throughout.
- [x] Deleting or clearing annotations still renumbers and removes rows (`notes, numbering, delete and clear (F-11)` still passes).
- [x] `npm run check` and `npm run e2e` pass.

## Notes
The chat textarea (`ChatPanel`) was never affected — nothing re-renders it on input — but "chat box" in the report is the note textarea that appears under the toolbar after a selection, which is exactly the path above.

## Log
- 2026-09-15T13:20+08:00 — claimed; reproduced with a per-keystroke Playwright test (focus lost after the first key).
- 2026-09-15T13:30+08:00 — fixed `renderPanel` to reconcile in place (stale rows removed first, positional `insertBefore` only when a row's index changed). Focus test passes; capture + chat specs pass (24/24).
- 2026-09-15T13:36+08:00 — verified: `npm run check` exits 0 (typecheck, lint, 122 unit tests, overlay + server build). Ready for review.
- 2026-09-15T13:40+08:00 — done; merged in https://github.com/simv/crt/pull/13
