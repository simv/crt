# Claude Review Tool (CRT) — Product Requirements Document

| | |
|---|---|
| **Status** | Draft v1.0 — approved for build |
| **Owner** | Simon (simv) |
| **Repo** | https://github.com/simv/crt |
| **Last updated** | 2026-09-16 |
| **Amended by** | [`docs/PRD-providers.md`](PRD-providers.md) — v0.2, provider-agnostic intake sessions (F-42…F-64, N-7…N-13, milestones M6–M11). Its §9 lists every statement below that it changes. §6.2a — v0.3, anchored threads (F-65…F-68), amends F-11, F-13, F-14 in place. |

This document is the reference for every CRT build session. A build session should read this file, `CLAUDE.md`, and the task it is working on, and nothing else, to know what "correct" means. Changes to scope go through this document first.

---

## 1. Problem

Simon builds web apps with Claude Code. While browsing the local dev instance of an app he constantly notices things: a misaligned card, a button that should be disabled, a table that needs a column, copy that's wrong. Today capturing that feedback means switching to a terminal, describing the element in words, guessing at what Claude needs to know, and often losing the exact page state that showed the problem. Feedback either gets lost or arrives at Claude with too little context to be worked on independently.

CRT closes that gap. The developer marks up the page they are looking at, talks to Claude *in the page*, and Claude turns the exchange into a self-contained task file in the project repo. Later, any Claude Code session can pick up an untouched task and complete it without needing the person who filed it.

## 2. Goals

1. **Zero-friction capture.** From "I see something" to "Claude has a fully-contextualised task written" in under two minutes, without leaving the browser tab.
2. **Context Claude actually needs.** Every task carries screenshots, URL and route, the exact DOM element(s), the component and source file that renders them, page state, console errors, and the developer's words, so the task can be worked on cold.
3. **Definition of done up front.** No task is written without a concrete, checkable definition of done agreed during intake.
4. **Independent execution.** A single skill (`/crt:next`) picks the next unstarted task and completes it end-to-end, including verification and a PR, without stopping to ask.
5. **Near-zero setup.** Works on any locally served web app. Install the plugin, run one command, browse. No changes to the target app's code are required.
6. **Everything runs against the real project.** Every Claude session CRT starts has `cwd` set to the target project's root and inherits that project's `CLAUDE.md`, settings, plugins, and MCP servers. There is no separate "CRT context".

## 3. Non-goals (v1)

- Not a general-purpose bug tracker, and not a replacement for GitHub Issues. Tasks are Markdown files in the repo; syncing to external trackers is a later integration.
- Not a hosted or multi-user product. One developer, one machine, localhost.
- Not a browser extension. The overlay is injected by a local proxy (or a script tag), which keeps install to one command and avoids store distribution.
- Not a visual design tool. Markup is for *pointing*, not for drawing mockups.
- Not a Claude Code replacement. CRT orchestrates Claude Code via the Agent SDK; it does not implement its own agent loop, tools, or model calls.
- Pixel-perfect screenshots of arbitrary pages (WebGL, cross-origin iframes, canvas) are best-effort in v1.
- Production/remote URLs. v1 targets `localhost` dev servers only.

## 4. Users and primary scenario

**User:** a solo developer (Simon) who already uses Claude Code on a project and has a dev server running.

**Primary scenario ("the loop"):**

1. Simon runs `/crt:serve` in Claude Code (or `npx claude-review-tool` in the project folder). CRT starts on `http://localhost:4400`, proxying his Next.js app on `:3000`, and opens the browser.
2. He browses normally. A small CRT button sits in the bottom-right corner.
3. He sees a problem, clicks the button, chooses **Select** and clicks the offending element (or **Box** and drags a rectangle around a region). A numbered pin appears. He types a note: "this total doesn't include the discount".
4. He clicks **Send to Claude**. The overlay captures the page (screenshot, DOM details, route, state, console) and the panel opens a chat. Claude, running as a Claude Code session with `cwd` = the project, reads the capture, locates the component and source, and replies with what it found, asking at most a couple of questions if something is ambiguous.
5. Simon answers. Claude proposes a definition of done; Simon accepts or edits. Claude writes `.crt/tasks/CRT-0007-cart-total-excludes-discount.md` plus the screenshot assets, and confirms the ID.
6. Simon closes the panel and keeps browsing. Later (same day or next week), in any Claude Code session on that project, he runs `/crt:next`. Claude picks CRT-0007, works it to done, verifies against the DoD, appends its log to the task file, and opens a PR.

