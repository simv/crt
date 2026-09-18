# claude-review-tool

The `crt` CLI for the **Claude Review Tool**: a local CRT server plus an annotation overlay that one dev-only line in your app loads onto your app's own URL (or that `crt proxy` injects into a proxied copy), lets you talk to Claude (or Codex) in the page, and writes self-contained task files to `.crt/tasks/` that any later Claude Code session can complete with `/crt:next`.

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

The plugin ships inside this package (`dist/plugin-marketplace/`), so `crt setup` needs no GitHub access and the plugin version always equals the `crt` version. `npx claude-review-tool` works with no install at all (the first run downloads ~220 MB). `crt doctor` checks node, project, `.crt`, mode, target, integration, instructions, port, agents and plugin when something is off.

Full documentation — install options, the four snippets and where each starts capturing, the production guarantee, what lands in your repo, the loop, providers, the task format, proxy mode, troubleshooting — is in the repository README: https://github.com/simv/crt#readme. Node ≥ 20; Windows, macOS and Linux. MIT.
