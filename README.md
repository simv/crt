# Claude Review Tool (CRT)

Annotate your local site in the browser, talk to Claude in the page, and get a self-contained task file in your repo that any Claude Code session can pick up later with `/crt:next`.

> Status: pre-release. See [docs/PRD.md](docs/PRD.md) for scope, architecture and the definition of done.

## Install

```bash
claude plugin marketplace add simv/crt
claude plugin install crt@crt
```

## Use

```bash
cd my-app && npm run dev     # your dev server, e.g. http://localhost:3000
claude                       # your normal Claude Code session in the project
/crt:serve                   # proxies your app at http://localhost:4400 and opens it
```

Browse as usual. Click the **CRT** button in the corner, select an element or draw a box, write a note, and **Send to Claude**. Claude (a real Claude Code session with `cwd` set to your project) reads the page context and your code, agrees a definition of done with you, and writes `.crt/tasks/CRT-0001-<slug>.md`.

Later, in any session on that project:

```
/crt:tasks         # what's outstanding
/crt:next          # pick the next backlog task and take it to a PR, without stopping
/crt:task CRT-0001 # show one task
```

Without the plugin: `npx claude-review-tool serve --open` in the project folder.

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

License: MIT.
