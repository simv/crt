---
id: CRT-0067
title: Refuse /__crt/ requests that are not from this machine (a foreign Origin, a rebound Host)
status: review
priority: high
created: 2026-11-23T10:55:00+08:00
updated: 2026-11-23T11:06:00+08:00
url: null
route: null
session: null
tags: [security, n-50, n-8, proxy, cors]
files: [packages/server/src/http.ts, packages/server/src/proxy.ts, packages/server/test/proxy.test.ts, docs/PRD-providers.md, docs/how-it-works.md]
---

## Summary
A page on the internet could reach the CRT server on `127.0.0.1` while it ran: every `/__crt/` route now refuses a request whose `Host` is not a loopback name or whose `Origin` is not a loopback origin (PRD-providers N-50).

## Context
- Found in the keys-and-secrets audit Simon asked for on 2026-11-23. Nothing secret is served by any route; the gap was who may call them.
- CORS (`http.ts` `applyCors`) only withheld the response headers from a non-loopback `Origin`; the route still ran. A `POST` with `content-type: text/plain` needs no preflight, so `POST /__crt/sessions`, `POST /__crt/captures` and `PUT /__crt/config` ran for any site the developer had open.
- No route but the review page (`reviewRequestAllowed`, F-135) checked `Host`, so a DNS name rebound to `127.0.0.1` was same-origin with the server and could read `/__crt/health`, `/__crt/doctor`, `/__crt/sessions` and a session's events, post messages and answer permission requests — a way to steer the agent in the project folder and read what it reads.
- PRD-providers N-8 and PRD-embedded N-22 accept what the developer's own app (a loopback origin) can do; that is unchanged.

## Evidence
No page capture. Reproduced on a build of main (0.9.0) with `CRT_SESSION_STUB=1`: `curl -H 'Origin: https://evil.example' -H 'Content-Type: text/plain' -d '{}' http://127.0.0.1:<port>/__crt/sessions` answered `201` with a new session; `curl -H 'Host: evil.example:<port>' …/__crt/sessions` listed it.

## Ask
1. One guard, `crtRequestAllowed` in `http.ts`, called first in `handleCrtRoute`: `Host` must be a loopback name; `Origin`, when sent, must be a loopback origin or a browser extension's own (`chrome-extension://<id>`, which no web page can send — the extension of PR #134 calls from its worker). Anything else: 403, no CORS headers, nothing read.
2. Tests for both refusals on the page-facing routes, the internal routes and the bundles, and for what still works.
3. N-50 in `docs/PRD-providers.md` next to N-8; one sentence in the Privacy paragraph of `docs/how-it-works.md`.

## Definition of Done
- [x] A non-loopback `Origin` gets 403 on every `/__crt/` route, including the no-preflight `POST`/`PUT` (N-50).
- [x] A non-loopback `Host` gets 403 on every `/__crt/` route (N-50).
- [x] A loopback app origin, a request with no `Origin` and an extension origin are answered as before (F-6, N-22).
- [x] `npm run check` green; `npm run e2e` green.

## Notes
Proxy mode forwards everything outside `/__crt/` as before; only CRT's own routes are guarded. An app reached under a hosts-file alias of `127.0.0.1` (for example `myapp.test:4401` in proxy mode) loses the overlay, as it already lost the review page.

## Log
- 2026-11-23T10:55+08:00 — claimed; built on `claude/project-thread-cf6jbb`: the guard in `http.ts`, its call in `proxy.ts`, tests in `test/proxy.test.ts`, N-50 and the Privacy sentence.
- 2026-11-23T11:05+08:00 — local run in a cloud container: typecheck, lint and build green; unit tests 977 of 978 run pass, e2e 85 of 86 — the two that fail (`exec.test.ts` "kills a process and its children", `embedded.spec.ts:148` the reuse line) fail the same way on main without this change, so the last DoD row waits for CI.
- 2026-11-23T11:06+08:00 — verified: CI green on ae0350f — `check (ubuntu-latest)`, `check (windows-latest)` and `e2e (ubuntu)` (https://github.com/simv/crt/actions/runs/45103179380). The first Windows run timed out in `handoff.test.ts` "puts exactly the kept items on a new branch…" (5000 ms, a test that spawns git and that this change does not touch); its one re-run passed. The last DoD row ticked. The merge is Simon's.
