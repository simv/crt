# CRT v0.3 — Setup and first run — PRD

| | |
|---|---|
| **Status** | Draft — ready for build (UX review 2026-09-16, four lenses; findings in Appendix A) |
| **Owner** | Simon (simv) |
| **Repo** | https://github.com/simv/crt |
| **Baseline** | `main` at 27b3f28 = v0.1.0 + PRD-providers M6–M9 (CRT-0009…0012) + anchored threads (CRT-0015) |
| **Amends** | `docs/PRD.md` v1.0 (§4 step 1, §8, F-1, F-5, F-35, F-36, F-41, N-5, N-6) and `docs/PRD-providers.md` (F-45, F-52, F-57, N-7) — every amended statement is listed in §9 |

This document extends `docs/PRD.md` and `docs/PRD-providers.md`. Everything in both stays in force unless §9 amends it. Requirement IDs continue the numbering (F-69…F-90, N-14…N-17); milestones are M12–M14, one task file each (`.crt/tasks/CRT-0016…0018`). A build session reads `docs/PRD.md`, `docs/PRD-providers.md`, this file, `CLAUDE.md` and its task file, and nothing else, to know what "correct" means. §12 tells the builder what to do when the real tools differ from what this document assumes.

---

## 1. Problem and scope

PRD §2 Goal 5 promises "near-zero setup: install the plugin, run one command, browse". After v0.2 the product does far more than v0.1, but getting it running has become the hardest part of using it. The owner, who wrote the tool, runs it from memory as `node <repo>/packages/server/dist/cli.js serve --target http://localhost:3100 --port 4400 --open` from another folder and keeps a note of that command because nothing shorter works. A cognitive walkthrough of the README path (Appendix A) found the same things a stranger would hit:

- **The install channels do not deliver the code on `main`.** npm has only `claude-review-tool@0.1.0` (2026-09-15) while `main` carries the provider work and anchored threads, so `npx -y claude-review-tool@latest` gives a v0.2 plugin a v0.1 server. The GitHub repo is private, so `claude plugin marketplace add simv/crt` fails for anyone without repository credentials. The plugin installed on the owner's own machine reports version 0.0.1.
- **Every start begins with a bind failure.** A `crt serve` left running by an earlier session (or a background skill) still holds port 4400. The message names no process and does not say it is CRT; freeing the port is a `netstat`/`taskkill` hunt.
- **The target is neither found nor remembered.** Port 3100 is not in the probe list, `--target` is never persisted, and with two dev servers up the first responding port wins silently. So the full `--target … --port …` incantation is retyped daily.
- **`crt` alone prints usage.** PRD §4 and §8 say `npx claude-review-tool` "does the same as `/crt:serve`"; the CLI disagrees.
- **Login is unknowable until the first Send.** The Claude preflight hard-codes `loggedIn: "unknown"`, so a developer writes a note, sends it, and only then reads "not logged in".
- **Arrival is blind.** After the browser opens there is a small "CRT" button and nothing that says what is proxied, which project the tasks go to, whether the agent is ready, or — when an SPA shell or a strict CSP kept the overlay out — that anything is wrong at all. The terminal is silent in every miss.
- **The first run is a silent multi-minute download.** The Agent SDK's platform binary is ~217 MB; `npx` fetches it with no output from CRT, while `/crt:serve` waits 30 s and gives up.

**Scope of v0.3 setup.** One command from a project folder gets the site into the browser with CRT on it, asking at most one question (which URL) and only when CRT cannot tell; the second run asks nothing. Every stop has its fix on screen. The one-time machine install is one npm command plus one `crt` command that registers the plugin with Claude Code without touching GitHub. Nothing new leaves the machine.

## 2. Goals

1. **`crt` is the whole per-project command.** From a project folder with the dev server running, `crt` (or `npx claude-review-tool`) opens `http://localhost:4400` on the app with the overlay loaded, without flags.
2. **One question, then none.** When CRT cannot find the dev server it asks for its URL or port, validates the answer, waits for it to come up, and remembers it for that machine. The next `crt` in that project starts in under three seconds with no prompt.
3. **A stale CRT is never a dead end.** An earlier `crt serve` on the port is recognised, reused when it serves the same thing, or stepped around; the developer is told which it was.
4. **Readiness is known before the browser opens.** The ready line and the page both say which project, which target, which agent, and whether it is logged in.
5. **Install is two commands per machine and works from npm alone.** `npm i -g claude-review-tool` then `crt setup`; the plugin is inside the package, so a private or moved repository cannot block it.
6. **Nothing new leaves the machine** (N-4/N-12): no update checks, no registry pings, only localhost probes and the agent's own calls.

## 3. Non-goals (v0.3)

- **Starting the dev server for the developer** (`crt --run "npm run dev"`). Dropped after review: on Windows `npm run dev` spawns `cmd.exe → node`, so stopping the parent orphans the tree; the dev server's progress bars would trample the ready line the skill reads; and which script, package manager and workspace to run is a guess that is wrong somewhere. CRT prints a hint when `package.json` has a `dev` script (F-71) and stops there.
- A GUI installer, a browser extension, a tray icon.
- Reading Claude Code credential files to learn login state (F-74 explains why not).
- Rewriting `<meta http-equiv>` CSP or `'strict-dynamic'` policies; CRT detects and reports them (F-80) and the script-tag fallback (F-6) stays the answer.
- Periodic health polling from the overlay.
- Multi-user or remote targets (unchanged from v1.0).

## 4. Scenario changes

PRD §4 step 1 becomes: *Simon runs `crt` in the project folder (or `/crt:serve` in Claude Code). CRT finds his dev server — or asks for its URL once and remembers it — checks that Claude Code is logged in, starts on `http://localhost:4400` and opens the browser; a stale CRT from yesterday is reused or stepped around, and the terminal says which.*

PRD §8 "Setup experience (the whole thing)" becomes:

```bash
# one-time, per machine
npm i -g claude-review-tool
crt setup                         # registers the bundled plugin with Claude Code: /crt:serve, /crt:next, …

# per project
cd my-app && npm run dev          # your normal dev server
crt                               # finds it (or asks for its URL once) → http://localhost:4400 opens; browse, annotate, send
```

Inside Claude Code, `/crt:serve` does what `crt` does and asks the URL question in the chat. `npx claude-review-tool` works without any install (the first run downloads ~220 MB and says so in the README).

## 5. Design

### 5.1 The guided start is a state machine, not a wizard

