---
name: serve
description: Start the Claude Review Tool server for the running dev server and open the app in the browser (embedded mode; --proxy to proxy the app instead). Use when the user wants to review, annotate, or give in-page feedback on their local site.
argument-hint: "[--proxy] [target-url-or-port]"
disable-model-invocation: true
allowed-tools: Bash(npx *) Bash(curl *) Read Edit Write Glob Grep AskUserQuestion
---

Start the CRT server for this project (PRD F-36, PRD-embedded F-105), from the project root `${CLAUDE_PROJECT_DIR}`. Never start the user's dev server for them: CRT works alongside one that is already running. In embedded mode (the default since v0.4) the app's own page loads the CRT overlay from the CRT server, so the CRT button appears on the app's own URL; `/crt:serve --proxy [target]` is the v0.3 flow that proxies the app through the CRT URL instead.

`crt` below is `npx --no crt` when the project has it installed (a devDependency, a workspace, or a global install), else `npx -y claude-review-tool@0.7`. Remember which one you used: the fallback may have to download the package (~220 MB on a first run), which changes how long you wait in step 2.

## 0. Is a CRT already running for this project?

The port is `port` from `.crt/config.local.json`, else from `.crt/config.json`, else 4400. Run `curl -s http://localhost:<port>/__crt/health`.

- It answers `{"ok":true,…}` and its `projectRoot` equals `${CLAUDE_PROJECT_DIR}` and its `mode` equals the mode you are about to start (`embedded` unless `--proxy` was given) → **reuse it**: skip to step 4 with its `target`, `projectRoot`, `tasksDir`, `tasks`, `provider` and `login`, and end the reply with "(reused the CRT already running)". Do not start another.
- It answers `{"ok":true,…}` for **another** `projectRoot`, or for this project in the **other mode** → a `crt serve` from another session holds the port. Ask (AskUserQuestion): "Port <port> is held by a CRT serving <its projectRoot>. Replace it, or start this one on another port?" with the options **Replace it** (add `--replace` in step 1) and **Use the next port** (add nothing; CRT steps to the next free port and the ready line names it).
- No answer, or not JSON → nothing to reuse; go on.

## ½. Is the project set up?

When `${CLAUDE_PROJECT_DIR}/.crt/tasks` does not exist, ask (AskUserQuestion): "CRT is not set up in this project. Set it up now? (creates .crt/, two .gitignore lines and a CRT section in CLAUDE.md, then adds one line to your app)" with the options **Yes, set it up** and **Not now**.

- Yes → run the `/crt:init` steps first (`crt init --yes`, then `crt init --snippet --json` and the snippet applied to the one app file it names), then continue here.
- No → stop with "run /crt:init when you want it".

`crt serve --yes` would set the project up too (F-99), but silently accepting that is not this skill's call — the user decides.

## 1. Start it

