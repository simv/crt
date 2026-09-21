---
id: CRT-0026
title: M22 — Reproducible screenshots (npm run screenshots over the e2e fixture and the stub) and the two SVG illustrations
status: backlog
priority: high
created: 2026-09-21T19:55:00+08:00
updated: 2026-09-21T19:55:00+08:00
url: null
route: null
session: null
tags: [m22, screenshots, illustrations, f-116, f-117, n-27, prd-polish]
files: [packages/server/e2e/screenshots.spec.ts, packages/server/playwright.config.ts, package.json, packages/server/src/providers/stub.ts, docs/images/README.md, docs/images/arrival.png, docs/images/select.png, docs/images/chat.png, docs/images/marker-states.png, docs/images/landing.png, docs/images/loop.svg, docs/images/loop-dark.svg, docs/images/architecture.svg, docs/images/architecture-dark.svg, packages/server/test/docs-images.test.ts, CLAUDE.md]
---

## Summary
The README has no picture of the product. Build one command, `npm run screenshots`, that starts the e2e fixture app and a `CRT_SESSION_STUB=1` embedded CRT server, drives the overlay to five states and writes five PNGs into `docs/images/` deterministically (fixed clock, cleared storage, animations disabled, waits on the overlay's own signals), and draw the two illustrations — the loop and the architecture — as hand-made SVG in light and dark files. The README task (M23) embeds them. `docs/PRD-polish.md` §5.3, F-116, F-117, N-27.

## Context
The e2e infrastructure is `packages/server/playwright.config.ts` + `e2e/fixture/server.mjs` (the fixture app on :3999 — a shop page with `[data-testid=cart-total]`, the loader tag, `?crt=<origin>` picking a CRT origin) + `e2e/fixture/crt.mjs` (starts CRT servers from a scratch project with `CRT_SESSION_STUB=1`); the specs (`capture.spec.ts`, `chat.spec.ts`, `arrival.spec.ts`, `focus.spec.ts`, `embedded.spec.ts`) show how to drive the overlay: `window.__crt` (`welcome()`, `checkHealth()`, `healthState()`, `loader`), the launcher `.launcher[data-health]`, the toolbar buttons, markers `.mark[data-state]` and their pills (`thinking…` / `needs permission` / `your turn` / the task ID — `ui.ts`, `popover.ts`), Shadow DOM under `#crt-host`. The stub provider (`packages/server/src/providers/stub.ts`) scripts an intake: streamed text, a tool line, a DoD proposal, `write_task` on accept; whether it scripts a permission card and the `your turn` state is for the builder to check (`chat.spec.ts` covers permissions if it does) — PRD-polish §12 rule 4 allows extending its script minimally without changing the e2e behaviour under `CRT_SESSION_STUB=1`. The landing page for `landing.png` is M21's (`/` on the stub server). Playwright offers `page.clock`, `animations: "disabled"` on `screenshot()`, `deviceScaleFactor` and `colorScheme` in `browser.newContext`. Brand geometry and colours for the illustrations: `docs/brand/` (M20), `packages/overlay/src/tokens.ts`. GitHub renders SVG through `<img>`: no page CSS, `currentColor` is black — hence fixed colours and separate dark files.

## Evidence
No page capture: created from `docs/PRD-polish.md` milestone M22 by the planning session. The design review (`docs/design/design-review-2026-09-21.md` §C, §D T3) named the five screenshots and the two illustrations.

## Ask
1. **`e2e/screenshots.spec.ts`** (or `scripts/screenshots.mjs` if a spec cannot own the servers cleanly — say why in the Log), run by `npm run screenshots` from the repo root (a Playwright project or config that is *not* part of `npm run e2e` and never runs in CI): viewport 1280 × 800, `deviceScaleFactor: 2`, `colorScheme: "light"`, `page.clock` fixed, storage cleared, `animations: "disabled"` on every capture, waits on `data-health`, `data-state` and the popover's own elements, never a fixed sleep over 500 ms (N-27). Writes to `docs/images/`:
   - `arrival.png` — the fixture page, the CRT pill bottom-right, the welcome card open (`window.__crt.welcome()`);
   - `select.png` — Select armed, the hover outline and label on the cart total, one pinned marker with its popover and a typed note;
   - `chat.png` — the popover as the chat: the stub's streamed text, one collapsed tool line, an **Allow / Deny** card;
   - `marker-states.png` — three markers on one page: `thinking…`, `your turn`, `CRT-0007` (three stub sessions, or one session stepped through and composited by three captures cropped to the markers — prefer three sessions);
   - `landing.png` — the M21 landing page on the stub server (`/`), light.
   Each ≤ 400 KB (target 250 KB). If the stub cannot produce a state, extend `stub.ts`'s script (a `CRT_STUB_SCRIPT` variant or a stub message that triggers a permission card) without changing what the e2e specs see.
2. **Illustrations** (F-117, Should): `docs/images/loop.svg` + `loop-dark.svg` (browser with the pill → annotation with a badge → chat → task file → `/crt:next` → PR, one arrow back), `architecture.svg` + `architecture-dark.svg` (the app on its own origin with the loader and the overlay ⇄ `127.0.0.1:4400` → agent session → `write_task` → `.crt/tasks/`); hand-drawn on the brand geometry, fixed colours only (no `currentColor`, no CSS variables, no `<style>`), system-ui text allowed with a generic fallback, ≤ 10 KB each.
3. **`docs/images/README.md`**: what each file shows, how to regenerate (`npm run screenshots`), that the PNGs are never hand-edited and never diffed in CI, and that the SVGs are hand-drawn.
4. **Test** `test/docs-images.test.ts`: every image referenced by `README.md`, `packages/server/README.md` and `docs/*.md` exists (a relative-path scan; M23 adds the references — until then the test covers the files that exist) and is under budget (PNG ≤ 400 KB, SVG ≤ 10 KB); each SVG has a `viewBox` and no `currentColor`/`var(`/`<style>`.
5. **`CLAUDE.md`**: Commands gains `npm run screenshots`; Don'ts gains "never hand-edit `docs/images/*.png`" (PRD-polish §9).

## Definition of Done
- [ ] `npm run screenshots` from a clean checkout (after `npm run build`) writes the five PNGs; a second run differs only by font rasterisation (compare sizes and a visual check; noted in the Log) — N-27.
- [ ] `test/docs-images.test.ts` green; every PNG ≤ 400 KB, every SVG ≤ 10 KB.
- [ ] `npm run check` and `npm run e2e` green; the stub's e2e behaviour unchanged (chat.spec, capture.spec).
- [ ] The four SVGs render on GitHub in light and dark (open the PR's file view, or a gist, in both themes — screenshots in the Log). Manual, run by the worker session (standing rule 2026-09-18).
- [ ] `docs/images/README.md` and the `CLAUDE.md` lines in place; the PNGs and SVGs committed.

## Notes
Depends on CRT-0024 (tokens, brand geometry). `landing.png` needs CRT-0025 merged; if it is not when this task runs, leave `landing.png` out, say so in the Log, and CRT-0027 (the README) adds it with the same script. Do not add the screenshot project to CI (pixel diffs flake); the test only checks existence and size. Keep the fixture page as it is — the screenshots are of the fixture, not of a real product; that is fine for the README because what matters is the overlay. Light only for PNGs (GitHub dark mode readers see a light screenshot in a frame, which is normal); the SVGs are the ones that switch.

## Log
- 2026-09-21T19:55+08:00 — created from docs/PRD-polish.md milestone M22 by the planning session that wrote it (session 78b6555f-fedb-4424-b1ab-1d8477f99af8), split out of the README task on the design review's advice (§D: T3 screenshots + SVGs before T4 README).
