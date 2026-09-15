---
id: CRT-0001
title: M1 — Proxy server with overlay injection and HMR passthrough
status: review
priority: high
created: 2026-09-14T20:50:00+08:00
updated: 2026-09-15T07:15:00+08:00
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
- [x] `npm run check` and `npm run e2e` pass locally on Windows and in CI on ubuntu + windows. — local Windows: check (50 unit tests) and e2e (6 Playwright tests) green; CI run 34907161022 on PR #2: `check (ubuntu-latest)`, `check (windows-latest)`, `e2e (ubuntu)` all pass (e2e log: "6 passed").
- [ ] Manual: the trial Next.js app on :3000 works through http://localhost:4400 with HMR (edit a component, see it update without reload); the CRT launcher is visible on every page. — manual, pending (see Log for what to check).
- [x] `curl -H "Accept-Encoding: gzip" http://localhost:4400/` returns injected HTML with correct `Content-Length` and no `Content-Encoding`. — verified with curl against `crt serve --target` in front of the e2e fixture (`/gzip` and `/br` routes); asserted by `test/proxy.test.ts` and `e2e/proxy.spec.ts`.
- [x] `/__crt/health` reports the detected target and project root. — curl shows `{"ok":true,"target":"http://localhost:3999","projectRoot":"C:\Projects\Claude\review-tool"}`; asserted in unit + e2e.
- [x] Each of the three N-6 failure cases prints a single actionable line and exits non-zero. — ran all three from the CLI (port in use, `--target` down, nothing on the probe ports): one `crt: …` line each, exit 1. Messages are also asserted in `test/target.test.ts`.
- [x] README "Use" section updated if flags changed; every new module has a header comment citing the F-ids it implements. — README gained a `crt serve` flags table and the e2e dev command; `errors.ts`, `project.ts`, `target.ts`, `inject.ts`, `init.ts`, `proxy.ts`, `serve.ts`, `cli.ts` all open with a header citing their F-/N-ids.

## Notes
Keep all proxy logic in `packages/server/src/proxy.ts`, injection in `inject.ts`, target detection in `target.ts`, project root in `project.ts`. These files will be reused unchanged by M2–M4.

