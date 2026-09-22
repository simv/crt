# claude-review-tool

<img alt="CRT — Claude Review Tool" src="https://raw.githubusercontent.com/simv/crt/main/docs/brand/crt-lockup.svg" width="320">

The `crt` CLI for the **Claude Review Tool**: annotate your local site in the browser, talk to Claude (or Codex, Gemini CLI, Antigravity CLI, any ACP agent) in the page, and get a self-contained task file in `.crt/tasks/` that any later Claude Code session can complete with `/crt:next`.

```bash
# one-time, per machine
npm i -g claude-review-tool
crt setup                         # registers the bundled plugin with Claude Code: /crt:init, /crt:serve, /crt:next, …

# one-time, per project
crt init                          # .crt/ (README, tasks, config), 2 .gitignore lines, a CRT section in CLAUDE.md — each announced,
                                  # then it prints the one-line snippet for your framework; /crt:init in Claude Code applies it for you

# per session
npm run dev                       # your dev server, your URL
crt                               # CRT server on :4400; opens your app; the CRT button is on your page
```

Add CRT to your app (development only — production builds contain nothing from CRT):

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

```html
<!-- no bundler — the development page only -->
<script src="http://localhost:4400/__crt/loader.js"></script>
```

What you get:

- A **CRT** button on your app's own URL: Select, Box or Pin what is wrong, write a note, Send — the same popover becomes the chat with a real Claude Code session in your project.
- A task file in `.crt/tasks/` with the screenshots, the element, the console and the failed requests, and a definition of done — committed with the project, workable cold.
- `/crt:next` in any later session takes a task to an open pull request without asking you anything; `/crt:tasks`, `/crt:task`, `/crt:done` keep the list.

Node ≥ 20 on Windows, macOS or Linux; Claude Code installed and logged in (no API key — CRT reuses that login). The plugin ships inside this package, so `crt setup` needs no GitHub access. `npx claude-review-tool` works with no install at all (the first run downloads ~220 MB). `crt doctor` names the fix when something is off.

<img alt="Select armed: the hover outline and label on a price, one pinned marker with its popover and a typed note" src="https://raw.githubusercontent.com/simv/crt/main/docs/images/select.png" width="960">

Documentation — the loop, the four snippets and where each starts capturing, the production guarantee, what lands in your repo, providers, the task format, proxy mode, troubleshooting: https://github.com/simv/crt#readme. MIT.
