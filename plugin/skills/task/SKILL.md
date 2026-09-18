---
name: task
description: Show one CRT task by ID with its context, ask, definition of done and log, and offer next actions. Use when the user references a CRT-NNNN identifier.
argument-hint: "<CRT-ID>"
allowed-tools: Bash(npx *) Read Glob
---

Show task `$ARGUMENTS` (PRD F-33/F-38), from the project root `${CLAUDE_PROJECT_DIR}`.

1. Run `npx --no crt task $ARGUMENTS` (the project's own install), else `npx -y claude-review-tool@0.4 task $ARGUMENTS`; it prints the whole file. If neither works, read `.crt/tasks/$ARGUMENTS-*.md` directly. If the CLI says `no task …`, list the IDs that do exist (`Glob .crt/tasks/CRT-*.md`) and stop.
2. Summarise: title, status, provider (one word after the status, from `provider:`; omit when absent), priority, created/updated; the **Summary**; the **Ask**; the **Definition of Done** with its tick state; and the last three **Log** entries. Mention `.crt/tasks/assets/$ARGUMENTS/` if it exists.
3. Offer the one next action that fits the status:
   - `backlog` → `/crt:next $ARGUMENTS`
   - `in_progress` → a worker is on it (branch `crt/$ARGUMENTS-<slug>`); `/crt:next $ARGUMENTS` re-runs it
   - `blocked` → quote the blocking question from the Log; answer it under **## Notes**, then `/crt:next $ARGUMENTS`
   - `review` → review the PR (`gh pr list --head crt/$ARGUMENTS-<slug>`), then `/crt:done $ARGUMENTS` once merged
   - `done` → nothing to do