`crt [target]` runs the same steps `crt serve` runs today — root → init → prune → target → providers → listen → open → ready — with three of them able to *ask* instead of *fail*: target (none found, several found, chosen one down), port (held by a CRT or by something else) and provider (explicitly chosen but unusable). Each step is a pure function over injected probes (`isReachable`, `health`, `preflight`, `prompt`) so every transcript in §6.1 is a unit-test row, the way `detect.ts` made F-44 testable without a machine. The interactive and non-interactive paths share the code; only the `prompt` implementation differs (`node:readline/promises` vs "answer the default or fail with the `crt:` line").

### 5.2 Interactive or not

Interactive **iff** stdin and stdout are TTYs, `CI` is unset, and `--yes` is absent. The plugin skills run `crt` in background Bash (non-TTY), so every prompt collapses to today's single `crt: …` line and the F-36/N-6 contracts are untouched. `--yes` answers each prompt with its bracketed default; a prompt with no default fails with its line. The browser opens by default when interactive (`--no-open` suppresses) and only with `--open` otherwise, which the skill already passes.

### 5.3 Where answers are remembered

A chosen target goes to **`.crt/config.local.json`**, never `.crt/config.json`. The committed file is the team's deliberate default (F-35); which port a dev server happens to use is a per-machine, per-checkout fact (the owner's app is on :3100 because :3000 belongs to another project). Writing a prompt answer into a committed file produces a diff nobody asked for and a value that is wrong for the next machine. This mirrors the F-57 "Remember" pattern and N-8 (the server writes the local file only). `readConfig` therefore layers `target` and `port` local-over-project, as it already does for `provider`. A single probe hit is *not* remembered: it is already instant, and recording a guess freezes it.

### 5.4 Login is checked before the browser opens

