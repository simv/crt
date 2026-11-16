---
id: CRT-0052
title: M31 — Hand-over: crt handoff delivers the kept items to the project as one branch and one pull request
status: review
priority: high
created: 2026-11-16T13:20:00+08:00
updated: 2026-11-16T15:56:00+08:00
url: null
route: null
session: null
tags: [m31, handoff, review, git, f-136, f-137, f-139, n-35, prd-zero]
files: [docs/PRD-zero.md, packages/server/src/handoff.ts, packages/server/src/home.ts, packages/server/src/tasks.ts, packages/server/src/cli.ts, packages/server/src/args.ts, packages/server/src/providers/exec.ts, packages/server/test/helpers/fake-cli.ts, plugin/skills/next/SKILL.md, plugin/skills/tasks/SKILL.md, docs/cli.md, docs/troubleshooting.md, CLAUDE.md, .claude/agents/prd-reviewer.md]
---

## Summary
A review collected under the CRT home (M29) and collated (M30) has no way into the project. Add `crt handoff`: one command that delivers the kept items, in review order, to the project. The default writes them as task files with fresh `CRT-NNNN` ids on a new branch — through a temporary git worktree, so the developer's checkout and running dev server are never touched — pushes it and opens one pull request whose description is the collated summary. Merging that pull request is the moment the project takes the feedback on, and `/crt:next` works the items from there.

## Context
- M29 (CRT-0050) provides the review store and `R-NN` task files with `branch` / `commit`; M30 (CRT-0051) provides keep, priority and order in `review.json`. If M30 has not landed, every item is kept, in the order filed.
- `createTask` and `allocateTaskId` in `packages/server/src/tasks.ts` allocate `CRT-NNNN` by scanning the destination folder (retrying on a clash), move assets to `assets/<ID>/` and call `writeIndex`. Evidence links in a task file are relative (`assets/<ID>/viewport-annotated.png`).
- CLI resolution and spawning live in `packages/server/src/providers/exec.ts` (PATH and PATHEXT, npm-shim parsing, `shell: false`, never a `.cmd` handed to `spawn` — N-10); `setup.ts` resolves `claude` that way for `crt setup`. The server spawns no `git` anywhere today.
- `/crt:next` (`plugin/skills/next/SKILL.md`) reads tasks through `crt tasks --json` and works in `.crt/tasks/`; it writes its PR body to `.crt/captures/pr-body-<ID>.md`.

## Evidence
No page capture: created from `docs/PRD-zero.md` milestone M31, after Simon's second request of 2026-11-16: "how do we make it easy to collect all the feedback and inject it back into the project to be worked on?"

## Ask
1. **`packages/server/src/handoff.ts`** (new) and `crt handoff [--to pr|branch|here] [--review <name>] [--branch <name>] [--yes] [--again]` per PRD-zero §5.5 and F-136: the default destination (`pr` with a remote and `gh` on PATH, `branch` in a git repository without either, `here` otherwise); the printed plan and the one `Go ahead? [Y/n]` (refusal off a terminal without `--yes`); the nothing-kept line.
2. **`pr` and `branch`.** Fetch; `git worktree add` under the OS temp dir on a new branch `crt/review-<review>` (`-2`, `-3` on a clash) from the remote's default branch, or from `HEAD` without a remote; write the items; `git commit` (`chore(crt): review <review> — N items`); remove the worktree on success and on failure; for `pr`, push and `gh pr create --base <default> --title "CRT review <review>: N items" --body-file <temp file>`. A failure before the commit leaves no branch; every failure is one `crt:` line saying what exists and the next command.
3. **Id allocation and rewrites.** In the destination's `.crt/tasks/`, each kept item in review order: next free `CRT-NNNN`, file renamed, `id:` rewritten, `assets/R-NN/` → `assets/CRT-NNNN/`, Evidence links rewritten, the Log line `— handed over from review <review> (was R-NN) by crt handoff`; the index regenerated; `.crt/tasks/**` and nothing else written.
4. **The summary** (PR body; printed for `here`): the review's name and dates, the totals, the reviewed commits and how far the base has moved, the items grouped by route with id, priority, title and one-line summary, how to work them, and one line about `crt init` when the project is not set up.
5. **`here`.** The same files written into the working tree's `.crt/tasks/`, uncommitted.
6. **`review.json`.** The hand-over recorded (destination, time, the `R-NN → CRT-NNNN` map, the PR URL); the review `handed` only after the destination's last step succeeded; `--again` and the refusal without it.
7. **Tests** against scratch repositories with a bare remote: the branch holds exactly the kept items with consecutive ids after the project's highest, assets moved, links rewritten, `crt task <ID> --validate` green for each, the index current; a dropped item is absent; **N-35**: the developer's checkout has the same `HEAD`, branch, stash list and `git status --porcelain` before and after, with uncommitted changes present; a fake `gh` from `test/helpers/fake-cli.ts` receives the title and a body containing the summary; the push-refused and `gh`-failed lines; `here`; `--again`.
8. **Should — bundle (F-137):** `--to bundle [--out <dir>]` writes `crt-review-<project>-<review>/` with `REVIEW.md`, the task files and assets, ids left as `R-NN`.
9. **Should — the worker reads a review (F-139):** `/crt:tasks --review` and `/crt:next --review [R-NN]` through `crt tasks --review --json`; `claude plugin validate ./plugin`.
10. **Docs and guards.** `docs/cli.md`, `docs/troubleshooting.md` (a hand-over that stopped half-way); `CLAUDE.md` Don'ts line and entry points and the reviewer agent's spawn row per PRD-zero §9.

