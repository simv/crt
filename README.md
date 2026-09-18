# Claude Review Tool (CRT)

Annotate your local site in the browser, talk to Claude in the page, and get a self-contained task file in your repo that any Claude Code session can pick up later with `/crt:next`. CRT started as Claude-only; since v0.2 it also works with Codex, and Claude Code remains the default. The name is historical.

> v0.3.0. [docs/PRD.md](docs/PRD.md) defines the scope, requirement IDs (F-n, N-n) and the definition of done; [docs/PRD-providers.md](docs/PRD-providers.md) (v0.2, providers) and [docs/PRD-setup.md](docs/PRD-setup.md) (v0.3, setup and first run) amend it. This README is the user manual.

## Install

```bash
# one-time, per machine
npm i -g claude-review-tool
crt setup                         # registers the bundled plugin with Claude Code: /crt:serve, /crt:next, …

# per project
cd my-app && npm run dev          # your normal dev server
crt                               # finds it (or asks for its URL once) → http://localhost:4400 opens; browse, annotate, send
```

`crt setup` gives every Claude Code session `/crt:serve`, `/crt:next`, `/crt:tasks`, `/crt:task`, `/crt:done` and `/crt:intake`, plus a SessionStart hook that says `CRT: N of M tasks in backlog …` whenever the project has backlog tasks (and stays silent otherwise). The plugin ships inside the npm package — `crt setup` runs `claude plugin marketplace add <the package's dist/plugin-marketplace>` and `claude plugin install crt@crt` for you, so nothing is fetched from GitHub and the plugin version always equals the `crt` version. Restart Claude Code after installing. After `npm update -g claude-review-tool`, run `crt setup` again (it says `already installed` when there is nothing to do). Node ≥ 20 on Windows, macOS or Linux; Claude Code installed and logged in (`claude` → `/login`). No API key: CRT reuses the machine's Claude Code login.

Other ways to install:

- **Teams that want the version in the lockfile:** `npm i -D claude-review-tool` in the project, then `npx crt` (or `crt` from an npm script). The skills always prefer a project install (`npx --no crt`) over anything global.
- **Zero-install:** `npx claude-review-tool` in the project folder does what `crt` does, and `npx claude-review-tool tasks` / `task <ID>` list what `/crt:tasks` / `/crt:task` show. The first run downloads the package and the Claude Code binary it bundles (~220 MB); npm caches it after that. The skills fall back to `npx -y claude-review-tool@0.3` the same way when no local install exists — the one lookup outside CRT's control.
- **From GitHub, without the npm package:** `claude plugin marketplace add simv/crt && claude plugin install crt@crt`. The repository is public, so this works for anyone; the plugin then tracks `main` (`claude plugin update crt@crt` picks up new skills) and the skills run `crt` through `npx` as above.

**Windows:** `npm i -g` puts `crt.cmd`, `crt.ps1` and a `crt` shell script on PATH. PowerShell prefers `crt.ps1`, which its execution policy may refuse (`running scripts is disabled on this system`) — run `crt.cmd` instead, or `npx.cmd claude-review-tool`, both of which work regardless of the policy; CMD and Git Bash are unaffected. The skills use `npx --no crt`, which resolves the bin without the shell shim.

**Older task files:** v0.2 added `provider:` to the task frontmatter and made the validator ignore unknown keys. A project pinned to `claude-review-tool@0.1.x` fails `crt task --validate` on files written by 0.2 or later — update to `0.2.0` or newer.

## Add CRT to your app

Embedded mode (the default since v0.4) needs one dev-only line in the app, so the CRT button appears on the app's own URL. Install the package in the project (`npm i -D claude-review-tool`; `react` and `vite` are optional peer dependencies) and pick the form for your setup — `crt init` will print it for you from v0.4's next milestone:

```tsx
// Next.js (App Router) — app/layout.tsx
import { CrtDevTools } from "claude-review-tool/react";
…
<body>{children}<CrtDevTools /></body>
```

```ts
// Vite — vite.config.ts
import { crt } from "claude-review-tool/vite";
export default defineConfig({ plugins: [react(), crt()] });
```

```ts
// any bundled app — the client entry (src/main.tsx, src/index.ts, …)
import { mountCrt } from "claude-review-tool/loader";
if (process.env.NODE_ENV !== "production") mountCrt();   // the guard is optional (F-98); it lets the bundler drop the import
```