Run **in the background** (the Bash tool's background mode; it keeps running until the user stops it):

```
crt serve --open --yes                       # no argument: CRT finds the dev server, or remembers the last answer (PRD-setup F-71, F-72)
crt serve --open --yes --target $ARGUMENTS   # argument given: 3000, localhost:3000 or a full URL
```

With `--proxy` (the v0.3 flow — for an app that cannot or should not be touched, PRD-embedded F-92):

```
crt proxy --open --yes                       # proxies the dev server through http://localhost:4400
crt proxy --open --yes --target $ARGUMENTS
```

`--yes` makes every prompt take its default (this is not a terminal), `--open` opens the browser once ready — the app's own URL in embedded mode, the CRT URL in proxy mode.

## 2. Wait for the ready line

The server prints one line (PRD-embedded F-93):

```
CRT ready at http://localhost:4400 for http://localhost:3000 (embedded; project: C:\my-app, 3 tasks in .crt\tasks, provider: claude (default), login: ok)
```

(`for <app>` is missing when no dev server was found; under `--proxy` the line reads `CRT ready at http://localhost:4400 → http://localhost:3000 (proxy; project: C:\my-app, 3 tasks in .crt\tasks, provider: claude (default), login: ok)`.)

How long to wait: **30 s** when `npx --no crt` resolved; **up to 5 minutes** when the `npx -y` fallback ran — you cannot tell whether the download is cached, so tell the user meanwhile: "no local install of claude-review-tool — npx may be downloading it (~220 MB on a first run)…". While waiting, poll `curl -s http://localhost:<port>/__crt/health` on the port the ready line names (it may be 4401 when 4400 was held: the ready line always names the port actually bound) — it answers `{"ok":true,"mode":…,"target":…,"app":…,"projectRoot":…,"tasksDir":…,"tasks":…,"provider":…,"login":…,"overlay":{…}}` once up.

`CRT <version> is already serving this project (embedded) at http://localhost:4400 (since …)` (or `… is already serving … for this project at …` in proxy mode) followed by exit 0 means a CRT from an earlier session was reused: report that URL with the "(reused …)" suffix.

## 3. If it prints a `crt:` line

Relay every `crt: …` line verbatim (PRD N-6). Some are a stop, some are not:

- `crt: no dev server on ports … — start it and open it in your browser; …` (embedded mode) → **not a stop**: CRT is ready for whatever page loads the loader. Relay it and go on; the reply ends with the "no dev server found" suffix (step 5).
- `crt: <origin> (remembered) is not responding — start it; CRT is ready for it` (embedded mode) → not a stop either: say which target is down and that starting it makes the button appear (`/crt:serve <port>` for another).
- `crt: no dev server found on ports …` (proxy mode, exit) → ask (AskUserQuestion) **"Which URL or port is your dev server on?"** — free text (3000, localhost:3000 or a URL), with **"not running yet"** as an option. On an answer, re-run step 1 with `--target <answer>`; the server remembers it in `.crt/config.local.json` (F-72), so end the reply with "(target came from your answer; remembered in .crt/config.local.json)". On "not running yet": tell the user to start the dev server and run `/crt:serve` (or `/crt:serve <port>`) again; stop.
- `crt: target <origin> is not responding …` (proxy mode, exit) → the remembered or given target is down: say which, and that starting it and re-running `/crt:serve`, or `/crt:serve <port>` for another, fixes it.
- `crt: <root> is not set up for CRT — run \`crt init\` (or \`crt --yes\`)` → step ½ was skipped; go back to it.
- `crt: port <n> is already in use …` → offer `--replace` (step 0) or `port` in `.crt/config.json`.
- `crt: your app's CRT loader expects :<port> — …` → the port was stepped: relay it; the fix is `crt --replace` or `port` in `.crt/config.json` and in the snippet.
- `crt: not logged in …` (or `login: missing` on the ready line) → CRT is up but the agent is not: relay the line; the page's welcome card says the same and the first Send will fail until `claude` has completed `/login` (no restart needed).
- `npx` cannot find the package → `npm i -g claude-review-tool` (or `npm i -D claude-review-tool`, or build this repo).

## 4. Ten seconds later, check the overlay reached the browser

After readiness, wait about 10 s and read health again.

- Embedded mode: if `overlay.loader` and `overlay.fetched` are both `0` and an app URL was opened, add to the reply: "The page never loaded the CRT loader, so no CRT button will show — the integration snippet is probably missing: run /crt:init, or /crt:serve --proxy to proxy the app instead." The server prints the same finding as a `crt: opened <app> but the page never loaded the CRT loader — …` line.
- Proxy mode: if `overlay.fetched` is `0`, add: "The page loaded but never asked for the overlay, so no CRT button will show. Check view-source for /__crt/overlay.js; if your app is a JS-rendered shell or sends a strict CSP, run /crt:init and browse http://localhost:3000 instead." (with the real target). The server prints the same finding as a `crt: injected the overlay into GET / but the browser never fetched /__crt/overlay.js …` line.

## 5. Reply, four lines

```
CRT is up at http://localhost:4400 for http://localhost:3000 (embedded; opened in your browser).
Project C:\my-app — tasks will be written to .crt\tasks (3 there now).
Agent: Claude, logged in.
Next: click the CRT button bottom-right (or Ctrl/Cmd+Shift+.), Select the element, type a note, Send. Run /crt:tasks when a task lands.
```

Under `--proxy` the first line reads `CRT is up at http://localhost:4400, proxying http://localhost:3000 (opened in your browser).`

Fill in the real URL, app, project, tasks directory and count from the ready line or health. Line 3 names the provider from the ready line (`Claude` for `claude`, `Codex CLI` for `codex`, `Gemini CLI` for `gemini`, `Antigravity CLI` for `antigravity`, the configured name for `acp`) and its login: `logged in` for `login: ok`, `login not checked yet` for `unchecked`, and for `missing` the server's `crt: not logged in …` line instead. Append "(reused the CRT already running)" or "(target came from your answer; remembered in .crt/config.local.json)" when they apply, `(no dev server found — open your app; the button appears when the page loads)` when none was found, and the step 4 sentence when the loader or overlay was never fetched.
