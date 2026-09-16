---
name: tasks
description: List the CRT tasks in this project (.crt/tasks) with status and priority. Use when the user asks what feedback or tasks are outstanding.
allowed-tools: Bash(npx *) Read Glob
---

List this project's CRT tasks (PRD F-33/F-38), from the project root `${CLAUDE_PROJECT_DIR}`.

1. Run `npx --no crt tasks --json` (the project's own install), else `npx -y claude-review-tool@0.3 tasks --json`. Either prints `{ "tasksDir", "tasks": [{ "id", "status", "priority", "title", "updated", "provider", "file" }] }` and regenerates the `README.md` index. If neither works, read the frontmatter of each `.crt/tasks/CRT-*.md` yourself. If there is no `.crt/tasks/`, say CRT is not set up here and that `/crt:serve` creates it; stop.
2. Present a compact table: ID, status, provider (one word after the status; blank when the task predates providers), priority, title, updated (date only). Group by status in the order `backlog`, `in_progress`, `blocked`, `review`, `done`; omit empty groups.
3. End with one line: how many are in backlog and that `/crt:next` works the next one (or, if none, that there is nothing to work). If any task is `blocked`, add its ID and say `/crt:task <ID>` shows the question.