`<CrtDevTools />` renders nothing and mounts the loader from its first effect, so the console/network hooks start capturing once the tree has hydrated; `crt()` prepends the loader module to `<head>` under `vite` only, before the app's own module runs; `mountCrt()` is the loader itself and captures from wherever you call it — as early in the client entry as you can. Each takes `{ port }` (or `{ origin }`) when `port` in `.crt/config.json` is not 4400; the Vite plugin reads the config files itself. For a page without a bundler, see [Script-tag fallback](#script-tag-fallback).

## Production

Nothing from CRT ships in a production build of an app that uses any of the entries, in four layers, each sufficient on its own: (1) the package's `production` export condition maps `claude-review-tool/loader` and `claude-review-tool/react` to no-op modules with the same exports — Vite, webpack 5 / Next, Rspack, Turbopack and esbuild (`--conditions=production`) honour it; (2) every entry's body sits behind `process.env.NODE_ENV !== "production"`, which those bundlers define statically, so the loader code is dropped even where the condition is not; (3) `mountCrt` does nothing unless the page is on `localhost`, `*.localhost`, `127.0.0.1` or `[::1]`; (4) the Vite plugin is `apply: "serve"`, and the script tag lives in the development page only. Verify any build with `grep -r "__crt" dist/` (or `.next/static`) after a production build — it finds nothing — and by checking that the production page never requests the CRT port. The package's own test builds a fixture app with esbuild 0.25 and Vite 8 and asserts the outputs contain none of `__crt`, `/loader.js`, `overlay.js`, `mountCrt`, `4400`.

## The loop

```bash
cd my-app && npm run dev     # your dev server, e.g. http://localhost:3000
crt                          # proxies your app at http://localhost:4400 and opens it
```

Inside Claude Code, `/crt:serve` does what `crt` does — it reuses a CRT that is already serving the project, asks in the chat which URL or port your dev server is on when it cannot find one, and replies with four lines saying where CRT is, where tasks go, which agent answers and what to click next.

1. **Browse as usual** on `localhost:4400`. Hot reload keeps working. A **CRT** button sits in the bottom-right corner (drag it anywhere; `Ctrl/Cmd+Shift+.` toggles it). Its dot says how things stand — hover it: green is connected (which project, which agent, whether it is logged in), amber means the agent is not ready (the fix is in the tooltip), red means the CRT server stopped answering. On a project’s first visit a small card above the button says what is proxied, where tasks go and which agent will answer; **Got it** dismisses it for that project, **Show me** opens the toolbar with Select armed.
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

### `crt` flags

```
crt [target] [--port <n>] [--open | --no-open] [--yes] [--replace] [--provider <id>]
crt serve [target] [--target <url>] [--mode <embedded|proxy>] …   # the same command under its explicit name
crt proxy [target] …                           # proxy your app through http://localhost:4400 instead (= crt serve --mode proxy)
crt doctor                                     # checklist: node, project, .crt, mode, target, integration, instructions, port, providers, plugin
crt init [--yes] [--no-instructions] [--snippet [--json]]   # set the project up, each write announced; then the snippet for your framework
crt setup [--claude <path>]                    # register the bundled Claude Code plugin (idempotent)
crt --version                                  # crt <version> (agent sdk <version>)
```

