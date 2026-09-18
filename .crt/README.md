# .crt/ — Claude Review Tool

CRT (Claude Review Tool) puts a review overlay on this project's local dev site: you annotate the page in the browser, talk to a coding agent in-page, and it writes a self-contained task file into this folder. Any later agent session completes a task from its file alone.

## What is in this folder

- `tasks/` — the work items, one Markdown file each (`CRT-NNNN-<slug>.md`): YAML frontmatter (`id`, `title`, `status`, `priority`, dates, `url`, `route`, `tags`, `files`), then Summary, Context, Evidence, Ask, Definition of Done, Notes and Log. Statuses run `backlog → in_progress → review → done` (or `blocked`).
- `tasks/README.md` — the generated index; `crt tasks` rewrites it, never hand-edit it.
- `tasks/assets/<ID>/` — the screenshots a task's Evidence refers to.
- `captures/` — transient page captures waiting for intake; gitignored, pruned after 7 days.
- `config.json` — committed, per project: `mode` (`embedded` or `proxy`), `target` (the app URL), `port` (the CRT server port), `provider` (the agent).
- `config.local.json` — the same keys per machine (what "Remember" and the guided start write); gitignored.

## Working a task

- `/crt:next [ID]` in Claude Code takes the next backlog task (or the named one) to an open pull request.
- `crt tasks` lists the tasks; `crt task <ID>` prints one (`--validate` checks its format).
- A task file is self-contained: any agent can read it and do the work.

Written by crt init 0.3.0; https://github.com/simv/crt