## 5. Architecture

CRT is one repo, three deliverables, one npm package plus one Claude Code plugin.

```
Browser tab (http://localhost:4400)
┌──────────────────────────────────────────────────────────┐
│  Target app (proxied from :3000, HMR websocket passthrough)│
│  ┌────────────────────────────────────────────────────┐  │
│  │ CRT overlay (Shadow DOM, injected <script>)         │  │
│  │  • corner launcher • select/box/pin tools           │  │
│  │  • capture engine  • chat panel (SSE/WebSocket)     │  │
│  └───────────────▲───────────────────┬────────────────┘  │
└──────────────────┼───────────────────┼───────────────────┘
                   │ /__crt/*          │
┌──────────────────┴───────────────────▼───────────────────┐
│  crt server (Node 20+, TypeScript)                        │
│  • reverse proxy + HTML injection                          │
│  • capture store (.crt/captures/, then task assets)        │
│  • session manager → Claude Agent SDK query()              │
│      cwd = project root, settingSources = user+project     │
│      systemPrompt = claude_code preset + intake append     │
│  • task store (.crt/tasks/*.md, ID allocation, index)      │
└──────────────────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────┐
│  Claude Code plugin "crt" (skills + hooks)                 │
│  /crt:serve  /crt:next  /crt:tasks  /crt:task  /crt:intake │
└──────────────────────────────────────────────────────────┘
```

### 5.1 Components

**`packages/server` — the `crt` CLI and local server.** Published to npm as `claude-review-tool` with bin `crt`. Responsibilities: detect the target dev server (flag `--target`, `.crt/config.json`, or probe common ports 3000/5173/8080/4200/8000), run an HTTP reverse proxy that rewrites HTML responses to inject the overlay script, pass WebSocket upgrades through untouched (Next.js and Vite HMR must keep working), expose the `/__crt/*` API, manage Claude sessions through the Agent SDK, and read/write the task store. Project root is the nearest ancestor of the launch directory containing `.git` (fallback: the launch directory). It never modifies files outside `.crt/` on its own.

**`packages/overlay` — the in-page UI.** A single bundled JS file, framework-free (or Preact if it materially reduces code), rendered entirely inside a Shadow DOM host so the target app's CSS cannot affect it and vice versa. Responsibilities: launcher button, annotation tools, capture engine, chat panel, permission prompts for the session.

**`plugin/` — the Claude Code plugin.** Installed via a marketplace hosted in this repo (`claude plugin marketplace add simv/crt` then `claude plugin install crt@crt`). Contains skills only (no bundled MCP or binaries), each of which shells out to `npx -y claude-review-tool@latest …` so the plugin never needs its own dependency install.

### 5.2 Why a proxy

The alternatives were a browser extension (store distribution, permissions, harder to inject a chat backend) and a script tag the user adds to their app (requires touching the app, differs per framework). A local reverse proxy needs nothing from the target app, works for any stack that serves HTML over HTTP, and gives the overlay a same-origin API. The cost is a second port and correct WebSocket passthrough, both of which are well understood. A script-tag mode (`<script src="http://localhost:4400/__crt/overlay.js">`) is kept as a documented fallback for apps that misbehave behind a proxy.

### 5.3 Why the Agent SDK

