---
id: CRT-0009
title: M6 — Spike: Codex CLI feasibility on Windows (exec --json, MCP under sandbox, resume)
status: in_progress
priority: high
created: 2026-09-15T17:30:00+08:00
updated: 2026-09-15T18:45:16+08:00
url: null
route: null
session: null
tags: [m6, spike, f-53, n-10, prd-providers]
files: [docs/PRD-providers.md, docs/spikes/codex-2026-09.md, packages/server/test/providers/fixtures/codex/]
---

## Summary
Record, from real runs on Simon's Windows machine, every behaviour of the OpenAI Codex CLI that the v0.2 Codex driver (PRD-providers F-53) assumes, so that M9 builds on observed facts and recorded fixtures rather than on documentation.

## Context
`docs/PRD-providers.md` §5.3, §8 (M6), F-53, §12. The driver design depends on three unverified premises: that `codex exec --json` spawns a configured stdio MCP server and that the server can reach `127.0.0.1` under `--sandbox read-only`; that `codex exec resume <thread_id>` accepts the same flags (`--image`, `-c mcp_servers.*`, stdin prompt) and does not silently start a new thread; and that the JSONL event names match F-53. This machine has `~/.codex/config.toml` (model gpt-5.5, `[windows] sandbox = "elevated"`) but no `codex` on PATH, so the CLI must be installed first (`npm i -g @openai/codex`). Nothing in this task touches product code.

## Evidence
No page capture: this is a research task created from PRD-providers milestone M6.

## Ask
1. Install the Codex CLI and confirm `codex --version` and `codex login status` (record exit codes and output shapes for logged-in and, if practical, logged-out states).
2. In a scratch git repo with an `AGENTS.md`, run `codex exec --json` with the prompt on stdin (`-` argument or whatever the CLI accepts), `--sandbox read-only`, `--ask-for-approval never`, `-C <repo>`, one `--image <png>`, and a stdio MCP server configured through `-c mcp_servers.crt.command=…`, `-c mcp_servers.crt.args=[…]`, `-c mcp_servers.crt.env={…}` pointing at a throwaway Node script that logs its environment and answers `initialize`/`tools/list`/`tools/call` for one tool that POSTs to a local HTTP listener on `127.0.0.1`. Record: was the MCP server spawned, did the tool call reach the listener, did the model see the tool, every JSONL event verbatim.
3. Run `codex exec resume <thread_id>` with the same flags and a second message; record whether the thread id matches, whether `--image` and `-c` are accepted on resume, and the events.
4. Kill a turn mid-run (`taskkill /T /F`), then resume; record whether the thread survives.
5. Record: whether text arrives as deltas or whole messages; which environment variables Codex exports into commands it runs (for `launchEnv`); which directory Codex reads Agent Skills from (for `crt skills install`); whether a per-invocation telemetry opt-out flag exists.
6. Write `docs/spikes/codex-2026-09.md` with the exact commands, verbatim output, and a verdict per question. If MCP under `read-only` is unreachable, name the fallback to use (`--sandbox workspace-write`, a network-access config key, or an approval mode) and the F-53 amendment M9 must apply. Save the raw JSONL runs as `packages/server/test/providers/fixtures/codex/*.jsonl` with a header comment naming the command and version.

## Definition of Done
- [ ] Manual (Simon): every question in the Ask has a verdict in `docs/spikes/codex-2026-09.md`, with the tested `codex --version` at the top.
- [ ] Manual (Simon): the MCP-under-sandbox verdict is explicit (reachable / unreachable + fallback), and F-53 in `docs/PRD-providers.md` is amended in the same PR if the fallback is needed.
- [ ] `packages/server/test/providers/fixtures/codex/` contains at least a first-turn run, a resume run and a resume-after-kill run; a unit test `fixtures parse and contain thread.started, item.completed, turn.completed (F-53)` passes.
- [ ] `npm run check` passes.

## Notes
This task is mostly Manual: it needs a logged-in Codex CLI, which `/crt:next` does not have. The worker should create the fixtures directory, the parsing test and the spike doc skeleton, leave the Manual items unticked, set `review`, and name them in its reply (PRD-providers §8). Simon fills in the runs.

## Log
- 2026-09-15T17:30+08:00 — created from PRD-providers milestone M6 by the planning session that wrote docs/PRD-providers.md.
- 2026-09-15T18:45:16+08:00 — claimed by worker session 069dc8c8-12a5-4ea6-bc01-4eae478e3f7e. Branched from `docs/prd-providers` (PR #17, still open) because the task file does not exist on `main` yet; the PR for this task is stacked on that branch.
