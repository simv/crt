# How it works

The pieces — your app with the loader and the overlay, the CRT server on `127.0.0.1:4400`, the agent session and its `write_task` tool — and how they talk in embedded and proxy mode, what the session may do, and what leaves the machine (nothing but the agent's own model calls). Back to the [README](../README.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/architecture-dark.svg">
  <img alt="How CRT fits together: the app with the loader and the overlay, the CRT server on 127.0.0.1:4400, the agent session, write_task, .crt/tasks/" src="images/architecture.svg" width="960">
</picture>

```
Browser tab  http://localhost:3000 ──── your app, on its own origin, served by your dev server
   ├─ CRT loader (the snippet: one dev-only import, or a <script> tag)
   │     installs the console/network hooks, then appends <script src="http://localhost:4400/__crt/overlay.js" defer>
   └─ CRT overlay (Shadow DOM) ──── /__crt/* cross-origin (loopback CORS) ──┐
                                                                            ▼
crt server (Node, 127.0.0.1:4400 only)                       ┌──────────────────────┐
   /__crt/loader.js, /__crt/overlay.js, /__crt/health …      │ agent session        │
   capture store  .crt/captures/ → .crt/tasks/assets/        │ Claude Code (SDK) or │
   task store     .crt/tasks/*.md + README index             │ Codex CLI            │
   session manager ──────────────────────────────────────────▶ write_task tool     │
   landing page at / (proxy mode: your app, proxied)         └──────────────────────┘
```

- **Embedded mode** (`crt`). The CRT server is the agent host: it binds `127.0.0.1:4400`, serves the loader, the overlay and the `/__crt/*` API, and proxies nothing — `http://localhost:4400/` is a landing page that says so and links to your app. Your app's own dev server serves your app; the one dev-only line in it loads the loader from CRT, the loader installs the console/network hooks and appends the overlay script from the running server, and the overlay talks to the API cross-origin. The server allows that only for `localhost`, `*.localhost`, `127.0.0.1` and `[::1]` origins (any port, http or https); every other origin gets no CORS headers and its preflight is refused. `crt` finds your app the way proxy mode does (positional, `--target`, the remembered or configured `target`, then the probed ports) but only to open it and print it; it never waits for it.
- **Proxy mode** (`crt proxy`). The same server, in front of your dev server: it forwards everything, rewrites `text/html` responses to inject the early hook and the deferred overlay script before `</head>`, pipes WebSocket upgrades through untouched so Next.js and Vite HMR keep working, and you browse `http://localhost:4400`. Every CRT route lives under `/__crt/`; nothing else is added to your app. See [Proxy mode](integration.md#proxy-mode).
- **Overlay.** One framework-free bundle (~85 KB, 28 KB gzipped) rendered inside a Shadow DOM host so your CSS and its CSS never meet, always fetched from the running server so it can never be a different version than the server. It is idle until you open it. `window.__crt` is its only global — a debugging/test surface (`window.__crt.loader` is the loader's: its origin and a `retry()`).
- **Intake session.** Send starts a real Claude Code session through `@anthropic-ai/claude-agent-sdk` with `cwd` = your project root (the nearest ancestor with `.git`, else the launch directory), `settingSources` user + project + local, and the Claude Code system prompt with the intake instructions appended (the same text as `/crt:intake`). The first message is the capture summary, your notes, the path to `capture.json` and the screenshots as images. The panel shows only your words for it — your note, or one line per annotation — and folds the rest behind a `Capture` pill; what the agent receives is unchanged. The process boots while the page is still being rasterised so the panel is live within a few seconds. Text streams over SSE; a `write_task` tool exposed by the server allocates the ID, renders the file, moves the assets and regenerates the index, so the file can never drift from the format. When Claude's message ends on the proposal's closing line, the panel folds it to its first paragraph and a `Definition of done · N items` pill that opens the full checklist, and the closing line becomes the **Accept** button; the full text stays in the transcript.
- **Permissions.** The session runs in Claude Code's `default` mode. Reads, searches, read-only `git` commands, CRT's own tool and writes under `.crt/` are allowed silently; `WebFetch`/`WebSearch` are denied; everything else prompts in the panel and is denied after five minutes without an answer. Intake does not modify source code; that is `/crt:next`'s job, in a normal session you can watch.
- **Privacy.** At runtime the server writes only under `.crt/` (and the OS temp dir); `crt init` is the one command that writes elsewhere, and it names every file first. Nothing leaves the machine except the model calls the agent already makes: the loader talks to `127.0.0.1` only, and only from a page on a loopback hostname. Embedded mode changes nothing about what a page can reach: your app's own scripts run on your app's origin and can call the CRT API cross-origin exactly as the overlay does (loopback CORS) — the same capability page scripts had on the proxied origin in proxy mode. There is no new route and no new page-writable key; `/__crt/internal/*` refuses any request carrying an `Origin` header, and the loader carries no token. No telemetry.