The intake conversation runs as a real Claude Code session via `@anthropic-ai/claude-agent-sdk` `query()` with `cwd` set to the project root, `settingSources: ['user','project','local']` so the project's `CLAUDE.md`, hooks, plugins and MCP servers load exactly as in the terminal, and `systemPrompt: { type: 'preset', preset: 'claude_code', append: <intake instructions> }`. Authentication reuses the machine's existing Claude Code login; no API key is required. Each session is created with an explicit `sessionId` (UUID) so it can be resumed from the terminal with `claude --resume <id>` if the user wants to continue outside the page. The SDK bundles the Claude Code binary for Windows, macOS and Linux as optional dependencies, so a plain `npm install` is sufficient.

## 6. Functional requirements

Requirements are numbered for reference from tasks and PRs. **Must** = required for v1 DoD. **Should** = v1 if time allows, else v1.1.

### 6.1 Serving and injection

- **F-1 (Must)** `crt serve [--target <url>] [--port 4400] [--open]` starts the proxy. With no `--target` it reads `.crt/config.json`, then probes ports 3000, 5173, 8080, 4200, 8000, 3001 and uses the first that responds, printing what it chose.
- **F-2 (Must)** HTML responses (by `Content-Type: text/html`) have `<script src="/__crt/overlay.js" defer></script>` injected before `</head>` (or `</body>`, or appended). Content-Length and compression are handled correctly (decompress → inject → re-serve uncompressed or re-compressed).
- **F-3 (Must)** WebSocket upgrade requests are proxied transparently. Next.js (`/_next/webpack-hmr`) and Vite HMR keep working through CRT; verified by an e2e test.
- **F-4 (Must)** All CRT endpoints live under `/__crt/` and never collide with the target app. The server binds to `127.0.0.1` only.
- **F-5 (Should)** `crt serve` prints a one-line status with target, CRT URL, project root, and task count, and `--open` launches the default browser.
- **F-6 (Should)** Script-tag mode: the overlay can be loaded from an app on any local origin with CORS enabled for `localhost` origins only.

### 6.2 Overlay and annotation

- **F-7 (Must)** A launcher button appears in the bottom-right corner on every page, draggable, with a keyboard shortcut (`Ctrl/Cmd+Shift+.`) to toggle.
- **F-8 (Must)** **Select** tool: hovering highlights the element under the cursor with an outline and a label (tag, id/classes, and component name when detectable); clicking pins it. Keyboard `↑` moves the selection to the parent, `↓` to the first child.
- **F-9 (Must)** **Box** tool: click-drag draws a rectangle; the elements intersecting it are recorded, and the rectangle is a first-class annotation.
- **F-10 (Must)** **Pin** tool: click places a point annotation with no element binding (for "here, something is missing").
- **F-11 (Must)** Each annotation is numbered (1, 2, 3…), has a free-text note, and can be deleted. Multiple annotations form one capture.
- **F-12 (Must)** Annotations survive in-page navigation within the SPA until sent or cleared; a full reload clears them (persisting across reloads via `sessionStorage` is a Should).
- **F-13 (Must)** **Send to Claude** freezes the annotation set, runs capture (6.3), opens the chat panel, and starts an intake session.
- **F-14 (Should)** A "quick note" path: one annotation + note + Send with no conversation; Claude writes the task without a chat unless it has a blocking question, in which case the panel opens.

### 6.2a Anchored threads (v0.3 amendment, 2026-09-16)

Dogfooding showed that the note panel and the chat living under the toolbar, far from the thing being pointed at, and one chat at a time, made the overlay feel like a form rather than a conversation about the page. This amendment moves the conversation to the element and lets several run at once. Where it conflicts with F-11, F-13 and F-14 above, this section wins; the tags stay.

