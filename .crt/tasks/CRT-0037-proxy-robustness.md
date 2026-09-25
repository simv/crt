---
id: CRT-0037
title: Proxy mode — a bad compressed HTML body must not crash the server, and /__crt/ upgrades must not reach the target
status: done
priority: high
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-25T12:13:36+08:00
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
- [x] New test (first, seen failing or crashing): the proxied upstream sends `content-encoding: gzip` with plain HTML bytes. CRT answers 200 with the original bytes, and a second request to the same server still succeeds.
- [x] New test: an HTML body above the cap is served complete and uninjected.
- [x] New test: in proxy mode, a WebSocket upgrade to `/__crt/anything` gets 404 and the target's upgrade handler is never called. The existing F-3 passthrough test (`proxy.test.ts:316`) still passes.
- [x] Every existing test citing F-1…F-6, F-71…F-73 or F-80 passes with its wording unchanged (N-21); `e2e/proxy.spec.ts` green.
- [x] `npm run check` green; `npm run e2e` green.

## Notes
- Leave the broader `handleCrtRoute` if-chain as it is here; see CRT-0042's notes on why it is deferred.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
- 2026-09-25T11:58+08:00 — claimed by /crt:next, session 3a2c4416-d4fc-4b78-8f36-73c23d9e3b6d, branch crt/CRT-0037-proxy-robustness
- 2026-09-25T12:01+08:00 — tests first: the new `proxy robustness (F-2, F-3, F-4)` block in `test/proxy.test.ts` ran red before the fix, all 3 cases: the mislabelled-gzip case crashed the server (Vitest caught the uncaught `Error: incorrect header check` from `decodeBody` inside the upstream `end` handler, and the test timed out); the 17 MB page came back 86 bytes longer, so it had been injected; `/__crt/anything` answered `418` from the target's upgrade handler.
- 2026-09-25T12:03+08:00 — decisions: the cap is `MAX_HTML_BODY = 16 MB`, exported so the test uses the real value (no test-only option). Past the cap the buffered chunks are written and the rest is piped as sent with the upstream headers. Each new line (`decode`, `large`) gets its own once-per-server flag next to F-80's. `isCrtPath` keeps the exact semantics of the old inline request check, so request routing is unchanged. The F-80 block's `ownProxy` moved to file scope with an optional `target`, so the new block shares it instead of copying it. `inject.ts` needed no change.
- 2026-09-25T12:05+08:00 — the local `node_modules` predated CRT-0035 (no `@types/react-dom`), so `lint` failed on `test/react-entry.test.ts`. `npm ci` fixed it; no repo change.
- 2026-09-25T12:10+08:00 — verified: mislabelled-encoding test (`serves HTML whose content-encoding does not decode as sent, says so once, and keeps serving (F-2)`) passes for gzip, br and deflate. Each answers 200 with the original bytes, `content-encoding` and `content-length`; one `crt:` line; the next `/page` is injected.
- 2026-09-25T12:10+08:00 — verified: cap test (`streams an HTML page above the 16 MB cap through complete and uninjected, and says so once (F-2)`): 16 MB + 1 MB page served twice byte-for-byte with its `content-length`; one line; health `injected: 1` after a normal page.
- 2026-09-25T12:10+08:00 — verified: upgrade test (`answers a WebSocket upgrade under /__crt/ with 404 and never forwards it to the target (F-3, F-4)`): `/__crt/anything`, `/__crt` and `/__crt/sessions/abc/ws` get 404 and the target records none. `/_next/webpack-hmr` still reaches it (418). `WebSocket passthrough (F-3) › completes the upgrade and echoes frames both ways` passes.
- 2026-09-25T12:10+08:00 — verified: all 36 pre-existing test titles in `proxy.test.ts` are byte-identical (sorted title lists of main vs branch compared, 36 → 39) and pass (40/40). `e2e/proxy.spec.ts` passes 6/6 in the e2e runs below. `prd-reviewer` subagent: no findings (scope within N-21, traceability, titles).
- 2026-09-25T12:10+08:00 — verified: `npm run check` exit 0 (52 files, 711 passed, 2 skipped). `npm run e2e` exit 0, 66 passed at the default worker count, and 66 passed with `npx playwright test --workers=2`.
- 2026-09-25T12:10+08:00 — verified (extra, real CLI): `crt proxy 3977 --port 4477` from a scratch project, against a scratch upstream. `/bad-gzip` served twice as sent and the server stayed up. The 17 MB chunked page came through byte-exact (17825846 bytes, no overlay tag). Upgrades to `/__crt/anything` and `/__crt` got 404; the upstream logged only `/_next/webpack-hmr`. The terminal printed each new `crt:` line once.
- 2026-09-25T12:10+08:00 — ready for review: changed `packages/server/src/proxy.ts` (the inject branch, `MAX_HTML_BODY`, `isCrtPath`, the upgrade check, two `warned` flags, header comment) and `packages/server/test/proxy.test.ts` (new block, hoisted `ownProxy`). The `handleCrtRoute` if-chain is untouched (Notes, CRT-0042).
- 2026-09-25T12:13+08:00 — done; closed in https://github.com/simv/crt/pull/93 (CI green on cb78adc)