## Definition of Done
- [x] `crt handoff` prints its plan and asks once; `--yes` skips the question; off a terminal without it, one `crt:` line and no write (N-35).
- [x] `--to branch` and `--to pr` leave a branch holding exactly the kept items with fresh consecutive `CRT-NNNN` ids, moved assets, rewritten links, the hand-over Log line and a current index; each validates (F-136).
- [x] The developer's checkout is untouched by `pr` and `branch` — the N-35 before/after row with a dirty working tree.
- [x] `--to pr` pushes and calls `gh pr create` with the summary as the body (fake `gh`); the half-way failures each produce their one line and leave the review `open`.
- [x] `--to here` writes the same files uncommitted; a `handed` review is refused without `--again`.
- [x] Hand-over writes `.crt/tasks/**` only; it never force-pushes, merges or pushes to a branch it did not create (unit rows on the git argument lists).
- [x] `npm run check` green; `npm run e2e` green; `claude plugin validate ./plugin` green if a skill changed.
- [ ] Manual: a review of the trial app handed over as a real pull request on its repository from a checkout with uncommitted changes and a running dev server — the checkout and the server undisturbed, the pull request readable on GitHub, and after it is merged `/crt:next` picks up the first item. The pull request URL in the Log. Opening a pull request on the trial app's repository is outward-facing: ask Simon before that step.

## Notes
Read `docs/PRD-zero.md` §5.5, §6.4, §7 (N-35), §11 and §12 rule 7 first. Decisions already taken (§13): ids are allocated at hand-over by the project's own allocator; the first destination is task files on a branch with a pull request; the working tree is never used as a fallback for `pr` / `branch`. GitHub issues as a destination is Open question 1 and not part of this task. `git` and `gh` are spawned only from `handoff.ts`, only inside this command. Needs M29; works without M30.

## Log
- 2026-11-16T13:20+08:00 — created from docs/PRD-zero.md milestone M31 by the planning session that wrote it (Claude Code cloud session 01KVgoZd7cmxUJP97XZgyRn9), on Simon's go-ahead of 2026-11-16.
- 2026-11-16T15:47+08:00 — claimed by Claude Code cloud session 01KVgoZd7cmxUJP97XZgyRn9 (Simon's "do whatever you need to do to get this complete"); handoff.ts drafted, `crt handoff` wired in cli.ts, Handover / recordHandover in home.ts.
- 2026-11-16T15:56+08:00 — verified: plan, one question, `--yes`, refusal off a terminal and a "no" answer — test/handoff.test.ts "asks once and writes nothing …"; and by hand with the built CLI on a scratch repository (`crt handoff </dev/null` refused with nothing written, `--yes` made `crt/review-2026-11-16`, a second run refused without `--again`, `--to nope` exit 2).
- 2026-11-16T15:56+08:00 — verified: pr and branch put exactly the kept items on the branch as CRT-0006/0007 (above the base's CRT-0003 file and CRT-0005 assets folder), assets moved, links rewritten, the Log line, a current index, each file passing `validateTaskText` (what `crt task --validate` runs); the dropped R-02 absent — "puts exactly the kept items …", "keeps the branch local with --to branch …".
- 2026-11-16T15:56+08:00 — verified: N-35 — HEAD, branch, stash list, `git status --porcelain` and `git worktree list` equal before and after, with a stash, a modified tracked file and an untracked file present.
- 2026-11-16T15:56+08:00 — verified: `gh pr create --base main --head <branch> --title "CRT review <name>: 2 items" --body-file` with the summary as the body (gh on PATH, its run answered by the test seam); the push refused by a pre-receive hook and gh failing each give their one line and leave the review open.
- 2026-11-16T15:56+08:00 — verified: `--to here` (uncommitted, ids from CRT-0001 in a guest project, nothing else written, `--again` continues the numbering); `--to bundle` (F-137); the handed-review refusal and `--again`.
- 2026-11-16T15:56+08:00 — verified: argument lists — one push, `refs/heads/<b>:refs/heads/<b>`, no force flag anywhere except removing its own temporary worktree, no merge / rebase / reset / checkout / switch / stash / pull, `add` and `commit` only in the worktree — "never force-pushes, merges or touches a branch it did not create".
- 2026-11-16T15:56+08:00 — verified: `npm run check` green except test/providers/exec.test.ts "kills a process and its children", and `npm run e2e` 84 passed with embedded.spec.ts:148 failing — both fail the same way on main in this container and pass in CI; `claude plugin validate ./plugin` green (both skills changed for F-139).
- 2026-11-16T15:56+08:00 — Should items: the bundle (F-137) is built; F-139 is built as `--review` in /crt:tasks and /crt:next, through `crt tasks --review --json`, the task file never staged.
- 2026-11-16T15:56+08:00 — Manual row: needs the trial app's repository and Simon's go-ahead to open a pull request there (outward-facing); left unticked here and carried to CRT-0053 with the other Manual rows for the one pass before `v0.8.0` is tagged, as CRT-0049 to CRT-0051 did.
- 2026-11-16T15:56+08:00 — ready for review: added handoff.ts, test/handoff.test.ts; changed home.ts (Handover, recordHandover), cli.ts, args.ts, both worker skills, docs/cli.md, docs/troubleshooting.md, docs/PRD-zero.md (As built (M31)), CLAUDE.md, the reviewer agent.
