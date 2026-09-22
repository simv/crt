# Troubleshooting

Every `crt doctor` row and every `crt:` failure line, what each means and the fix. Run `crt doctor` first; its sample is repeated here from the front page ([README › Troubleshooting](../README.md#troubleshooting)).

## `crt doctor`

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
ok    plugin    crt@crt 0.6.0 installed (claude on PATH)
→ claude — codex not logged in
```

`FAIL` is reserved for what stops `crt` from serving: `FAIL  node      v18.20.0 — CRT needs Node 20 or newer`; in proxy mode `FAIL  target    none set and nothing on the probed ports — crt <port>` and `FAIL  target    http://localhost:3100 (remembered) — not responding` (in embedded mode the target is only what `crt` opens for you, so those rows are `--    target    none set; crt opens nothing (crt <port> to remember one)` and `warn  target    http://localhost:3100 (remembered) — not responding`); `FAIL  port      4400 held by CRT 0.6.0 → http://localhost:3000 (this project) — crt --replace`; `FAIL  port      4400 in use by a non-CRT process — crt --port 4401`; and the provider a session would use when it is unusable (its row carries the same line the panel shows). Everything else is a `warn` — `warn  project   C:\my-app\src — no .git above; .crt/ will be created here (run from the repo root, or git init)`, another provider's problem, `warn  plugin    crt@crt not installed — run crt setup`, `warn  plugin    crt@crt 0.5.0 installed, this is 0.6.0 — run crt setup` — or `--` for what was skipped (`--    .crt      not initialised — run crt init`, `--    plugin    claude not on PATH — skipped`), so a Claude-only machine passes. The v0.4 rows never fail: `.crt` says `warn  .crt      tasks/ (4 tasks), config.json, .gitignore entries — no README.md — run crt init` for a folder that predates `crt init`'s README; `mode` reads `ok    mode      embedded` or `ok    mode      proxy (.crt/config.json)`; `integration` reads only the snippet's candidate files for the detected framework — `ok    integration next — app/layout.tsx imports claude-review-tool/react`, `ok    integration vite — vite.config.ts uses claude-review-tool/vite`, `ok    integration loader — src/main.tsx imports claude-review-tool/loader`, `warn  integration not found (next) — run crt init for the snippet, or crt proxy`, `--    integration static page — add the <script> tag (crt init --snippet)`, `--    integration proxy mode`; `instructions` reads `ok    instructions CLAUDE.md carries the CRT section` (both names when both do), `warn  instructions CLAUDE.md has no CRT section — crt init adds it` or `--    instructions no CLAUDE.md or AGENTS.md — crt init creates one`. `crt` runs the same checks before its first question and prints only the `FAIL` and `warn` rows.

## `crt:` lines

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

`crt` creates nothing on its own (v0.4): a project without `.crt/tasks/` is set up only by `crt init`, or by `crt` after you said yes. On a terminal `crt` prints the plan and asks `Set up CRT in C:\my-app? [Y/n]` (Enter sets it up and starts; `n` prints `crt: cancelled` and exits 130 — the same line ends a `crt init` answered `n`); off a terminal — a skill, CI — it refuses with the line above unless `--yes` was given, which sets the project up with every write printed and starts. `crt init` itself prints the plan first, only the items not already in place:

```
crt init will, in C:\my-app:
  create .crt/README.md
  create .crt/tasks/
  create .crt/config.json
  add .crt/captures/ and .crt/config.local.json to .gitignore
  add a CRT section to CLAUDE.md
```

then asks `Go ahead? [Y/n]` on a terminal (`--yes` skips it; off a terminal the command is explicit enough to apply without asking) and announces each write as it happens — `crt init: created .crt/README.md`, `crt init: created .crt/tasks/`, `crt init: created .crt/config.json`, `crt init: added .crt/captures/ and .crt/config.local.json to .gitignore`, `crt init: added the CRT section to CLAUDE.md` (or `crt init: created CLAUDE.md with the CRT section` when neither `CLAUDE.md` nor `AGENTS.md` existed, `crt init: updated the CRT section in CLAUDE.md` when the section's version stamp was older). When there is nothing to do it says `crt init: C:\my-app is set up (.crt/README.md, tasks/, config.json, .gitignore entries, CRT section in CLAUDE.md)`. It ends with the snippet for your framework (`Add CRT to your app (development only):`, the file, the lines, and `Production builds contain nothing from CRT (docs/integration.md › Production). /crt:init in Claude Code applies this for you.`); `crt init --snippet` prints only that and writes nothing. `crt tasks` on a project that is not set up prints `no tasks (CRT is not set up here — run crt init)` and exits 0 (`--json` answers `{ "tasksDir": null, "tasks": [] }`). The CRT section sits between `<!-- BEGIN:crt v0.6 -->` and `<!-- END:crt -->` in `CLAUDE.md` and `AGENTS.md` (an `@AGENTS.md`-only `CLAUDE.md` is skipped in favour of `AGENTS.md`), is replaced in place when the stamp's major.minor changes and never touched at runtime; `--no-instructions` leaves both files alone. In Claude Code, the SessionStart hook says `CRT: .crt/ is set up but CLAUDE.md has no CRT section — run crt init to add it` when the section is missing.

### No dev server found

```
crt: no dev server on ports 3000, 5173, 8080, 4200, 8000, 3001 — start it and open it in your browser; the CRT button appears when the page loads the CRT loader (crt <port> to have CRT open it next time)
crt: found N dev servers (…); opening http://localhost:3000 — run `crt <port>` to pick another
```

Not errors, in embedded mode: your app is only what `crt` opens for you, so `crt` is ready either way (the ready line has no `for <app>`), and the CRT button appears on whichever loopback page loads the loader. The first line means nothing answered HTTP on the probed ports and you gave no target (`crt 3100` remembers one per machine in `.crt/config.local.json`; `--target <url>` and `target` in `.crt/config.json` also work); on a terminal it reads `No dev server on ports … — start it and open it in your browser; the CRT button appears when the page loads the CRT loader (crt <port> to have CRT open it next time).` and the browser is not opened. The second line is the off-terminal form of the list a terminal shows with `Which one should I open? [1]`: the first responder was opened. In proxy mode the target is what CRT forwards to, so the same situations are errors there:

```
crt: no dev server found on ports 3000, 5173, 8080, 4200, 8000, 3001 — start it, or run `crt <port>`
crt: found N dev servers (…); using http://localhost:3000 — run `crt <port>` to pick another
```

You ran `crt proxy` off a terminal (or with `--yes`) without a target, without `target` in either config file, and nothing answered HTTP on any of the probed ports. Start your dev server first, or name it as above. On a terminal `crt proxy` asks for the URL or port instead (`Dev server URL or port:`) and waits for it to come up, re-probing every 2 s; with several dev servers up it lists them and asks `Which one? [1]`. The second line is the off-terminal form of that list: the first responder was taken.

### Target unreachable

```
crt: http://localhost:3100 (remembered) is not responding — start it; CRT is ready for it
crt: target <origin> is not responding — start your dev server there, or run `crt <port>`
```

CRT had an explicit target — positional, `--target`, or from a config file (`(remembered)` for `.crt/config.local.json`, `(.crt/config.json)` for the project file) — but the connection was refused or timed out after 1.5s. Check the dev server really is up on that host and port (any HTTP status counts as up, so a 404 is fine) and that the port is not a typo. The first line is embedded mode, on or off a terminal: not an error, no wait, no question — CRT is up and the button appears once you start the app and its page loads the loader (the browser is not opened for you). The second is proxy mode off a terminal; on a terminal `crt proxy` waits for it instead (`<origin> is not responding yet — start it, then press Enter to retry (type another URL to change, Ctrl+C to quit)`), re-probing every 2 s, and offers another dev server it found (`Use 3000? [Y/n]`).

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
crt: your app's CRT loader expects :4400 — run `crt --replace`, or set port in .crt/config.json and in the snippet
```

The first two are not errors: without `--port`, `crt` reuses a CRT that serves the same project in the same mode (and, in proxy mode, the same target) — `CRT <version> is already serving this project (embedded) at http://localhost:4400 (since 09:12) — opened http://localhost:3000.` / `CRT <version> is already serving … for this project at … — opened it.` — and otherwise steps to the next free port, saying which it found on 4400. In embedded mode the last line follows, because the snippet in your app still names 4400: either replace the other CRT, or put the new `port` in `.crt/config.json` and in the snippet (`{ port }`, `data-crt-port`; the Vite plugin reads the config). On a terminal it asks instead — `1) Start this one on 4401  2) Replace it  3) Quit` for another CRT, `Start on 4401 instead? [Y/n]` for anything else. The next two appear only with an explicit `--port`, which is never stepped around. `--replace` asks the other CRT to stop through its shutdown route; the fifth line means it did not. Any other bind failure prints `crt: cannot listen on 127.0.0.1:<port> (<code>)` instead. `crt doctor` shows who holds the port.

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

`crt setup` needs the `claude` CLI (it runs `claude plugin list --json`, `claude plugin marketplace add <dir>` and `claude plugin install crt@crt` — or `update` when an older `crt@crt` is there — and writes nothing itself). Install Claude Code, or pass the executable with `crt setup --claude <path>`; the second line quotes Claude Code's own error and the same two commands work by hand from GitHub. On success it prints `crt setup: registered marketplace crt from <path>` and `crt setup: installed crt@crt 0.6.0 — restart Claude Code to load /crt:serve, /crt:next, /crt:tasks, /crt:task, /crt:done, /crt:intake, /crt:init`; `crt setup: crt@crt 0.6.0 is already installed` means there was nothing to do. When the plugin and the project's `claude-review-tool` disagree on major.minor, the SessionStart hook says `CRT: plugin 0.6.0 but the project's claude-review-tool is 0.5.0 — npm update claude-review-tool (or crt setup after updating)`.

### No `.git` in the project

Not an error. CRT uses the nearest ancestor of the launch directory that contains `.git` as the project root and falls back to the launch directory itself, so `.crt/` is created wherever you ran `crt`. If the `project:` path in the ready line (or in `/__crt/health`) is not where you want `.crt/tasks/` to live, run `crt` from your project root — or `git init` it. `crt doctor` warns about it.

### The CRT button does not appear (embedded)

```
crt: opened http://localhost:3000 but the page never loaded the CRT loader — add the integration (`crt init` prints the snippet, /crt:init applies it), or run `crt proxy`
```

CRT opened your app, but fifteen seconds later the page had asked for neither `/__crt/loader.js` nor `/__crt/overlay.js`: the integration is not in the page. `/__crt/health` shows it as `overlay.loader: 0` and `overlay.fetched: 0`, and `/crt:serve` says so in its reply. In order:

- **Is the snippet there?** `crt doctor`'s `integration` row reads the candidate file for your framework: `ok    integration next — app/layout.tsx imports claude-review-tool/react` means it is; `warn  integration not found (next) — run crt init for the snippet, or crt proxy` means it is not (`crt init` prints it, `/crt:init` applies it; `--    integration static page — add the <script> tag (crt init --snippet)` for a page without a bundler). `<CrtDevTools />` must be inside the tree that renders on the client (the root layout's `<body>` in Next.js); `crt()` must be in the `plugins` array of the config Vite actually loads; the script tag must be in the page that is served in development.
- **Is the page on a loopback hostname?** The loader does nothing at all on any other host — `localhost`, `*.localhost`, `127.0.0.1` and `[::1]` are the whole list. A dev server reached through a LAN IP or a tunnel has no CRT button, by design.
- **Is it the pill?** `CRT server not running on :4400 — run \`crt\` in the project, then click here` bottom-right means the loader ran but the overlay script failed to load: `crt` is not running, or it is running on another port (`crt: port 4400 is held by another CRT …; using 4401` earlier in the terminal, and the `crt: your app's CRT loader expects :4400` line after it — see [Port in use](#port-in-use)). Start `crt`, then click the pill or refocus the tab; no reload needed. With the script-tag form there is no pill: the script itself is missing while the server is down and the browser's network panel shows the failed request for `/__crt/loader.js` — start `crt` and reload.
- **A Content-Security-Policy?** The app's own CSP must allow `http://localhost:4400` in `script-src` (the loader and the overlay script) and in `connect-src` (the API and the SSE stream); the browser console names the blocked directive. In development only — production builds carry nothing from CRT. If the policy cannot be changed, `crt proxy` relaxes the CSP of the proxied pages for its own origin.
- **Did the page log an error before the loader ran?** It is not captured — the hooks start where the snippet runs ([Add CRT to your app](integration.md) says where that is for each form). Move the snippet earlier, or use `crt()` / the script tag first in `<head>`.

If the button is there but **Send** fails with `CRT server answered 0` or a CORS error in the console, the page is on a non-local origin, which the server does not allow.

### Overlay does not appear (proxy mode)

```
crt: injected the overlay into GET / but the browser never fetched /__crt/overlay.js — a Content-Security-Policy or a JS-rendered shell is blocking it; see docs/troubleshooting.md › Overlay does not appear
```

Proxy mode only (`crt proxy`). The proxy is up, it put the overlay tag into the page, but ten seconds later the browser had still not asked for the script, so there is no CRT button (and no dot, no welcome card). The same finding shows in `/__crt/health` as `overlay.fetched: 0`, and `/crt:serve` repeats it in its reply. Two more lines name the cause when CRT can see it: `crt: GET / answered application/json, not text/html — CRT injects only into HTML; use the script-tag fallback (README)` and `crt: GET / sends a CSP with 'strict-dynamic' that CRT cannot relax — the overlay may be blocked; use the script-tag fallback` (also for a nonce, a `require-trusted-types-for` directive or a policy in a `<meta http-equiv>` tag). Check `view-source:` for `<script src="/__crt/overlay.js" defer>` — it is only injected into responses whose `Content-Type` is `text/html`. If your app renders the shell from JavaScript, redirects to its own absolute origin, or sends a `Content-Security-Policy` the relaxer cannot fix, use embedded mode instead: the "script-tag fallback" those lines name is the fourth form in [Add CRT to your app](integration.md), and `crt` (without `proxy`) is what runs it.