| Flag | Default | Meaning |
|---|---|---|
| `[target]` | auto | Your app's URL, as a positional: `3000`, `localhost:3000` or a full URL — what CRT opens for you in embedded mode, what it proxies in proxy mode. Remembered in `.crt/config.local.json` once it responds; `crt <port>` switches it. |
| `--target <url>` | auto | The same, as a flag (what scripts and the skills pass); never remembered. Without either, CRT reads `target` from `.crt/config.local.json`, then `.crt/config.json`, then probes ports 3000, 5173, 8080, 4200, 8000, 3001. In proxy mode a terminal asks when there are several or none and waits for the one you name; embedded mode never waits — it says what it found (or did not) and is ready either way. |
| `crt proxy [target]` | | Proxy mode: the v0.3 experience for an app that cannot be touched — browse `http://localhost:4400`, CRT injects the overlay into every HTML page (WebSocket/HMR passthrough, CSP relaxing). The same flags as `crt`. |
| `--mode <embedded\|proxy>` | `embedded` (or `mode` in `.crt/config.local.json` / `.crt/config.json`) | Which mode `crt serve` runs in; `crt proxy` is `--mode proxy`. Put `"mode": "proxy"` in `.crt/config.json` to make proxy mode a project's default. |
| `--port <n>` | `4400` (or `port` in `.crt/config.local.json` / `.crt/config.json`) | Port CRT listens on. Always bound to `127.0.0.1`. Never stepped around; without it a held port falls back to 4401…4409. |
| `--open` / `--no-open` | on for a terminal, off otherwise | Open the CRT URL in your default browser once ready. |
| `--yes` | off | Never prompt: every question takes its default or fails with one `crt:` line (also the behaviour off a terminal or with `CI` set). |
| `--replace` | off | Stop a CRT already holding the port (through its `POST /__crt/internal/shutdown`, which any local process may call — page scripts cannot, and it is no more than a signal could do) and take it over. |
| `--provider <id>` | auto | The agent behind the chat: `claude` (default) or `codex`. See [Providers](#providers). |
| `crt doctor` | | Read-only checklist, one row per check; exit 1 on any `FAIL`. First step in [Troubleshooting](#troubleshooting). |
| `crt init [--yes] [--no-instructions] [--snippet [--json]]` | | Sets the project up explicitly: prints its plan (`.crt/README.md`, `.crt/tasks/`, `.crt/config.json`, the two `.gitignore` lines, a CRT section in `CLAUDE.md` / `AGENTS.md` — only what is not in place), asks `Go ahead? [Y/n]` on a terminal (`--yes` skips the question; off a terminal it applies without asking), announces every write, and ends with the one-line snippet for your framework. `--no-instructions` leaves `CLAUDE.md` / `AGENTS.md` alone; `--snippet` prints only the snippet and writes nothing (`--json` for tooling). Idempotent: a second run says `crt init: <root> is set up (…)`. |
| `crt setup [--claude <path>]` | `claude` on PATH | Registers the plugin bundled in the package with Claude Code and installs (or updates) `crt@crt`; says `already installed` when it is. `--claude` names the Claude Code executable when it is not on PATH. |
| `crt --version` | | `crt 0.3.0 (agent sdk 0.3.270)`, read from local files — CRT never checks a registry. |

On success it prints one line — `CRT ready at http://localhost:4400 for http://localhost:3000 (embedded; project: C:\my-app, 3 tasks in .crt\tasks, provider: claude (default), login: ok)` (`for <app>` is omitted when no dev server was found; `CRT ready at http://localhost:4400 → http://localhost:3000 (proxy; project: …)` under `crt proxy`) — and, on a terminal, `Open http://localhost:3000 → CRT button bottom-right (Ctrl/Cmd+Shift+.) → Select · note · Send. Ctrl+C stops CRT; your dev server keeps running.` (`Open http://localhost:4400 → …` in proxy mode), then keeps running until Ctrl+C (`Stopping CRT … 1 session ended; written task files are kept.`). In embedded mode the CRT button appears on your app's own URL once the page loads the CRT loader — `<script src="http://localhost:4400/__crt/loader.js"></script>` first in `<head>` of your development page, or one of the entries in [Add CRT to your app](#add-crt-to-your-app) (`crt init` prints the snippet for your framework; `/crt:init` in Claude Code applies it); `http://localhost:4400` itself shows a landing page that says so, and when CRT opened your app but the page never asked for the loader it says `crt: opened http://localhost:3000 but the page never loaded the CRT loader — add the integration (\`crt init\` prints the snippet, /crt:init applies it), or run \`crt proxy\``. When a CRT from an earlier session already serves the same project in the same mode on the port, `crt` says `CRT <version> is already serving this project (embedded) at http://localhost:4400 (since 09:12) — opened http://localhost:3000.` (`CRT <version> is already serving … for this project at … — opened it.` in proxy mode) and exits 0; when it serves something else, or the port is held by something that is not CRT, `crt` takes the next free port and says so (`crt: port 4400 is held by another CRT (→ <target>, project <root>); using 4401` / `crt: port 4400 is in use by a process that is not CRT; using 4401`). `crt` never sets a project up on its own: when `.crt/tasks/` is missing it prints the `crt init` plan and asks `Set up CRT in <root>? [Y/n]` on a terminal, sets it up under `--yes`, and otherwise refuses with `crt: <root> is not set up for CRT — run \`crt init\` (or \`crt --yes\`)` — see [CRT is not set up](#crt-is-not-set-up). Every failure is a single `crt: …` line on stderr and a non-zero exit — run `crt doctor` first, then see [Troubleshooting](#troubleshooting) for what each one means.

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

The agent behind the in-page chat is a *provider*. Claude Code is the default and needs nothing; `crt --provider codex` (or `provider: "codex"` in `.crt/config.json`, or the caret next to **Send**) runs the intake on the developer's own Codex CLI instead. The provider for a session is the first of these that is set:

1. `provider` in the `POST /__crt/sessions` body — the caret next to **Send**, for that one send;
2. the running server's active provider — `--provider` or `CRT_PROVIDER` at start, replaced by **Remember** in the Agent menu for the life of the process;
3. `provider` in `.crt/config.local.json` (per machine, gitignored — what **Remember** writes);
4. `provider` in `.crt/config.json` (per project, committed);
5. auto-detection: what is installed and logged in here, disambiguated by the project's markers (`.claude/`, `CLAUDE.md`, `.codex/`, `AGENTS.md`);
6. `claude`.

A provider chosen explicitly (1–4) that is not usable is never swapped for another: the session fails with the provider's one-line problem. Only auto-detection falls back — a logged-out Claude is stepped over when Codex is usable, and the ready line says why (`provider: codex — claude not logged in`). `crt providers` prints every provider's state and which one a new session would use, with the reason:

```
claude   ready        Claude Code (Agent SDK) 0.3.270  logged in                                markers: .claude/, CLAUDE.md
codex    not on PATH  Codex CLI                        install: npm i -g @openai/codex          markers: none
→ claude — .claude/, CLAUDE.md; codex not on PATH
```

The full rules are in [docs/PRD-providers.md](docs/PRD-providers.md) F-43/F-44; this section covers what you need per provider. CRT itself has no telemetry; nothing leaves the machine except the model calls the chosen agent already makes, and that agent's own telemetry where it has any (below, per provider).

### Claude Code

Nothing to install beyond Claude Code itself: CRT runs sessions through the Agent SDK, which bundles its own Claude Code binary, and reuses the machine's login (`claude` → `/login`, or `CLAUDE_CODE_OAUTH_TOKEN`). Login is checked at start with the bundled binary's `auth status`; only its yes/no is read. Telemetry is Claude Code's own setting.

```
not logged in to Claude Code — run `claude` in a terminal and complete /login (or set CLAUDE_CODE_OAUTH_TOKEN), then send again
```

Log in, then send again — no restart needed; the page re-checks. When `claude` is not on your PATH the line ends with `(install Claude Code first: npm i -g @anthropic-ai/claude-code)`.

```
Claude Code binary not found — reinstall claude-review-tool (`npm install`) so @anthropic-ai/claude-agent-sdk-<platform>-<arch> is present
```

The SDK's platform package for this OS did not install (an `--omit=optional` install, or a package manager that skipped it). Reinstall `claude-review-tool`.

### Codex

Tested with `codex-cli 0.154.0` (`npm i -g @openai/codex`, then `codex login` — a ChatGPT account). CRT never bundles Codex: it runs the `codex` on your PATH (Windows: the npm `codex.cmd` shim is parsed and its JS entry run with CRT's own Node, so no shell is involved), or the executable you name in `.crt/config.json`:

```json
{ "providers": { "codex": { "command": ["C:\\tools\\codex\\codex.exe"] } } }
```

What a Codex session looks like: **Send to Codex** starts `codex exec --json` in your project root under Codex's **read-only sandbox** — no Allow/Deny cards; the footer shows a `read-only sandbox` badge — with the intake instructions at the top of the first message and the screenshots passed as files. `write_task` reaches Codex through `crt mcp`, a tiny stdio MCP server in the same package that the session's Codex process spawns and that hands the call to the running `crt serve`; the file is written by the server exactly as it is for Claude, with `provider: codex` and Codex's thread id in `session:`. The footer's `codex resume <thread id>` continues the same conversation in a terminal.

**Every later message is a new `codex exec resume` process.** Codex re-reads the whole thread on each resume, so a second or third turn costs about as much as the first and takes a few seconds before the first token; the panel shows the running state while it waits. This is Codex's behaviour, not something CRT can shorten (PRD-providers N-13).

**Telemetry.** Codex has its own analytics; CRT passes `-c analytics.enabled=false` on every invocation it starts, so nothing beyond the model calls Codex itself makes leaves the machine (PRD-providers N-12). CRT has no telemetry of its own.

**Skills for Codex.** `crt skills install --provider codex` writes the seven CRT skills (`next`, `tasks`, `task`, `done`, `intake`, `serve`, `init`) as Agent Skills into `.agents/skills/` in the project (`--global` puts them in `~/.codex/skills`, or `$CODEX_HOME/skills`; `--dir <path>` anywhere else). The text is the plugin's with the Claude-only tokens rewritten; the no-questions guarantee of `/crt:next` is tested on Claude Code only. Running it again changes nothing. `--provider claude` is refused — Claude Code gets the skills from the plugin.

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

```
write_task was called with a stale token — the session had ended
```

The agent called `write_task` after the session it belonged to was discarded or the server restarted (every session gets its own token for the life of that session). Start a new session and send again.

## Task format

Tasks live at `.crt/tasks/CRT-NNNN-<slug>.md` (the ID is allocated by scanning the folder for the highest one, so there is no counter file to conflict on), with a generated `.crt/tasks/README.md` index that the server and `crt tasks` rewrite whenever a task changes. Commit `.crt/`; only `.crt/captures/` and `.crt/config.local.json` are ignored.

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
provider: claude           # which agent ran the intake (absent in v0.1 files)
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
- 2026-09-14T10:32+08:00 — created by intake session 7a3d… (claude) from capture 20260914-103200-ab12.
```

The seven sections are fixed and in this order. The **Log** is append-only: every status change, work session and verification result is a new bullet with a timestamp and the session that wrote it. A task is workable cold when a session that has never seen the page can start from the file alone — that is the bar intake holds itself to. `crt task CRT-0007 --validate` checks a file against the format; `crt tasks --json` is what the skills read.

## Script-tag fallback

Since v0.4 this is the default, productised as **embedded mode** (`crt`): your app loads a small loader from the CRT server and the CRT button appears on your app's own URL — no proxied copy. The loader installs the console/network hooks at once, appends the overlay script from the running server, and shows a pill (`CRT server not running on :4400 — run \`crt\` in the project, then click here`) that retries on click or when the tab regains focus, so starting `crt` after the page is open needs no reload. For a page without a bundler, put the tag first in `<head>` of your development page:

```html
<script src="http://localhost:4400/__crt/loader.js"></script>
```

(`data-crt-port="4401"` on that tag when `port` in `.crt/config.json` is not 4400. With this form the script itself is missing when the server is down, so there is no pill — the pill needs the bundled ES module form, which the entries in [Add CRT to your app](#add-crt-to-your-app) bring.) The plain overlay tag still works too:

```html
<script src="http://localhost:4400/__crt/overlay.js" defer></script>
```

Either way, keep browsing `http://localhost:3000`: the overlay reads the CRT origin from its own script tag and talks to the API cross-origin. The server allows this only for `localhost`, `*.localhost`, `127.0.0.1` and `[::1]` origins (any port, http or https); every other origin gets no CORS headers and its preflight is refused. The loader is as strict in the other direction: it loads the overlay only from a CRT origin on one of those hosts — a non-loopback `origin` option or script source is ignored and `http://localhost:4400` is used instead — so nothing from CRT ever reaches, or comes from, another machine. Console errors and failed requests fired before the loader runs are missed — put the tag as early in `<head>` as you can. `crt proxy` is the v0.3 experience for an app that cannot be touched: browse `http://localhost:4400` and CRT injects the overlay (and the early hook) into every HTML page.

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

Run `crt doctor` first. It is a read-only checklist — one row per check, `ok` / `warn` / `FAIL` / `--` as words, exit 1 on any `FAIL`, nothing but localhost probes — and its rows name the fix:

```
$ crt doctor
ok    node      v22.4.0 (needs 20 or newer)
ok    project   C:\my-app (.git)
ok    .crt      README.md, tasks/ (4 tasks), config.json, config.local.json, .gitignore entries
ok    mode      embedded
ok    target    http://localhost:3100 (remembered) — responding
ok    integration next — app/layout.tsx imports claude-review-tool/react
ok    instructions CLAUDE.md carries the CRT section
ok    port      4400 free
ok    claude    Claude Code (Agent SDK 0.3.270) — logged in
warn  codex     codex-cli 0.154.0 — not logged in — run `codex login`
ok    plugin    crt@crt 0.3.0 installed (claude on PATH)
→ claude — codex not logged in
```

`FAIL` is reserved for what stops `crt` from serving: `FAIL  node      v18.20.0 — CRT needs Node 20 or newer`; in proxy mode `FAIL  target    none set and nothing on the probed ports — crt <port>` and `FAIL  target    http://localhost:3100 (remembered) — not responding` (in embedded mode the target is only what `crt` opens for you, so those rows are `--    target    none set; crt opens nothing (crt <port> to remember one)` and `warn  target    http://localhost:3100 (remembered) — not responding`); `FAIL  port      4400 held by CRT 0.3.0 → http://localhost:3000 (this project) — crt --replace`; `FAIL  port      4400 in use by a non-CRT process — crt --port 4401`; and the provider a session would use when it is unusable (its row carries the same line the panel shows). Everything else is a `warn` — `warn  project   C:\my-app\src — no .git above; .crt/ will be created here (run from the repo root, or git init)`, another provider's problem, `warn  plugin    crt@crt not installed — run crt setup`, `warn  plugin    crt@crt 0.2.0 installed, this is 0.3.0 — run crt setup` — or `--` for what was skipped (`--    .crt      not initialised — run crt init`, `--    plugin    claude not on PATH — skipped`), so a Claude-only machine passes. The v0.4 rows never fail: `.crt` says `warn  .crt      tasks/ (4 tasks), config.json, .gitignore entries — no README.md — run crt init` for a folder that predates `crt init`'s README; `mode` reads `ok    mode      embedded` or `ok    mode      proxy (.crt/config.json)`; `integration` reads only the snippet's candidate files for the detected framework — `ok    integration next — app/layout.tsx imports claude-review-tool/react`, `ok    integration vite — vite.config.ts uses claude-review-tool/vite`, `ok    integration loader — src/main.tsx imports claude-review-tool/loader`, `warn  integration not found (next) — run crt init for the snippet, or crt proxy`, `--    integration static page — add the <script> tag (crt init --snippet)`, `--    integration proxy mode`; `instructions` reads `ok    instructions CLAUDE.md carries the CRT section` (both names when both do), `warn  instructions CLAUDE.md has no CRT section — crt init adds it` or `--    instructions no CLAUDE.md or AGENTS.md — crt init creates one`. `crt` runs the same checks before its first question and prints only the `FAIL` and `warn` rows.

Each `crt` failure is one line on stderr, prefixed `crt: `, followed by a non-zero exit. `<…>` below marks values filled in at runtime.

### Unknown command

```
crt: unknown command "<x>" — a target is a port, host:port or URL; `crt help` lists commands
```

The first argument was neither a command (`serve`, `doctor`, `setup`, `init`, `tasks`, `task`, `providers`, `skills`, `help`) nor something that looks like a dev server (`3000`, `localhost:3000`, `http://…`). Exit 2.

### CRT is not set up

```
crt: C:\my-app is not set up for CRT — run `crt init` (or `crt --yes`)
```

`crt` creates nothing on its own (v0.4): a project without `.crt/tasks/` is set up only by `crt init`, or by `crt` after you said yes. On a terminal `crt` prints the plan and asks `Set up CRT in C:\my-app? [Y/n]` (Enter sets it up and starts; `n` prints `crt: cancelled` and exits 130); off a terminal — a skill, CI — it refuses with the line above unless `--yes` was given, which sets the project up with every write printed and starts. `crt init` itself prints the plan first, only the items not already in place:

```
crt init will, in C:\my-app:
  create .crt/README.md
  create .crt/tasks/
  create .crt/config.json
  add .crt/captures/ and .crt/config.local.json to .gitignore
  add a CRT section to CLAUDE.md
```

then asks `Go ahead? [Y/n]` on a terminal (`--yes` skips it; off a terminal the command is explicit enough to apply without asking) and announces each write as it happens — `crt init: created .crt/README.md`, `crt init: created .crt/tasks/`, `crt init: created .crt/config.json`, `crt init: added .crt/captures/ and .crt/config.local.json to .gitignore`, `crt init: added the CRT section to CLAUDE.md` (or `crt init: created CLAUDE.md with the CRT section` when neither `CLAUDE.md` nor `AGENTS.md` existed, `crt init: updated the CRT section in CLAUDE.md` when the section's version stamp was older). When there is nothing to do it says `crt init: C:\my-app is set up (.crt/README.md, tasks/, config.json, .gitignore entries, CRT section in CLAUDE.md)`. It ends with the snippet for your framework (`Add CRT to your app (development only):`, the file, the lines, and `Production builds contain nothing from CRT (README › Production). /crt:init in Claude Code applies this for you.`); `crt init --snippet` prints only that and writes nothing. `crt tasks` on a project that is not set up prints `no tasks (CRT is not set up here — run crt init)` and exits 0 (`--json` answers `{ "tasksDir": null, "tasks": [] }`). The CRT section sits between `<!-- BEGIN:crt v0.4 -->` and `<!-- END:crt -->` in `CLAUDE.md` and `AGENTS.md` (an `@AGENTS.md`-only `CLAUDE.md` is skipped in favour of `AGENTS.md`), is replaced in place when the stamp's major.minor changes and never touched at runtime; `--no-instructions` leaves both files alone. In Claude Code, the SessionStart hook says `CRT: .crt/ is set up but CLAUDE.md has no CRT section — run crt init to add it` when the section is missing.

### No dev server found

```
crt: no dev server found on ports 3000, 5173, 8080, 4200, 8000, 3001 — start it, or run `crt <port>`
crt: found N dev servers (…); using http://localhost:3000 — run `crt <port>` to pick another
```

You ran `crt` off a terminal (or with `--yes`) without a target, without `target` in either config file, and nothing answered HTTP on any of the probed ports. Start your dev server first, or name it: `crt 3100` (remembered per machine in `.crt/config.local.json`), `--target <url>`, or `target` in `.crt/config.json`. On a terminal `crt` asks for the URL or port instead (`Dev server URL or port:`) and waits for it to come up, re-probing every 2 s; with several dev servers up it lists them and asks `Which one? [1]`. The second line is the off-terminal form of that list: the first responder was taken.

### Target unreachable

```
crt: target <origin> is not responding — start your dev server there, or run `crt <port>`
```

CRT had an explicit target — positional, `--target`, or from a config file — but the connection was refused or timed out after 1.5s. Check the dev server really is up on that host and port (any HTTP status counts as up, so a 404 is fine) and that the port is not a typo. On a terminal `crt` waits for it instead (`<origin> is not responding yet — start it, then press Enter to retry (type another URL to change, Ctrl+C to quit)`), re-probing every 2 s, and offers another dev server it found (`Use 3000? [Y/n]`).

### Target not a valid URL

```
crt: target "<value>" is not a valid URL — use e.g. --target http://localhost:3000
crt: target "<value>" must be http:// or https://
```

The `--target` value (or `target` in `.crt/config.json`) could not be parsed as a URL; the second line means it parsed but used some other scheme. Pass a bare port (`3000`), a host and port (`localhost:3000`) or a full `http://`/`https://` URL.

### Port in use

```
crt: port 4400 is held by another CRT (→ <target>, project <root>); using 4401
crt: port 4400 is in use by a process that is not CRT; using 4401
crt: port <port> is already in use by CRT <version> (→ <target>, project <root>) — stop the other process, run `crt --replace`, or pass --port <n>
crt: port <port> is already in use by a process that is not CRT — stop the other process or pass --port <n>
crt: could not stop the CRT on port 4400 (<reason>) — stop it yourself, or run `crt --port 4401`
crt: ports <port>–<port+9> are all in use — run `crt --port <n>`
```

The first two are not errors: without `--port`, `crt` reuses a CRT that serves the same project and target (`CRT <version> is already serving … — opened it.`) and otherwise steps to the next free port, saying which it found on 4400. On a terminal it asks instead — `1) Start this one on 4401  2) Replace it  3) Quit` for another CRT, `Start on 4401 instead? [Y/n]` for anything else. The next two appear only with an explicit `--port`, which is never stepped around. `--replace` asks the other CRT to stop through its shutdown route; the fifth line means it did not. Any other bind failure prints `crt: cannot listen on 127.0.0.1:<port> (<code>)` instead. `crt doctor` shows who holds the port.

### No Claude login

```
crt: not logged in to Claude Code — run `claude` in a terminal and complete /login (or set CLAUDE_CODE_OAUTH_TOKEN), then send again
crt: not logged in to Claude Code — run `claude` in a terminal and complete /login (or set CLAUDE_CODE_OAUTH_TOKEN), then send again (install Claude Code first: npm i -g @anthropic-ai/claude-code)
```

CRT asks the bundled Claude Code binary `auth status --json` at start (reading only its `loggedIn` flag) and prints this right after the ready line, whose `login:` field says `missing`; the second form appears when `claude` is not on your PATH. `crt providers` and `crt doctor` show the same state. Run `claude` in a terminal and complete `/login` (or set `CLAUDE_CODE_OAUTH_TOKEN`), then send your note — no need to restart `crt`; the page re-checks. When Codex is installed and logged in, a logged-out Claude is stepped over: the ready line reads `provider: codex — claude not logged in`.

### Plugin not installed, or `crt setup` fails

```
crt: claude not found on PATH — install Claude Code (npm i -g @anthropic-ai/claude-code), or run: claude plugin marketplace add simv/crt && claude plugin install crt@crt
crt: `claude plugin install crt@crt` failed: <first line of what claude printed> — fix that, or run: claude plugin marketplace add simv/crt && claude plugin install crt@crt
```

`crt setup` needs the `claude` CLI (it runs `claude plugin list --json`, `claude plugin marketplace add <dir>` and `claude plugin install crt@crt` — or `update` when an older `crt@crt` is there — and writes nothing itself). Install Claude Code, or pass the executable with `crt setup --claude <path>`; the second line quotes Claude Code's own error and the same two commands work by hand from GitHub. On success it prints `crt setup: registered marketplace crt from <path>` and `crt setup: installed crt@crt 0.3.0 — restart Claude Code to load /crt:serve, /crt:next, /crt:tasks, /crt:task, /crt:done, /crt:intake, /crt:init`; `crt setup: crt@crt 0.3.0 is already installed` means there was nothing to do. When the plugin and the project's `claude-review-tool` disagree on major.minor, the SessionStart hook says `CRT: plugin 0.3.0 but the project's claude-review-tool is 0.2.0 — npm update claude-review-tool (or crt setup after updating)`.

### No `.git` in the project

Not an error. CRT uses the nearest ancestor of the launch directory that contains `.git` as the project root and falls back to the launch directory itself, so `.crt/` is created wherever you ran `crt`. If the `project:` path in the ready line (or in `/__crt/health`) is not where you want `.crt/tasks/` to live, run `crt` from your project root — or `git init` it. `crt doctor` warns about it.

### Overlay does not appear

```
crt: injected the overlay into GET / but the browser never fetched /__crt/overlay.js — a Content-Security-Policy or a JS-rendered shell is blocking it; see README › Overlay does not appear
```

The proxy is up, it put the overlay tag into the page, but ten seconds later the browser had still not asked for the script, so there is no CRT button (and no dot, no welcome card). The same finding shows in `/__crt/health` as `overlay.fetched: 0`, and `/crt:serve` repeats it in its reply. Two more lines name the cause when CRT can see it: `crt: GET / answered application/json, not text/html — CRT injects only into HTML; use the script-tag fallback (README)` and `crt: GET / sends a CSP with 'strict-dynamic' that CRT cannot relax — the overlay may be blocked; use the script-tag fallback` (also for a nonce, a `require-trusted-types-for` directive or a policy in a `<meta http-equiv>` tag). Check `view-source:` for `<script src="/__crt/overlay.js" defer>` — it is only injected into responses whose `Content-Type` is `text/html`. If your app renders the shell from JavaScript, redirects to its own absolute origin, or sends a `Content-Security-Policy` the relaxer cannot fix, use the [script-tag fallback](#script-tag-fallback). If the button is there but **Send** fails with `CRT server answered 0` or a CORS error in the console, the page is on a non-local origin, which script-tag mode does not allow.

## Repository

| Path | What |
|---|---|
| `packages/server` | npm package `claude-review-tool` — the `crt` CLI, proxy, capture store, session manager; its `dist/plugin-marketplace/` is the plugin as `crt setup` installs it |
| `packages/overlay` | in-page UI, bundled into the server |
| `plugin/` | the Claude Code plugin (skills + hooks); marketplace manifest at `.claude-plugin/marketplace.json` |
| `docs/PRD.md`, `docs/PRD-providers.md`, `docs/PRD-setup.md` | the product requirements documents (v1.0, v0.2 providers, v0.3 setup) |
| `.crt/tasks` | this repo's own work items, in CRT's task format |

## Develop

```bash
npm ci
npm run check   # typecheck, lint, unit tests, build
npm run e2e     # Playwright smoke: fixture app behind a real `crt serve` (needs `npx playwright install chromium` once)
```

Plugin changes: `claude plugin validate ./plugin` (and `.` for the marketplace, and `packages/server/dist/plugin-marketplace` after a build) must pass — CI runs all of them. To try a local skill edit before it is on `main`, run `claude --plugin-dir ./plugin` in the project you are testing against, or `crt setup` from a fresh profile (`CLAUDE_CONFIG_DIR=<empty dir>`) with `crt` npm-linked to this repo.

Release: bump `version` in `packages/server/package.json`, both plugin manifests and the pinned `claude-review-tool@<major.minor>` in the seven skills (a unit test fails when they disagree), merge, then `git tag v<version> && git push origin v<version>`. The `release` workflow checks the tag matches the package version, runs `npm run check`, **stages** `claude-review-tool` on npm through trusted publishing (OIDC from this repository's `release.yml`; no token, provenance attested) and creates a GitHub Release with generated notes. The version goes live only when the maintainer promotes the staged version on npmjs.com (package → Versions) with 2FA — CI can stage a release but never ship one.

License: MIT.
