# The `crt` command

Every `crt` command and flag, what `crt` prints on the way to `CRT ready` and after it, and what the intake session gets from the page. The loop itself is on the front page: [README › The loop](../README.md#the-loop).

## `crt` flags

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
| `--provider <id>` | auto | The agent behind the chat: `claude` (default) or `codex`. See [Providers](providers.md). |
| `crt doctor` | | Read-only checklist, one row per check; exit 1 on any `FAIL`. First step in [Troubleshooting](troubleshooting.md). |
| `crt init [--yes] [--no-instructions] [--snippet [--json]]` | | Sets the project up explicitly: prints its plan (`.crt/README.md`, `.crt/tasks/`, `.crt/config.json`, the two `.gitignore` lines, a CRT section in `CLAUDE.md` / `AGENTS.md` — only what is not in place), asks `Go ahead? [Y/n]` on a terminal (`--yes` skips the question; off a terminal it applies without asking), announces every write, and ends with the one-line snippet for your framework. `--no-instructions` leaves `CLAUDE.md` / `AGENTS.md` alone; `--snippet` prints only the snippet and writes nothing (`--json` for tooling). Idempotent: a second run says `crt init: <root> is set up (…)`. |
| `crt setup [--claude <path>]` | `claude` on PATH | Registers the plugin bundled in the package with Claude Code and installs (or updates) `crt@crt`; says `already installed` when it is. `--claude` names the Claude Code executable when it is not on PATH. |
| `crt --version` | | `crt 0.5.0 (agent sdk 0.3.270)`, read from local files — CRT never checks a registry. |

## What `crt` prints

### The ready line

On success it prints one line — `CRT ready at http://localhost:4400 for http://localhost:3000 (embedded; project: C:\my-app, 3 tasks in .crt\tasks, provider: claude (default), login: ok)` (`for <app>` is omitted when no dev server was found; `CRT ready at http://localhost:4400 → http://localhost:3000 (proxy; project: …)` under `crt proxy`) — and, on a terminal, `Open http://localhost:3000 → CRT button bottom-right (Ctrl/Cmd+Shift+.) → Select · note · Send. Ctrl+C stops CRT; your dev server keeps running.` (`Open your dev server in the browser → …` when none is known; `Open http://localhost:4400 → …` in proxy mode), then keeps running until Ctrl+C (`Stopping CRT … 1 session ended; written task files are kept.`).

### Finding your app

Before that, finding your app in embedded mode is one line and never a question or a wait: `Found http://localhost:3000.`; with several dev servers up a terminal lists them and asks `Which one should I open? [1]` (off a terminal: `crt: found N dev servers (…); opening http://localhost:3000 — run \`crt <port>\` to pick another`); with none, `No dev server on ports 3000, 5173, 8080, 4200, 8000, 3001 — start it and open it in your browser; the CRT button appears when the page loads the CRT loader (crt <port> to have CRT open it next time).` and CRT is ready anyway; a remembered or configured app that is down gets `crt: http://localhost:3100 (remembered) is not responding — start it; CRT is ready for it`.

### The loader

The CRT button appears on your app's own URL once the page loads the CRT loader ([Add CRT to your app](integration.md)); `http://localhost:4400` itself shows a landing page that says so, and when CRT opened your app but the page never asked for the loader it says `crt: opened http://localhost:3000 but the page never loaded the CRT loader — add the integration (\`crt init\` prints the snippet, /crt:init applies it), or run \`crt proxy\``; the first page that does load it gets `crt: overlay loaded in the browser (from http://localhost:3000)`.

### A CRT already on the port

When a CRT from an earlier session already serves the same project in the same mode on the port, `crt` says `CRT <version> is already serving this project (embedded) at http://localhost:4400 (since 09:12) — opened http://localhost:3000.` (`… — open your app in the browser.` when none is known; `CRT <version> is already serving … for this project at … — opened it.` in proxy mode) and exits 0; when it serves something else, or the port is held by something that is not CRT, `crt` takes the next free port and says so (`crt: port 4400 is held by another CRT (→ <target>, project <root>); using 4401` / `crt: port 4400 is in use by a process that is not CRT; using 4401`), and in embedded mode adds `crt: your app's CRT loader expects :4400 — run \`crt --replace\`, or set port in .crt/config.json and in the snippet`, because the snippet in your app still points at 4400.

### Setting the project up

`crt` never sets a project up on its own: when `.crt/tasks/` is missing it prints the `crt init` plan and asks `Set up CRT in <root>? [Y/n]` on a terminal, sets it up under `--yes`, and otherwise refuses with `crt: <root> is not set up for CRT — run \`crt init\` (or \`crt --yes\`)` — see [CRT is not set up](troubleshooting.md#crt-is-not-set-up).

### Failures

Every failure is a single `crt: …` line on stderr and a non-zero exit — run `crt doctor` first, then see [Troubleshooting](troubleshooting.md) for what each one means.

## What Claude gets

Everything is gathered at Send time from the live page, because the session cannot see the page afterwards (PRD §6.3):

- page URL, route, title, viewport, device pixel ratio, scroll position, user agent, timestamp;
- a viewport screenshot with the annotation markers drawn on, a clean one, and a crop per annotation (in-page rasterisation — best effort for canvas, WebGL and cross-origin images);
- per annotated element: a unique CSS selector, XPath, tag, id, classes, `data-*`, ARIA role/label, text, bounding box, a curated computed-style subset, and its outer HTML plus its parent's (4 KB each);
- the component chain and source file for React dev builds (`_debugSource` on React ≤ 18, owner stacks on React 19) and Vue; the detected framework, bundler and Next.js route pattern;
- `console.error`/`warn`, uncaught errors and unhandled rejections since page load (50 most recent), and failed network requests — `fetch`/XHR with status ≥ 400 or a thrown error, plus any image, script or stylesheet whose response was ≥ 400 (50 most recent);
- your notes.

It is written to `.crt/captures/<id>/capture.json` (+ PNGs) and moves to `.crt/tasks/assets/<ID>/` when the task is written. Captures older than 7 days that never became tasks are pruned on the next `crt serve`.

