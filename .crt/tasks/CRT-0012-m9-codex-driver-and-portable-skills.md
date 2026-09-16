---
id: CRT-0012
title: M9 — Codex driver (codex exec --json) and crt skills install
status: done
priority: normal
created: 2026-09-15T17:30:00+08:00
updated: 2026-09-16T11:10:00+08:00
url: null
route: null
session: null
tags: [m9, f-53, f-58, f-59, f-61, n-7, n-10, n-13, prd-providers]
files: [packages/server/src/providers/codex.ts, packages/server/src/providers/exec.ts, packages/server/src/cli.ts, packages/server/test/providers/codex.test.ts, packages/server/e2e/chat.spec.ts, README.md]
---

## Summary
Implement the Codex provider on the developer's own `codex` CLI — one `codex exec --json` process per turn, resumed by thread id, read-only sandbox, `write_task` through `crt mcp` — and ship the CRT skills as portable Agent Skills via `crt skills install`.

## Context
`docs/PRD-providers.md` §5.2, §5.3, §5.4, §8 (M9), F-53 **as amended by the CRT-0009 spike doc** (`docs/spikes/codex-2026-09.md` is authoritative for flags, event names, MCP reachability and fallbacks), F-58, F-59, F-61 (codex axis), N-7, N-10, N-13, §12 verification protocol. Depends on CRT-0009, CRT-0010, CRT-0011.

## Evidence
No page capture: created from PRD-providers milestone M9.

## Ask
1. `providers/codex.ts` `start()`: executable resolution per F-53 (config override → `codex.exe`/`codex` on PATH → npm shim parsed to a JS entry run with `process.execPath` → `installed: false` with the N-7 line); turn 1 `codex exec --json …` with the first message on stdin, `--image` per capture PNG, `-c mcp_servers.crt.*` pointing at `node <cli.js> mcp` with the token in `env`; turn n `codex exec resume <thread_id>`; thread-id assertion on resume; event mapping; the "turn ended with no agent_message and no mcp_tool_call" warning; interrupt by process-tree kill; preflight (`--version` ≥ header minimum, `login status` → true/false/unknown); `resumeCommand`; `telemetryOptOut`; `launchEnv` from the spike.
2. Conformance test `test/providers/codex.test.ts` running the F-59 scenario against a fake transport that replays the CRT-0009 fixtures.
3. Fake `codex` for e2e: a Node script in a scratch `bin/` prepended to PATH (`ubuntu`: executable script; `windows`: npm-shaped `codex.cmd` shim pointing at it). It answers `--version` and `login status`, consumes stdin, accepts `exec` and `exec resume <id>`, tolerates `--image`/`-c`/`-m`, replays fixtures, and spawns the configured MCP server and calls `write_task` through it. `e2e/chat.spec.ts` codex axis per F-61.
4. `crt skills install [--provider <id>] [--global] [--dir <path>]` per F-58 with the token rewrites, the added first paragraph, idempotency, refusal for `--provider claude`, and `--dir` required when the profile records no skills directory.
5. README: N-7 Codex lines verbatim, install/login, the N-13 note on per-turn resume cost, telemetry statement (N-12).

## Definition of Done
- [x] Conformance test replays the CRT-0009 fixtures and asserts the F-59 sequence, `provider: codex`, native thread id in `session:`, `resumeCommand` = `codex resume <id>`.
- [x] e2e codex axis green on both runners, with the fake calling `write_task` through `crt mcp` and the task file appearing with `provider: codex`; the footer shows the read-only badge and no Allow/Deny.
- [x] A resume whose `thread.started` id differs ends the session with the N-7 "could not resume" line (unit test).
- [x] `crt skills install --provider codex --dir <tmp>` writes six `SKILL.md` files containing no `${CLAUDE_` and no `AskUserQuestion`; running it twice changes nothing.
- [x] `npm run check` passes; the module header records the tested Codex version, exact command lines and observed event names.
- [x] Manual (Simon): on the trial Next.js app, `crt serve --provider codex` → annotate → Send to Codex → streamed text and tool lines, a task passing `crt task --validate`, and `codex resume <id>` continues the conversation in a terminal.
- [x] Manual (Simon): on a scratch copy of the trial app with `AGENTS.md` and no Claude markers, `crt serve` prints `→ codex` with its reason.

## Notes
If the spike found MCP unreachable under `--sandbox read-only`, apply the fallback the spike doc names and amend F-53 in `docs/PRD-providers.md` in this PR (PRD-providers §12 rule 2). Do not pass `--skip-git-repo-check`.

