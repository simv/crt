---
name: tasks
description: List the CRT tasks in this project (.crt/tasks) with status and priority. Use when the user asks what feedback or tasks are outstanding.
allowed-tools: Bash(npx *) Read Glob
---

List this project's CRT tasks (PRD F-33/F-38).

1. Run `npx -y claude-review-tool@latest tasks` from `${CLAUDE_PROJECT_DIR}`. If the CLI is unavailable, read the frontmatter of each `.crt/tasks/CRT-*.md`.
2. Present a compact table: ID, status, priority, title, updated. Group by status in the order backlog, in_progress, blocked, review, done.
3. End with one line: how many are in backlog and that `/crt:next` works the next one.
