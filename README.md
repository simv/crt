# Claude Review Tool (CRT)

Annotate your local site in the browser, talk to Claude in the page, and get a self-contained task file in your repo that any Claude Code session can pick up later with `/crt:next`.

> v0.1.0. [docs/PRD.md](docs/PRD.md) defines the scope, requirement IDs (F-n, N-n) and the definition of done; this README is the user manual.

## Install

```bash
claude plugin marketplace add simv/crt
claude plugin install crt@crt
```

That gives every Claude Code session `/crt:serve`, `/crt:next`, `/crt:tasks`, `/crt:task`, `/crt:done` and `/crt:intake`, plus a SessionStart hook that says `CRT: N of M tasks in backlog …` whenever the project has backlog tasks (and stays silent otherwise). Restart Claude Code after installing; `claude plugin update crt@crt` picks up new versions (the plugin tracks `main`).

The skills run the `crt` CLI as `npx --no crt` when the project has it installed (`npm i -D claude-review-tool`, a global install, or this repo's workspace), otherwise as `npx -y claude-review-tool@latest`, so nothing else needs installing. Node ≥ 20 on Windows, macOS or Linux; Claude Code logged in (`claude` → `/login`). No API key: CRT reuses the machine's Claude Code login.

Without the plugin, `npx claude-review-tool serve --open` in the project folder does what `/crt:serve` does, and `npx claude-review-tool tasks` / `task <ID>` list what `/crt:tasks` / `/crt:task` show.

## The loop

```bash
cd my-app && npm run dev     # your dev server, e.g. http://localhost:3000
claude                       # your normal Claude Code session in the project
/crt:serve                   # proxies your app at http://localhost:4400 and opens it
```

1. **Browse as usual** on `localhost:4400`. Hot reload keeps working. A **CRT** button sits in the bottom-right corner (drag it anywhere; `Ctrl/Cmd+Shift+.` toggles it).
2. **Point at the problem.** Open the toolbar and pick a tool:
   - **Select** — hover shows an outline and a label (tag, id/classes, and the React/Vue component name when detectable); click pins the element. `↑` moves to the parent, `↓` to the first child, `Enter` pins, `Esc` cancels.
   - **Box** — drag a rectangle; the elements inside it are recorded.
   - **Pin** — click a point with no element ("something is missing here").
   Each annotation gets a number and a popover beside the element with its note. Add as many as you like; **Delete** one from its popover, **Clear** drops them all. They survive in-page navigation and a reload, and clicking a number badge reopens its popover.
3. **Send to Claude** — the button in the popover. The overlay captures the page and the same popover becomes the chat. Claude — a real Claude Code session with `cwd` set to your project, with your `CLAUDE.md`, settings, plugins and MCP servers loaded — reads the capture and your code, asks at most a couple of questions only if it has to, proposes a definition of done, and on your OK writes `.crt/tasks/CRT-0007-<slug>.md` with the screenshots under `.crt/tasks/assets/CRT-0007/`. The marker stays on the page: its badge takes the session's colour and a pill next to it says `thinking…`, `needs permission`, `your turn` or the task ID, so you can close the popover, annotate something else and start a second thread while the first is still working. Each thread has its own popover; one is open at a time.
   - Sending captures that one annotation. Tick **include the N other unsent annotations** in the popover to send several as one capture ("these two should match").
   - **Quick note** instead of Send, when the note is written: the popover closes and Claude writes the task on its own. The status line shows the task ID when it lands; the popover opens by itself only if Claude has a question or needs a permission.
   - **Chat** in the toolbar starts a conversation about the page as a whole — no element, just your message plus the screenshot, console and failed requests. It docks above the toolbar, and the Chat button shows its state.
   - **Sessions** lists the recent intake sessions (note, state, task ID) so you can reopen one — for example a quick note that turned into a question while you were browsing elsewhere.
   - Tool use shows as collapsed lines; anything not pre-allowed (reads, searches, read-only `git`, writes under `.crt/`) asks you in the popover with **Allow / Deny** (if you are busy in another popover, the marker pulses and the status line points at it instead). **Stop** interrupts the turn; **Discard** closes the session and removes the annotation; **×** just hides the popover. The footer shows the session ID and `claude --resume <id>` to continue the same conversation in a terminal.
4. **Later, in any session on that project:**

```
/crt:tasks           # what's outstanding
/crt:next            # pick the next backlog task and take it to a PR, without stopping
/crt:next CRT-0007   # work (or retry) a specific task
/crt:task CRT-0007   # show one task and the next action for it
/crt:done CRT-0007   # after the PR merges: mark it done, record the PR URL
```

`/crt:next` claims the task (`status: in_progress`, log entry, branch `crt/CRT-0007-<slug>`), implements the **Ask**, ticks each **Definition of Done** item it verified, runs the project's tests/lint/build, sets `status: review`, commits, pushes and opens a PR whose body is the task's Summary + DoD + a link to the task file. It never asks you anything: if the task file is not enough to proceed it sets `status: blocked` with the question in the **Log** — answer it under **Notes** and run `/crt:next CRT-0007` again. Merging is yours.

### `crt serve` flags

```
crt serve [--target <url>] [--port <n>] [--open] [--provider <id>]
```

| Flag | Default | Meaning |
|---|---|---|
| `--target <url>` | auto | Dev server to proxy. Accepts `3000`, `localhost:3000` or a full URL. Without it, CRT reads `target` from `.crt/config.json`, then probes ports 3000, 5173, 8080, 4200, 8000, 3001 and takes the first that answers. |
| `--port <n>` | `4400` (or `port` in `.crt/config.json`) | Port CRT listens on. Always bound to `127.0.0.1`. |
| `--open` | off | Open the CRT URL in your default browser once ready. |
| `--provider <id>` | auto | The agent behind the chat: `claude` (default) or `codex`. See [Providers](#providers). |

On success it prints one line — `CRT ready at http://localhost:4400 → http://localhost:3000 (project: C:\my-app, 3 tasks)` — and keeps running until Ctrl+C. `crt serve` first runs `crt init`, which creates `.crt/tasks/`, `.crt/config.json` and adds `.crt/captures/` to `.gitignore` (idempotent). Every failure is a single `crt: …` line on stderr and a non-zero exit — see [Troubleshooting](#troubleshooting) for what each one means.

### What Claude gets

Everything is gathered at Send time from the live page, because the session cannot see the page afterwards (PRD §6.3):

- page URL, route, title, viewport, device pixel ratio, scroll position, user agent, timestamp;
- a viewport screenshot with the annotation markers drawn on, a clean one, and a crop per annotation (in-page rasterisation — best effort for canvas, WebGL and cross-origin images);
- per annotated element: a unique CSS selector, XPath, tag, id, classes, `data-*`, ARIA role/label, text, bounding box, a curated computed-style subset, and its outer HTML plus its parent's (4 KB each);
- the component chain and source file for React dev builds (`_debugSource` on React ≤ 18, owner stacks on React 19) and Vue; the detected framework, bundler and Next.js route pattern;
- `console.error`/`warn`, uncaught errors and unhandled rejections since page load (50 most recent), and failed network requests — `fetch`/XHR with status ≥ 400 or a thrown error, plus any image, script or stylesheet whose response was ≥ 400 (50 most recent);
- your notes.

It is written to `.crt/captures/<id>/capture.json` (+ PNGs) and moves to `.crt/tasks/assets/<ID>/` when the task is written. Captures older than 7 days that never became tasks are pruned on the next `crt serve`.

## Providers

The agent behind the in-page chat is a *provider*. Claude Code is the default and needs nothing; `crt serve --provider codex` (or `provider: "codex"` in `.crt/config.json`, or the caret next to **Send**) runs the intake on the developer's own Codex CLI instead. `crt providers` prints every provider's state and which one a new session would use, with the reason. The full resolution order and the auto-detection rules are in [docs/PRD-providers.md](docs/PRD-providers.md) F-43/F-44; this section covers what you need per provider.

### Codex

Tested with `codex-cli 0.154.0` (`npm i -g @openai/codex`, then `codex login` — a ChatGPT account). CRT never bundles Codex: it runs the `codex` on your PATH (Windows: the npm `codex.cmd` shim is parsed and its JS entry run with CRT's own Node, so no shell is involved), or the executable you name in `.crt/config.json`:

```json
{ "providers": { "codex": { "command": ["C:\\tools\\codex\\codex.exe"] } } }
```

What a Codex session looks like: **Send to Codex** starts `codex exec --json` in your project root under Codex's **read-only sandbox** — no Allow/Deny cards; the footer shows a `read-only sandbox` badge — with the intake instructions at the top of the first message and the screenshots passed as files. `write_task` reaches Codex through `crt mcp`, a tiny stdio MCP server in the same package that the session's Codex process spawns and that hands the call to the running `crt serve`; the file is written by the server exactly as it is for Claude, with `provider: codex` and Codex's thread id in `session:`. The footer's `codex resume <thread id>` continues the same conversation in a terminal.

**Every later message is a new `codex exec resume` process.** Codex re-reads the whole thread on each resume, so a second or third turn costs about as much as the first and takes a few seconds before the first token; the panel shows the running state while it waits. This is Codex's behaviour, not something CRT can shorten (PRD-providers N-13).

**Telemetry.** Codex has its own analytics; CRT passes `-c analytics.enabled=false` on every invocation it starts, so nothing beyond the model calls Codex itself makes leaves the machine (PRD-providers N-12). CRT has no telemetry of its own.

**Skills for Codex.** `crt skills install --provider codex` writes the six CRT skills (`next`, `tasks`, `task`, `done`, `intake`, `serve`) as Agent Skills into `.agents/skills/` in the project (`--global` puts them in `~/.codex/skills`, or `$CODEX_HOME/skills`; `--dir <path>` anywhere else). The text is the plugin's with the Claude-only tokens rewritten; the no-questions guarantee of `/crt:next` is tested on Claude Code only. Running it again changes nothing. `--provider claude` is refused — Claude Code gets the skills from the plugin.

**Codex problems** show up as one line in the panel (or on the `CRT ready` line and in `crt providers`):

```
codex not found on PATH — npm i -g @openai/codex, or set providers.codex.command in .crt/config.json
```

Codex is not installed where CRT can see it — the desktop app and IDE extensions do not put `codex` on PATH. Install the CLI, or point `providers.codex.command` at the executable.

```
not logged in to Codex — run `codex login` in a terminal, then send again
```

`codex login status` said so, **or** a turn failed with Codex's "log out and sign in again" (a stale login that `login status` still reports as logged in). Run `codex login`, then send again; no need to restart `crt serve`.

```
codex <version> is too old — CRT needs 0.154.0 or newer (npm i -g @openai/codex@latest)
```

The `codex exec --json` event names and flags CRT relies on were recorded on 0.154.0; older releases differ. Update the CLI.

```
Codex could not resume thread <id> — start a new session
```

`codex exec resume <id>` came back with a different thread id, which means Codex silently started a new conversation instead of continuing yours (it does that for an unknown non-UUID id, or when its session store lost the thread). Press **New session**; the task file, if one was written, is already on disk.

```
Codex finished the turn without replying or calling write_task — check that Codex lists the crt MCP server (node <cli.js> mcp) and that nothing on stderr says it failed to start
```

The turn completed with no text and no tool call, which almost always means Codex could not start `crt mcp` (a missing `node`, a broken install) and so never saw the `write_task` tool. Run `crt serve` from a terminal and look at what Codex prints, or run `codex mcp list` inside the project.

## Task format

Tasks live at `.crt/tasks/CRT-NNNN-<slug>.md` (the ID is allocated by scanning the folder for the highest one, so there is no counter file to conflict on), with a generated `.crt/tasks/README.md` index that the server and `crt tasks` rewrite whenever a task changes. Commit `.crt/`; only `.crt/captures/` is ignored.

```markdown
---
id: CRT-0007
title: Cart total excludes applied discount
status: backlog            # backlog | in_progress | review | done | blocked
priority: normal           # low | normal | high
created: 2026-09-14T10:32:00+08:00
updated: 2026-09-14T10:32:00+08:00
url: http://localhost:4400/cart?promo=SAVE10
route: /cart
session: 7a3d…             # intake session id — `claude --resume 7a3d…` continues it
tags: [cart, pricing]
files: [src/components/Cart.tsx, src/lib/pricing.ts]
---

## Summary
One paragraph: what is wrong / wanted, in plain language.

## Context
What the page showed, how to reproduce (URL, state, steps), what component renders it, where the logic lives.

## Evidence
![viewport (annotated)](assets/CRT-0007/viewport-annotated.png)
![annotation 1](assets/CRT-0007/ann-1.png)
Annotation 1 — `<span class="cart-total">` in `CartSummary` (src/components/Cart.tsx:88), selector `#total`: "this total doesn't include the discount"

## Ask
The change requested, precisely.

## Definition of Done
- [ ] Checkable item 1
- [ ] Checkable item 2
- [ ] Existing tests pass; new test covers the fix

## Notes
Constraints, hunches, non-goals, alternatives considered during intake.

## Log
- 2026-09-14T10:32+08:00 — created by intake session 7a3d… from capture 20260914-103200-ab12.
```

The seven sections are fixed and in this order. The **Log** is append-only: every status change, work session and verification result is a new bullet with a timestamp and the session that wrote it. A task is workable cold when a session that has never seen the page can start from the file alone — that is the bar intake holds itself to. `crt task CRT-0007 --validate` checks a file against the format; `crt tasks --json` is what the skills read.

## Script-tag fallback

The proxy needs nothing from your app, but some apps misbehave behind one (hard-coded absolute origins, cookies scoped to the port, strict CSP). Then load the overlay from your own origin instead:

```html
<script src="http://localhost:4400/__crt/overlay.js" defer></script>
```

Run `crt serve --target http://localhost:3000` as usual, but keep browsing `http://localhost:3000`: the overlay reads the CRT origin from its own script tag and talks to the API cross-origin. The server allows this only for `localhost`, `*.localhost`, `127.0.0.1` and `[::1]` origins (any port, http or https); every other origin gets no CORS headers and its preflight is refused. In this mode the early error hook is not injected, so console errors and failed requests fired before the overlay script loads are missed — put the tag as early in `<head>` as you can.

## How it works

```
Browser tab  http://localhost:4400 ──── your app, proxied from :3000 (WebSocket/HMR passthrough)
   └─ CRT overlay (Shadow DOM, injected <script>) ── /__crt/* ──┐
                                                                ▼
crt server (Node, 127.0.0.1 only)                    ┌──────────────────────┐
   reverse proxy + HTML injection                    │ Claude Code session  │
   capture store  .crt/captures/ → .crt/tasks/assets/│ via the Agent SDK    │
   task store     .crt/tasks/*.md + README index     │ cwd = your project   │
   session manager ──────────────────────────────────▶ write_task tool     │
                                                     └──────────────────────┘
```

- **Proxy.** `crt serve` finds your dev server, binds `127.0.0.1:4400`, forwards everything, and rewrites `text/html` responses (decompressing gzip/brotli first) to inject a tiny blocking error hook and the deferred overlay script before `</head>`. Absolute redirects to the target are rewritten to the CRT origin and a CSP that would block the script is relaxed for `'self'`. WebSocket upgrades are piped through untouched, so Next.js and Vite HMR keep working. Every CRT route lives under `/__crt/`; nothing else is added to your app.
- **Overlay.** One framework-free bundle (~85 KB, 28 KB gzipped) rendered inside a Shadow DOM host so your CSS and its CSS never meet. It is idle until you open it. `window.__crt` is its only global — a debugging/test surface.
- **Intake session.** Send starts a real Claude Code session through `@anthropic-ai/claude-agent-sdk` with `cwd` = your project root (the nearest ancestor with `.git`, else the launch directory), `settingSources` user + project + local, and the Claude Code system prompt with the intake instructions appended (the same text as `/crt:intake`). The first message is the capture summary, your notes, the path to `capture.json` and the screenshots as images. The process boots while the page is still being rasterised so the panel is live within a few seconds. Text streams over SSE; a `write_task` tool exposed by the server allocates the ID, renders the file, moves the assets and regenerates the index, so the file can never drift from the format.
- **Permissions.** The session runs in Claude Code's `default` mode. Reads, searches, read-only `git` commands, CRT's own tool and writes under `.crt/` are allowed silently; `WebFetch`/`WebSearch` are denied; everything else prompts in the panel and is denied after five minutes without an answer. Intake does not modify source code; that is `/crt:next`'s job, in a normal session you can watch.
- **Privacy.** The server never writes outside `.crt/` and the OS temp dir, and nothing leaves the machine except the model calls Claude Code already makes. No telemetry.

## Troubleshooting

Each `crt serve` failure is one line on stderr, prefixed `crt: `, followed by a non-zero exit. `<…>` below marks values filled in at runtime.

### No dev server found

```
crt: no dev server found on ports 3000, 5173, 8080, 4200, 8000, 3001 — start it, or pass --target <url>
```

You ran `crt serve` without `--target` and without `target` in `.crt/config.json`, and nothing answered HTTP on any of the probed ports. Start your dev server first, or point CRT at it explicitly with `--target <url>` (or set `target` in `.crt/config.json`).

### Target unreachable

```
crt: target <origin> is not responding — start your dev server there or pass --target <url>
```

CRT had an explicit target — from `--target` or from `.crt/config.json` — but the connection was refused or timed out after 1.5s. Check the dev server really is up on that host and port (any HTTP status counts as up, so a 404 is fine) and that the port is not a typo.

### Target not a valid URL

```
crt: target "<value>" is not a valid URL — use e.g. --target http://localhost:3000
crt: target "<value>" must be http:// or https://
```

The `--target` value (or `target` in `.crt/config.json`) could not be parsed as a URL; the second line means it parsed but used some other scheme. Pass a bare port (`3000`), a host and port (`localhost:3000`) or a full `http://`/`https://` URL.

### Port in use

```
crt: port <port> is already in use — stop the other process or pass --port <n>
```

Something else — usually a `crt serve` you left running — already holds CRT's listen port on `127.0.0.1`. Stop that process, or run CRT on another port with `--port <n>` (or set `port` in `.crt/config.json`); any other bind failure prints `crt: cannot listen on 127.0.0.1:<port> (<code>)` instead.

### No Claude login (shown in the page, not on the CLI)

```
not logged in to Claude Code — run `claude` in a terminal and complete /login (or set CLAUDE_CODE_OAUTH_TOKEN), then send again
```

The proxy started fine, but the Claude Code session behind **Send to Claude** has no usable credentials, so the error arrives in the in-page chat. Run `claude` in a terminal and complete `/login` (or set `CLAUDE_CODE_OAUTH_TOKEN`), then send your note again — no need to restart `crt serve`.

### No `.git` in the project

Not an error. CRT uses the nearest ancestor of the launch directory that contains `.git` as the project root and falls back to the launch directory itself, so `.crt/` is created wherever you ran `crt serve`. If the `project:` path in the ready line (or in `/__crt/health`) is not where you want `.crt/tasks/` to live, run `crt serve` from your project root — or `git init` it.

### Overlay does not appear

Not a `crt: …` line: the proxy is up but the page has no CRT button. Check `view-source:` for `<script src="/__crt/overlay.js" defer>` — it is only injected into responses whose `Content-Type` is `text/html`. If your app renders the shell from JavaScript, redirects to its own absolute origin, or sends a `Content-Security-Policy` the relaxer cannot fix, use the [script-tag fallback](#script-tag-fallback). If the button is there but **Send** fails with `CRT server answered 0` or a CORS error in the console, the page is on a non-local origin, which script-tag mode does not allow.

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

Release: bump `version` in `packages/server/package.json` (and the plugin manifests), merge, then `git tag v<version> && git push origin v<version>`. The `release` workflow checks the tag matches the package version, runs `npm run check`, **stages** `claude-review-tool` on npm through trusted publishing (OIDC from this repository's `release.yml`; no token, provenance attested) and creates a GitHub Release with generated notes. The version goes live only when the maintainer promotes the staged version on npmjs.com (package → Versions) with 2FA — CI can stage a release but never ship one.

License: MIT.