- **F-65 (Must) Anchored popover.** Each annotation owns one popover, positioned next to its element (right, else left, else below, else above the marker; inside the viewport; it follows the element on scroll). Creating an annotation opens its popover with the note textarea focused; clicking a marker's number badge toggles it. At most one popover is open at a time. The popover header shows the number and the F-8 label; its footer holds **Quick note** and the F-56 split **Send to <agent>** button — these no longer live in the toolbar. Sending from a popover captures that annotation alone by default; a checkbox "include the N other unsent annotations" is offered when others exist, so several annotations can still form one capture (F-11).
- **F-66 (Must) Chat in place.** After Send the same popover becomes that thread's chat panel (F-25…F-29, unchanged inside), titled with the annotation's number and label. Closing it hides the popover; the session keeps running. **Discard** (the former "New session") closes the server session and removes the annotation. A reload re-attaches every thread (sessionStorage), so the markers and their states come back.
- **F-67 (Must) Markers persist with state.** Sending no longer clears annotations. A sent annotation keeps its marker; the number badge takes the session state (`starting` / `running` / `waiting` / `idle` / `task` / `error` / `ended`) as a colour, and a pill next to it shows the label (`thinking…`, `needs permission`, `your turn`, the task ID, `error`). Clicking the pill opens the thread. Threads are independent: a second annotation can be sent while the first is still running, and each marker reports its own session. **Clear** removes every annotation and popover but closes no session (they remain in the F-30 list).
- **F-68 (Must) Page-level chat.** A **Chat** toolbar button opens a popover docked above the toolbar with a textarea "Ask <agent> about this page…" and the same Send controls. Sending runs the normal capture with zero annotations and the message as the bundle's `note`; the first message carries it as `Developer's message:` and the intake proceeds unchanged (the agent has the page, console, network and screenshot but no element). The Chat button shows the latest page-level thread's state as a dot; older ones are reachable from the session list, which opens any session in a docked popover.

### 6.3 Capture

The capture bundle is a JSON document plus image files. Everything Claude might need must be gathered *at send time* from the live page, because the session will not have access to the page afterwards.

- **F-15 (Must)** Page: URL, pathname, query, hash, `document.title`, viewport size, device pixel ratio, user agent, timestamp, scroll position.
- **F-16 (Must)** Screenshot of the current viewport with annotation overlays drawn on, plus a clean version, plus a crop per annotation. v1 uses in-page DOM rasterisation (`html-to-image` or equivalent); fidelity is best-effort (Non-goal 3).
- **F-17 (Must)** Per annotated element: a unique CSS selector, XPath, tag, id, class list, `data-*` attributes, ARIA role/label, trimmed text content (≤ 500 chars), bounding rect, and a curated computed-style subset (display, position, size, margin/padding, font, color, background).
- **F-18 (Must)** Component detection: for React dev builds, walk `__reactFiber$*` to collect the component name chain (nearest 5 named function/class components) and, when present, `_debugSource` (file, line). For Vue, `__vueParentComponent`. For others, record "unknown".
- **F-19 (Must)** The outer HTML of each annotated element and of its parent, truncated to 4 KB each.
- **F-20 (Must)** Console: `console.error`/`warn` and uncaught errors since page load (the overlay hooks these at injection time), capped at 50 entries.
- **F-21 (Should)** Failed network requests (status ≥ 400 or errored) since page load via `PerformanceObserver` and a `fetch`/XHR hook, capped at 50.
- **F-22 (Should)** Framework hints: detected framework and version (Next.js via `__NEXT_DATA__`/`next.version`, Vite via `import.meta.hot`, etc.), and for Next.js the matched route pattern when derivable.
- **F-23 (Must)** Captures are written to `.crt/captures/<capture-id>/` (JSON + PNGs) and, once a task is written, moved to `.crt/tasks/assets/<TASK-ID>/`. Unsent or abandoned captures older than 7 days are pruned on server start.

### 6.4 Intake conversation

- **F-24 (Must)** Sending a capture creates a session: `query()` with `cwd` = project root, `sessionId` = new UUID, `settingSources` = user+project+local, Claude Code preset system prompt with the CRT intake instructions appended (`plugin/skills/intake/SKILL.md` is the single source of those instructions), and the first user message containing the capture summary, the developer's notes, the path to the capture bundle, and the screenshot images as image content blocks.
- **F-25 (Must)** The chat panel streams assistant text as it arrives (`includePartialMessages: true`), shows tool activity as collapsed lines ("Read src/components/Cart.tsx"), and supports multi-turn input via streaming input mode.
- **F-26 (Must)** Permissions: the session runs in `default` mode with `canUseTool` routed to the panel. Reads, searches, `git` read commands, and writes under `.crt/` are pre-allowed; anything else prompts in the panel with Allow / Deny. The intake session is expected not to modify source code.
- **F-27 (Must)** The intake behaviour, in order: (1) read the capture and screenshots; (2) locate the rendering component and source file(s) using the selector, component chain, and text; (3) read enough surrounding code to understand how the observed state is produced; (4) ask clarifying questions **only** when the ask or the DoD cannot be pinned down without them, at most three, one message; (5) propose a definition of done as a checklist and wait for confirmation — the proposal ends with the fixed line `Accept as-is, or tell me what to change, and I'll write the task.`, and the panel shows an **Accept** button whenever a turn ends on that line with no task written yet; clicking it sends the reply `Accept`, which the intake treats as confirmation; (6) write the task file and assets; (7) reply with the task ID and path.
- **F-28 (Must)** The panel shows the session ID and a "Continue in terminal" hint (`claude --resume <id>`).
- **F-29 (Should)** Interrupt button (SDK `interrupt()`), and "New session" to discard.
- **F-30 (Should)** A session list in the panel to reopen recent intake sessions for the project.

