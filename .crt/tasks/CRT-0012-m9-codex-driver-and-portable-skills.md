---
id: CRT-0012
title: M9 — Codex driver (codex exec --json) and crt skills install
status: in_progress
priority: normal
created: 2026-09-15T17:30:00+08:00
updated: 2026-09-16T09:30:00+08:00
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
- [ ] Conformance test replays the CRT-0009 fixtures and asserts the F-59 sequence, `provider: codex`, native thread id in `session:`, `resumeCommand` = `codex resume <id>`.
- [ ] e2e codex axis green on both runners, with the fake calling `write_task` through `crt mcp` and the task file appearing with `provider: codex`; the footer shows the read-only badge and no Allow/Deny.
- [ ] A resume whose `thread.started` id differs ends the session with the N-7 "could not resume" line (unit test).
- [ ] `crt skills install --provider codex --dir <tmp>` writes six `SKILL.md` files containing no `${CLAUDE_` and no `AskUserQuestion`; running it twice changes nothing.
- [ ] `npm run check` passes; the module header records the tested Codex version, exact command lines and observed event names.
- [ ] Manual (Simon): on the trial Next.js app, `crt serve --provider codex` → annotate → Send to Codex → streamed text and tool lines, a task passing `crt task --validate`, and `codex resume <id>` continues the conversation in a terminal.
- [ ] Manual (Simon): on a scratch copy of the trial app with `AGENTS.md` and no Claude markers, `crt serve` prints `→ codex` with its reason.

## Notes
If the spike found MCP unreachable under `--sandbox read-only`, apply the fallback the spike doc names and amend F-53 in `docs/PRD-providers.md` in this PR (PRD-providers §12 rule 2). Do not pass `--skip-git-repo-check`.

## Log
- 2026-09-15T17:30+08:00 — created from PRD-providers milestone M9 by the planning session that wrote docs/PRD-providers.md.
- 2026-09-16T09:30:00+08:00 — claimed by worker session 96fa353a-d6a1-4fb7-b482-9e1397f2b3a7
