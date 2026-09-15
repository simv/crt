---
id: CRT-0004
title: M4 — Plugin install path, /crt:next worker and SessionStart hook
status: in_progress
priority: normal
created: 2026-09-14T20:50:00+08:00
updated: 2026-09-15T10:32:00+08:00
url: null
route: null
session: null
tags: [m4, plugin, skills]
files: [plugin/.claude-plugin/plugin.json, .claude-plugin/marketplace.json, plugin/skills/next/SKILL.md, plugin/hooks/hooks.json, plugin/hooks/session-start.mjs]
---

## Summary
Make the two-command install real and prove the worker: refine the plugin skills against the shipped CLI, verify `/crt:next` takes a real task to a PR with no questions, and wire the SessionStart backlog hint.

## Context
PRD §6.6 (F-36…F-41), §8, milestone M4. Depends on CRT-0003. Skill drafts already exist under `plugin/skills/`; they were written before the CLI and must be reconciled with its actual flags and output. Test the marketplace flow with `claude plugin marketplace add ./` locally first, then from GitHub.

## Evidence
None — greenfield task from the PRD.

## Ask
1. Reconcile every skill with the real CLI (`serve`, `tasks --json`, `task`), including the `CRT ready at` line `/crt:serve` waits for.
2. `/crt:next` (F-37): dry-run it on a synthetic task in this repo; fix anything that causes it to stop and ask. Ensure `blocked` is used when information is missing, and that the branch/commit/PR steps work with `gh`.
3. `/crt:done` (F-40) and the SessionStart hook (F-41): verify the hook prints exactly one line only when backlog > 0 and never errors when `.crt/` is absent.
4. Plugin validation: `claude plugin validate ./plugin` passes; `claude plugin marketplace add simv/crt` + `claude plugin install crt@crt` works on a machine (or a fresh user profile) without the repo cloned.
5. README install/usage sections match reality.

## Definition of Done
- [ ] Fresh install in two commands yields `/crt:serve`, `/crt:next`, `/crt:tasks`, `/crt:task`, `/crt:done`, `/crt:intake`.
- [ ] `/crt:next` on the trial Next.js app takes a real intake-written task from backlog to an open PR with zero interactive prompts; the task file's Log records claim, verification and hand-over.
- [ ] SessionStart hook shows the backlog line in a project with backlog tasks and nothing otherwise.
- [ ] `claude plugin validate ./plugin` passes in CI (add a job step if the CLI is installable there; else document the manual check in the Log).

## Notes
Open question 2 in the PRD (auto-merge) stays "no" for this milestone.

## Log
- 2026-09-14T20:50+08:00 — created from PRD milestone M4 during project setup.
- 2026-09-15T10:32+08:00 — claimed by build session (Claude Code, VS Code); branch `crt/CRT-0004-m4-worker-skill-and-plugin`. Found at claim time: `claude-review-tool` is not on npm yet (404), so every `npx -y claude-review-tool@latest` in the skills fails today; plugin `crt@crt` is already installed from GitHub `simv/crt`.
- 2026-09-15T10:45+08:00 — skills reconciled with the CLI: every skill resolves `crt` as `npx --no crt` (project/workspace/global install) before `npx -y claude-review-tool@latest`, and degrades to reading frontmatter when neither works. `/crt:serve` now passes `--target` (the CLI has no positional target) and polls `/__crt/health` as a fallback for the `CRT ready at` line. `/crt:next` rewritten: explicit-ID retry of `blocked` tasks, branch from current HEAD so the uncommitted intake file rides along, never stages the developer's dirty paths, PR body via `.crt/captures/pr-body-<ID>.md` + `--body-file`, `blocked` = question in Log + commit + push + no PR, three-line reply. `/crt:done` handles the protected `main` (falls back to a `crt/<ID>-done` PR). Verified `${CLAUDE_SESSION_ID}`, `${CLAUDE_PROJECT_DIR}`, `$0`/`$1` are substituted in skill text with a scratch skill. Hook hardened (try/catch everywhere, exit 0 always) with `test/session-start-hook.test.ts` (absent `.crt`, no backlog, backlog>0 = exactly one line, unreadable dir, no `CLAUDE_PROJECT_DIR`). `claude plugin validate ./plugin` and `.` pass locally and via `npx -y @anthropic-ai/claude-code@latest` with no profile; added as a CI step. Fresh profile (`CLAUDE_CONFIG_DIR`) install from `./` and from GitHub `simv/crt` (cwd `%TEMP%`, repo not cloned) both yield the six skills and the hook. `npm run check` green (114 tests).
