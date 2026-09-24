---
id: CRT-0037
title: Proxy mode — a bad compressed HTML body must not crash the server, and /__crt/ upgrades must not reach the target
status: backlog
priority: high
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-24T12:15:00+08:00
url: null
route: null
session: null
tags: [review-2026-09, bug, proxy, f-2, f-3, f-4]
files: [packages/server/src/proxy.ts, packages/server/src/inject.ts, packages/server/test/proxy.test.ts]
---

## Summary
There are two defects in `crt proxy`, both in code that embedded mode never runs:
- **Crash:** a dev server that sends `content-encoding: gzip` (or `br` / `deflate`) with a body that isn't validly encoded throws inside an event handler. That kills the whole CRT process, including open intake sessions.
- **Upgrade leak:** a WebSocket upgrade under `/__crt/` is forwarded to the target, which breaks F-4's rule that `/__crt/*` never reaches it.

## Context
- `packages/server/src/proxy.ts:355-357`: `decodeBody(...)` runs inside the upstream response's `end` handler.
  - `inject.ts:46-55` uses `gunzipSync`, `brotliDecompressSync` and `inflateRawSync`, which throw on corrupt, truncated or mislabelled input.
  - There is no try/catch and no `uncaughtException` handler in `src/`.
  - `:358-362` already has a "serve it untouched" branch for unknown encodings.
  - The HTML body is buffered with no size limit (`:353-354`), and `decoded.toString("latin1")` runs twice on the same buffer (`:365`, `:373`).
- `proxy.ts:247` routes the `/__crt` prefix locally for requests. The `upgrade` handler (`:259-265`) doesn't check the prefix and passes every path to `proxy.upgrade`. The existing upgrade test (`proxy.test.ts:550-568`) covers embedded mode only.
- **N-21 (PRD-embedded):** the proxy path isn't refactored beyond what mode selection needs, and every F-1…F-6 / F-71…F-73 / F-80 test keeps passing unchanged. These are targeted bug fixes, not a refactor: keep the change inside the two spots named.

## Evidence
No page capture: from the code review in session e145e7ac, 2026-09-24. Both paths were confirmed by reading the code at the lines above.

## Ask
1. Wrap decode and inject in try/catch. On failure, serve the original bytes and headers untouched, as the unknown-encoding branch does, and log one `crt:` line once per server. Convert the body to a string once.
2. Cap the buffered HTML, e.g. 16 MB. Above the cap, stream the rest through uninjected and log once.
3. Add one `isCrtPath(url)` helper used by both the request handler and the upgrade handler. In proxy mode, answer an upgrade under `/__crt/` with `404` and close, exactly as embedded mode does.

## Definition of Done
- [ ] New test (first, seen failing or crashing): the proxied upstream sends `content-encoding: gzip` with plain HTML bytes. CRT answers 200 with the original bytes, and a second request to the same server still succeeds.
- [ ] New test: an HTML body above the cap is served complete and uninjected.
- [ ] New test: in proxy mode, a WebSocket upgrade to `/__crt/anything` gets 404 and the target's upgrade handler is never called. The existing F-3 passthrough test (`proxy.test.ts:316`) still passes.
- [ ] Every existing test citing F-1…F-6, F-71…F-73 or F-80 passes with its wording unchanged (N-21); `e2e/proxy.spec.ts` green.
- [ ] `npm run check` green; `npm run e2e` green.

## Notes
- Leave the broader `handleCrtRoute` if-chain as it is here; see CRT-0042's notes on why it is deferred.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
