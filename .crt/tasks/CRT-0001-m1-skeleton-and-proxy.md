---
id: CRT-0001
title: M1 — Proxy server with overlay injection and HMR passthrough
status: in_progress
priority: high
created: 2026-09-14T20:50:00+08:00
updated: 2026-09-15T06:50:00+08:00
url: null
route: null
session: null
tags: [m1, server, proxy]
files: [packages/server/src/cli.ts, packages/server/src/args.ts, packages/overlay/src/index.ts]
---

## Summary
Make `crt serve` real: detect the target dev server, reverse-proxy it on `localhost:4400`, inject the overlay script into HTML responses, and pass WebSocket upgrades through so Next.js/Vite HMR keeps working. Add `crt init` and the e2e harness that proves it.

## Context
PRD §5, §6.1 (F-1…F-6), §9, milestone M1. The scaffold exists: monorepo, CI, stub CLI (`packages/server/src/cli.ts`), stub overlay that renders a launcher inside Shadow DOM. Node built-ins (`node:http`, `node:net`, `node:zlib`) are preferred over `http-proxy`-style dependencies unless a dependency removes substantial code. The e2e fixture should be a tiny static server in `packages/server/e2e/fixture/` that serves an HTML page and a WebSocket echo endpoint, so CI needs no framework install.

## Evidence
None — greenfield task from the PRD.

## Ask
1. `crt serve [--target <url>] [--port 4400] [--open]` (F-1, F-5): resolve target from flag → `.crt/config.json` → probe 3000, 5173, 8080, 4200, 8000, 3001; print `CRT ready at http://localhost:<port> → <target> (project: <root>)`; `--open` launches the default browser (`start`/`open`/`xdg-open`, spawned with `shell: false`).
2. Reverse proxy on `127.0.0.1:<port>` (F-4): forward method, path, headers (rewrite `Host`, add `X-Forwarded-*`), body, and stream the response. Rewrite `Location` headers pointing at the target origin to the CRT origin.
3. HTML injection (F-2): when the upstream `Content-Type` is `text/html`, buffer, decompress if `Content-Encoding` is gzip/br/deflate, insert `<script src="/__crt/overlay.js" defer></script>` before `</head>` (fallback `</body>`, fallback append), drop `Content-Encoding`, set correct `Content-Length`. Strip `Content-Security-Policy` `script-src` restrictions only as far as needed for the overlay, or document that dev servers rarely send CSP.
4. WebSocket passthrough (F-3): handle the `upgrade` event, open a TCP socket to the target, replay the upgrade request, pipe both ways, and close cleanly.
5. Serve `/__crt/overlay.js` from `packages/server/dist/overlay.js` with no-cache headers; `/__crt/health` returns `{ ok: true, target, projectRoot }`.
6. `crt init` (F-35): create `.crt/tasks/`, `.crt/config.json` (if absent), add `.crt/captures/` to `.gitignore` idempotently. `serve` runs `init` first.
7. Project root detection: nearest ancestor with `.git`, else cwd; expose it in `/__crt/health`.
8. e2e (Playwright, Chromium): fixture server → `crt serve --target` → page at CRT origin has `#crt-host` with a shadow root and the launcher button; a WebSocket to the CRT origin echoes through the fixture; a gzip-encoded HTML response is injected correctly. Wire `npm run e2e` and the existing `e2e` CI job.
9. Clear one-line errors (N-6) for: target unreachable, port in use, no target found.

## Definition of Done
- [ ] `npm run check` and `npm run e2e` pass locally on Windows and in CI on ubuntu + windows.
- [ ] Manual: the trial Next.js app on :3000 works through http://localhost:4400 with HMR (edit a component, see it update without reload); the CRT launcher is visible on every page.
- [ ] `curl -H "Accept-Encoding: gzip" http://localhost:4400/` returns injected HTML with correct `Content-Length` and no `Content-Encoding`.
- [ ] `/__crt/health` reports the detected target and project root.
- [ ] Each of the three N-6 failure cases prints a single actionable line and exits non-zero.
- [ ] README "Use" section updated if flags changed; every new module has a header comment citing the F-ids it implements.

## Notes
Keep all proxy logic in `packages/server/src/proxy.ts`, injection in `inject.ts`, target detection in `target.ts`, project root in `project.ts`. These files will be reused unchanged by M2–M4.

## Log
- 2026-09-14T20:50+08:00 — created from PRD milestone M1 during project setup.
- 2026-09-15T06:50+08:00 — claimed by worker session 00c065ff-ff11-42b4-ae2b-a46a7618b8ad (first build session, branch crt/CRT-0001-m1-skeleton-and-proxy).