### 6.5 Task files

- **F-31 (Must)** Tasks live at `<project>/.crt/tasks/<ID>-<slug>.md`. IDs are `CRT-` + zero-padded 4-digit sequence, allocated by scanning the directory for the highest existing ID (no counter file to conflict on). Slugs are ≤ 40 chars, lowercase, hyphenated.
- **F-32 (Must)** File format is Markdown with YAML frontmatter and fixed sections, in this order:

  ```markdown
  ---
  id: CRT-0007
  title: Cart total excludes applied discount
  status: backlog            # backlog | in_progress | review | done | blocked
  priority: normal           # low | normal | high
  created: 2026-09-14T10:32:00+08:00
  updated: 2026-09-14T10:32:00+08:00
  url: http://localhost:3000/cart?promo=SAVE10
  route: /cart
  session: 7a3d…             # intake session id
  tags: [cart, pricing]
  files: [src/components/Cart.tsx, src/lib/pricing.ts]
  ---

  ## Summary
  One paragraph: what is wrong / wanted, in plain language.

  ## Context
  What the page showed, how to reproduce (URL, state, steps), what component renders it, where the logic lives. Links to assets.

  ## Evidence
  ![viewport](assets/CRT-0007/viewport.png)
  ![annotation 1](assets/CRT-0007/ann-1.png)
  Annotation 1 — `<span class="cart-total">` in `CartSummary` (src/components/Cart.tsx:88): "this total doesn't include the discount"

  ## Ask
  The change requested, precisely.

  ## Definition of Done
  - [ ] Checkable item 1
  - [ ] Checkable item 2
  - [ ] Existing tests pass; new test covers the fix

  ## Notes
  Constraints, hunches, non-goals, alternatives considered during intake.

  ## Log
  - 2026-09-14T10:32+08:00 — created by intake session 7a3d…
  ```

  The **Log** section is append-only. Every status change, every work session, every verification result is a new bullet with a timestamp and the session ID that wrote it.
- **F-33 (Must)** `crt tasks` (CLI) lists tasks with ID, status, priority, title; `crt tasks --json` for tooling; `crt task <ID>` prints one. The plugin skills use these rather than parsing Markdown themselves.
- **F-34 (Must)** A generated `.crt/tasks/README.md` index (table of ID / status / title / updated) is rewritten by the server whenever a task changes, so the folder is readable on GitHub. It is never hand-edited.
- **F-35 (Must)** `.crt/` is committed. `crt init` (run automatically by `serve`) creates `.crt/tasks/`, `.crt/config.json`, and adds `.crt/captures/` to `.gitignore`.

### 6.6 Plugin skills

All skills run in the project's own Claude Code session and are namespaced `/crt:<name>`.

