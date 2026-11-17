---
id: CRT-0059
title: M38 — The extension: the overlay on any site the developer turns it on for, through a Manifest V3 extension for Chrome and Edge
status: review
priority: high
created: 2026-11-17T13:40:00+08:00
updated: 2026-11-17T16:06:00+08:00
url: null
route: null
session: null
tags: [m38, extension, f-154, f-155, f-156, f-157, f-158, f-159, f-160, n-42, n-43, n-44, prd-extension]
files: [docs/PRD-extension.md, docs/spikes/extension-2026-11.md, docs/spikes/extension-2026-11/ext/manifest.json, packages/overlay/build.mjs, packages/overlay/src/loader.ts, packages/server/src/capture-schema.ts, packages/server/src/http.ts, packages/server/e2e/helpers.ts, packages/server/e2e/browser.spec.ts, packages/server/e2e/fixture/server.mjs]
---

## Summary
Build the extension: a probe in the page's world, the overlay in an isolated world, and a service worker that is the only thing talking to the CRT server. The developer turns CRT on for a site with the toolbar button; from then on the overlay is on that site's real URL in their own browser, with nothing in the app and the app's security policy untouched.

## Context
- The spike (`docs/spikes/extension-2026-11.md`, runnable: `node docs/spikes/extension-2026-11/run.mjs`) proves each mechanism against a strict policy in Playwright's Chromium and is the starting point for the manifest, the worker's fetch and stream relay, and the e2e launch arguments.
- M37 (CRT-0058) left the overlay with four seams whose defaults are today's behaviour; this task supplies the extension's implementations.
- `packages/overlay/build.mjs` builds every overlay output with the esbuild API into `packages/server/dist/`.
- `e2e/browser.spec.ts` and the fixture's `/untouched` page (no integration, a policy) are the nearest existing e2e; `e2e/helpers.ts` holds the `PORTS` registry and `startCrt`.
- `http.ts` `applyCors` sends no header to a non-loopback origin and refuses nothing; `capture-schema.ts` describes the page URL as "the CRT origin".

## Evidence
No page capture: created from `docs/PRD-extension.md` milestone M38.

## Ask
1. **The package (F-154)** — `packages/overlay/src/extension/`: `manifest.json`, `probe.ts`, `content.ts`, `worker.ts`, the popup, icons from the mark; built into `packages/server/dist/extension/`; permissions exactly as F-154 lists them; the version is the package's.
2. **On and off (F-155)** — the §5.3 flow: click or shortcut, the one-origin permission, `registerContentScripts` (probe in `MAIN` at `document_start`), immediate injection, the badge, off again, kept across a restart.
3. **Mount (F-156)** — the overlay in the isolated world with a closed root and no global; stand down where the page already has a CRT loader.
4. **The bridge (F-157)** — JSON calls and the event stream over `chrome.runtime`, to the configured loopback origin only; reconnect from the last event id.
5. **Screenshots (F-158)** — `captureVisibleTab` with the overlay hidden; the default rasteriser on refusal; `capture.json` records which.
6. **What is wrong (F-159)** — the no-server pill and the different-project state (the version line is M39).
7. **Any site (F-160)** — a non-loopback page URL accepted by the capture path (§12 rule 5), the server's own origin checks untouched.
8. **Tests** — `e2e/extension.spec.ts` per PRD-extension §5.6 and the F-rows; unit rows for the manifest and the worker's origin check; the N-42 row (a page script tries to post a capture and start a session and cannot).
9. **Docs and guards** — `CLAUDE.md` and the reviewer agent's rows per §9.

