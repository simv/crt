---
name: next
description: Pick the next unstarted CRT task from .crt/tasks and complete it end-to-end without stopping — implement, verify against its Definition of Done, log, and open a PR.
disable-model-invocation: true
argument-hint: "[task-id]"
---

You are the CRT worker (PRD F-37). Work one task to completion **without asking the user anything**. Everything you need is in the task file; if it truly is not, mark the task `blocked` and stop.

## 1. Pick the task

- Run `npx -y claude-review-tool@latest tasks --json` from `${CLAUDE_PROJECT_DIR}`. (If the CLI is unavailable, read `.crt/tasks/*.md` frontmatter directly.)
- If `$ARGUMENTS` names a task ID, use it. Otherwise choose the lowest-ID task with `status: backlog`, preferring `priority: high`.
- If there is no eligible task, say so and stop.

## 2. Claim it

- Set frontmatter `status: in_progress`, update `updated`, and append to **## Log**: `- <ISO timestamp> — claimed by worker session ${CLAUDE_SESSION_ID}`.
- Ensure a clean working tree on the default branch, then create branch `crt/<id>-<slug>` (from the filename).
- Commit the claim: `chore(crt): claim <ID>`.

## 3. Understand

Read the whole task file, every asset under `.crt/tasks/assets/<ID>/` (view the screenshots), and every file listed in `files:`. Read the project's `CLAUDE.md`. Reproduce the observed behaviour from the **Context** section where possible (run the app or tests).

## 4. Implement

Make the change described in **Ask**. Keep it minimal and idiomatic to the project. Add or update tests so that each **Definition of Done** item that can be automatically checked, is.

## 5. Verify

Run the project's lint, typecheck, test and build commands (from `CLAUDE.md` or `package.json`). Walk the DoD checklist one item at a time; for each, either tick it (`- [x]`) with a one-line note of how it was verified, or leave it unticked and explain why in the Log. Do not tick an item you did not verify.

## 6. Hand over

- Append to **## Log**: what changed (files), how each DoD item was verified, anything the reviewer should know.
- Set `status: review` (all DoD items ticked) or `status: blocked` (any unticked, with the reason in the Log). Update `updated`.
- Commit with a Conventional Commit message referencing the ID, e.g. `fix(cart): include discount in total (CRT-0007)`.
- Push the branch and open a PR: title = task title prefixed with the ID; body = the task's **Summary**, the ticked **Definition of Done**, and a link to the task file. Use `gh pr create` (or the GitHub MCP if available).
- Reply with the task ID, final status, and the PR URL. Nothing else.

## Rules

- Never ask the user a question. Decide, document the decision in the Log, move on.
- Never change scope. If the Ask turns out to be wrong, record why in the Log and set `blocked`.
- Never edit another task's file.
- Never regenerate `.crt/tasks/README.md` by hand; the CLI does that.