- **F-36 (Must)** `/crt:serve [target]` — runs `npx -y claude-review-tool@latest serve --open [--target …]` from `${CLAUDE_PROJECT_DIR}` in the background and reports the URL.
- **F-37 (Must)** `/crt:next` — the worker. Runs `crt tasks --json`, picks the lowest-ID task with `status: backlog` (respecting `priority: high` first), sets it to `in_progress` with a log entry, creates branch `crt/<id>-<slug>` from the default branch, implements the Ask, satisfies every DoD item, runs the project's test/lint/build commands, appends a verification log, sets `status: review`, commits, pushes, and opens a PR whose body is the task's Summary + DoD checklist (checked) + link to the task file. It **does not stop to ask questions**; if it is blocked it sets `status: blocked` with the reason in the Log and exits cleanly. `disable-model-invocation: true` (manual only).
- **F-38 (Must)** `/crt:tasks` — prints the task list with a one-line summary each. `/crt:task <ID>` prints the task and offers next actions.
- **F-39 (Must)** `/crt:intake` — the intake instructions (used by the server as the appended system prompt, and invocable directly in the terminal with a capture path as the argument, for debugging or manual use).
- **F-40 (Should)** `/crt:done <ID>` — marks review → done after the PR merges, appending the PR URL.
- **F-41 (Should)** A `SessionStart` hook that, when `.crt/tasks/` exists and contains backlog tasks, adds one line of context: "CRT: N tasks in backlog, run /crt:next".

## 7. Non-functional requirements

- **N-1** Node ≥ 20 on Windows, macOS, Linux. Windows is the primary dev platform and must be first-class (paths, spawning, line endings).
- **N-2** Time from `Send to Claude` to first streamed token ≤ 5 s on a warm machine (dominated by session start).
- **N-3** The overlay adds ≤ 150 KB gzipped and no measurable jank to the host page when idle.
- **N-4** Nothing leaves the machine except the Claude API calls Claude Code already makes. No telemetry.
- **N-5** The server never writes outside `.crt/` and the OS temp dir; the intake session's write permission is scoped to `.crt/**` by `canUseTool`.
- **N-6** Fails loudly and clearly: unreachable target, no Claude login, no `.git`, port in use — each has a one-line actionable message.

## 8. Setup experience (the whole thing)

```bash
# one-time, per machine
claude plugin marketplace add simv/crt
claude plugin install crt@crt

# per project, per session
cd my-app && npm run dev          # your normal dev server
claude                            # your normal Claude Code session
/crt:serve                        # → http://localhost:4400 opens; browse, annotate, send
/crt:next                         # → picks up the next task and does it
```

Without the plugin, `npx claude-review-tool` in the project folder does the same as `/crt:serve`.

## 9. Repository layout, workflow and CI

```
crt/
├── .claude-plugin/marketplace.json     # marketplace: plugin "crt" → ./plugin
├── plugin/                             # the Claude Code plugin
│   ├── .claude-plugin/plugin.json
│   ├── skills/{serve,next,tasks,task,intake,done}/SKILL.md
│   └── hooks/hooks.json
├── packages/
│   ├── server/                         # npm: claude-review-tool (bin: crt)
│   └── overlay/                        # built into server/dist/overlay.js
├── docs/PRD.md                         # this file
├── .crt/tasks/                         # CRT dogfoods itself: its own tasks live here
├── .github/workflows/{ci,release}.yml
├── CLAUDE.md
└── package.json                        # npm workspaces
```

Workflow: trunk-based on `main` with short-lived branches, Conventional Commits, squash merges, PRs required (branch protection: PR + passing `ci` check, no force-push). CI on every PR and on `main`: install, typecheck, lint, unit tests (Vitest), overlay build, e2e smoke (Playwright: static fixture app behind the proxy → overlay injected → annotation capture JSON has expected shape; a WebSocket echo through the proxy). Release: tag `v*` → build → `npm publish` (needs an `NPM_TOKEN` repo secret, added by Simon) → GitHub Release with notes. Plugin install always tracks `main`; the npm package is pinned by the plugin skill to `@latest`.

