---
name: serve
description: Start the Claude Review Tool proxy in front of the running dev server and open it in the browser. Use when the user wants to review, annotate, or give in-page feedback on their local site.
argument-hint: "[target-url-or-port]"
disable-model-invocation: true
allowed-tools: Bash(npx *) Bash(curl *)
---

Start the CRT server for this project (PRD F-36), from the project root `${CLAUDE_PROJECT_DIR}`.

1. Build the command. `crt` is `npx --no crt` if the project has it installed, else `npx -y claude-review-tool@latest`:

   ```
   crt serve --open --yes                       # no argument: CRT detects the dev server (PRD F-1)
   crt serve --open --yes --target $ARGUMENTS   # argument given: 3000, localhost:3000 or a full URL
   ```

   Run it **in the background** (the Bash tool's background mode). It keeps running until the user stops it.

2. Wait for readiness, up to 30 s: the server prints one line

   ```
   CRT ready at http://localhost:4400 → http://localhost:3000 (project: C:\my-app, 3 tasks in .crt\tasks, provider: claude (default), login: ok)
   ```

   If you cannot read the background output, poll `curl -s http://localhost:4400/__crt/health` (use the port from `.crt/config.json` if it is not 4400; the ready line names the port actually bound, which may be 4401 when 4400 was held); it answers `{"ok":true,"target":…,"projectRoot":…,"login":…}` once up. A line `CRT <version> is already serving … for this project at http://localhost:4400` followed by exit 0 means a CRT from an earlier session is still up and was reused: report that URL.

3. Report three lines: the CRT URL, the target it is proxying, and the project root. Then tell the user to browse the CRT URL, annotate, and **Send to Claude**; tasks land in `.crt/tasks/`.

4. If it exits instead, relay its single `crt: …` line verbatim (PRD N-6) and stop. Typical causes and what to say: no dev server found → start the dev server and re-run `/crt:serve <port>`; port in use → `/crt:serve` after freeing 4400 or set `port` in `.crt/config.json`; `npx` cannot find the package → `npm i -D claude-review-tool` (or build this repo). Do not start the user's dev server for them unless they ask.