The SDK-bundled Claude binary that `claudePreflight` already resolves answers `auth status --json` with a `loggedIn` boolean in ~300 ms without a model call (verified on 2.1.270 on Windows during this review; §12 rule 1 applies if the shape differs). Preflight spawns it with `shell: false` and a 5 s timeout, reads only `loggedIn`, and never logs the rest of the payload (it carries the account's email and organisation). `false` produces the existing N-6 line at start, on the ready line, in `crt providers`, in `/__crt/providers`, and in the page — before anyone writes a note. Any other outcome stays `"unknown"` (PRD-providers §12 rule 3), which never blocks.

### 5.5 The plugin ships inside the package

`plugin/` is copied into `dist/plugin-marketplace/` at build time next to a marketplace manifest whose `source` is the copied plugin, so the npm package is a complete Claude Code marketplace on disk. `crt setup` registers it with `claude plugin marketplace add <that path>` and `claude plugin install crt@crt` (the same marketplace name as the GitHub one, so it replaces rather than duplicates). Consequences: no GitHub access is needed; the plugin version equals the server version by construction; `claude plugin update crt@crt` after `npm update -g` (or after `npm run build` in this repo, where `crt` is npm-linked) picks up new skills. The GitHub marketplace remains valid for people who prefer it.

### 5.6 What changes where

| Area | Change |
|---|---|
| `packages/server/src/cli.ts`, `args.ts` | bare `crt` and positional target → `start`; `help`, `--version`, `doctor`, `setup`; `--yes`, `--no-open`, `--replace` |
| `packages/server/src/start.ts` (new) | the guided state machine (F-70…F-73), pure over injected probes; both `crt` and `crt serve` run it, and `serve.ts` keeps the non-interactive core it wraps (`ServeOptions` stays compatible with `cli.ts`, which the e2e fixture drives through `dist/cli.js`) |
| `packages/server/src/prompt.ts` (new) | `node:readline/promises` prompt with validation and the "press Enter to retry" loop; Ctrl+C handling (F-77) |
| `packages/server/src/doctor.ts` (new) | the checklist (F-76), shared by `crt doctor` and the guided start |
| `packages/server/src/setup.ts` (new) | `crt setup` (F-86), spawning `claude` through `providers/exec.ts` |
| `packages/server/src/init.ts` | `readConfig` layers `target`/`port` local-over-project; `writeLocalConfig` accepts `target` (F-72) |
| `packages/server/src/target.ts` | probe returns *all* responders with a label (F-71); `normalizeTarget` recognises bare digits / host:port / URL as a positional |
| `packages/server/src/providers/claude.ts` | preflight runs `auth status --json` (F-74) |
| `packages/server/src/proxy.ts`, `provider-routes.ts` | health payload (F-78), `POST /__crt/internal/shutdown` (F-79), overlay-fetch tracking (F-80), `loggedIn` in `/__crt/providers` |
| `packages/overlay/src/ui.ts` (+ `welcome.ts` new) | launcher health dot (F-81), welcome card (F-82) |
| `plugin/skills/serve/SKILL.md`, `plugin/hooks/session-start.mjs` | guided `/crt:serve` (F-83), drift line (F-84) |
| `packages/server/scripts/copy-intake.mjs` | also copies `plugin/` + marketplace manifest into `dist/plugin-marketplace/` (F-85) |
| `README.md`, `docs/PRD.md`, `CLAUDE.md` | §9 |

## 6. Functional requirements

### 6.1 Command line

- **F-69 (Must) `crt [target]` starts.** The first argument that is not a known command name — bare digits, `host:port`, or `scheme://…` — is the target (`normalizeTarget`); `crt` with nothing starts too; `--target <url>` stays as an alias so existing scripts and the skills keep working. `crt serve [target]` is the same command under its explicit name, prompts included — the skills pass `--yes`. `crt help`, `crt --help` and `crt -h` print usage; `crt --version` prints `crt <package version> (agent sdk <SDK package version>)`, both read from local `package.json` files. Anything else that is neither a command nor a target: `crt: unknown command "<x>" — a target is a port, host:port or URL; \`crt help\` lists commands` (exit 2).
- **F-70 (Must) Interactive only on a terminal.** As §5.2: TTY on both stdin and stdout, `CI` unset, no `--yes`. Non-interactive runs never print a prompt and never wait; each prompt below has a default or a `crt:` line. `--open` / `--no-open` as §5.2.
- **F-71 (Must) Guided target.** Resolution: positional or `--target` → `.crt/config.local.json` `target` → `.crt/config.json` `target` → probe. The probe (same ports, same 1.5 s) collects **every** responder and labels it with the response's `<title>` or `X-Powered-By` when present. Then:
  - one found → use it, print `Found http://localhost:3000.`; not remembered;
  - several found → interactive: numbered list, `Which one? [1]`; non-interactive: the first, and the line `crt: found N dev servers (…); using http://localhost:3000 — run \`crt <port>\` to pick another`;
  - none found → interactive: `No dev server on ports 3000, 5173, 8080, 4200, 8000, 3001.` plus, when the root `package.json` has `scripts.dev`, `(This project has \`npm run dev\`.)`, then the prompt `Dev server URL or port:` with validation (`"abc" is not a URL or port — try 3000, localhost:3000 or http://…`; an empty answer re-prompts) and the wait loop `http://localhost:3100 is not responding yet — start it, then press Enter to retry (type another URL to change, Ctrl+C to quit)`, re-probing every 2 s while waiting; non-interactive: `crt: no dev server found on ports … — start it, or run \`crt <port>\`` (today's line with the new hint);
  - explicit or remembered target down → interactive: the same wait loop, and when the probe finds something else, `http://localhost:3100 (remembered) is not responding, but http://localhost:3000 is. Use 3000? [Y/n]`; non-interactive: `crt: target <origin> is not responding — start your dev server there, or run \`crt <port>\``.
- **F-72 (Must) Remember the choice.** A target the developer typed at the prompt, picked from the list, or passed as the positional (`crt 3100`) is written to `.crt/config.local.json` as `target` once it has responded (creating the file; `.gitignore` already lists it) and announced: `Remembered http://localhost:3100 in .crt/config.local.json — \`crt <port>\` switches.` Never remembered: the `--target` flag (the scripting form the skills and the e2e fixture use), a single probe hit, a `Y` to "Use 3000?" (the remembered value stays; `crt 3000` switches it), a port fallback (F-73), and `--port` itself — `port` is only ever set by hand in a config file. `readConfig` layers `target` and `port` local-over-project (§5.3).
- **F-73 (Must) A busy port is diagnosed, not just reported.** On `EADDRINUSE` CRT requests `GET /__crt/health` on the port (1 s timeout, retried once — a cold Node server on Windows can take longer than a few hundred milliseconds to answer its first request). Then:
  - the occupant is a CRT with the same `projectRoot` and `target` → **reuse**: `CRT <version> is already serving http://localhost:3000 for this project at http://localhost:4400 (since 09:12) — opened it.`, open the browser if asked, exit 0. This holds non-interactively too, so a skill's health poll succeeds. When its `version` differs from ours, interactive asks `That is CRT 0.2.0; this is 0.3.0. Replace it? [Y/n]` (non-interactive: reuse and say so);
  - a CRT serving another target or project → interactive: `Port 4400 is held by another CRT: → http://localhost:3000, project C:\my-app, since 09:12, 1 session open.` then `1) Start this one on 4401  2) Replace it  3) Quit` `Which? [1]`; non-interactive: the next free port in 4401…4409 with the line `crt: port 4400 is held by another CRT (→ <target>, project <root>); using 4401`;
  - not a CRT → interactive: `Port 4400 is in use by something that is not CRT. Start on 4401 instead? [Y/n]`; non-interactive: next free port with `crt: port 4400 is in use by a process that is not CRT; using 4401`.
  - An explicit `--port` is never stepped around: the existing `crt: port <n> is already in use …` line stays, extended with what health found. `--replace` (or answer 2) stops the other CRT through F-79; failure → `crt: could not stop the CRT on port 4400 (<reason>) — stop it yourself, or run \`crt --port 4401\``. The ready line always names the port actually bound, and the skill reads it from there (F-83).
- **F-74 (Must) Claude login preflight.** `claudePreflight` runs the bundled binary with `auth status --json` (§5.4) and sets `loggedIn` to the JSON's `loggedIn` boolean; a non-zero exit, a timeout, or unparseable output leaves `"unknown"` and `problem: null`. `loggedIn: false` sets `problem` to the existing line (`not logged in to Claude Code — run \`claude\` in a terminal and complete /login (or set CLAUDE_CODE_OAUTH_TOKEN), then send again`) extended with the install hint when `claude` is not on PATH (`… (install Claude Code first: npm i -g @anthropic-ai/claude-code)`). The check runs at start and on every `?refresh=1`, so a login completed in another terminal is noticed without a restart. Only `loggedIn` is read; the rest of the payload is never logged or stored. Because `preflightPasses` already treats `loggedIn: false` as unusable, a logged-out Claude is demoted by F-44 when another provider is usable (`provider: codex — claude not logged in`) and otherwise stays the default with that reason; an explicit `--provider claude` is never replaced and shows the N-7 line, as today (§9 lists this under F-43/F-44).
- **F-75 (Must) Ready output.** Line 1 keeps the F-5 shape and gains a login field: `CRT ready at http://localhost:4400 → http://localhost:3000 (project: C:\my-app, 3 tasks in .crt\tasks, provider: claude (default), login: ok)` where `login:` is `ok` / `missing` / `unchecked` for the resolved provider. Interactive runs add one line: `Open http://localhost:4400 → CRT button bottom-right (Ctrl/Cmd+Shift+.) → Select · note · Send. Ctrl+C stops CRT; your dev server keeps running.` — or, when login is `missing`, the F-74 line instead. The first `crt init` in a project prints `crt init: created .crt/tasks, .crt/config.json; added .crt/captures/ and .crt/config.local.json to .gitignore — commit .crt/`. When the overlay first loads, `crt: overlay loaded in the browser (GET /)`.
- **F-76 (Must) `crt doctor`.** A read-only checklist, one row per check, `ok` / `FAIL` / `warn` / `--` as words (legacy consoles), exit 1 on any `FAIL`, localhost only:

  ```
  $ crt doctor
  ok    node      v22.4.0 (needs 20 or newer)
  ok    project   C:\my-app (.git)
  ok    .crt      tasks/ (4 tasks), config.json, config.local.json, .gitignore entries
  ok    target    http://localhost:3100 (remembered) — responding
  ok    port      4400 free
  ok    claude    Claude Code (Agent SDK 0.3.270) — logged in
  warn  codex     codex-cli 0.154.0 — not logged in — run `codex login`
  ok    plugin    crt@crt 0.3.0 installed (claude on PATH)
  → claude — codex not logged in
  ```

  `FAIL` (exit 1) is reserved for what stops `crt` from serving: Node too old, no target or target down, port held, and the *resolved* provider unusable. Every other provider's problem and the plugin row are `warn`, so a Claude-only machine passes `crt doctor`. Wordings: `FAIL node v18.20.0 — CRT needs Node 20 or newer`; `warn project C:\my-app\src — no .git above; .crt/ will be created here (run from the repo root, or git init)`; `-- .crt not initialised — crt creates it`; `FAIL target none set and nothing on the probed ports — crt <port>`; `FAIL target http://localhost:3100 (remembered) — not responding`; `FAIL port 4400 held by CRT 0.3.0 → http://localhost:3000 (this project) — crt --replace`; `FAIL port 4400 in use by a non-CRT process — crt --port 4401`; provider rows reuse the F-45 states and N-7 lines verbatim, with `logged in` / `not logged in` / `login unknown` from F-74 (`FAIL` for the resolved provider, `warn` for the others); `-- plugin claude not on PATH — skipped`; `warn plugin crt@crt not installed — run crt setup`; `warn plugin crt@crt 0.2.0 installed, this is 0.3.0 — run crt setup`. The guided start runs the same checks and prints only `FAIL`/`warn` rows before its first prompt; `crt doctor` is the first step in README › Troubleshooting.
- **F-77 (Must) Stopping.** Ctrl+C prints `Stopping CRT … 1 session ended; written task files are kept.` and exits 0 after `close()`; a second Ctrl+C within 2 s exits immediately. Ctrl+C at a prompt prints `crt: cancelled` and exits 130. SIGTERM behaves as the first Ctrl+C.

### 6.2 Server surface

- **F-78 (Must) Health tells the whole story.** `GET /__crt/health` → `{ ok, version, startedAt, target, projectRoot, tasksDir, tasks, provider, login, sessions, overlay }` where `login` is `"ok" | "missing" | "unchecked"`, `sessions` the number of open intake sessions, and `overlay` is F-80's object. Existing assertions are extended, not replaced. `GET /__crt/providers` rows gain `loggedIn` from F-74.
- **F-79 (Must) Replace a stale CRT without PIDs.** `POST /__crt/internal/shutdown` closes the server the way Ctrl+C does and answers `{ ok: true }` first. Like every `/__crt/internal/*` route it refuses any request carrying an `Origin` header (N-8), so a page script cannot call it; any local process can, which is accepted for a localhost tool and stated in the README. `crt --replace` uses it, then waits for the port (up to 5 s) before binding.
- **F-80 (Must) The overlay's absence is reported.** The server keeps one 10 s timer, restarted by every HTML response it injected into and cleared by any request for `/__crt/overlay.js` (one timer per server by design: it answers "did *this browser session* ever load the overlay", so a spec that asserts it uses a dedicated server). When it fires, once per server: `crt: injected the overlay into GET / but the browser never fetched /__crt/overlay.js — a Content-Security-Policy or a JS-rendered shell is blocking it; see README › Overlay does not appear`. Health's `overlay` is `{ injected: n, fetched: n, lastContentType, cspWarning }`. **Should:** two more lines, once each — a document request (`sec-fetch-dest: document`) answered without `text/html`: `crt: GET / answered application/json, not text/html — CRT injects only into HTML; use the script-tag fallback (README)`; a CSP with `'strict-dynamic'`, a nonce, or `require-trusted-types-for`: `crt: GET / sends a CSP with 'strict-dynamic' that CRT cannot relax — the overlay may be blocked; use the script-tag fallback`.

### 6.3 Overlay arrival

- **F-81 (Must) Launcher health.** The launcher carries a state dot with a hover tooltip, driven by one health fetch at mount, on `visibilitychange`, and after any failed CRT request — never a timer: `checking` (grey pulse) "Checking the CRT server…"; `connected` (green) "CRT · Claude ready · C:\my-app", with the suffix " · login not checked yet" when health's `login` is `unchecked` (the stub, and any provider whose login cannot be read, stay green); `agent not ready` (amber) the resolved provider's N-7 line verbatim, `not logged in` included; `unreachable` (red) "CRT server not answering — is crt serve still running? (Send will fail)". **Should:** `different project` (amber) "This :4400 is serving C:\other-app — a crt serve from another session is still running", by comparing health's `startedAt`/`projectRoot` with the values saved in `sessionStorage` on first load. Chrome stays "CRT" (F-64); the agent noun is the provider's display name (F-56).
- **F-82 (Must) Welcome card.** On a project's first visit the overlay shows a dismissable card above the launcher, remembered in `localStorage` under `crt.welcome.v1:<health.projectRoot>` (one port serving two projects shows it once each). Copy: title "CRT is on this page"; "Proxying http://localhost:3000 for C:\my-app. Tasks are written to .crt\tasks (3 there now)."; one agent line for the resolved provider (its display name replaces "Claude") — "Agent: Claude — ready, logged in" / "Agent: Claude — not logged in: run `claude` in a terminal, complete /login, then send (no restart needed)" / "Agent: Claude — login not checked yet; the first Send will tell you"; "1. Open the toolbar: the CRT button, or Ctrl/Cmd+Shift+. 2. Select, Box or Pin the thing. 3. Type a note and Send."; buttons **Got it** (dismiss, remembered) and **Show me** (Should: opens the toolbar, arms Select, dismisses). Never shown when the active provider is `stub`, in script-tag mode, inside an iframe (`window.top !== window`), when threads or annotations were restored from `sessionStorage` (a mid-work reload), or when the health fetch failed (F-81 owns that). `window.__crt.welcome()` opens it on demand (tests, debugging).

### 6.4 Plugin skill and hook

- **F-83 (Must) Guided `/crt:serve`.** Step 0: `curl` health on the configured port; if `ok` and `projectRoot` equals `${CLAUDE_PROJECT_DIR}`, reuse it and say so; if it belongs to another project, ask (AskUserQuestion) whether to replace it (`--replace`) or use `--port`. Otherwise run `crt serve --open --yes [--target <arg>]` in the background and wait for the ready line — up to **5 minutes** whenever the `npx -y` fallback is what ran (the skill cannot know whether the download is cached; it says "no local install of claude-review-tool — npx may be downloading it (~220 MB on a first run)…" while waiting), 30 s when `npx --no crt` resolved — polling health on the port the ready line names. On `crt: no dev server found …`, ask "Which URL or port is your dev server on?" (free text; "not running yet" as an option), then re-run with `--target`; the server remembers it (F-72). 10 s after readiness, read health again; if `overlay.fetched` is 0, add: "The page loaded but never asked for the overlay, so no CRT button will show. Check view-source for /__crt/overlay.js; if your app is a JS-rendered shell or sends a strict CSP, add the script tag from README › Script-tag fallback and browse http://localhost:3000 instead." Reply, four lines: "CRT is up at http://localhost:4400, proxying http://localhost:3000 (opened in your browser)." / "Project C:\my-app — tasks will be written to .crt\tasks (3 there now)." / "Agent: Claude, logged in." (or the F-74 line) / "Next: click the CRT button bottom-right (or Ctrl/Cmd+Shift+.), Select the element, type a note, Send. Run /crt:tasks when a task lands." plus "(reused the CRT already running)" or "(target came from your answer; remembered in .crt/config.local.json)" when they apply. The skill never starts the dev server.
- **F-84 (Should) Version drift line.** The SessionStart hook, still reading local files only, compares the plugin's `plugin.json` version with `${CLAUDE_PROJECT_DIR}/node_modules/claude-review-tool/package.json` when that file exists and prints one line on a major.minor mismatch: `CRT: plugin 0.3.0 but the project's claude-review-tool is 0.2.0 — npm update claude-review-tool (or crt setup after updating)`. Silent otherwise; never spawns npm; keeps the 5 s timeout and exit 0.

### 6.5 Install and release

- **F-85 (Must) The package ships the plugin.** The build copies `plugin/` and a generated marketplace manifest (name `crt`, `source: ./plugin`, version = package version) into `dist/plugin-marketplace/`; `files` already includes `dist`. CI runs `claude plugin validate` against `dist/plugin-marketplace` and `dist/plugin-marketplace/plugin` as well as the source. `dist/intake.md` and `dist/skills/` keep their current roles.
- **F-86 (Must) `crt setup`.** Idempotent registration of the bundled plugin with Claude Code. Resolves the `claude` CLI on PATH the way `codex` is resolved (PATH and PATHEXT, npm shim parsing — N-10), or the executable given as `--claude <path>`; it does not reuse `providers.claude.command`, whose F-53 meaning ("the agent to run sessions on") does not apply to Claude. Runs `claude plugin list --json`; if `crt@crt` is present at this package's version → `crt setup: crt@crt 0.3.0 is already installed`, exit 0. Otherwise `claude plugin marketplace add <dist/plugin-marketplace>` then `claude plugin install crt@crt` (or `claude plugin update crt@crt` when an older version is present), each with `shell: false`, printing `crt setup: registered marketplace crt from <path>` / `crt setup: installed crt@crt 0.3.0 — restart Claude Code to load /crt:serve, /crt:next, /crt:tasks, /crt:task, /crt:done, /crt:intake`. `claude` missing → `crt: claude not found on PATH — install Claude Code (npm i -g @anthropic-ai/claude-code), or run: claude plugin marketplace add simv/crt && claude plugin install crt@crt` (exit 1). A `claude` command that fails → its first stderr line quoted in one `crt:` line. `crt setup` writes nothing itself; the writes are Claude Code's own (§9 lists this under N-5). The guided start does **not** spawn `claude`; only `crt doctor` and `crt setup` do.
- **F-87 (Must) One version, everywhere it shows.** `packages/server/package.json`, `plugin/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` carry the same version (already the rule); `crt --version` (F-69) and health `version` (F-78) print it. The six skills resolve `crt` as `npx --no crt` first (a project, workspace or global install) and then `npx -y claude-review-tool@<major.minor>` where `<major.minor>` is the plugin's own; a unit test asserts every skill's pinned string equals the manifest version's major.minor, so a release bump that forgets a skill fails `npm run check`. `@latest` appears in no skill.
- **F-88 (Must) README.** Install leads with the two per-machine commands (§4), then per project `crt`; `npm i -D claude-review-tool` is offered for teams that want the version in the lockfile, `npx claude-review-tool` as the zero-install form with the ~220 MB first-run note and a Windows note (`crt.ps1` shim vs PowerShell execution policy: `npx.cmd`/`crt.cmd` work regardless). "The loop" starts with `crt`. The flags table gains the positional target, `--yes`, `--no-open`, `--replace`, and `crt doctor`, `crt setup`, `crt --version`. Troubleshooting opens with "run `crt doctor`" and quotes every new `crt:` line verbatim (a doc test greps for each). The "How it works" diagram is unchanged.
- **F-89 (Must) Release.** The milestone ships as the next minor (`0.3.0`; if CRT-0014 has not shipped `0.2.0` by then, M14 also carries CRT-0014's Asks and its DoD rows are ticked there). Tag, npm publish, GitHub Release per `release.yml`. **Manual (Simon):** `npm i -g claude-review-tool@0.3.0 && crt setup` on a machine (or fresh `CLAUDE_CONFIG_DIR` profile) without the repo yields the six skills.

### 6.6 Tests

- **F-90 (Must) Coverage.** Unit (`packages/server/test`): every §6.1 transcript as a table row over the pure state machine with stubbed probes and a scripted prompt (interactive and `--yes` variants); `normalizeTarget` positional detection; `readConfig` local-over-project for `target`/`port`; `writeLocalConfig` with `target`; `claudePreflight` against fixture outputs of `auth status --json` (`loggedIn` true / false / garbage / non-zero exit / timeout → `"unknown"`); doctor rows and exit code; the overlay-fetch timer; health payload shape; `crt setup` against a fake `claude` installed the way `fake-codex` is (npm shim on Windows, script elsewhere) covering already-installed, older-installed, missing-`claude`, and a failing subcommand; the skill pin test (F-87); the hook drift line. e2e: a second `crt.mjs` started against the same target and scratch project exits 0 with the reuse line and leaves the first serving; a non-CRT listener on the port makes the next start take 4401 and say so; the launcher dot reaches `connected` and shows `unreachable` after the server closes; `window.__crt.welcome()` renders the card with health's values; F-80's line appears when the fixture serves a page that never loads the overlay. The busy-port and F-80 specs start their own servers (a scratch project of their own, `dist/cli.js serve --yes` spawned by the spec with `CRT_SESSION_STUB=1` and stdout captured — never a second `crt.mjs` on a shared scratch root, which would truncate its log). Runners (N-10): unit tests, the fake-`claude` tests included, run on ubuntu and windows on every PR; e2e runs on ubuntu only (the Windows e2e job was dropped from CI on 2026-09-16 — Windows coverage of the shim path is the unit job's), so "both runners" in a DoD refers to unit tests, never to e2e.

## 7. Non-functional requirements

- **N-14 Never hangs, never blocks.** Every prompt has a non-interactive answer (a default, a flag, or a `crt:` line). Interactive prompts wait for the developer and do not time out; the wait loop re-probes every 2 s and returns on the first success. Nothing in the start path waits on a model call; login-unknown never blocks (PRD-providers §12 rule 3 stays).
- **N-15 Second run is instant.** With a remembered target that responds, `crt` prints the ready line within 3 s on a warm machine (root, init, one probe, `auth status`, bind), and the browser opens right after it.
- **N-16 No new network.** N-4/N-12 restated for this surface: the server's start path, `crt doctor`, `crt setup` and the hook talk only to `localhost` (the target probe, the health check on a busy port, the shutdown route) and to the agents' own login and model calls. No registry lookups, no update checks, no version pings — `crt --version` and the hook read local files. The one lookup outside CRT's control is npm's own when a skill falls back to `npx -y claude-review-tool@<major.minor>` (F-87) because no local install exists; the README says so.
- **N-17 Terminal copy rules.** Every stop is one line beginning with the fact and ending with the fix (the console may wrap it; CRT never inserts a line break inside it). Words, not glyphs, for status (`ok`/`warn`/`FAIL`); no colour required for meaning; paths as the OS prints them. New `crt:` lines are listed in F-71, F-73, F-76, F-80, F-86 and quoted in the README verbatim (F-88).

## 8. Milestones

Each milestone is one task file. DoD items are **worker-checkable** unless marked **Manual (Simon)**; the worker ticks what it verified, leaves Manual items unticked, sets `review`, and names the unticked items in its reply.

**M12 — Guided start (`.crt/tasks/CRT-0016`).** F-69, F-70, F-71, F-72, F-73, F-74, F-75, F-76, F-77, F-78, F-79, N-14…N-17, the server half of F-90. DoD: `npm run check` green with every §6.1 transcript as a passing row; `crt doctor` on this repo prints `ok` for node, project, `.crt`, claude (logged in) and `→ claude — …`; `crt 3999` against the e2e fixture starts without a prompt and remembers the target in the scratch project's `config.local.json`; the busy-port e2e (reuse, non-CRT → 4401) passes; **Manual (Simon):** on the trial app folder, `crt` with nothing running asks for the URL, waits while `npx next dev -p 3100` starts, opens the browser, and the second `crt` starts with no question in under 3 s; with a stale CRT on 4400 from another session, `crt` says it reused it (same target) or took 4401 (different target).

**M13 — Arrival (`.crt/tasks/CRT-0017`).** F-80, F-81, F-82, F-83, F-84, the overlay and skill halves of F-90. Depends on M12 (health fields, `--yes`, login). DoD: e2e proves the launcher dot states, the welcome card via `window.__crt.welcome()`, and the F-80 line on a page that never fetches the overlay; `claude plugin validate` passes; the skill contains the health step, the AskUserQuestion fallback and the four-line reply; **Manual (Simon):** in Claude Code on the trial app with no dev server running, `/crt:serve` asks for the port in the chat, starts on the answer, and replies with the four lines; the welcome card appears once on the trial app and not after "Got it"; stopping `crt serve` turns the dot red with the tooltip.

**M14 — Install and release (`.crt/tasks/CRT-0018`).** F-85, F-86, F-87, F-88, F-89, §10 evidence, version bump, tag, publish. Depends on M12 and M13. DoD: `npm run build` produces `dist/plugin-marketplace/` that `claude plugin validate` accepts; `crt setup` against the fake `claude` covers the four cases on both runners; no skill contains `@latest` and the pin test passes; README quotes every new line (doc test); every §10 row ticked with evidence; **Manual (Simon):** `npm i -g claude-review-tool@0.3.0 && crt setup` in a fresh profile yields the six skills, `claude plugin list` shows `crt@crt 0.3.0`, and the release workflow published `0.3.0`.

## 9. Amendments to `docs/PRD.md` v1.0, `docs/PRD-providers.md` and `CLAUDE.md`

| Statement | v0.3 |
|---|---|
| PRD §4 step 1 "Simon runs `/crt:serve` in Claude Code (or `npx claude-review-tool` in the project folder). CRT starts on `http://localhost:4400`…" | replaced by §4 above. |
| PRD §8 Setup experience | replaced by the block in §4 above. |
| F-1 "`crt serve [--target <url>] …` With no `--target` it reads `.crt/config.json`, then probes …" | "`crt [target]` / `crt serve [target]` (`--target` kept). Resolution: positional → `.crt/config.local.json` → `.crt/config.json` → probe of all responders; on a terminal CRT asks when there are several or none (F-71) and remembers the answer per machine (F-72)." |
| F-5 ready line | gains `in <tasksDir>` and `login: ok/missing/unchecked` (F-75); interactive runs add the next-action line; `--open` is the default on a terminal. |
| F-35 `.crt/config.json` | `target` and `port` are also read from `.crt/config.local.json`, which wins; the guided start writes `target` there (F-72). |
| F-36 `/crt:serve` "runs `npx -y claude-review-tool@latest serve --open [--target …]`" | "runs `crt serve --open --yes [--target …]` (resolved per F-87), reuses a CRT already serving the project, asks for the URL when none is found, and reports in four lines (F-83)." |
| F-41 SessionStart hook | may add the F-84 drift line, still from local files only. |
| N-5 "the server never writes outside `.crt/`" | unchanged for the server. `crt setup` causes writes by *Claude Code* to its own plugin store (F-86); listed here as the third documented exception next to the `.gitignore` line and `crt skills install`. |
| N-6 | extended by the lines in F-71, F-73, F-76, F-80, F-86 and the N-17 rules. |
| PRD-providers F-43/F-44 resolution and detection | unchanged rules, new input: Claude's preflight can now fail on `loggedIn: false` (F-74), so a logged-out Claude is demoted when another provider is usable and otherwise resolves as the default with the reason `claude not logged in`; an explicit `--provider`/config choice is still never replaced. F-60's table gains these rows. |
| PRD-providers F-45 `crt providers` | the Claude row's login column shows `logged in` / `not logged in` / `login unknown` (F-74) instead of "unknown until a session starts". |
| PRD-providers F-52 Claude preflight "login is only known once a session starts" | "login is read from the bundled binary's `auth status --json` (F-74); a session start remains the fallback signal." |
| PRD-providers F-57 health "adds `provider`" | health is the F-78 object; `/__crt/providers` rows carry `loggedIn`. |
| PRD-providers N-7 | the F-74 install hint and the F-86 `claude not found` line join the minimum set. |
| PRD §11 rows "`/crt:serve` with no arguments finds the running dev server…" and "`claude plugin marketplace add simv/crt` + `claude plugin install crt@crt` on a clean machine…" | read "…or asks for it once and remembers it (F-71/F-72)" and "…or `npm i -g claude-review-tool && crt setup` (F-86)"; evidence unchanged for the GitHub path. |
| CLAUDE.md "Read `docs/PRD.md` and `docs/PRD-providers.md` before doing anything non-trivial" | "Read `docs/PRD.md`, `docs/PRD-providers.md` and `docs/PRD-setup.md`…" (applied in the PR that adds this document). |
| CLAUDE.md entry points line | add `start.ts` (guided start), `prompt.ts`, `doctor.ts`, `setup.ts` after `serve.ts` (applied by M12/M14). |
| CLAUDE.md `npm run build` line | "…then builds the server (which also copies `plugin/skills/intake/SKILL.md` → `dist/intake.md` and `plugin/` → `dist/plugin-marketplace/`)" (applied by M14). |
| CLAUDE.md Release line | add "and the pinned `claude-review-tool@<major.minor>` in the six skills (F-87)". |

## 10. Definition of done (v0.3 setup)

Ticked by M14 with evidence (test name, e2e spec, task Log entry or run URL).

- [x] `crt` in the trial app folder with the dev server running opens the browser on `:4400` with no flags and no question (M12 Manual). — CRT-0016 DoD Manual row, ticked on Simon's word (Log 2026-09-16T20:08, PR #35); `e2e/start.spec.ts` "`crt 3999` starts with no prompt" for the no-question half.
- [x] With nothing running, `crt` asks once for the URL/port, waits for it, remembers it in `.crt/config.local.json`; the second `crt` asks nothing and is ready in under 3 s (M12 Manual, N-15). — CRT-0016 DoD Manual row (Simon, Log 2026-09-16T20:08); `test/start.test.ts` (every §6.1 transcript, interactive and `--yes`); `e2e/start.spec.ts` (the second run asks nothing and still names 3999).
- [x] A stale CRT on the port is reused (same target/project) or stepped around (4401), and the terminal says which (e2e busy-port tests). — `e2e/start.spec.ts` "a second start on the same target and project exits 0 with the reuse line while the first keeps serving (F-73)", "a non-CRT listener on the port makes the next start take the next port and say so (F-73)", "an explicit --port is never stepped around, and --replace stops the CRT on the port through the shutdown route (F-73, F-79)"; CRT-0016 Log 2026-09-16T17:02 (run 35076281203).
- [x] The ready line carries `login: ok` when logged in and the N-6 line appears at start when not (`claudePreflight` fixtures; M12 Manual after a `claude auth logout`/login round trip if Simon chooses to run one). — `test/providers/claude-preflight.test.ts` (true/false/garbage/non-zero/timeout rows; the false case carries `CLAUDE_NOT_LOGGED_IN`); `e2e/start.spec.ts` asserts `login: unchecked` on the stub ready line; `login: ok` observed on this machine's ready line (CRT-0017 Log 2026-09-16T22:35, real `claude` provider). The logout round trip was not run.
- [x] `crt doctor` exits 1 with the failing row when the target is down, the port is held, or a chosen provider is unusable, and 0 on this repo (unit rows + Log). — `test/doctor.test.ts` (FAIL rows ×9, warn rows ×7, the F-76 sample verbatim); CRT-0016 Log 2026-09-16T16:50 (exit 1 with the held-port row while a parallel server ran) and CRT-0018 Log 2026-09-16T22:45 (exit 0 on this repo with a dev server answering on :8080, every row `ok`, at the pre-bump version; with no dev server up the target row is `FAIL` and the exit 1, as designed).
- [x] The launcher dot and the welcome card show project, target, agent and login; the card appears once per project (e2e + M13 Manual). — `e2e/arrival.spec.ts` (dot `connected` → `unreachable`; `window.__crt.welcome()` and Got it per project); CRT-0017 Manual row (Log 2026-09-16T22:35 on the trial app).
- [x] A page that never fetches the overlay produces the F-80 line in the terminal and the extra sentence in `/crt:serve`'s reply (e2e + M13 Manual). — `e2e/arrival.spec.ts` "a page whose CSP blocks the overlay script …" (the terminal line, `overlay.fetched` 0); `test/serve-skill.test.ts` (the fallback sentence in the skill); CRT-0017 Manual row.
- [x] `/crt:serve` reuses a running CRT for the project and asks for the URL in chat when none is found (M13 Manual). — CRT-0017 DoD Manual row, ticked on Simon's word (Log 2026-09-16T21:40, PR #37); `test/serve-skill.test.ts` pins the health step and the AskUserQuestion fallback.
- [x] `npm i -g claude-review-tool@0.3.0 && crt setup` on a machine without the repo yields the six skills; `crt setup` again says "already installed" (M14 Manual + fake-`claude` unit tests). — Done 2026-09-17 from the published package: `npm i -g --prefix <scratch> claude-review-tool@0.3.0`, `crt --version` → `crt 0.3.0 (agent sdk 0.3.270)`, `crt setup` in a fresh `CLAUDE_CONFIG_DIR` → `registered marketplace crt from <prefix>/node_modules/claude-review-tool/dist/plugin-marketplace` + `installed crt@crt 0.3.0 — restart Claude Code …`, `claude plugin list --json` → `crt@crt 0.3.0` with the six skills, second `crt setup` → `crt setup: crt@crt 0.3.0 is already installed` (CRT-0018 Log 2026-09-17T00:35). Unit half: `test/setup.test.ts` (already-installed, older → `update`, missing `claude`, failing subcommand, `--claude <path>`, writes nothing) on both runners. Pre-release evidence: `crt setup` from this repo's `dist/` in a fresh `CLAUDE_CONFIG_DIR` registered the marketplace, installed `crt@crt 0.3.0` with the six skills, and said `already installed` on the second run (CRT-0018 Log 2026-09-16T22:50). Simon promoted the version on npmjs.com the same night.
- [x] No skill references `@latest`; the pin test passes; `crt --version` and health `version` equal the package version (unit). — `test/skill-pin.test.ts` (three manifests equal, every skill pins `@<major.minor>` after `npx --no crt`, no `@latest`); `e2e/start.spec.ts` "crt --version, crt help and an unknown command (F-69)" and its health assertion `version: VERSION` read from `package.json`.
- [x] README Install is the §4 block; every new `crt:` line is quoted (doc test); Troubleshooting starts with `crt doctor`. — `test/readme.test.ts` (the §4 block, the flags rows, every F-69/F-71/F-73/F-74/F-76/F-80/F-84/F-86 line, Troubleshooting's first sentence).
- [x] CI green on `main`; `v0.3.0` tagged and published; GitHub Release exists. — PR #39 checks green (run 35113109335: check ubuntu/windows, e2e ubuntu); tag `v0.3.0` at 6dca2b1; `release` run https://github.com/simv/crt/actions/runs/35165908676 (success) staged the package and created https://github.com/simv/crt/releases/tag/v0.3.0; Simon promoted it 2026-09-17 — `npm view claude-review-tool version` → `0.3.0`, `dist-tags.latest` → `0.3.0`.

## 11. Risks

| Risk | Mitigation |
|---|---|
| `auth status --json` changes shape or disappears in a later bundled binary | Only `loggedIn` is read; anything else → `"unknown"` (never blocks). The tested binary version is recorded in `providers/claude.ts`'s header; §12 rule 1. |
| `claude plugin list --json` / `marketplace add <path>` differ from what §5.5 assumes | §12 rules 2 and 4: fall back to text parsing or print the two manual commands; never invent flags. |
| Reusing a stale CRT serves a stale *build* in dogfooding (same version string, older `dist/`) | Health `startedAt` is printed on the reuse line; `--replace` is one flag away; `crt doctor` shows the held port. Accepted for a dev tool. |
| The shutdown route lets any local process stop CRT | Stated in the README; page scripts are blocked by the `Origin` rule (N-8); equivalent to what a local process can already do with signals. |
| Prompts on a terminal that lies about being a TTY (some IDE consoles) | `--yes` and `CI` opt out; the wait loop re-probes on its own, so an unanswered prompt still completes once the dev server is up. |
| The welcome card overlaps existing e2e selectors | Suppressed under the `stub` provider (how e2e runs); tests open it explicitly via `window.__crt.welcome()`. |
| Global install on PATH differs per shell on Windows (`crt.ps1` vs `crt.cmd`) | README Windows note (F-88); the skills use `npx --no crt`, which resolves the bin without the shell shim. |

## 12. Verification protocol for the builder

This document was written from one review session's runs and tool documentation. When the installed tool differs:

1. **A flag or output shape differs but the capability exists** (e.g. `auth status` prints `{"authenticated": …}`): use the real one, record the observed shape and version in the module header, keep the fixtures true to it, and proceed.
2. **A capability is missing** (`auth status` absent; `claude plugin list` has no `--json`): `loggedIn: "unknown"` / parse the text output defensively and, failing that, print the manual commands. Do not block; note it in the task Log.
3. **A marketplace added from a local path behaves differently** (name collision with the GitHub one, `install` on an already-installed plugin errors): prefer `update`, then `install`; if neither is idempotent, `crt setup` checks `list --json` first and treats "already present at this version" as success. Record what was observed.
4. **A TTY cannot be detected reliably in some console**: the interactive/non-interactive rule stays as written; document the console and the `--yes` workaround in the README.
5. **The e2e busy-port test is flaky on a runner**: the reuse case must stay; the non-CRT case may bind a listener inside the fixture process rather than a separate one. Never remove the assertion.

## 13. Decisions taken and open questions

**Decisions.**

1. Target is remembered per machine (`config.local.json`), not per project — §5.3.
2. `crt --run` is dropped; a `package.json` `dev` hint replaces it — §3.
3. The lead install is global (`npm i -g`) plus `crt setup`; per-project `-D` is documented for teams; `npx` stays the zero-install fallback. A solo developer reviewing several of their own apps is the PRD §4 user, and one `crt` on PATH is the smoothest path for them.
4. The plugin ships inside the npm package and `crt setup` registers it from disk; the GitHub marketplace stays as an alternative — §5.5.
5. The guided start never spawns the `claude` CLI on PATH (cost, and it is not needed to serve); the one process it starts is the SDK-bundled binary's `auth status` (F-74). `crt doctor` and `crt setup` do spawn the CLI.
6. No update checks or registry lookups by CRT, ever (N-16).
7. Login is checked with `auth status --json` on the bundled binary; a probe session is not used (it would cost a model call per start).
8. `--port` and port fallbacks are never remembered; `port` is set by hand in a config file (F-72). `--target` (the flag) is never remembered either; the positional is.
9. A logged-out Claude is demoted by auto-detection when another provider is usable (F-74, §9); the ready line's reason says why.

**Open questions.**

1. Should the repository go public? npm is already public and `release.yml` wants `--provenance` back when it does. Not required by this document (F-86 works from disk), but it would make the GitHub install path work for everyone. Simon's call.
2. Should the welcome card also appear the first time a *new provider* becomes active (e.g. Codex)? Proposed: no; the Agent menu already shows the row.

---

## Appendix A — Review findings (2026-09-16)

Four reviews were run against `main` 27b3f28, each from one lens, with these facts established first: npm has only 0.1.0; the SDK's platform binary is ~217 MB (measured under `node_modules`); the repo is private (`gh repo view`); the owner's machine has `crt` npm-linked to the workspace and `claude plugin list` shows `crt@crt 0.0.1`; the bundled binary 2.1.270 answers `auth status --json` with `loggedIn` in ~310 ms; `claude plugin` has `marketplace add|list|remove|update`, `install`, `update`, `list --json`, `validate`.

**A.1 First-run walkthrough (three personas: macOS + plugin, Windows 11 + plugin, `npx` only).** Blockers: install step 1 fails for everyone but the owner (private repo); what is installable (0.1.0) is not what is documented (v0.2 + threads). Majors: the `npx` cold start is a silent multi-minute download treated as a 30 s wait by the skill; a stale server on 4400 is unidentifiable and needs a PID hunt; target selection is silent and forgetful (first responder wins, unlisted ports fail, `--target` never persisted); persona 3's first command prints usage. Minors: the README quotes the ready line without the provider suffix; `.crt/` and `.gitignore` writes are unannounced; login unknowable until the first Send and the fix text assumes `claude` is on PATH; PowerShell's default policy blocks `npx.ps1`. → F-69, F-71…F-75, F-85…F-88.

**A.2 CLI interaction design.** Proposed the grammar, the TTY rule, the transcripts, `config.local.json` for the remembered target, health-based diagnosis of a busy port with a shutdown route instead of PIDs, `crt doctor` rows in words, and dropping `--run` with the `dev`-script hint. Adopted with one change: when the port is held by a CRT for *another* target the default is "start on 4401", not "replace", because in this repo a parallel session's server is often the occupant. → F-69…F-73, F-76, F-77, F-79, §5.2, §5.3.

**A.3 Distribution and packaging.** `npx -y …@latest` re-resolves the tag on every skill call (a registry hit per `/crt:tasks`) and downloads 220 MB cold; plugins cannot declare npm dependencies, so a plugin-only install is impossible; `claude plugin list --json` is parseable and `marketplace add` with an existing name replaces it; `crt --version` does not exist and health carries no version; the installed plugin cache is 0.0.1 from an early marketplace commit; the unrelated npm package `crt` (2015, no bin) makes `npx crt` fail, which the `next` skill already anticipates. Recommended a pinned install, `crt setup`, one version rule with a skill pin test, a hook drift line, shipping the plugin in the package as the fallback to a public repo, and a guided `/crt:serve`. Adopted, with the lead install changed from per-project `-D` to global (§13 decision 3). → F-84…F-87, F-83.

**A.4 Arrival in the page and terminal output.** Inventory of invisible state at arrival (provider readiness only on the ready line; login hard-coded unknown; project root and task dir never fetched by the overlay; no signal that the overlay reached the server; the proxied page indistinguishable from the app; no `startedAt` to spot a stale server; terminal silent when injection misses). Proposed the welcome card copy and suppression rules, the launcher dot states, `auth status` as the login pre-check (credential files rejected: undocumented, platform-specific, bypassed by env tokens, and outside `.crt/`), server-side overlay-fetch detection with three lines, the `login:` field and second ready line, and the four-line skill reply. Adopted as written; the non-HTML and strict-CSP lines and "different project" state are Should. → F-74, F-75, F-78, F-80…F-83.
