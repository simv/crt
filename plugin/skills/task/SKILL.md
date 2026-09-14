---
name: task
description: Show one CRT task by ID with its context, ask, definition of done and log, and offer next actions. Use when the user references a CRT-NNNN identifier.
argument-hint: "<CRT-ID>"
allowed-tools: Bash(npx *) Read Glob
---

Show task `$ARGUMENTS` (PRD F-33/F-38).

1. Find `.crt/tasks/$ARGUMENTS-*.md` and read it. If the ID is missing or ambiguous, list the closest matches and stop.
2. Summarise: title, status, priority, created/updated, the **Summary**, the **Ask**, the **Definition of Done** with tick state, and the last three **Log** entries. Mention the assets folder if it exists.
3. Offer the relevant next action: `/crt:next $ARGUMENTS` (backlog), review the PR (review), or `/crt:done $ARGUMENTS` (merged).