## Log
- 2026-09-15T17:30+08:00 — created from PRD-providers milestone M9 by the planning session that wrote docs/PRD-providers.md.
- 2026-09-16T09:30:00+08:00 — claimed by worker session 96fa353a-d6a1-4fb7-b482-9e1397f2b3a7
- 2026-09-16T10:05+08:00 — decisions: (1) the per-session token goes to `crt mcp` via `-c mcp_servers.crt.env_vars=['CRT_MCP_TOKEN','CRT_MCP_PORT']` with the values in the codex process environment, not the `env={…}` map the spike used, so it never sits on a command line (F-49/N-8); verified on codex-cli 0.154.0 under `--strict-config` with the spike's MCP probe (spike doc §6, F-53 amended in docs/PRD-providers.md per §12 rule 1). (2) Codex restarts item ids at `item_0` every turn, so the driver prefixes them `t<n>-` — the panel matched a second turn's tool line to the first turn's element otherwise (found by the e2e). (3) `task_written` is recorded by the registry on the internal route, never by the driver, so it appears exactly once. (4) `StartSessionOptions` gained optional `command` (providers.<id>.command) and `agentVersion` (from the cached preflight) so the driver need not re-run `--version` per session. (5) The fake `codex` enforces the spike's flag contract (rejects `--sandbox`/`-C` on resume, unknown `-c` keys, missing approval keys) so a drift from the M6 verdicts fails in CI, not on a real machine. (6) MCP unreachable fallback: not needed (spike verdict), `--skip-git-repo-check` not passed.
- 2026-09-16T10:05+08:00 — changed: packages/server/src/providers/codex.ts (driver: codexTurnCommand, TurnMapper, startCodexSession, skillsDirs, N-7 lines), src/skills.ts + src/cli.ts (`crt skills install`), src/session-events.ts (StartSessionOptions.command/agentVersion, result.detail), src/sessions.ts (passes them), src/providers/types.ts (skillsDirs on the profile), claude.ts/stub.ts (skillsDirs: none), scripts/copy-intake.mjs (dist/skills/<name>/SKILL.md), e2e/fixture/fake-codex.mjs + fake-codex-install.mjs (the F-61 fake, npm .cmd shim on Windows / executable script elsewhere), e2e/fixture/crt.mjs + playwright.config.ts (third server on --provider codex, port 4497), e2e/chat.spec.ts (codex axis), test/providers/codex.test.ts (27 tests), test/providers/conformance.ts (stdio write path behind the real handleInternalRoute), test/skills.test.ts (5 tests), .github/workflows/ci.yml (e2e on ubuntu + windows), README.md (Providers → Codex: N-7 lines verbatim, install/login, N-13 resume cost, N-12 telemetry, skills install), docs/PRD-providers.md (F-53 M9 amendment), docs/spikes/codex-2026-09.md (§6 env_vars addendum).
- 2026-09-16T10:05+08:00 — verified DoD 1: test/providers/codex.test.ts "passes the F-59 conformance scenario…" runs runConformance against the fake codex (replaying first-turn.jsonl / resume.jsonl through the real spawn path and the .cmd shim) with writePath stdio — real `crt mcp` shim → real handleInternalRoute → createTask; asserts provider: codex, session: = thread id, resumeCommand = codex resume <id>; the "codex event mapping over the recorded fixtures" block replays all nine fixtures through TurnMapper.
- 2026-09-16T10:05+08:00 — verified DoD 2: `npm run e2e` on Windows 11: 37/37 (chat.spec.ts 12/12, codex axis at :464 — footer `Codex · 0.154.0 · read-only sandbox · continue in a terminal: codex resume <uuid>`, no .perm, write_task via crt mcp, file with provider: codex, Stop kills the turn). ubuntu: the e2e job now runs on both runners (ci.yml matrix) — confirmed green on this PR's checks before merge (see the next Log line once CI reports).
- 2026-09-16T10:05+08:00 — verified DoD 3: codex.test.ts "a resume whose thread.started id differs ends the session with the N-7 could-not-resume line" (FAKE_CODEX_RESUME_MISMATCH=1) and the TurnMapper replay of resume-after-kill.jsonl against another thread id.
- 2026-09-16T10:05+08:00 — verified DoD 4: test/skills.test.ts (six files, no `${CLAUDE_`, no AskUserQuestion, frontmatter lines dropped, idempotent by content and mtime); also by hand with dist/cli.js: 6 written, second run "already up to date (6 skills)", `--provider claude` refused with exit 1.
- 2026-09-16T10:05+08:00 — verified DoD 5: `npm run check` green (typecheck, 24 files / 232 tests, build); codex.ts header lists codex-cli 0.154.0, both command lines, every observed event name and the env_vars finding.
- 2026-09-16T10:05+08:00 — extra verification on the real CLI (not a DoD item; Codex 0.154.0 is installed and logged in here): two-turn session through the built driver in C:ProjectsClaudecrt-codex-spike-repo — thread.started → init, resume kept the thread and remembered turn 1; a third session called write_task through the real `crt mcp` (token via env_vars) and the file passed `crt task --validate` with provider: codex and the thread id in session:. Scratch .crt/ removed afterwards.
- 2026-09-16T10:05+08:00 — prd-reviewer: PR-READY WITH NOTES (test titles missing (F-n) tags — fixed; README index regenerated with `crt tasks`). Left unticked for Simon: the two Manual items (trial Next.js app end to end incl. `codex resume`; auto-detection `→ codex` on an AGENTS.md-only copy).
- 2026-09-16T10:25+08:00 — DoD 2 ubuntu half confirmed: PR #25 CI run 35046177471 green on all four jobs — check (ubuntu, windows) and e2e (ubuntu 1m14s, windows 4m44s). One fix on the way: the preflight tests' synthetic PATH needed node's directory for the POSIX executable-script fake (`#!/usr/bin/env node`); Windows never hit it because the .cmd shim path runs process.execPath directly.
- 2026-09-16T10:50+08:00 — Manual items ticked on Simon's confirmation ("ive tested", 2026-09-16) against the new trial app C:ProjectsClaude	ool-validation (local-only Next 16 shop created this session; Apex is no longer used for trials). Merging PR #25 per the end-of-task rule.
- 2026-09-16T11:10+08:00 — done; merged in https://github.com/simv/crt/pull/25
