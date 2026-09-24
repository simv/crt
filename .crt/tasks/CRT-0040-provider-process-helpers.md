---
id: CRT-0040
title: Provider CLI plumbing in one place — spawn, line reader, stderr tail, version parsing and the preflight skeleton
status: backlog
priority: normal
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-24T12:15:00+08:00
url: null
route: null
session: null
tags: [review-2026-09, refactor, providers, prd-providers-5, n-7, n-10]
files: [packages/server/src/providers/exec.ts, packages/server/src/providers/codex.ts, packages/server/src/providers/antigravity.ts, packages/server/src/providers/acp.ts, packages/server/src/providers/gemini.ts, packages/server/src/providers/claude.ts, packages/server/src/providers/version.ts]
---

## Summary
Three CLI drivers (Codex, Antigravity, ACP) each carry their own copy of the same process plumbing:
- the spawn options and a `*ProcessDeps` interface;
- a stdout newline buffer;
- a JSON-line parser;
- a 30-line stderr tail;
- and, for three providers, the preflight skeleton.

`compareVersions` lives in `codex.ts` but Gemini and Antigravity import it from there. A sixth provider today means copying all of this. This task moves it into `providers/exec.ts` (which CLAUDE.md already names as the shared spawn module) and a neutral `providers/version.ts`, with no behaviour change.

## Context
- **Spawn:** `realDeps` has the same options in `codex.ts:294-306`, `antigravity.ts:504-516` and `acp.ts:430-441`. The `*ProcessDeps` interfaces match: `codex.ts:289`, `antigravity.ts:497`, `acp.ts:423`.
- **Stdout buffer:** `codex.ts:380-390`, `antigravity.ts:606-617`, `acp.ts:102-110`.
- **Line parsers:** `parseCodexLine` (`codex.ts:221`), `parseAgyLine` (`antigravity.ts:306`) and `parseRpcLine` (`acp.ts:141`) each trim, check for `{`, `JSON.parse`, then check a type field.
- **Stderr tail:** each has its own `STDERR_TAIL_LINES = 30`: `claude.ts:64/307`, `codex.ts:61/392`, `antigravity.ts:72/619`, `acp.ts:58/568`.
- **Preflight skeleton** (resolve, `--version`, parse, too old, login, `why ?? stderr` fallback): `codex.ts:107-123`, `gemini.ts:106-119`, `antigravity.ts:126-137`.
- **Version parsing:** `parseGeminiVersion` (`gemini.ts:100`) and `parseAntigravityVersion` (`antigravity.ts:140`) have byte-identical regexes. `compareVersions` is at `codex.ts:132`, imported by `gemini.ts:33` and `antigravity.ts:63`.
- **Small duplicates:**
  - `summarize()` ×4: `claude.ts:487`, `codex.ts:272`, `antigravity.ts:356`, `acp.ts:307`.
  - `shortPath()` ×2: `claude.ts:524`, `acp.ts:302`.
  - Token-usage formatting ×2: `codex.ts:278-284`, `antigravity.ts:364-367`.
  - `IMAGES_DROPPED_LINE` (`acp.ts:313`) duplicates the literal at `intake-message.ts:158`, and its own comment says so.
- **Invariant (CLAUDE.md, PRD-providers §5):** each agent's CLI or protocol stays driven only from `providers/<id>.ts` and `providers/exec.ts`. All Agent SDK usage stays in `claude.ts`.

## Evidence
No page capture: from the code review in session e145e7ac, 2026-09-24. The review estimated about 250–300 duplicated lines across the drivers (this task plus CRT-0041).

## Ask
1. In `exec.ts`:
   - `spawnProvider(exe, args, { cwd, env })` with the shared options (`shell: false`, `windowsHide`, stdio) and one `ProcessDeps` type;
   - `lineReader(stream, onLine)`;
   - `parseJsonLine(line)` returning `unknown | null`;
   - `StderrTail` (`push(chunk)`, `lines()`, a per-provider filter regex).
2. `providers/version.ts`: `parseBareVersion`, `compareVersions`, and `cliPreflight({ … })`, which returns the same `PreflightResult` the three providers return today. The N-7 wording stays in each profile and is passed in.
3. Move `summarize`, `shortPath` and the token-usage formatter into one shared provider-utility module. Export `IMAGES_DROPPED_LINE` from `intake-message.ts` and import it in `acp.ts`.
4. Move the drivers onto these. Each driver file keeps only its own protocol mapping.

## Definition of Done
- [ ] New unit tests for `lineReader` (split chunks, CRLF, a final line with no newline), `parseJsonLine`, `StderrTail` and `compareVersions` / `parseBareVersion`, written before the move.
- [ ] No driver defines its own stdout buffer, stderr tail, `realDeps` spawn options or `compareVersions`; `gemini.ts` and `antigravity.ts` no longer import from `codex.ts`.
- [ ] Every N-7 preflight string test passes unchanged: `codex.test.ts` "codex preflight against the npm-style fake", `acp.test.ts` "gemini preflight…", `antigravity.test.ts` "antigravity preflight…".
- [ ] The fixture-replay and conformance tests pass unchanged: `codex-fixtures.test.ts`, `codex.test.ts`, `acp.test.ts`, `antigravity.test.ts`, `stub.test.ts`, `exec.test.ts`, `detect.test.ts`.
- [ ] Net line count of `src/providers/` goes down (record before and after).
- [ ] `npm run check` green on Windows and Ubuntu; `npm run e2e` green.

## Notes
- **N-11:** `acp.ts` is 808 lines, over the 400 at which the official ACP SDK "may be added, pinned exactly". The review doesn't recommend adding it now: a new runtime dependency for a provider marked experimental, while this task and CRT-0041 remove the shared plumbing from `acp.ts` anyway. Re-measure after both tasks and note the count in the Log.
- **Order:** do this before CRT-0041.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
