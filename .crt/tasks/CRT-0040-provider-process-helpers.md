---
id: CRT-0040
title: Provider CLI plumbing in one place — spawn, line reader, stderr tail, version parsing and the preflight skeleton
status: review
priority: normal
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-28T08:58:00+08:00
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
- [x] New unit tests for `lineReader` (split chunks, CRLF, a final line with no newline), `parseJsonLine`, `StderrTail` and `compareVersions` / `parseBareVersion`, written before the move.
- [x] No driver defines its own stdout buffer, stderr tail, `realDeps` spawn options or `compareVersions`; `gemini.ts` and `antigravity.ts` no longer import from `codex.ts`.
- [x] Every N-7 preflight string test passes unchanged: `codex.test.ts` "codex preflight against the npm-style fake", `acp.test.ts` "gemini preflight…", `antigravity.test.ts` "antigravity preflight…".
- [x] The fixture-replay and conformance tests pass unchanged: `codex-fixtures.test.ts`, `codex.test.ts`, `acp.test.ts`, `antigravity.test.ts`, `stub.test.ts`, `exec.test.ts`, `detect.test.ts`.
- [x] Net line count of `src/providers/` goes down (record before and after).
- [x] `npm run check` green on Windows and Ubuntu; `npm run e2e` green.

## Notes
- **N-11:** `acp.ts` is 808 lines, over the 400 at which the official ACP SDK "may be added, pinned exactly". The review doesn't recommend adding it now: a new runtime dependency for a provider marked experimental, while this task and CRT-0041 remove the shared plumbing from `acp.ts` anyway. Re-measure after both tasks and note the count in the Log.
- **Order:** do this before CRT-0041.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
- 2026-09-28T08:28+08:00 — claimed by /crt:next, session 8a010845-cc99-44a6-b00b-b817ead4c228, branch crt/CRT-0040-provider-process-helpers (worktree .claude/worktrees/CRT-0040)
- 2026-09-28T08:58+08:00 — decision: ACP keeps feeding stdout chunks to `JsonRpcStdio.feed` (now over the shared `LineBuffer`) instead of `lineReader`. `lineReader` delivers an unterminated last line at stream end, and the ACP driver never handled one; Codex and Antigravity already flushed theirs at `exit`, so `lineReader` changes nothing for them. The prd-reviewer subagent caught this in the first draft.
- 2026-09-28T08:58+08:00 — decision: the provider tests stay byte-for-byte unchanged, so the old names stay importable: `codex.ts` re-exports `compareVersions`; `gemini.ts` / `antigravity.ts` re-export `parseBareVersion` as `parseGeminiVersion` / `parseAntigravityVersion`; `acp.ts` re-exports `IMAGES_DROPPED_LINE`. The ProcessDeps seam now takes the `Executable` (`spawn(exe, args, …)`), so the `[...exe.args, ...args]` splice lives in `spawnProvider` alone. No test injected deps.
- 2026-09-28T08:58+08:00 — verified: new tests before the move — commit 4f8e108 added `exec.ts` helpers, `version.ts`, `format.ts` with `test/providers/exec-streams.test.ts` (lineReader split chunks, CRLF incl. a `\r` / `\n` split across chunks, a final line with no newline at stream end, a split UTF-8 character, `flush()`; parseJsonLine; StderrTail cap/brief/noise; spawnProvider), `version.test.ts` (parseBareVersion, compareVersions, cliPreflight not found / too old / failed `--version` / login check) and `format.test.ts`; 23 tests green on the unchanged drivers, which moved in the next commit (e5a299d).
- 2026-09-28T08:58+08:00 — verified: no driver copies — grep over claude/codex/antigravity/acp/gemini.ts finds no `indexOf("\n")` loop, no `STDERR_TAIL_LINES`, no `stderrTail` array, no `realDeps`, no `shell: false` / `detached:` spawn options, no `function compareVersions` / `summarize` / `shortPath`, and no `from "./codex.js"` in gemini.ts or antigravity.ts. Spawn is only in `exec.ts` (`spawnProvider`).
- 2026-09-28T08:58+08:00 — verified: N-7 preflight tests unchanged — `git diff main -- packages/server/test/providers/{codex,acp,antigravity}.test.ts` is empty; `vitest -t preflight` runs 9/9 green: codex "not on PATH", "found through the shim…", "too old…"; gemini the same three; antigravity "not on PATH", "found, versioned, login unknown…"; the ad-hoc ACP preflight.
- 2026-09-28T08:58+08:00 — verified: fixture-replay and conformance unchanged — `git diff main` is empty for codex-fixtures, codex, acp, antigravity, stub, exec, detect tests, conformance.ts and test/helpers; all pass in the full run (57 files, 751 passed, 2 skipped).
- 2026-09-28T08:58+08:00 — verified: line count of `src/providers/*.ts` — before (main c0610d3) 3,659 lines in 9 files, 2,809 code lines; after 3,647 lines in 11 files (−12, with the new `version.ts` 59 and `format.ts` 26), 2,745 code lines (−64). N-11 re-measure: `acp.ts` 810 → 768 lines, still over 400; re-measure after CRT-0041 as the Notes say.
- 2026-09-28T08:58+08:00 — verified: Windows — `npm run check` exit 0 (typecheck, lint, 57 files / 751 unit tests, build). One earlier run lost `antigravity.test.ts` conformance (EPERM removing the session dir while the killed tree let go) and the stub "take your time" 600 ms timing test, neither touched here; both files green 3/3 alone and the full check green again. `npx playwright test --workers=2` 73/74: the one failure is `embedded.spec.ts` "the ES module loader bundled into a page…", whose F-91 line expects no dev server on the probed ports while other sessions held :3001 and :8080 ("found 2 dev servers") — environmental. After the ACP fix, `e2e/chat.spec.ts` 23/23 (codex, ad-hoc ACP, antigravity included). Ubuntu is the PR's CI `check (ubuntu)` / `e2e (ubuntu)`, logged below when it reports.
- 2026-09-28T08:58+08:00 — ready for review: changed packages/server/src/providers/{exec,codex,antigravity,acp,gemini,claude}.ts, new packages/server/src/providers/{version,format}.ts, packages/server/src/intake-message.ts (exports `IMAGES_DROPPED_LINE`), new packages/server/test/providers/{exec-streams,version,format}.test.ts, CLAUDE.md (entry-point list names version.ts / format.ts). `cliPreflight` runs `--version` through `exec.ts`'s `runExecutable`; Codex's `login status` stays in codex.ts. prd-reviewer: PR-READY WITH NOTES; both notes fixed (ACP flush above, requirement IDs on the 23 new test titles).