Build sessions on CRT itself use CRT's own conventions: work is tracked in `.crt/tasks/` from the first milestone onward, and `/crt:next` is used to drive later milestones once it exists.

## 10. Milestones

Each milestone is shippable and verifiable on its own. Numbers are references, not dates.

**M1 — Skeleton and proxy.** Monorepo, CI, `crt serve` with target detection, HTML injection, WebSocket passthrough, `crt init`, static overlay that only shows the launcher. DoD: Next.js dev app with HMR works through `localhost:4400`; e2e test green.

**M2 — Annotate and capture.** Select / Box / Pin tools, notes, numbering, capture engine (F-15…F-20, F-23), capture saved to `.crt/captures/`. DoD: e2e test asserts capture JSON shape and that a PNG exists; manual test on the trial Next.js app records component names.

**M3 — Intake session.** Session manager on the Agent SDK, chat panel with streaming and permissions, intake skill, task writer, ID allocation, index. DoD: full loop from Send → task file with DoD on the trial app; task file validates against the format; session resumable from terminal.

**M4 — Worker and plugin.** Plugin manifest and marketplace, `/crt:serve`, `/crt:tasks`, `/crt:task`, `/crt:next`, SessionStart hook. DoD: fresh machine install in two commands; `/crt:next` takes a real task from the trial app to a PR without prompting.

**M5 — Hardening and release.** Should-level items with the best value/cost, docs, `npm publish` 0.1.0, release workflow. DoD: section 11 fully checked.

## 11. Definition of done (project)

CRT v0.1 is done when every item below is true and demonstrated on the trial Next.js project. Each tick names its evidence; the full table is in the Log of `.crt/tasks/CRT-0005-m5-hardening-docs-release.md`.

