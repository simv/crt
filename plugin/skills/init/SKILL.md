---
name: init
description: Set the Claude Review Tool up in this project (crt init) and add the one-line CRT integration to the app for the detected framework. Use when the user wants to add, set up or enable CRT in the project, or when /crt:serve found the project is not set up.
allowed-tools: Bash(npx *) Read Edit Write Glob Grep AskUserQuestion
---

Set CRT up in this project (PRD-embedded F-104), from the project root `${CLAUDE_PROJECT_DIR}`: run `crt init`, then apply the snippet it prints to the one app file it names. You edit at most one app file — the snippet target — and you never commit.

`crt` below is `npx --no crt` when the project has it installed (a devDependency, a workspace, or a global install), else `npx -y claude-review-tool@0.6`. The fallback may have to download the package (~220 MB on a first run); say so while you wait.

## 1. Run `crt init --yes`

Run `crt init --yes` from `${CLAUDE_PROJECT_DIR}` and relay every `crt init:` line it prints verbatim (F-100: one line per write — `.crt/README.md`, `.crt/tasks/`, `.crt/config.json`, the two `.gitignore` lines, the CRT section in `CLAUDE.md` / `AGENTS.md` — or `crt init: <root> is set up (…)` when nothing was to do). `--yes` only skips the terminal question; every write is still announced.

If it prints a `crt: …` failure line instead, relay that line verbatim and stop.

## 2. Apply the snippet

Run `crt init --snippet --json`. It answers `{ "framework", "file", "snippet", "import", "usage" }` (F-102) and writes nothing.

Open the named `file` (Read). When `file` is `null`, find the target with Glob: the root layout (`app/layout.tsx`, `src/app/layout.tsx`, `.jsx`/`.js` variants) for `next`, `vite.config.*` for `vite`, the client entry (`src/main.tsx`, `src/index.tsx`, `src/main.jsx`, `src/index.jsx`, `src/main.ts`, `src/index.ts`) for `react` and `bundled`; when several candidates exist, ask (AskUserQuestion) which one is the app's entry.

Grep the file for `claude-review-tool/` and `/__crt/loader.js` **before editing**: when the snippet is already present, say so instead of editing.

Apply the snippet with Edit, by framework:

- **next** — add `import` at the top of the layout (after any `"use client"` / existing imports) and `<CrtDevTools />` as the **last child of `<body>`**, after `{children}` (the `usage` line shows the shape: `<body>{children}<CrtDevTools /></body>`). Keep the body's existing attributes and children.
- **vite** — add `import` at the top of `vite.config.*` and append `crt()` to the `plugins` array (`plugins: [react(), crt()]`); create `plugins: [crt()]` when the config has no `plugins` key. Never add a second `crt()`.
- **react** and **bundled** — add `import` and the `usage` line at the **top of the entry**, right after the existing imports (`import { mountCrt } from "claude-review-tool/loader";` then `if (process.env.NODE_ENV !== "production") mountCrt();`).
- **static** — there is no bundler to hook: tell the user which page to put `<script src="http://localhost:4400/__crt/loader.js"></script>` in (the development page only, first in `<head>`) and stop; edit nothing.

Never touch any other file. Never commit.

## 3. Reply

Reply with:

1. the lines `crt init` printed;
2. the diff of the one app file you edited (or, for `static`, the tag to add and where; or "the snippet is already in `<file>`");
3. the sentence "Development only — production builds contain nothing from CRT.";
4. "Next: `npm run dev`, then /crt:serve."
