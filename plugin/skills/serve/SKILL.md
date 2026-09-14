---
name: serve
description: Start the Claude Review Tool proxy in front of the running dev server and open it in the browser. Use when the user wants to review, annotate, or give in-page feedback on their local site.
argument-hint: "[target-url]"
disable-model-invocation: true
allowed-tools: Bash(npx *) Bash(curl *)
---

Start the CRT server for this project.

1. Run, in the background, from the project root (`${CLAUDE_PROJECT_DIR}`):

   ```
   npx -y claude-review-tool@latest serve --open $ARGUMENTS
   ```

   If `$ARGUMENTS` is empty, omit `--target`; the server detects the dev server itself (PRD F-1).

2. Wait for the line `CRT ready at http://localhost:<port>` (up to 30 s). Report the CRT URL, the target it chose, and the project root it detected, in one line each.

3. If it fails, relay the server's one-line error verbatim (PRD N-6) and stop. Do not try to start the user's dev server for them unless they ask.