- [x] `claude plugin marketplace add simv/crt` + `claude plugin install crt@crt` on a clean machine yields working `/crt:*` skills. — CRT-0004 DoD 1 (fresh `CLAUDE_CONFIG_DIR` profile, repo not cloned); CI step `claude plugin validate`.
- [x] `/crt:serve` with no arguments finds the running dev server, proxies it with HMR intact, and opens the browser on `localhost:4400`. — `test/target.test.ts` (probe order), `e2e/proxy.spec.ts` (F-3 WebSocket echo), CRT-0001 Log 2026-09-15T08:25 (Next 15.5 HMR through :4400 on the trial app), `openBrowser` in `serve.ts`.
- [x] Select, Box and Pin annotations with notes can be placed, numbered, deleted and sent. — `e2e/capture.spec.ts` "launcher and tools (F-7…F-12)" and "capture and send".
- [x] A capture contains screenshots (viewport + per-annotation), element details, React component chain with source file when available, console errors, and page metadata (all Must items in 6.3). — `test/capture-schema.test.ts`, `e2e/capture.spec.ts` (F-15…F-20, F-22, F-23; React 18 fiber walk), `test/owner-stack.test.ts` (React 19), CRT-0002 Log (trial app, React 19.2 owner stacks).
- [x] Sending opens an in-page chat backed by a Claude Code session whose `cwd` is the project and which has loaded the project's `CLAUDE.md`; text streams; tool use is visible; non-pre-allowed tools prompt in the panel. — `test/session.test.ts` (real SDK: `init` carries our id and cwd), `e2e/chat.spec.ts` (streaming, tool lines, Allow/Deny), CRT-0003 Log manual (1)–(2) on the trial app (`settingSources` user+project+local).
- [x] The intake session reads the source, asks ≤ 3 questions only when needed, proposes a DoD, and writes a task file that conforms to F-32 with assets under `.crt/tasks/assets/<ID>/`. — CRT-0003 Log manual (1) (`SiteHeader.tsx:103-106` read, 6-item DoD, `write_task`, `crt task --validate` clean); `test/tasks.test.ts` `createTask`; `e2e/chat.spec.ts` "write".
- [x] `crt tasks`, `crt task <ID>`, `/crt:tasks`, `/crt:task` work and the index README is regenerated on change. — `test/tasks.test.ts` (`listTasks`, `writeIndex`, `validateTaskText`), CRT-0003 DoD 5, CRT-0004 Log (skills reconciled with the CLI).
- [x] `/crt:next` picks the lowest-ID backlog task, implements it, verifies every DoD item, appends a log, sets status `review`, and opens a PR — with no interactive questions. — CRT-0004 Log: simv/crt#7 (CRT-0006, 32 turns, no questions) and simv/apex#257 (trial app, 80 turns, no questions).
- [x] Every Claude session started by CRT is resumable from the terminal with `claude --resume <id>`. — `test/session.test.ts` (the SDK `init` reports the id CRT chose), CRT-0003 DoD 4 (`claude -p --resume ae269fe2-…` continued the in-page conversation).
- [x] CI (typecheck, lint, unit, build, e2e) is green on `main`; branch protection is on; `v0.1.0` is tagged and published to npm. — CI green on `main` (run 34932424513); ruleset `main-protection` (PR + `check (ubuntu-latest)`, `check (windows-latest)`, `e2e (ubuntu)`, squash only, no force-push); tag `v0.1.0` at 582c8c7, `release` run 34932661658 published `claude-review-tool@0.1.0` and created https://github.com/simv/crt/releases/tag/v0.1.0.
- [x] `README.md` documents install, the loop, the task format, script-tag fallback, and troubleshooting for the N-6 failure cases. — README sections Install, The loop, Task format, Script-tag fallback, How it works, Troubleshooting (CRT-0006 + CRT-0005).
- [x] All Must requirements in section 6 are implemented and referenced by at least one test or a manual verification note in the relevant task's Log. — table in CRT-0005 Log (F-27, F-36…F-39 by manual notes in CRT-0003/CRT-0004; every other Must by a named test).

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| DOM rasterisation screenshots miss content (canvas, cross-origin images, some CSS) | Ship best-effort in v1; capture outerHTML + computed styles as the ground truth; v1.1 evaluates `getDisplayMedia({preferCurrentTab})` for true pixels. |
| React component/source detection depends on dev-build internals (`__reactFiber$`, `_debugSource`) that vary by React version | Detect defensively, degrade to "unknown", and always include selector + text so Claude can grep. Test against React 18 and 19. |
| Proxying breaks some apps (absolute redirects to `:3000`, CSP headers, cookies scoped to port) | Rewrite `Location` headers to the CRT origin; strip/relax CSP for `/__crt/` script; document script-tag fallback (F-6). |
| Agent SDK API drift (pre-1.0, tracks Claude Code releases) | Pin an exact SDK version; isolate all SDK use in one module (`session.ts`) with a thin interface; CI runs a smoke test that starts and ends a session when `CLAUDE_CODE_OAUTH_TOKEN` is available. |
| `/crt:next` "never stops" collides with legitimate need for input | The blocked state exists precisely for this; the skill writes the question into the Log and exits. The DoD is decided at intake so the worker shouldn't need to ask. |
| Windows path and process quirks | Windows is the primary dev machine; CI runs the unit and build jobs on `windows-latest` as well as `ubuntu-latest`. |

## 13. Open questions

1. Should intake sessions be allowed to *fix* trivial things immediately (one-line copy changes) instead of always writing a task? Proposed: no in v1; a task is always written, keeping the loop simple and reviewable.
2. Should `/crt:next` merge its own PR when CI is green? Proposed: no; Simon merges. Revisit after a few weeks of use.
3. Task priority in v1 is manual (frontmatter). Is an "urgent" lane needed in the overlay? Proposed: a priority toggle on Send is cheap; add in M4 if time allows.

## 14. Glossary

**Capture** — the frozen bundle of annotations, screenshots and page context gathered at Send time. **Intake session** — the Claude Code session that turns a capture into a task. **Worker session** — a Claude Code session running `/crt:next`. **Task** — one `.crt/tasks/CRT-NNNN-slug.md` file. **Project root** — the git root of the app being reviewed; every session's `cwd`.
