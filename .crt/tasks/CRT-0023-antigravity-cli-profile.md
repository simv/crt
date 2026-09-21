---
id: CRT-0023
title: Antigravity CLI profile — spike on `agy --print --output-format stream-json`, then a native driver
status: in_progress
priority: normal
created: 2026-09-21T13:10:00+08:00
updated: 2026-09-21T13:15:00+08:00
url: null
route: null
session: null
tags: [antigravity, spike, f-42, f-53, f-59, f-61, n-7, n-10, prd-providers]
files: [docs/PRD-providers.md, docs/spikes/antigravity-2026-09.md, packages/server/src/providers/antigravity.ts, packages/server/test/providers/antigravity.test.ts, packages/server/test/providers/fixtures/antigravity/, packages/server/e2e/chat.spec.ts, README.md]
---

## Summary
Add Google's Antigravity CLI (`agy`) as a built-in provider: first a spike that records, from real runs on Simon's machine, how its first-party non-interactive JSON mode behaves (stream-json in and out, MCP servers, resume, permissions, images), then a native driver and profile in the shape of the Codex one, with the F-59 conformance scenario against a fake `agy` and an e2e axis.

## Context
PRD-providers §11 item 4 (amended by CRT-0013, 2026-09-21): Antigravity qualifies for its own profile because it has a first-party non-interactive JSON mode, not an ACP endpoint — so it cannot ride the F-54 ad-hoc `{ kind: "acp" }` config. Installed and logged in on this machine: `agy` 1.2.7 at `%LOCALAPPDATA%\agy\bin\agy.exe` (a single Go-style binary, no npm shim); `agy models` lists Gemini 3.x models, so unlike Gemini CLI 0.60.0 (which refuses the free personal tier — CRT-0013) a real intake can be run and the Manual rows ticked. Relevant flags from `agy --help`: `--print`/`-p`, `--output-format text|json|stream-json`, `--input-format text|stream-json` ("reads one NDJSON message per line from stdin and runs a turn for each; requires --output-format stream-json"), `--continue`/`-c`, `--conversation <id>` (resume by id), `--dangerously-skip-permissions`, `--mode accept-edits|plan`, `--sandbox`, `--model`, `--effort`, `--add-dir`, `--project`; subcommands `mcp add|remove|list|enable|disable`, `models`, `agents`. Depends on the driver contract in `session-events.ts` and the conformance helper `test/providers/conformance.ts` (F-59); mirror `providers/codex.ts` (one process per turn, resume by id) or `providers/acp.ts` (one process per session with stream-json turns) — the spike decides which fits.

## Evidence
No page capture: created from the CRT-0013 session at Simon's request ("i have also installed antigravity cli … can we add it as well").

## Ask
1. **Spike** (`docs/spikes/antigravity-2026-09.md` + `docs/spikes/antigravity-2026-09/probe/`, fixtures in `test/providers/fixtures/antigravity/*.jsonl` with header comments, the Codex spike's layout): `agy --version`; a login-state probe (is there a status command, or which file/env the CLI reads); `agy --print --output-format stream-json --input-format stream-json` from a scratch repo outside `%TEMP%` — the exact NDJSON message shapes both ways (system/init, assistant text — deltas or whole, tool use/result, the final result, errors), whether one process can run several turns (the loop), how a conversation id is reported and whether `--conversation <id>` resumes it with the same id; how an MCP server is handed to a turn (`agy mcp add` writes where? per project? is there a per-invocation way, and can the token reach it via environment, never argv — F-49/N-8); whether `crt mcp` is spawned, lists `write_task`, and the model calls it; permissions in print mode (does it prompt on stdin, refuse, or need `--mode`/`--dangerously-skip-permissions`; what `--sandbox` restricts — map to F-46 `permissions`); images (a stream-json content block, a path, or none); what environment `agy` exports into shells it runs (`launchEnv`); skills/instructions directories (F-58; `AGENTS.md`? `.agy/`? `GEMINI.md`?); a per-invocation telemetry opt-out (N-12); Ctrl+C/kill mid-turn then resume.
2. **PRD**: add an F-53-style requirement for the Antigravity driver to `docs/PRD-providers.md` (§11 item 4 → a numbered F-id, the verdicts as "tested version" bullets), including its N-7 lines, markers and the F-46 reference values.
3. **Driver + profile** `providers/antigravity.ts` (id `antigravity`, displayName `Antigravity`, agentName `Antigravity CLI`), executable resolution through `exec.ts` (`agy.exe` on PATH; `providers.antigravity.command` override), events → `SessionEvent`, `write_task` through `crt mcp`, resume command per the spike, `experimental` unset once the Manual rows pass.
4. **Tests**: `test/providers/antigravity.test.ts` runs the F-59 conformance scenario against a fake `agy` (`e2e/fixture/fake-agy.mjs`, npm-style install not needed — an executable script/`.cmd` per the fake-install helper) that replays the recorded fixtures and spawns the configured MCP server; fixture replay tests; the N-7 lines; an e2e `antigravity` axis in `chat.spec.ts` (a fifth server); README Providers section; `crt skills install --provider antigravity` if a skills directory exists.

## Definition of Done
- [ ] Spike doc with a verdict per Ask-1 question, every row `observed`, tested `agy --version` at the top; fixtures recorded from real runs.
- [ ] PRD-providers carries the Antigravity requirement and §11 item 4 is updated.
- [ ] Conformance test against the fake `agy` passes, including `write_task` through `crt mcp`; fixture replay tests pass.
- [ ] e2e `antigravity` axis green on both runners.
- [ ] `npm run check` passes; README Providers section quotes the N-7 lines verbatim (doc test).
- [ ] Manual: on the trial app, `crt --provider antigravity` → annotate → Send to Antigravity → streamed text, tool lines, a task passing `crt task --validate` with `provider: antigravity`, and the footer's resume command continues the conversation in a terminal.

## Notes
`agy` is logged in on this machine (`agy models` answers), so the Manual row is runnable by the worker session (standing rule 2026-09-18). Do not fold this into the ACP driver: `agy` speaks no ACP (checked: no `--acp` flag, no ACP strings in the binary). Keep `agy` off the e2e servers' PATH unless it is the fake (N-9). If the spike finds no per-invocation way to hand the turn an MCP server without touching the user's config, name the fallback (`agy mcp add` into the project scope, removed on close?) and put the N-19 write-outside-`.crt/` question to Simon in this file before building.

## Log
- 2026-09-21T13:10+08:00 — created by session f36246b7-e1ec-4291-95b0-f7a38ba6c3c3 while finishing CRT-0013, after Simon asked whether the Antigravity CLI could be added; `agy` 1.2.7 found at `%LOCALAPPDATA%\agy\bin\agy.exe`, no ACP mode, stream-json loop present, `agy models` lists Gemini 3.x (logged in).
- 2026-09-21T13:15+08:00 — claimed by /crt:next, session 73480a4c-3400-4053-b1e9-1eb435371ec4, branch crt/CRT-0023-antigravity-cli-profile
