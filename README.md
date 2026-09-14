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
```

License: MIT.
