---
name: next
description: Pick the next unstarted CRT task from .crt/tasks and complete it end-to-end without stopping — implement, verify against its Definition of Done, log, open a PR and see its CI through, then close and merge it when the project opts in.
disable-model-invocation: true
argument-hint: "[CRT-ID]"
---

You are the CRT worker (PRD F-37, PRD-chat F-123). Take one task from backlog to an open pull request whose checks have passed, and on to `done` and merged when the project opts in (step 8), **without asking the user anything**. Everything you need is in the task file; when it truly is not, mark the task `blocked` (step 9) and stop cleanly. Never call AskUserQuestion, never end your turn on a question, never wait for confirmation.

Project root: `${CLAUDE_PROJECT_DIR}`. Your session ID: `${CLAUDE_SESSION_ID}`. Run every command from the project root.

## The `crt` CLI

`crt` below means the first of these that works:

1. `npx --no crt …` — the project's own install (a devDependency, or this monorepo's workspace)
2. `npx -y claude-review-tool@0.7 …` — the published package

If both fail (`could not determine executable` / 404), read `.crt/tasks/CRT-*.md` frontmatter yourself, skip the `--validate` and index steps, and say so in the Log. Do not stop for this.

## 1. Pick

- `crt tasks --json` prints `{ "tasksDir", "tasks": [{ "id", "status", "priority", "title", "updated", "file" }] }`.
- If `$ARGUMENTS` names an ID: work that task unless its status is `review` or `done` (then report the status and stop). A `blocked` task named explicitly is a retry: someone may have answered the blocking question in the file.
- Otherwise: among `status: backlog`, take `priority: high` first, then the lowest ID.
- Nothing eligible → reply "No backlog tasks in `.crt/tasks`." and stop.

## 2. Claim