## Definition of Done
- [x] The built manifest has exactly the permissions of F-154 and the package's version (a unit row).
- [x] On a page with `default-src 'self'` and no CRT in the app: the launcher is visible, the app's first `console.error` and a React component name are in the capture, and `window.__crt` is undefined in the page (F-156; e2e).
- [x] A full stub intake through the extension writes a task file, and an event stream held past 30 s keeps delivering (F-157; e2e).
- [x] Turned off, the site has no CRT element, no registered script and no `crt.*` storage key; a site never turned on was never injected (F-155, N-43, N-44; e2e).
- [x] A page script cannot post a capture or start a session through the extension (N-42; e2e).
- [x] The same on a mapped non-loopback host name (F-160; e2e).
- [x] When the capture is refused the screenshot comes from the in-page rasteriser and `capture.json` says so (F-158; e2e).
- [x] No request header rule, no `declarativeNetRequest`, no request to a non-loopback host anywhere under `extension/` (N-43, N-44; a grep row).
- [x] `npm run check` green; `npm run e2e` green.
- [ ] **Manual** — Windows, Simon's own Chrome profile and his own Edge profile: the trial app on `localhost:3000` with its policy as committed and no CRT entry in it, signed in, a real Claude session to a written task whose screenshot is the real tab; the versions in the Log.
- [ ] **Manual** — one public `https://` site turned on: a capture sent, no local-network prompt shown; how long the click's screenshot grant lasts across a reload and a same-site navigation recorded in the Log.

## Notes
Read `docs/PRD-extension.md` §5, §6.2, §7, §9 and §12, and the spike. Decisions already proposed in §13 and not to be revisited once Simon has said "build it": per-site on a click; no all-sites permission; the overlay in the isolated world. §12 rules 2 and 3 name two things not to do on your own (a header rule or relay when loopback cannot be reached; `<all_urls>` to make a test pass). Needs M37; M39 needs this task.

## Log
- 2026-11-17T13:40+08:00 — created from docs/PRD-extension.md by the planning session that wrote it (Claude Code cloud session 01KVgoZguPBAwZVMCJYTTptL), after Simon's request of 2026-11-17 to review any site on its real URL without a proxy or an edit to the app. Not to be started until Simon says "build it".
- 2026-11-17T16:00+08:00 — claimed (in_progress) and built in the same pull request as CRT-0058 (https://github.com/simv/crt/pull/134): `packages/overlay/src/extension/` (`probe.ts`, `content.ts`, `worker.ts`, `wire.ts`, `clean.ts`, `options.ts`, `options.html`, `manifest.json`, `chrome.d.ts`), `buildExtension` in `packages/overlay/build.mjs` → `packages/server/dist/extension/`, the 48 and 128 px icons in `docs/brand/`, `e2e/extension.spec.ts` with the fixture's `/ext` pages.
- 2026-11-17T16:00+08:00 — verified: DoD 1, 8 — `test/extension.test.ts` (the manifest's permission list and version, the loopback rule, the route allow-list, the grep rows). DoD 2–7 — `e2e/extension.spec.ts`, eight tests green in Playwright's Chromium with the built extension loaded: the `'self'`-only page, the stub intake to a written task with a stream held past 30 s, off and never-on, the page that tries to drive CRT, `outside.test` mapped to loopback, the refused capture, and the real tab capture.
- 2026-11-17T16:00+08:00 — differences from the PRD text, recorded in PRD-extension §14: no popup (the toolbar click is the switch, the port is on the Options page); the probe is asked on capture, not listened to; a declined permission still gives the one tab; the registrations are the record of which sites are on; storage is the extension's, keyed by site; the real capture is tested through a second, test-only copy of the extension that holds `<all_urls>` (the shipped manifest never does).
- 2026-11-17T16:00+08:00 — DoD 9 (`npm run check`, `npm run e2e`) left unticked until CI says so (the known container-only failures of CRT-0058's Log apply).
- 2026-11-17T16:00+08:00 — DoD 10, 11 (Manual) open: Simon's own Chrome and Edge on Windows with the trial app and a real Claude session; one public `https://` site; how long the click's screenshot grant lasts.
- 2026-11-17T16:06+08:00 — verified: CI green on 04f4bd8 — `check (ubuntu-latest)`, `check (windows-latest)` and `e2e (ubuntu)` (https://github.com/simv/crt/actions/runs/44043269973); the `npm run check` / `npm run e2e` row ticked. The Manual rows stay open.
