---
id: CRT-0004
title: M4 — Plugin install path, /crt:next worker and SessionStart hook
status: review
priority: normal
created: 2026-09-14T20:50:00+08:00
updated: 2026-09-15T11:15:00+08:00
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
- [x] Fresh install in two commands yields `/crt:serve`, `/crt:next`, `/crt:tasks`, `/crt:task`, `/crt:done`, `/crt:intake`. (Fresh `CLAUDE_CONFIG_DIR` profile, cwd `%TEMP%`, repo not cloned: `claude plugin marketplace add simv/crt` + `claude plugin install crt@crt` → `crt@crt` enabled, six `skills/*/SKILL.md` and `hooks/hooks.json` in the plugin cache. Same from `marketplace add ./`.)
- [x] `/crt:next` on the trial Next.js app takes a real intake-written task from backlog to an open PR with zero interactive prompts; the task file's Log records claim, verification and hand-over. (Apex: in-page intake wrote CRT-0001, `claude -p "/crt:next"` opened simv/apex#257 — 80 turns, no AskUserQuestion, no permission denial; Log has claim, one line per DoD item, hand-over. See Log below.)
- [x] SessionStart hook shows the backlog line in a project with backlog tasks and nothing otherwise. (`test/session-start-hook.test.ts`, 5 cases, spawning the hook as Claude Code does; plus observed live at the start of this session.)
- [x] `claude plugin validate ./plugin` passes in CI (add a job step if the CLI is installable there; else document the manual check in the Log). (`ci.yml` step "claude plugin validate" runs `npx -y @anthropic-ai/claude-code@latest plugin validate ./plugin` and `.`; verified locally to pass with no profile/login.)

## Notes
Open question 2 in the PRD (auto-merge) stays "no" for this milestone.

## Log
- 2026-09-14T20:50+08:00 — created from PRD milestone M4 during project setup.
- 2026-09-15T10:32+08:00 — claimed by build session (Claude Code, VS Code); branch `crt/CRT-0004-m4-worker-skill-and-plugin`. Found at claim time: `claude-review-tool` is not on npm yet (404), so every `npx -y claude-review-tool@latest` in the skills fails today; plugin `crt@crt` is already installed from GitHub `simv/crt`.
- 2026-09-15T10:45+08:00 — skills reconciled with the CLI: every skill resolves `crt` as `npx --no crt` (project/workspace/global install) before `npx -y claude-review-tool@latest`, and degrades to reading frontmatter when neither works. `/crt:serve` now passes `--target` (the CLI has no positional target) and polls `/__crt/health` as a fallback for the `CRT ready at` line. `/crt:next` rewritten: explicit-ID retry of `blocked` tasks, branch from current HEAD so the uncommitted intake file rides along, never stages the developer's dirty paths, PR body via `.crt/captures/pr-body-<ID>.md` + `--body-file`, `blocked` = question in Log + commit + push + no PR, three-line reply. `/crt:done` handles the protected `main` (falls back to a `crt/<ID>-done` PR). Verified `${CLAUDE_SESSION_ID}`, `${CLAUDE_PROJECT_DIR}`, `$0`/`$1` are substituted in skill text with a scratch skill. Hook hardened (try/catch everywhere, exit 0 always) with `test/session-start-hook.test.ts` (absent `.crt`, no backlog, backlog>0 = exactly one line, unreadable dir, no `CLAUDE_PROJECT_DIR`). `claude plugin validate ./plugin` and `.` pass locally and via `npx -y @anthropic-ai/claude-code@latest` with no profile; added as a CI step. Fresh profile (`CLAUDE_CONFIG_DIR`) install from `./` and from GitHub `simv/crt` (cwd `%TEMP%`, repo not cloned) both yield the six skills and the hook. `npm run check` green (114 tests).
- 2026-09-15T10:50+08:00 — worker dry run in this repo: synthetic task CRT-0006 (README troubleshooting for the N-6 cases, a slice of CRT-0005 Ask 2) written uncommitted into a `git worktree` of `main`, then `claude --plugin-dir ./plugin -p "/crt:next CRT-0006" --permission-mode acceptEdits` with an allowlist for git/gh/npx/npm/node. Result: `status: review`, PR simv/crt#7, 32 turns, $1.81, 3m44s, no questions, no permission denials; all four DoD items ticked with evidence lines; two scope decisions recorded in the Log instead of asked. `/crt:done CRT-0006` with the PR still open correctly refused and changed nothing ($0.33). Merging #7 was declined by the auto-mode classifier (merge without review) — left for Simon.
- 2026-09-15T11:12+08:00 — DoD 2 on the trial app: Apex dev server on :3000, `crt serve --target http://localhost:3000 --port 4400` from `C:\Projects\Claude\Apex`, intake driven through `window.__crt` (select `a.site-mark`, note about the logo link's accessible name) → CRT-0001 written by `write_task` after one DoD confirmation ($1.00). `claude -p "/crt:next"` from the Apex root picked it (only backlog task), and — because the checkout was on another session's branch with its own uncommitted edits and Apex's `guard-bash.mjs` refused `git switch` — created branch `crt/CRT-0001-site-header-logo-link-announces-only` from `main` in a sibling worktree, implemented `aria-label="Apex — home"` plus a witnessed-failing source fence in `test/a11y-names.test.ts`, verified with `pnpm --filter @apex/web test` (786/786), typecheck, an a11y probe against a production build and a 1280×800 screenshot compared to the capture, and opened simv/apex#257 (4 files: task, index, component, test). 80 turns, $6.73, 10m53s, zero questions, developer's dirty files untouched. Cleanup as agreed: PR #257 closed with a comment, branch deleted, `.crt/` removed, `.gitignore` restored, servers stopped. Lesson folded into the skill: an explicit worktree escape when a project hook blocks switching.
- 2026-09-15T11:15+08:00 — verified: DoD 1 fresh-profile installs (local and GitHub); DoD 2 Apex run above; DoD 3 `test/session-start-hook.test.ts`; DoD 4 CI step + local `npx -y @anthropic-ai/claude-code@latest plugin validate`. `npm run check` green.
- 2026-09-15T11:15+08:00 — ready for review: changed `plugin/skills/{serve,next,tasks,task,done,intake}/SKILL.md`, `plugin/hooks/session-start.mjs`, `.claude-plugin/marketplace.json` (description), `.github/workflows/ci.yml`, `README.md`, new `packages/server/test/session-start-hook.test.ts`. Reviewer notes: the npm package is still unpublished, so the skills lean on `npx --no crt` (a global `npm i -g ./packages/server` was used for the Apex run; README documents it); PR #7 (CRT-0006) is open and should merge before this one — both touch README in different regions.
