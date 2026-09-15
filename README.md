# Claude Review Tool (CRT)

Annotate your local site in the browser, talk to Claude in the page, and get a self-contained task file in your repo that any Claude Code session can pick up later with `/crt:next`.

> Status: pre-release. See [docs/PRD.md](docs/PRD.md) for scope, architecture and the definition of done.

## Install

```bash
claude plugin marketplace add simv/crt
claude plugin install crt@crt
```

That gives every Claude Code session `/crt:serve`, `/crt:next`, `/crt:tasks`, `/crt:task`, `/crt:done` and `/crt:intake`, plus a SessionStart hook that says `CRT: N of M tasks in backlog …` whenever the project has backlog tasks (and stays silent otherwise). Restart Claude Code after installing; `claude plugin update crt@crt` picks up new versions (the plugin tracks `main`).

The skills run the `crt` CLI as `npx --no crt` when the project has it installed (a devDependency, a global install, or this repo's workspace), otherwise as `npx -y claude-review-tool@latest`. Until the package is published (milestone M5), install it from a checkout: `npm i -g ./packages/server` after `npm run build`.

## Use

```bash
cd my-app && npm run dev     # your dev server, e.g. http://localhost:3000
claude                       # your normal Claude Code session in the project
/crt:serve                   # proxies your app at http://localhost:4400 and opens it
```

Browse as usual. Click the **CRT** button in the corner, select an element or draw a box, write a note, and **Send to Claude**. Claude (a real Claude Code session with `cwd` set to your project) reads the page context and your code, agrees a definition of done with you, and writes `.crt/tasks/CRT-0001-<slug>.md`.

Later, in any session on that project:

```
/crt:tasks           # what's outstanding
/crt:next            # pick the next backlog task and take it to a PR, without stopping
/crt:next CRT-0001   # work (or retry) a specific task
/crt:task CRT-0001   # show one task and the next action for it
/crt:done CRT-0001   # after the PR merges: mark it done, record the PR URL
```

`/crt:next` claims the task (`status: in_progress`, log entry, branch `crt/CRT-0001-<slug>`), implements the **Ask**, ticks each **Definition of Done** item it verified, sets `status: review`, commits, pushes and opens a PR whose body is the task's Summary + DoD + a link to the task file. It never asks you anything: if the task file is not enough to proceed it sets `status: blocked` with the question in the **Log** — answer it under **Notes** and run `/crt:next CRT-0001` again. Merging is yours.

Without the plugin: `npx claude-review-tool serve --open` in the project folder, and `crt tasks` / `crt task <ID>` for the list.

### `crt serve` flags

```
crt serve [--target <url>] [--port <n>] [--open]
```

| Flag | Default | Meaning |
|---|---|---|
| `--target <url>` | auto | Dev server to proxy. Accepts `3000`, `localhost:3000` or a full URL. Without it, CRT reads `target` from `.crt/config.json`, then probes ports 3000, 5173, 8080, 4200, 8000, 3001 and takes the first that answers. |
| `--port <n>` | `4400` (or `port` in `.crt/config.json`) | Port CRT listens on. Always bound to `127.0.0.1`. |
| `--open` | off | Open the CRT URL in your default browser once ready. |

On success it prints one line — `CRT ready at http://localhost:4400 → http://localhost:3000 (project: C:\my-app, 3 tasks)` — and keeps running until Ctrl+C. `crt serve` first runs `crt init`, which creates `.crt/tasks/`, `.crt/config.json` and adds `.crt/captures/` to `.gitignore` (idempotent). If the target is down, no dev server can be found, or the port is taken, it prints a single `crt: …` line telling you what to do and exits non-zero.

Through the proxy, HTML responses get `<script src="/__crt/overlay.js" defer>` injected (compressed responses are decompressed first), WebSocket upgrades such as Next.js and Vite HMR pass straight through, and `http://localhost:4400/__crt/health` reports the detected target and project root. All CRT routes live under `/__crt/`.

## Repository

| Path | What |
|---|---|
| `packages/server` | npm package `claude-review-tool` — the `crt` CLI, proxy, capture store, session manager |
| `packages/overlay` | in-page UI, bundled into the server |
| `plugin/` | the Claude Code plugin (skills + hooks); marketplace manifest at `.claude-plugin/marketplace.json` |
| `docs/PRD.md` | the product requirements document |
| `.crt/tasks` | this repo's own work items, in CRT's task format |

## Develop

```bash
npm ci
npm run check   # typecheck, lint, unit tests, build
npm run e2e     # Playwright smoke: fixture app behind a real `crt serve` (needs `npx playwright install chromium` once)
```

Plugin changes: `claude plugin validate ./plugin` (and `.` for the marketplace) must pass — CI runs both. To try a local skill edit before it is on `main`, run `claude --plugin-dir ./plugin` in the project you are testing against, or `claude plugin marketplace add ./` from a fresh profile (`CLAUDE_CONFIG_DIR=<empty dir>`).

License: MIT.