## Log
- 2026-09-14T20:50+08:00 — created from PRD milestone M1 during project setup.
- 2026-09-15T06:50+08:00 — claimed by worker session 00c065ff-ff11-42b4-ae2b-a46a7618b8ad (first build session, branch crt/CRT-0001-m1-skeleton-and-proxy).
- 2026-09-15T07:10+08:00 — worker session 00c065ff-ff11-42b4-ae2b-a46a7618b8ad: implementation complete, verification below.
  - **Files.** New `packages/server/src/{errors,project,target,inject,init,proxy,serve}.ts`; `cli.ts` now dispatches `serve`/`init` (`tasks`/`task` still exit 2 until M3). Tests: `test/{inject,project-init,target,proxy}.test.ts` (50 unit tests incl. the 3 from the scaffold) + `vitest.config.ts` (restricts Vitest to `test/**`). E2E: `e2e/fixture/server.mjs` (static HTML in identity/gzip/br/chunked/no-head/CSP variants, absolute redirect, header echo, body echo, hand-rolled WebSocket echo — Node built-ins only) + `server.d.ts`, `playwright.config.ts` (starts fixture on :3999 then `crt serve --target … --port 4499`), `e2e/proxy.spec.ts` (6 tests). `@playwright/test` added as a devDependency; `npm run e2e` wired; the existing CI e2e job picks up the config automatically.
  - **Design notes.** Node built-ins only (`node:http`/`https`/`net`/`tls`/`zlib`). HTML is buffered and injected via a latin1 round-trip so any charset survives byte-for-byte; the proxy narrows the forwarded `Accept-Encoding` to gzip/deflate/br so an upstream can never hand us HTML we cannot decode (zstd). Injection is skipped for HEAD/204/304. `Location` headers pointing at the target origin (localhost, 127.0.0.1, [::1], 0.0.0.0 spellings) are rewritten to the CRT origin. CSP: if the response carries a `Content-Security-Policy`, `'self'` is added to `script-src` (or `script-src-elem`, or a `script-src` is derived from `default-src`) — enough for the same-origin overlay; dev servers rarely send CSP at all. WebSocket upgrades are replayed verbatim over a raw socket with `Host` rewritten and `X-Forwarded-*` added, then piped both ways; either side closing tears down the other. Server binds `127.0.0.1`; `/__crt/*` never reaches the target (unknown paths → 404 JSON). `--open` spawns `cmd.exe /c start "" <url>` / `open` / `xdg-open` with `shell: false`.
  - **Tradeoff to know.** Streaming HTML (Next.js app-router RSC streaming) is buffered until the response ends before injection, so first paint waits for the full document in dev. Acceptable for M1; revisit if it hurts on the trial app.
  - **Conflicts.** `.crt/tasks/README.md` says to keep the index current by hand until `crt tasks` exists (M3), while `plugin/skills/next/SKILL.md` says never to edit it by hand — followed the README's own instruction and updated the CRT-0001 row by hand this once.
  - **Verification.** `npm run check` green on Windows (Node 24.18, npm 11). `npm run e2e` green on Windows (Chromium headless shell). Manual curl session against fixture + `crt serve --target http://localhost:3999 --port 4499`: `/gzip` with `Accept-Encoding: gzip` → 200, no `content-encoding`, `content-length: 314` matching the injected body, tag before `</head>`; `/redirect` → `location: http://localhost:4499/?from=redirect`; `/echo-headers` shows `host: localhost:3999` and `x-forwarded-{host,proto,for}`; `/csp` → `script-src 'nonce-abc' 'self'`; `/__crt/nope` → 404 JSON; `/__crt/overlay.js` → `text/javascript`, `cache-control: no-store`; a Node `WebSocket` to `ws://localhost:4499/ws` echoed. N-6: port in use / target down / nothing on probe ports each print one `crt: …` line and exit 1; `--port abc` likewise. `--open` ran without error (a browser tab should have opened; not visually confirmed from the session). `crt serve` printed `CRT ready at http://localhost:4499 → http://localhost:3999 (project: C:\Projects\Claude\review-tool, 5 tasks)`.
  - **Manual check for Simon (DoD item 2).** With the trial Next.js app running on :3000, from its folder run `node C:\Projects\Claude\review-tool\packages\server\dist\cli.js serve --open` (or `npx claude-review-tool serve --open` once published). Expect the `CRT ready at http://localhost:4400 → http://localhost:3000 (project: …)` line and a tab on :4400. Check: (a) the black **CRT** pill is bottom-right on every route, including after client-side navigation; (b) DevTools → Network → WS shows `_next/webpack-hmr` connected via `localhost:4400` with `101`; (c) edit a component's JSX text, save — the page updates in place without a full reload and the CRT pill stays; (d) `curl -s -D - -H "Accept-Encoding: gzip" http://localhost:4400/ | head -20` shows no `content-encoding`, a `content-length`, and `<script src="/__crt/overlay.js" defer></script>` before `</head>`; (e) `curl http://localhost:4400/__crt/health` names the target and the app's git root. If HMR does not connect, note the WS status code and the server's console output in this Log.
  - **CI.** DoD item 1 stays unticked until the PR's `check (ubuntu-latest)`, `check (windows-latest)` and `e2e (ubuntu)` jobs are green; will be ticked in a follow-up commit on this branch.
- 2026-09-15T07:15+08:00 — worker session 00c065ff-ff11-42b4-ae2b-a46a7618b8ad: CI green on PR #2 (https://github.com/simv/crt/pull/2); DoD item 1 ticked. Status → review. Only the manual Next.js/HMR check (DoD item 2) remains, for Simon.
