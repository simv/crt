---
name: serve
description: Start the Claude Review Tool proxy in front of the running dev server and open it in the browser. Use when the user wants to review, annotate, or give in-page feedback on their local site.
argument-hint: "[target-url-or-port]"
disable-model-invocation: true
allowed-tools: Bash(npx *) Bash(curl *) Read AskUserQuestion
---

Start the CRT server for this project (PRD F-36, PRD-setup F-83), from the project root `${CLAUDE_PROJECT_DIR}`. Never start the user's dev server for them: CRT proxies one that is already running.

`crt` below is `npx --no crt` when the project has it installed (a devDependency, a workspace, or a global install), else `npx -y claude-review-tool@0.3`. Remember which one you used: the fallback may have to download the package (~220 MB on a first run), which changes how long you wait in step 2.

## 0. Is a CRT already running for this project?

The port is `port` from `.crt/config.local.json`, else from `.crt/config.json`, else 4400. Run `curl -s http://localhost:<port>/__crt/health`.

- It answers `{"ok":true,…}` and its `projectRoot` equals `${CLAUDE_PROJECT_DIR}` → **reuse it**: skip to step 4 with its `target`, `projectRoot`, `tasksDir`, `tasks`, `provider` and `login`, and end the reply with "(reused the CRT already running)". Do not start another.
- It answers `{"ok":true,…}` for **another** `projectRoot` → a `crt serve` from another session holds the port. Ask (AskUserQuestion): "Port <port> is held by a CRT serving <its projectRoot>. Replace it, or start this one on another port?" with the options **Replace it** (add `--replace` in step 1) and **Use the next port** (add nothing; CRT steps to the next free port and the ready line names it).
- No answer, or not JSON → nothing to reuse; go on.

## 1. Start it

Run **in the background** (the Bash tool's background mode; it keeps running until the user stops it):

```
crt proxy --open --yes                       # no argument: CRT finds the dev server, or remembers the last answer (PRD-setup F-71, F-72)
crt proxy --open --yes --target $ARGUMENTS   # argument given: 3000, localhost:3000 or a full URL
```

`crt proxy` is proxy mode (PRD-embedded F-92: the v0.3 flow; `crt` alone is embedded mode since v0.4 — this skill switches to it in M17). `--yes` makes every prompt take its default (this is not a terminal), `--open` opens the browser once ready.

## 2. Wait for the ready line

The server prints one line:

```
CRT ready at http://localhost:4400 → http://localhost:3000 (proxy; project: C:\my-app, 3 tasks in .crt\tasks, provider: claude (default), login: ok)
```

How long to wait: **30 s** when `npx --no crt` resolved; **up to 5 minutes** when the `npx -y` fallback ran — you cannot tell whether the download is cached, so tell the user meanwhile: "no local install of claude-review-tool — npx may be downloading it (~220 MB on a first run)…". While waiting, poll `curl -s http://localhost:<port>/__crt/health` on the port the ready line names (it may be 4401 when 4400 was held: the ready line always names the port actually bound) — it answers `{"ok":true,"target":…,"projectRoot":…,"tasksDir":…,"tasks":…,"provider":…,"login":…,"overlay":{…}}` once up.

`CRT <version> is already serving … for this project at http://localhost:4400 (since …)` followed by exit 0 means a CRT from an earlier session was reused: report that URL with the "(reused …)" suffix.

## 3. If it stops instead

Relay its single `crt: …` line verbatim (PRD N-6), then:

- `crt: no dev server found on ports …` → ask (AskUserQuestion) **"Which URL or port is your dev server on?"** — free text (3000, localhost:3000 or a URL), with **"not running yet"** as an option. On an answer, re-run step 1 with `--target <answer>`; the server remembers it in `.crt/config.local.json` (F-72), so end the reply with "(target came from your answer; remembered in .crt/config.local.json)". On "not running yet": tell the user to start the dev server and run `/crt:serve` (or `/crt:serve <port>`) again; stop.
- `crt: target <origin> is not responding …` → the remembered or given target is down: say which, and that starting it and re-running `/crt:serve`, or `/crt:serve <port>` for another, fixes it.
- `crt: port <n> is already in use …` → offer `--replace` (step 0) or `port` in `.crt/config.json`.
- `crt: not logged in …` (or `login: missing` on the ready line) → CRT is up but the agent is not: relay the line; the page's welcome card says the same and the first Send will fail until `claude` has completed `/login` (no restart needed).
- `npx` cannot find the package → `npm i -g claude-review-tool` (or `npm i -D claude-review-tool`, or build this repo).

## 4. Ten seconds later, check the overlay reached the browser

After readiness, wait about 10 s and read health again. If `overlay.fetched` is `0`, add to the reply: "The page loaded but never asked for the overlay, so no CRT button will show. Check view-source for /__crt/overlay.js; if your app is a JS-rendered shell or sends a strict CSP, add the script tag from README › Script-tag fallback and browse http://localhost:3000 instead." (with the real target). The server prints the same finding as a `crt: injected the overlay into GET / but the browser never fetched /__crt/overlay.js …` line.

## 5. Reply, four lines

```
CRT is up at http://localhost:4400, proxying http://localhost:3000 (opened in your browser).
Project C:\my-app — tasks will be written to .crt\tasks (3 there now).
Agent: Claude, logged in.
Next: click the CRT button bottom-right (or Ctrl/Cmd+Shift+.), Select the element, type a note, Send. Run /crt:tasks when a task lands.
```

Fill in the real URL, target, project, tasks directory and count from the ready line or health. Line 3 names the provider from the ready line (`Claude` for `claude`, `Codex CLI` for `codex`) and its login: `logged in` for `login: ok`, `login not checked yet` for `unchecked`, and for `missing` the server's `crt: not logged in …` line instead. Append "(reused the CRT already running)" or "(target came from your answer; remembered in .crt/config.local.json)" when they apply, and the step 4 sentence when the overlay was never fetched.
