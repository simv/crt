---
id: CRT-0058
title: M37 — The overlay seams: transport, probe, storage and rasteriser behind one module each, with no change in behaviour
status: review
priority: high
created: 2026-11-17T13:40:00+08:00
updated: 2026-11-17T16:06:00+08:00
url: null
route: null
session: null
tags: [m37, extension, overlay, f-151, f-152, f-153, f-158, n-41, prd-extension]
files: [docs/PRD-extension.md, docs/spikes/extension-2026-11.md, packages/overlay/src/api.ts, packages/overlay/src/health.ts, packages/overlay/src/chat.ts, packages/overlay/src/component.ts, packages/overlay/src/console-hook.ts, packages/overlay/src/network-hook.ts, packages/overlay/src/storage.ts, packages/overlay/src/screenshot.ts, packages/server/test/overlay-structure.test.ts]
---

## Summary
The overlay assumes it shares the page's JavaScript world and makes its own requests. An extension cannot give it either (the spike, rows 3 and 5). Put the four places where that assumption lives behind one module each, with today's behaviour as the default, so the same overlay source can later run in an extension's isolated world. Nothing a developer sees changes in this task.

## Context
- `packages/overlay/src/api.ts` `crtJson`, `health.ts` and the `EventSource` in `chat.ts` are the overlay's calls to the server; `base.ts` `crtUrl` builds their URLs.
- `console-hook.ts` and `network-hook.ts` keep their logs on `window.__crt`; `component.ts` reads framework properties off DOM nodes (`__reactFiber$…`, `__vueParentComponent`, `__vue__`, `window.__svelte`).
- `storage.ts` wraps Web Storage; `loader.ts` keeps its own on purpose (N-20).
- `screenshot.ts` `rasteriseViewport` is the in-page rasteriser and the raster frame.
- `test/overlay-structure.test.ts` already pins structural rules of the overlay with greps.

## Evidence
No page capture: created from `docs/PRD-extension.md` milestone M37. The spike is `docs/spikes/extension-2026-11.md`.

## Ask
1. **Transport (F-151)** — one module with `json(path, init)` and `events(path, onEvent)` and a settable implementation; the default is today's `fetch` / `EventSource` on `crtUrl(path)`. `api.ts`, `health.ts` and `chat.ts` use it; nothing else in the overlay calls `fetch`, `EventSource` or `crtUrl` for a CRT route.
2. **Probe (F-152)** — one module through which the overlay reads the console log, the network log and the framework lookups; the default calls them directly. Define the cross-world message shapes (JSON, bounded by the logs' existing limits) and the lookup-by-DOM-event round trip, with their unit rows; the extension's entry files are M38.
3. **Storage (F-153)** — a backing choice in `storage.ts`, Web Storage by default; every key keeps its name.
4. **Rasteriser (F-158, default only)** — `takeScreenshots` asks a settable `rasteriser` for the viewport canvas; the default is the code as it stands.
5. **Tests** — a fake transport row, the probe rows, the storage rows against two backings, the grep rows in `overlay-structure.test.ts`.
6. **Docs and guards** — `CLAUDE.md` Conventions gains the seam rule per PRD-extension §9.

## Definition of Done
- [x] No overlay module but the transport calls `fetch`, `EventSource` or `crtUrl` for a `/__crt/` route (F-151; a grep row).
- [x] The console log, the network log and the framework lookups are read through the probe module only (F-152; a grep row).
- [x] The storage rows pass against Web Storage and against a second, in-memory backing (F-153).
- [x] `takeScreenshots` draws markers and crops on whatever canvas the rasteriser returns (F-158; a unit row with a fake rasteriser).
- [x] `npm run e2e` green with no assertion changed in any existing spec (N-41; `git diff main -- packages/server/e2e` shows no changed assertion).
- [x] The gzipped sizes of `overlay.js`, `loader.js` and `loader-inject.js` before and after are in the Log, within budget (N-20, N-41).
- [x] `npm run check` green.

## Notes
Read `docs/PRD-extension.md` §5.1, §5.2, §6.1, §7 and §12 rule 1, and the spike. A refactor: if a behaviour has to change to make a seam fit, stop and say so in the Log before changing it. M38 needs this task.

## Log
- 2026-11-17T13:40+08:00 — created from docs/PRD-extension.md by the planning session that wrote it (Claude Code cloud session 01KVgoZguPBAwZVMCJYTTptL), after Simon's request of 2026-11-17 to review any site on its real URL without a proxy or an edit to the app. Not to be started until Simon says "build it".
- 2026-11-17T16:00+08:00 — claimed (in_progress) on Simon's "Build it" of 2026-11-17 and built in the pull request that carries the PRD (https://github.com/simv/crt/pull/134): `transport.ts`, `probe.ts` + `probe-wire.ts`, `bag.ts`, the backing in `storage.ts`, the rasteriser in `screenshot.ts`, `mount.ts`; `api.ts`, `health.ts`, `chat.ts`, `ui.ts`, `capture.ts`, `element.ts`, `tools.ts` moved onto them.
- 2026-11-17T16:00+08:00 — verified: DoD 1, 2 — `test/overlay-structure.test.ts` (the grep rows) and `test/overlay-seams.test.ts` (16 rows: a fake transport, the two-realm probe round trip, both storage backings, a fake rasteriser). DoD 3, 4 — the same file. DoD 5 — the full e2e run with no assertion changed in any existing spec; the two failures it shows (`embedded.spec.ts` "health says embedded…", and on some runs `chat.spec.ts` "Stop interrupts the turn…") fail the same way on `main` in this container.
- 2026-11-17T16:00+08:00 — DoD 6 — bytes / gzip, before → after: `overlay.js` 128631 / 40127 → 129837 / 40621; `loader.js` 6941 / 2996 → 6995 / 3046; `loader-inject.js` 6904 / 3008 → 6958 / 3057; `early.js` 3484 / 1462 → 3538 / 1510. The loader stays within its N-20 budget (`test/loader.test.ts`).
- 2026-11-17T16:00+08:00 — DoD 7 (`npm run check`) left unticked until CI says so: locally everything is green but `test/providers/exec.test.ts` "kills a process and its children", which fails the same way on `main` in this container.
- 2026-11-17T16:00+08:00 — beyond the Ask: `capture-schema.ts` takes the optional `screenshots.via` (`page` | `browser`), which the rasteriser seam reports (F-158); `loader.ts` exports `mountPill` for the extension's own "server not running" line.
- 2026-11-17T16:06+08:00 — verified: CI green on 04f4bd8 — `check (ubuntu-latest)`, `check (windows-latest)` and `e2e (ubuntu)` (https://github.com/simv/crt/actions/runs/44043269973); the `npm run check` / `npm run e2e` row ticked. The Manual rows stay open.
