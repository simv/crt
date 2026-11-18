---
id: CRT-0062
title: M40 — The extension with no CRT server: the review kept in the browser
status: review
priority: normal
created: 2026-11-18T08:28:00+08:00
updated: 2026-11-18T08:50:00+08:00
url: null
route: null
session: null
tags: [extension, standalone, m40, f-165, f-166, f-167, n-48, prd-connect]
files: [docs/PRD-connect.md, docs/spikes/connect-2026-11.md, packages/overlay/src/extension/standalone.ts, packages/overlay/src/extension/review-items.ts, packages/overlay/src/extension/idb.ts, packages/overlay/src/extension/review.ts, packages/overlay/src/extension/review.html, packages/overlay/src/extension/worker.ts, packages/overlay/src/extension/manifest.json, packages/overlay/build.mjs, packages/server/test/extension-standalone.test.ts, packages/server/e2e/extension.spec.ts]
---

## Summary
The extension needs a CRT server running in the reviewed project's folder. Let it work with none: the worker answers the overlay's routes itself and keeps the review in the browser, with a page to read it, keep or drop items, and copy or download it as Markdown.

## Context
- PRD-connect §5.1–§5.3, F-165, F-166, F-167, N-48. The spike is `docs/spikes/connect-2026-11.md`.
- The overlay's transport already ends in the worker (PRD-extension F-151, F-157), so the overlay itself does not change.
- A default or a site's choice that names a server behaves as in v0.10, the F-159 pill included.

## Evidence
No page capture. Simon, 2026-11-18: "what i actually want is the user to just install the extension, connect the extension to claude and then choose where to send feedback to … the user shouldn't have to run commands to edit the folder of the project they are reviewing." He chose "Claude in the cloud first" from the proposal (https://claude.ai/artifact/JiA81f15bwmChPF9CzyTW2) and said "build on the branch".

## Ask
1. **The spike** — what Claude offers a third party, and the fire address's answer to a bad token.
2. **The target** — `targetFor`: a site's choice, the default, else `auto` (port 4400 when it answers, else this browser), pinned per tab.
3. **Standalone routes** — health, providers, captures, sessions and the stream over a key-value store (IndexedDB), with review-local ids.
4. **The review page** — list by site, keep / drop, delete, screenshot, copy and download as Markdown; "Open review" on the toolbar button's menu and Alt+Shift+R.

## Definition of Done
- [x] With no server started, turning a site on mounts the overlay and Send keeps the item; the panel shows the words, the id and where it goes; a later message is added; a reload re-attaches (F-165, F-166; e2e).
- [x] The standalone routes over an in-memory store: ids, pictures, per-site isolation, the stream's replay, the refusals (unit rows).
- [x] The review page lists the item, drops and keeps it, and shows what is sent (F-167; e2e); the Markdown keeps page text in code spans (unit rows).
- [x] In standalone mode the worker makes no request (N-48; the grep row in `test/extension.test.ts`).
- [x] The nine earlier extension e2e tests pass with no assertion weakened (one gained the new option's label).
- [ ] `npm run check` green; `npm run e2e` green in CI.

## Notes
- The manifest gains `contextMenus` (the menu entry) and a second page. The permission pin in `test/extension.test.ts` moved with it.
- A page under a policy that forbids `data:` images, when Chrome refuses the tab capture, gets no screenshot in standalone mode: the rasteriser frame is a server page. The capture says why.

## Log
- 2026-11-18T08:28+08:00 — created and claimed (in_progress) on Simon's choice of "Claude in the cloud first".
- 2026-11-18T08:50+08:00 — built as described; `test/extension.test.ts` and `test/extension-standalone.test.ts` 26 rows green, `e2e/extension.spec.ts` 10 of 10 green locally. Status → review.
