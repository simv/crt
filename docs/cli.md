# The `crt` command

Every `crt` command and flag, what `crt` prints on the way to `CRT ready` and after it, and what the intake session gets from the page. The loop itself is on the front page: [README › The loop](../README.md#the-loop).

## `crt` flags

```
crt [target] [--port <n>] [--open | --no-open] [--yes] [--replace] [--provider <id>] [--review [name]]
crt serve [target] [--target <url>] [--mode <embedded|proxy>] …   # the same command under its explicit name
crt proxy [target] …                           # proxy your app through http://localhost:4400 instead (= crt serve --mode proxy)
crt browse [target] …                          # the same server, your app in a Chrome or Edge window CRT starts itself: nothing to add to the app
crt review [--json] [--open | --no-open]       # the current review: its items, kept or dropped, and the totals; on a terminal, its page
crt review list                                # every review of this project, with its status and counts
crt review new [name]                          # start a new review (named after today's date by default)
crt doctor                                     # checklist: node, project, .crt, mode, target, integration, instructions, port, providers, plugin
crt init [--yes] [--no-instructions] [--snippet [--json]]   # set the project up, each write announced; then the snippet for your framework
crt setup [--claude <path>]                    # register the bundled Claude Code plugin (idempotent)
crt --version                                  # crt <version> (agent sdk <version>)
```

| Flag | Default | Meaning |
|---|---|---|
| `[target]` | auto | Your app's URL, as a positional: `3000`, `localhost:3000` or a full URL — what CRT opens for you in embedded mode, what it proxies in proxy mode. Remembered in `.crt/config.local.json` once it responds (for a guest or under `--review`, in the file of the same name under the CRT home); `crt <port>` switches it. |
| `--target <url>` | auto | The same, as a flag (what scripts and the skills pass); never remembered. Without either, CRT reads `target` from `.crt/config.local.json`, then `.crt/config.json`, then probes ports 3000, 5173, 8080, 4200, 8000, 3001. In proxy mode a terminal asks when there are several or none and waits for the one you name; embedded mode never waits — it says what it found (or did not) and is ready either way. |
| `crt proxy [target]` | | Proxy mode: the v0.3 experience for an app that cannot be touched — browse `http://localhost:4400`, CRT injects the overlay into every HTML page (WebSocket/HMR passthrough, CSP relaxing). The same flags as `crt`. |
| `crt browse [target]` | | The CRT browser: the embedded server, plus a Chrome or Edge window that CRT starts itself with a profile of its own per project (under `~/.crt/browser/`) and puts the CRT loader into over the DevTools protocol — so the CRT button is on your app's own URL with no integration and no policy exception in the app. The same flags as `crt` except `--mode`; it opens the window off a terminal too, and `--no-open` never launches it. CRT looks for Chrome, then Edge, then Chromium; `"browser": { "command": ["<path>", "<arg>", …] }` in `.crt/config.local.json` (or `.crt/config.json`) names another one. See [The CRT browser](#the-crt-browser). |
| `--mode <embedded\|proxy>` | `embedded` (or `mode` in `.crt/config.local.json` / `.crt/config.json`) | Which mode `crt serve` runs in; `crt proxy` is `--mode proxy`. Put `"mode": "proxy"` in `.crt/config.json` to make proxy mode a project's default. |
| `--port <n>` | `4400` (or `port` in `.crt/config.local.json` / `.crt/config.json`) | Port CRT listens on. Always bound to `127.0.0.1`. Never stepped around; without it a held port falls back to 4401…4409. |
| `--open` / `--no-open` | on for a terminal, off otherwise | Open the CRT URL in your default browser once ready. |
| `--yes` | off | Never prompt: every question takes its default or fails with one `crt:` line (also the behaviour off a terminal or with `CI` set). |
| `--review [name]` | off (or `"store": "review"` in `.crt/config.local.json` / `.crt/config.json`) | Keep this run's feedback in a **review** under the CRT home (`~/.crt`, or `CRT_HOME`) instead of the project's `.crt/tasks/`, and write nothing into the project — what a project that is not set up gets anyway (below). With a name, that review (started by the first Send if it does not exist); without one, the current review. |
| `--replace` | off | Stop a CRT already holding the port (through its `POST /__crt/internal/shutdown`, which any local process may call — page scripts cannot, and it is no more than a signal could do) and take it over. |
| `--provider <id>` | auto | The agent behind the chat: `claude` (default) or `codex`. See [Providers](providers.md). |
| `crt doctor` | | Read-only checklist, one row per check; exit 1 on any `FAIL`. First step in [Troubleshooting](troubleshooting.md). |
| `crt init [--yes] [--no-instructions] [--snippet [--json]]` | | Sets the project up explicitly: prints its plan (`.crt/README.md`, `.crt/tasks/`, `.crt/config.json`, the two `.gitignore` lines, a CRT section in `CLAUDE.md` / `AGENTS.md` — only what is not in place), asks `Go ahead? [Y/n]` on a terminal (`--yes` skips the question; off a terminal it applies without asking), announces every write, and ends with the one-line snippet for your framework. `--no-instructions` leaves `CLAUDE.md` / `AGENTS.md` alone; `--snippet` prints only the snippet and writes nothing (`--json` for tooling). Idempotent: a second run says `crt init: <root> is set up (…)`. |
| `crt setup [--claude <path>]` | `claude` on PATH | Registers the plugin bundled in the package with Claude Code and installs (or updates) `crt@crt`; says `already installed` when it is. `--claude` names the Claude Code executable when it is not on PATH. |
| `crt --version` | | `crt 0.7.2 (agent sdk 0.3.270)`, read from local files — CRT never checks a registry. |

## What `crt` prints

### The ready line

On success it prints one line — `CRT ready at http://localhost:4400 for http://localhost:3000 (embedded; project: C:\my-app, 3 tasks in .crt\tasks, provider: claude (default), login: ok)` (`for <app>` is omitted when no dev server was found; `CRT ready at http://localhost:4400 → http://localhost:3000 (proxy; project: …)` under `crt proxy`) — and, on a terminal, `Open http://localhost:3000 → CRT button bottom-right (Ctrl/Cmd+Shift+.) → Select · note · Send. Ctrl+C stops CRT; your dev server keeps running.` (`Open your dev server in the browser → …` when none is known; `Open http://localhost:4400 → …` in proxy mode), then keeps running until Ctrl+C (`Stopping CRT … 1 session ended; written task files are kept.`).

### Finding your app

Before that, finding your app in embedded mode is one line and never a question or a wait: `Found http://localhost:3000.`; with several dev servers up a terminal lists them and asks `Which one should I open? [1]` (off a terminal: `crt: found N dev servers (…); opening http://localhost:3000 — run \`crt <port>\` to pick another`); with none, `No dev server on ports 3000, 5173, 8080, 4200, 8000, 3001 — start it and open it in your browser; the CRT button appears when the page loads the CRT loader (crt <port> to have CRT open it next time).` and CRT is ready anyway; a remembered or configured app that is down gets `crt: http://localhost:3100 (remembered) is not responding — start it; CRT is ready for it`.

### The loader

The CRT button appears on your app's own URL once the page loads the CRT loader ([Add CRT to your app](integration.md)); `http://localhost:4400` itself shows a landing page that says so, and when CRT opened your app but the page never asked for the loader it says `crt: opened http://localhost:3000 but the page never loaded the CRT loader — add the integration (\`crt init\` prints the snippet, /crt:init applies it), or run \`crt proxy\``; the first page that does load it gets `crt: overlay loaded in the browser (from http://localhost:3000)`.

### A CRT already on the port

When a CRT from an earlier session already serves the same project in the same mode on the port, `crt` says `CRT <version> is already serving this project (embedded) at http://localhost:4400 (since 09:12) — opened http://localhost:3000.` (`… — open your app in the browser.` when none is known; `CRT <version> is already serving … for this project at … — opened it.` in proxy mode) and exits 0; when it serves something else, or the port is held by something that is not CRT, `crt` takes the next free port and says so (`crt: port 4400 is held by another CRT (→ <target>, project <root>); using 4401` / `crt: port 4400 is in use by a process that is not CRT; using 4401`), and in embedded mode adds `crt: your app's CRT loader expects :4400 — run \`crt --replace\`, or set port in .crt/config.json and in the snippet`, because the snippet in your app still points at 4400.

### The CRT browser

`crt browse` prints the ready line with `(embedded, CRT browser; …)` and then, on a terminal, `In the CRT browser window → CRT button bottom-right (Ctrl/Cmd+Shift+.) → Select · note · Send. Ctrl+C stops CRT; your dev server keeps running.` The window opens on your app (on CRT's own page when no dev server answered — type your app's URL there), and the first page that loads the overlay gets `crt: overlay loaded in the browser (from http://localhost:3000)` as with the integration. In that window a page on `localhost`, `*.localhost`, `127.0.0.1` or `[::1]` is served without its `Content-Security-Policy` header, so the app's policy cannot refuse the overlay; every other site keeps its policy and never sees CRT. The window is not your everyday browser: you sign in to your app once in its profile, and your extensions are not there.

One window per server: a second `crt browse` in the project asks the running CRT to open a tab and exits 0 with `CRT <version> is already serving this project at http://localhost:4400 (since 09:12) — opened the CRT browser on http://localhost:3000.` Closing the window does not stop CRT — `crt: the CRT browser was closed — \`crt browse\` opens it again` — and stopping CRT closes the window: `Stopping CRT … 1 session ended; the CRT browser was closed; written task files are kept.`

When no browser is found: `crt: no Chrome, Edge or Chromium found — set browser.command in .crt/config.local.json, or run \`crt proxy\``. When the one found does not start or does not answer: `crt: <exe> did not accept a DevTools connection (<why>) — set browser.command in .crt/config.local.json, or run \`crt proxy\``. CRT keeps serving after either line.

### Setting the project up

`crt` never sets a project up on its own, and no longer asks to: a project without `.crt/tasks/` is reviewed as a **guest**. One line says so before the ready line —

```
crt: C:\my-app is not set up for CRT — keeping this review in C:\Users\me\.crt\reviews\my-app-3fa9c1 (nothing is written to the project; `crt init` adopts CRT here).
```

— and the ready line reads `(embedded, guest; project: C:\my-app, review 2026-11-16: 0 items, provider: …, login: …)`. Nothing under the project root is created, modified or deleted while CRT runs: captures, the remembered target, the provider choice and the tasks all go to the CRT home. `--yes` only means "never prompt"; it does not run `crt init`. `crt init` is the deliberate step that adopts CRT in a repository — see [CRT is not set up](troubleshooting.md#crt-is-not-set-up).

### Reviews

A **review** is where feedback is kept when it is not written straight into the project: for a guest, and for a set-up project started with `--review` (or `"store": "review"`). It lives under the CRT home, one folder per project (the folder name plus a short hash of its path) and one per review:

```
~/.crt/reviews/my-app-3fa9c1/
  project.json            which checkout this is
  config.local.json       what would have gone to .crt/config.local.json: the remembered target, the provider choice, Always-allow rules
  2026-11-16/             a review, named after the day it started (or the name you gave it)
    review.json           its status, when it started, its items in order
    tasks/R-01-<slug>.md  the task files, with review-local ids
    tasks/assets/R-01/    their screenshots and capture.json
    tasks/README.md       the generated index
    captures/             captures not yet turned into items
```

The first Send starts a review when the project has no open one, and the first thing a run creates under the home is announced once (`crt: created C:\Users\me\.crt\reviews`). Items are numbered `R-01`, `R-02`, … within their review and are ordinary [task files](task-format.md) otherwise; each records the `branch` and `commit` the project was on when it was captured. The **current review** is the project's newest open one.

| Command | What it does |
|---|---|
| `crt review` | Prints the current review, one line per item in order — `R-03  high    kept     /checkout  Cart total excludes applied discount` — then `Review 2026-11-16: 11 items · 9 kept · 3 routes` and the next step (`crt handoff`). On a terminal it then opens the **review page** (below) in your browser: on the CRT already serving this project, else on one it starts, which runs until Ctrl+C. `--open` opens the page off a terminal too, `--no-open` never does; `--port <n>` is where to look for, or start, the server. With no review: `crt: no review for <root> yet — run \`crt\`, send some feedback, then \`crt review\``, exit 0. |
| `crt review --json` | The same as JSON for tooling: `review`, `dir`, `tasksDir`, `status`, `created`, `project`, `items` (`id`, `keep`, `order`, `title`, `priority`, `status`, `route`, `branch`, `commit`, `file`), `totals`, `handovers`; `{ "review": null, "items": [] }` when there is none. |
| `crt review list` | Every review of the project, oldest first: `2026-11-16  open    11 items, 9 kept  (current)`. |
| `crt review new [name]` | Starts a new review, which becomes the current one; the previous stays open and listed. A name is lower-case letters, digits and hyphens; the default is today's date, with `-2`, `-3` … when taken. |
| `crt tasks --review [name]`, `crt task R-03 --review [name]` | `crt tasks` and `crt task` over a review's items instead of `.crt/tasks/` (the current review, or the named one). |

#### The review page

`http://localhost:4400/__crt/review` is the current review before the project sees any of it. The items are grouped by the route they were filed on — groups in the order of their first item, items in the order filed — each with its title, the first paragraph of its summary, the annotated screenshot and the commit that was reviewed. Per item: **Drop** (it stays in the review, greyed, and **Keep** brings it back), the **Priority** select, and **Move up** / **Move down** within its group; per group, **Group up** / **Group down**. Every control is a button or a select, so the whole page works from the keyboard. The totals and the hand-over command (`crt handoff`, with a Copy button) are at the top.

Every change is saved at once. What is kept and in what order lives in `review.json`; a priority change is the one thing that edits a task file before hand-over (`priority:`, `updated:` and a Log line). The page reads the review again when you come back to its tab, so items filed meanwhile appear without a reload.

The page and its API (`/__crt/review/items`, `/__crt/review/groups`, and an item's screenshots by id and file name) answer the page itself and local processes only: a request from any other origin — your app's page included — is refused.

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