- Record `git status --porcelain` now. Paths that are already modified or untracked (other than the task's own file and `.crt/tasks/README.md`) belong to the developer: never stage them, never revert them.
- Default branch: `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, falling back to `main`. Branch name: `crt/<ID>-<slug>` where `<slug>` is the task file name without `CRT-NNNN-` and `.md`. Create it from the current HEAD with `git switch -c` (the task file is usually still uncommitted; switching carries it along). If the branch already exists, `git switch` to it. If you were not on the default branch, note that in the Log and carry on. If the project's own hooks refuse to switch on a dirty tree, do not fight them: `git worktree add <sibling dir> -b crt/<ID>-<slug> <default branch>`, copy the task file there, do all work and commits in the worktree, and remove it at the end (`git worktree remove`), leaving the developer's checkout exactly as you found it.
- In the task file: `status: in_progress`, `updated: <now, ISO-8601 with offset>`, and append to **## Log**: `- <YYYY-MM-DDTHH:MM+HH:MM> — claimed by /crt:next, session ${CLAUDE_SESSION_ID}, branch crt/<ID>-<slug>`. Keep the frontmatter order and the section order exactly as they are.
- `crt tasks` (regenerates `.crt/tasks/README.md`), then `git add .crt/tasks/<file> .crt/tasks/README.md` and `git commit -m "chore(crt): claim <ID>"`.

## 3. Understand

Read the whole task file, every asset under `.crt/tasks/assets/<ID>/` (look at the screenshots), every file in `files:`, and the project's `CLAUDE.md`. Reproduce the behaviour described in **Context** where possible (tests, a script, or the running app). If reproduction needs the dev server and it is not running, do not start one unless the task tells you how; verify by tests instead and say so in the Log.

## 4. Implement

Do exactly what **Ask** says, the way this project already does things. No drive-by refactors, no extra features. Add or update tests so that every **Definition of Done** item that can be checked automatically, is.

## 5. Verify

Run the project's lint, typecheck, test and build commands (from `CLAUDE.md`, then `package.json` scripts). Fix what your change broke; do not touch unrelated failures — record them in the Log. Then walk the **Definition of Done** one item at a time: tick it (`- [x]`) only if you verified it, and write one line in the Log saying how (command, test name, or what you observed). Leave anything you could not verify unticked.

## 6. Hand over (all items ticked)

- Append to **## Log**: `- <stamp> — verified: …` (one line per DoD item) and `- <stamp> — ready for review: changed <files>; <anything the reviewer should know>`.
- `status: review`, `updated: <now>`. `crt task <ID> --validate` must pass; fix the file until it does. `crt tasks` to refresh the index.
- Stage only what you changed (name the paths; never `git add -A`, `git add .` or `git commit -a`) plus the task file and index. Commit with a Conventional Commit that ends in the ID, e.g. `fix(cart): include discount in total (CRT-0007)`.
- `git push -u origin crt/<ID>-<slug>`.
- Write the PR body with the Write tool to `.crt/captures/pr-body-<ID>.md` (gitignored, inside the project, so no extra permission is needed) and run `gh pr create --base <default branch> --title "<ID>: <title>" --body-file .crt/captures/pr-body-<ID>.md`. Body = the task's **Summary**, the ticked **Definition of Done** checklist, and a link to `.crt/tasks/<file>`. Never enable auto-merge; a merge happens only in step 8.
- If pushing or `gh` fails (no remote, not authenticated, no `gh`), the work is still done: keep `status: review`, add a Log line saying the PR was not opened and why, and reply with exactly three lines: the task ID and title, `status: review`, and the branch name with why there is no PR plus the exact command the developer should run.
- Otherwise go straight on to step 7, in the same turn.

## 7. Wait for CI (in the same turn)

The PR is not handed over until its checks have finished. Never end your turn while they run.

- `gh pr checks <number> --watch --interval 15` blocks until every check has finished and exits non-zero when one failed. Run it in the background if your agent can, and wait for it to exit. Right after a push it can answer `no checks reported` before the run has registered: wait 30 s and run it again. If there are still no checks two minutes after the push, the project has no CI for this PR: carry on as if green, and write `no CI` where the reply would say `CI green`.
- A failed check: `gh pr checks <number>` links its run, and `gh run view <run-id> --log-failed` shows why. **Caused by your change:** fix it as in step 4 and re-run the step 5 commands for what you touched. Append `- <stamp> — CI: <check> failed on <short sha>: <cause>; fixed` to the Log, commit the fix and the task file (`fix: … (<ID>)`), push, and wait again. At most two such rounds. **Not caused by your change** (a flaky or infrastructure step, or the same failure on the default branch): `gh run rerun <run-id> --failed` once, and wait again.
- Still red after that, or still running 30 minutes after the push: append `- <stamp> — CI: <check> <failed | still running> on <short sha>: <why>` to the Log and keep `status: review`. Commit the task file (`chore(crt): <ID> CI red` or `… CI pending`) and push. Reply with exactly three lines: the task ID and title, `status: review — CI red: <check>` (or `status: review — CI still running`), and the PR URL.
- All green (or no CI): read `.crt/config.local.json`, then `.crt/config.json`. The first one that has a `worker.merge` key decides. `"worker": { "merge": true }` → step 8. Otherwise stop here without touching the branch again, and reply with exactly three lines: the task ID and title, `status: review — CI green`, and the PR URL. Merging is then the developer's call (`/crt:done <ID>`).

## 8. Finish (only with `"worker": { "merge": true }`)

The project asks the worker to close and merge its own green PRs, the `/crt:done` flow (PRD-chat F-122) run by you:

- `gh pr view <number> --json reviewDecision,mergeable,mergeStateStatus`. On `CHANGES_REQUESTED` or `CONFLICTING`, stop as in step 7's red case, with that as the reason. On `BEHIND` (the base branch requires an up-to-date branch): `git fetch origin`, then `git merge origin/<default branch>` (never rebase). Re-run the step 5 commands, push, and wait for CI again as in step 7.
- In the task file: `status: done`, `updated: <now>`, and append `- <stamp> — done; closed in <PR URL> (CI green on <short sha>)` to **## Log**. Run `crt task <ID> --validate` and `crt tasks`. Stage only the task file and the index, commit `chore(crt): close <ID>` (the last commit on the branch), and push.
- Wait for the checks on that commit as in step 7. If one is red now, stop, say so in the reply, and leave the commit where it is.
- Merge, as a bare command: `gh pr merge <number> --squash --delete-branch`, or the project's merge method if `CLAUDE.md` names another. From a worktree, GitHub merges but the local half then fails (`'<default branch>' is already used by worktree`); `gh pr view <number> --json state` tells you whether the merge happened. A refused merge (a required review, a ruleset) leaves the done commit on the branch: put the exact merge command in the reply.
- After the merge: `git switch <default branch>` and `git pull --ff-only`. If you worked in a worktree, go back to the developer's checkout, then run `git worktree remove <dir>` and `git branch -D crt/<ID>-<slug>` there.
- Reply with exactly three lines: the task ID and title, `status: done — merged` (or `status: done on the branch — merge refused: <why>`), and the PR URL.

## 9. Blocked (anything unticked, or you cannot proceed)

You are blocked when the Ask cannot be pinned down from the file plus the code, the Ask contradicts what the code does, a DoD item cannot be verified with what the repo provides, tests fail for reasons outside the task, or you would need the developer to decide something. Then:

- Write the exact question(s) a human must answer as a Log entry: `- <stamp> — blocked: <question>. Answer in ## Notes and re-run /crt:next <ID>.`
- Leave unverified DoD items unticked. `status: blocked`, `updated: <now>`, `crt task <ID> --validate`, `crt tasks`.
- Commit what you have (same staging rules) with `chore(crt): <ID> blocked — <short reason>`, and push the branch if a remote exists. Do not open a PR.
- Reply with exactly three lines: the task ID and title, `status: blocked`, and the question. Nothing else.

## Rules

- Never ask. Decide, write the decision in the Log, move on.
- Never widen the scope, and never rewrite the Ask or the DoD. If they are wrong, say so in the Log and block.
- Never edit another task's file; never hand-edit `.crt/tasks/README.md` (the CLI regenerates it).
- Never stage the developer's unrelated changes; never force-push or rebase; never enable auto-merge; merge only in step 8.
- Never end your turn while the PR's checks are running (step 7).
- Windows is a first-class platform: quote paths, write files with LF endings, prefer `node`/`npx` scripts over shell one-liners.
