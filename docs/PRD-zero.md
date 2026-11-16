# CRT v0.8 — Zero integration: review any app, hand the feedback over — PRD

| | |
|---|---|
| **Status** | Planned — M28–M32 not started (CRT-0049…0053, filed 2026-11-16) |
| **Owner** | Simon (simv) |
| **Repo** | https://github.com/simv/crt |
| **Baseline** | `main` at 2d2b36f = v0.7.2 plus #114 (PRD-chat M25–M27, F-122…F-124) |
| **Amends** | `docs/PRD.md` (§3 Non-goal 3, F-32, F-35, N-4, N-5), `docs/PRD-setup.md` (F-72, F-76), `docs/PRD-embedded.md` (§3 "Moving the tasks directory", F-91, F-94, F-99, F-103, F-105, N-19), `README.md`, the reference pages under `docs/`, `CLAUDE.md`, `.claude/agents/prd-reviewer.md` — every amended statement is listed in §9 |
| **Design inputs** | Simon's two requests of 2026-11-16 (§1); the investigation and prototype of the same day (§5.1; the write-up and `zero-integration-prototype.cjs` in the project's shared files); the loader as built (`packages/overlay/src/loader.ts`), the task store as built (`packages/server/src/tasks.ts`), `crt init` as built (`packages/server/src/init.ts`) |

This document extends `docs/PRD.md`, `docs/PRD-providers.md`, `docs/PRD-setup.md`, `docs/PRD-embedded.md`, `docs/PRD-polish.md` and `docs/PRD-chat.md`. Everything in the six stays in force unless §9 amends it. Requirement IDs continue the numbering (F-125…F-139, N-31…N-36, after PRD-chat F-124 / N-30); milestones are M28–M32 (after PRD-chat M27), one task file each (`.crt/tasks/CRT-0049…0053`). A build session reads the six earlier PRDs, this file, `CLAUDE.md` and its task file, and nothing else, to know what "correct" means. §12 tells the builder what to do when a real browser, `git` or an agent differs from what this document assumes.

---

## 1. Problem and scope

Simon, 2026-11-16, in two messages:

> think about how we can make this work without having to integrate it into app code or anything. i want to be able to use the tool without having to change the source code of the app you're reviewing, or install anything directly in the solution.

> we need to think of a way of collecting and collating the feedback in a way that's easy to pass back to the project you're reviewing so they can be managed. how do we make it easy to collect all the feedback and inject it back into the project to be worked on?

What stands between v0.7 and that:

- **Embedded mode needs the app's cooperation.** One line in the app's source, usually the `claude-review-tool` dependency in its `package.json`, and, when the app has a strict Content-Security-Policy, an edit to that policy so the page may load from `http://localhost:4400` (the trial app, Jack of Clubs, needed all three).
- **Proxy mode needs nothing from the app but changes its URL.** `crt proxy` works on an untouched app today, and since 0.7.2 handles most policies itself. Its cost is the one PRD-embedded §1 names: the app is browsed on `:4400`, so everything it does with its own origin behaves differently, and a policy with a nonce, `'strict-dynamic'` or Trusted Types cannot be relaxed (F-80).
- **Either way the first run writes into the project.** `crt` asks to run `crt init`, which creates `.crt/`, adds two lines to `.gitignore` and a section to `CLAUDE.md` / `AGENTS.md` (F-99, F-100, F-101).
- **Feedback lands in the project one file at a time.** Each Send writes a task straight into the project's `.crt/tasks/`. There is no notion of "this review", no collated view of it, no record of which commit was reviewed, and no step where the project receives the feedback as a whole.

**Scope of v0.8.** (1) **The CRT browser**: `crt` launches Chrome or Edge itself and injects the existing loader over the DevTools protocol, so the CRT button is on the app's own URL with nothing in the app. (2) **Guest start**: `crt` runs in a project that is not set up and writes nothing into it. (3) **Reviews**: feedback is collected in a review kept in the reviewer's home directory, with review-local ids and the reviewed branch and commit on every item. (4) **Collation**: `crt review` shows the review as one page where items are kept, dropped, prioritised and ordered. (5) **Hand-over**: `crt handoff` delivers the kept items to the project in one step, first as task files on a branch with a pull request. (6) Release `0.8.0`.

## 2. Goals

1. **Two commands, zero files changed.** `npm run dev`, then `npx claude-review-tool` in the project folder: a browser window opens on the app's own URL with the CRT button on it. Nothing was added to the app, nothing was installed in it, and nothing was written into the project.
2. **The app's own URL, whatever its policy.** No proxied copy, and no policy the CRT browser cannot work under.
3. **A review is one thing.** Every item filed during a review is in one place, listed on one page, and can be dropped, reprioritised and ordered before the project sees any of it.
4. **One step hands it over.** `crt handoff` puts the kept items into the project as one branch and one pull request whose description is the collated summary; merging it is the moment the project takes the feedback on. `/crt:next` works the items from there with no further step.
5. **The receiver can tell what was reviewed.** Every item names the branch and commit the reviewer was looking at; the hand-over says how far the project has moved since.
6. **Nothing that works today changes.** A project that is set up and carries the integration behaves exactly as in 0.7.2 (N-36); proxy mode keeps every requirement and test.
7. **Nothing new leaves the machine** (N-4 / N-12 / N-16), except what `git push` and `gh pr create` send when the developer runs `crt handoff` to a remote.

## 3. Non-goals (v0.8)

- **A browser extension** (unchanged since v1.0). The CRT browser gets the same result without a second codebase, store review and a version that can drift from the server's. Revisit only when someone needs zero integration in their everyday browser profile and cannot use proxy mode.
- **Firefox and Safari in the CRT browser.** The DevTools protocol is Chromium's; other browsers use the integration or `crt proxy`.
- **Attaching to the developer's running browser.** Current Chrome refuses remote debugging on the default profile; the CRT browser uses its own profile (§5.1).
- **Injection from the dev server** (`NODE_OPTIONS` preloads, hosting-startup assemblies). PRD-setup §3 dropped wrapping the dev server; the same reasons apply.
- **Screenshots over the DevTools protocol.** The connection makes true screenshots possible and would retire the rasteriser's caveats (F-16, CRT-0046, CRT-0047); a later PRD. v0.8 captures exactly as v0.7 does.
- **Hand-over to GitHub issues, or to any other tracker.** The destination list is open by design (F-136); issues need a home for the screenshots and are a later task (Open question 1).
- **A model-written collation.** Grouping and ordering in v0.8 are deterministic (N-29's spirit); the agent pass that proposes merges is a Should (F-135).
- **Changing the intake, the proposal, the worker's steps or the F-32 sections.** The frontmatter gains two keys and a review uses a second id shape; nothing else in the format moves.

## 4. Scenario changes

PRD §4 gains a second scenario beside the one PRD-embedded §4 rewrote:

*Simon is asked to look over an app he has not set up for CRT. He runs its dev server, then `npx claude-review-tool` in its folder. CRT says the project is not set up and that it will keep this review in his home directory, starts the server, and opens a Chrome window on `http://localhost:3000` — the app's own URL — with the CRT button on the page. He browses, selects, notes and sends as always; each proposal he accepts becomes `R-01`, `R-02`, … in the review. `git status` in the project shows nothing.*

*When he is done he runs `crt review`. A page lists the eleven items grouped by route, each with its annotated screenshot. He drops two that turned out to be the same thing as a third, raises one to high, and moves the checkout items to the top.*

*He runs `crt handoff`. CRT prints what it will do — nine task files `CRT-0051…0059` and their assets on a new branch `crt/review-2026-11-16`, pushed, a pull request opened — and asks once. His checkout and his running dev server are not touched. The pull request's description is the collated list. The project's maintainer reads it, merges it, and `/crt:next` starts on the first item.*

PRD §8 "Setup experience (the whole thing)", as amended by PRD-embedded §4, gains the zero-integration form ahead of the per-project block:

```bash
# reviewing an app, nothing added to it
npm run dev                       # the app's dev server, its own URL
npx claude-review-tool            # CRT server on :4400; a browser window opens on the app with the CRT button
crt review                        # the review on one page: keep, drop, prioritise, order
crt handoff                       # the kept items → the project, as one branch and one pull request
```

The per-project block (`crt init`, the one-line snippet) stays as the way to adopt CRT in a project for good: the button in the developer's everyday browser, tasks written straight into `.crt/tasks/`.

## 5. Design

### 5.1 The CRT browser

CRT starts a Chromium-family browser itself and holds a DevTools protocol connection to it for as long as the server runs. For every tab it registers the loader as a script that runs in each new document before any of the page's own scripts, and serves a loopback page's document to the tab without its `Content-Security-Policy` header, so the app's policy does not stop the overlay there and stays enforced everywhere else. From there on the page is in embedded mode exactly as if the app had included the loader: the loader installs the console and network hooks, appends the overlay tag from the running server, and the overlay talks to `/__crt/*` cross-origin under the existing loopback CORS rule. Nothing in the overlay, the API or the session path changes.

**The prototype (2026-11-16).** Against the 0.7.2 build: an app with no CRT integration serving `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-src 'none'`, `crt` in embedded mode with the stub provider, headless Chromium driven by raw protocol calls. With no injection there was no CRT on the page; with the loader injected and the policy enforced the overlay script was refused (`violates … "script-src 'self'"`); with the loader injected and `Page.setBypassCSP` the overlay loaded, the `console.error` from the app's first script was in the capture, a Send wrote `capture.json` and three screenshots and started the intake session, and the overlay was back after a navigation. Not covered by the prototype: a real Chrome or Edge on Windows, the pipe transport, a real agent session.

**As built (M28, 2026-11-16, Chromium 153 over the pipe).** `Page.setBypassCSP` did not survive contact with the real transport: called while a navigation is held it never answers, so it cannot be decided per navigation, and decided per tab it would stay on for a non-loopback page until a reload. The policy is lifted per document instead ("Loopback only" below), which needs no per-tab state and no reload. The paragraphs below describe what was built.

**Transport.** `--remote-debugging-pipe`: the protocol runs over two extra stdio handles of the child process, as NUL-terminated JSON messages. No port is opened, so no other local process can drive the browser, and no WebSocket client is needed — `node:child_process` is enough (N-31).

**Profile.** A dedicated user-data directory per project under the CRT home (§5.3): `<home>/browser/<project-key>/`. Current Chrome ignores remote debugging on the default profile, and a profile per project keeps one app's `localhost` cookies from meeting another's. The consequence is the trade-off of this mode: the window is not the developer's everyday browser, so they sign in to the app once in that profile (it persists) and their personal extensions are absent.

**Injection.** `Target.setAutoAttach` with `waitForDebuggerOnStart` and `flatten`, so every tab — the first and each later one — is prepared before its first document runs: `Page.addScriptToEvaluateOnNewDocument` with the loader source bound to this server's origin, `Fetch.enable` for document responses ("Loopback only" below), then `Runtime.runIfWaitingForDebugger` — the four calls sent together, because a tab the page opened answers the first three only once it is released. The browser starts on `about:blank` and is navigated to the app once its tab is prepared; a new tab is created blank and navigated the same way. The script runs when the document is created, before `document.documentElement` exists. The loader as built throws there (`append()` calls `appendChild` on a null root, and `retry()` then does nothing because `script` is already assigned), so the loader changes: hooks install at once, the overlay tag is appended as soon as the root element exists (F-127). That is earlier than any integration manages today. One exception: a tab the page opens with `window.open` keeps the window of its initial empty document for the first page it loads, and the registered script does not run again there, so CRT evaluates the loader once in that first document — after the page's first scripts, whose console output is then missed; every later document in the tab is ordinary.

**Loopback only.** The loader already does nothing on a non-loopback hostname or inside a frame. The policy is lifted per document, never per tab: every document response is paused in the browser process (`Fetch.requestPaused`, resource type Document, response stage), and a main-frame document on `localhost`, `*.localhost`, `127.0.0.1` or `[::1]` that carries a `Content-Security-Policy` header is served to the tab with the same status and body and without that header (`Fetch.getResponseBody` + `Fetch.fulfillRequest`; the `Content-Encoding`, `Content-Length` and `Transfer-Encoding` headers go with it, because the body is handed over decoded and whole). Every other document — a frame, a non-loopback host, a redirect, a document with no policy — continues untouched (N-32). Because the decision is made for each document before it commits, a tab that goes from a non-loopback page to a loopback one needs no reload. A document served this way has no network address, so the browser's local-network-access check would refuse its requests to the CRT server; CRT grants the app's own loopback origin that one permission (`Browser.grantPermissions`, `loopbackNetwork`). Not reached: a policy in a `<meta>` tag, and a document a service worker serves without the network. The other calls CRT makes: `Target.getTargets` and `Target.createTarget` (a blank tab) to open a URL, `Page.navigate` to load it, `Page.reload` once for a tab that was already on a loopback page when CRT attached (a browser restoring its last session — it loaded without the loader), and `Browser.close` when CRT stops.

**Lifecycle.** The browser belongs to the server process. Closing the window does not stop CRT (`crt: the CRT browser was closed — \`crt browse\` opens it again`); stopping CRT closes the browser, because the pipe closes. `crt browse` against a CRT that is already serving the project asks that server to open the window (`POST /__crt/internal/browse`), since the connection must live in the server.

### 5.2 Guest start

A project is **set up** when `<root>/.crt/tasks/` exists (the F-99 test, unchanged). `crt` in a project that is not set up no longer asks to initialise it and no longer refuses: it starts as a **guest**, says so in one line, and writes nothing under the project root for as long as it runs. Captures, the remembered target, the provider choice and the tasks all go to the CRT home (§5.3). `crt init` stays exactly as it is and becomes the deliberate step that adopts CRT in a repository, not a precondition for using it.

A set-up project keeps today's behaviour: tasks are written straight into `.crt/tasks/`. `--review` (or `"store": "review"` in `.crt/config.local.json` / `.crt/config.json`) makes a set-up project collect into a review too — the reviewer's case on a project that already uses CRT, which the trial app is.

The intake session still runs with `cwd` = the project root, so the agent reads the source for context exactly as today. What changes is where `write_task` writes and which directory the session may read besides the project: the review's directory.

### 5.3 The CRT home and the review store

The **CRT home** is `~/.crt` (`CRT_HOME` overrides it; tests always set it). It is the one place outside a project the server writes at runtime (N-34):

```
~/.crt/
  browser/<project-key>/                 the CRT browser's profile for that project
  reviews/<project-key>/
    project.json                         { root, remote, name }
    config.local.json                    what a guest would have written to .crt/config.local.json (F-72, F-57)
    <review>/                            e.g. 2026-11-16, 2026-11-16-2, or the name given to `crt review new`
      review.json                        the manifest: status, created, items (order, keep, priority), hand-overs
      tasks/R-01-<slug>.md …             F-32 files with review-local ids
      tasks/assets/R-01/…                their screenshots and capture.json
      tasks/README.md                    the generated index
      captures/                          captures not yet turned into items
```

`<project-key>` is the project root's folder name plus a short hash of its absolute path (`jack-of-clubs-3fa9c1`), so two checkouts of one name do not share a review. The **current review** of a project is its newest review whose status is `open`; one is created on the first capture when there is none. A review handed over (§5.5) becomes `handed` and is kept; the next capture starts a new one.

A review's task file is an F-32 file in every respect but two: its `id` is `R-NN` (two digits, growing to three), and it lives outside the project. Every task file — in a review or in `.crt/tasks/` — gains two frontmatter keys, `branch:` and `commit:`, read from the project at capture time (`null` when the project is not a git repository or has no commit); the validator has ignored unknown keys since v0.2, so files stay readable by older versions.

### 5.4 Collation: `crt review`

`crt review` prints the current review as a list and, on a terminal, opens its page: `GET /__crt/review`, served by the CRT server like the landing page (starting the server when none is running for the project). The page lists the items grouped by `route`, each with its title, summary, priority, the annotated screenshot, the reviewed commit, and three controls: **Keep / Drop**, the priority, and **Move up / Move down**. A group can be moved as a whole. Every change is written to `review.json` at once; the task files are not rewritten until hand-over, except `priority:`. Dropped items stay in the review, greyed, and can be kept again. The page states the totals (`11 items · 9 kept · 3 routes`) and offers the hand-over command to copy.

Grouping and ordering are deterministic: groups in the order of their first item, items in the order filed, until the reviewer moves them. A **Should**: a `Suggest merges` action that starts an agent session over the review's task files and proposes which items duplicate each other; accepting a suggestion drops the duplicates and adds a line to the kept item's Notes. No item is ever merged or dropped by the agent alone.

### 5.5 Hand-over: `crt handoff`

`crt handoff` delivers the kept items of the current review. The destination is `--to pr | branch | here | bundle`; the default is `pr` when the project has a remote and `gh` is on PATH, `branch` when it is a git repository without either, `here` otherwise.

For every destination CRT first prints its plan — the items, the ids they will get, the files it will write, the branch and where it will be pushed — and asks `Go ahead? [Y/n]` on a terminal (`--yes` skips the question; off a terminal without `--yes` it refuses with one `crt:` line). Then:

- **`pr` and `branch`.** CRT never touches the developer's checkout: it creates a temporary `git worktree` on a new branch `crt/review-<review>` from the remote's default branch (after a fetch; from `HEAD` when there is no remote), writes the items there, commits (`chore(crt): review <review> — N items`), removes the worktree, and — for `pr` — pushes the branch and runs `gh pr create` with the collated summary as the body. The running dev server sees no file change and no branch switch.
- **`here`.** The items are written into the working tree's `.crt/tasks/`, uncommitted. For the solo developer who is both reviewer and worker.
- **`bundle`** (Should). A folder `crt-review-<project>-<review>/` (`--out <dir>`) holding `REVIEW.md`, the task files and their assets, for a project the reviewer cannot push to.

**Ids are allocated at hand-over.** In the destination's `.crt/tasks/` each kept item, in review order, gets the next free `CRT-NNNN` (the existing allocator, so the project's own ids are never reused): the file is renamed, `id:` rewritten, `assets/R-NN/` moved to `assets/CRT-NNNN/`, the Evidence links rewritten, and the Log gains `— handed over from review <review> (was R-NN) by crt handoff`. The index is regenerated. Hand-over writes `.crt/tasks/**` and nothing else: no `.gitignore` line, no `CLAUDE.md` section, no `.crt/README.md` — those remain `crt init`'s, and the summary says so in one line when the project is not set up.

**The summary** (the pull request body, `REVIEW.md` in a bundle, and what `here` prints): the review's name and dates, the totals, the reviewed commits and how far the base has moved (`reviewed at 4f2a91c on main; the base is 12 commits ahead`), then the items grouped by route in review order — id, priority, title, one-line summary — and how to work them (`/crt:next`, or read the files).

`review.json` records the hand-over (destination, time, the `R-NN → CRT-NNNN` map, the pull request URL) and the review becomes `handed`. Handing a `handed` review over again is refused unless `--again` is given.

### 5.6 What plain `crt` does

`crt` picks how the button reaches the page, in this order, and says which in the ready line:

1. **The integration is present** (the F-103 `integration` row finds it): today's behaviour — the app opens in the default browser.
2. **No integration, a Chromium-family browser found**: the CRT browser.
3. **Neither**: CRT says so and names the two ways forward (`crt proxy`, or install Chrome or Edge), replacing the F-94 dead end.

`crt browse` forces the CRT browser (useful when the integration is present but the app's policy blocks it); `crt proxy` is unchanged; `--no-open` opens nothing in every case. Where the tasks go is independent of how the button got there: set up → `.crt/tasks/`, guest or `--review` → the current review.

### 5.7 What changes where

| Area | Change |
|---|---|
| `packages/server/src/browser.ts` (new) | discovery, launch, the pipe transport, auto-attach, injection, the per-document policy lift, the one-browser-per-server controller (F-125, F-126, F-128) |
| `packages/overlay/src/loader.ts`, `packages/overlay/build.mjs` | early-document tolerance; the injectable form bound to an origin (F-127) |
| `packages/server/src/home.ts` (new) | the CRT home, the project key, the review store, `review.json` (F-130, F-133) |
| `packages/server/src/serve.ts`, `start.ts`, `cli.ts`, `args.ts` | guest start, `--review`, `crt browse`, `crt review`, `crt handoff`, the open decision of §5.6, the ready line (F-128, F-129, F-132) |
| `packages/server/src/tasks.ts`, `write-task.ts`, `sessions.ts`, `captures.ts` | `R-NN` ids, `branch` / `commit`, the store a session writes to (F-134) |
| `packages/server/src/providers/*` | the review directory readable by the session; no other driver change (F-129) |
| `packages/server/src/review-page.ts` (new), `routes.ts`, `proxy.ts` | `/__crt/review` and its API, `/__crt/internal/browse` (F-128, F-135) |
| `packages/server/src/handoff.ts` (new) | the plan, the worktree, id allocation, the summary, the destinations (F-136, F-137) |
| `packages/server/src/doctor.ts`, `landing.ts` | the `browser`, `.crt` and `review` rows; the landing page's guest copy (F-131) |
| `plugin/skills/next/SKILL.md`, `tasks/SKILL.md` | `--review` (Should, F-139) |
| `README.md`, `docs/*.md`, `CLAUDE.md`, `.claude/agents/prd-reviewer.md` | §9 |

## 6. Functional requirements

### 6.1 The CRT browser

- **F-125 (Must) Find and launch the browser.** Resolution, in order: `browser.command` (array: command + args) in `.crt/config.local.json`, `.crt/config.json` or the guest config (§5.3); then the known install locations, Chrome before Edge before Chromium — Windows: `Google\Chrome\Application\chrome.exe` and `Microsoft\Edge\Application\msedge.exe` under `%ProgramFiles%`, `%ProgramFiles(x86)%` and `%LocalAppData%`; macOS: the `Google Chrome`, `Microsoft Edge` and `Chromium` apps under `/Applications` and `~/Applications`; Linux: `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `microsoft-edge` on PATH. Built with `node:path`, never by hand. The launch is `spawn(<exe>, ["--remote-debugging-pipe", "--user-data-dir=<home>/browser/<project-key>", "--no-first-run", "--no-default-browser-check", …browser.command args, <app URL>], { shell: false })` with the two protocol handles as extra stdio pipes. None found → the F-132 fallback, never a failure of `crt` itself. A browser that exits within 3 s of launch, or never answers the first protocol call within 10 s → one line (`crt: <exe> did not accept a DevTools connection (<stderr tail or "no answer">) — set browser.command in .crt/config.local.json, or run \`crt proxy\``) and CRT stays up. Tested: unit rows for the resolution on each platform over an injected filesystem and env; the launch arguments; the two failure lines with a fake executable (`test/helpers/fake-cli.ts`).
- **F-126 (Must) The loader is in every loopback page before its first script.** Per §5.1: every page target, the first and each later tab or window, is prepared before its first document runs; the loader runs in each new main-frame document, bound to this server's origin (the port CRT actually listens on, including a 4401…4409 fallback); a main-frame document on a loopback host is served to the tab without its `Content-Security-Policy` header, and no other document is changed (§5.1, N-32). The first page that loads the overlay this way gets the existing `crt: overlay loaded in the browser (from <origin>)` line. Tested: e2e `browser.spec.ts` with Playwright's Chromium as `browser.command` (headless through its args) on a dedicated server — a fixture page with **no** loader tag under the strict policy of §5.1: the server logs the overlay line and health shows `overlay.fetched ≥ 1`; a `console.error` in the page's first script is in the capture of a Send driven through `window.__crt` over the protocol connection's own `Runtime.evaluate` (a test seam on the browser module); a second tab gets the overlay; unit rows for the protocol framing (split and joined NUL-terminated chunks) and the policy decision per host and per frame; a unit row against a fake browser on the pipe for the order of the preparation calls and the header that is removed.
- **F-127 (Must) The loader tolerates the earliest document.** `mountCrt` called before `document.documentElement` exists installs the hooks at once, appends the overlay tag when the root element appears (one `MutationObserver` on the document, disconnected on first use; no timer — N-20), and leaves `retry()` working when an append failed. An injectable form of the loader exists whose origin is given by the injector, not read from a script tag (the builder chooses between a third build output and a wrapper around `dist/loader.js`); `window.__crt` stays the only global. Size stays ≤ 5 KB gzipped (N-20). Tested: unit rows from `packages/server/test` (the `owner-stack.test.ts` pattern) with a document that has no root yet; the existing loader rows unchanged.
- **F-128 (Must) `crt browse`, and the browser's lifecycle.** `crt browse [target]` ≡ `crt [target]` with the CRT browser forced; when a CRT already serves the project it sends `POST /__crt/internal/browse` (refused with an `Origin` header, like every `/__crt/internal/*` route) and exits 0 with `CRT <version> is already serving this project at <url> — opened the CRT browser on <app>.` One browser per server: a second request focuses nothing and opens a new tab on the app URL in the existing one. The window closing → the §5.1 line once, CRT keeps serving. CRT stopping → the browser is closed, and the stop line reads `Stopping CRT … 1 session ended; the CRT browser was closed; written task files are kept.` `--no-open` never launches it. Usage text, `docs/cli.md`.

### 6.2 Guest start and the review store

- **F-129 (Must) Guest start.** `crt`, `crt serve`, `crt browse` and `crt proxy` in a project without `.crt/tasks/` start without asking and without writing under the project root. One line says so before the ready line: `crt: <root> is not set up for CRT — keeping this review in <home>\reviews\<project-key> (nothing is written to the project; \`crt init\` adopts CRT here).` The ready line's parenthesis reads `(embedded, guest; project: <root>, review 2026-11-16: 0 items, provider: …, login: …)`. `--review [name]` and `"store": "review"` give a set-up project the same store. The intake session's `cwd` stays the project root; the review directory is readable by it (Claude: the SDK's additional-directories option; sandboxed providers: §12 rule 5); writes under the review directory are allowed silently where writes under `.crt/` are today (F-26), and nothing else about the permission policy changes. Health gains `store: "project" | "review"`, `review: string | null` and `guest: boolean`. The welcome card's second sentence reads `Feedback is kept in a review (<n> items) — \`crt review\` shows it, \`crt handoff\` sends it to the project.` in a review. Tested: a start in a scratch project with no `.crt/` under a temp `CRT_HOME`, the line, the ready line, health; a full stub Send; and N-33's snapshot.
- **F-130 (Must) The CRT home.** `home.ts`: `crtHome(env)` = `CRT_HOME`, else `<homedir>/.crt`; `projectKey(root)` = the folder name (lower-cased, `[^a-z0-9-]` → `-`) + `-` + the first 6 hex of the SHA-256 of the absolute root (case-folded on Windows). The layout of §5.3. A guest's F-72 remembered target and F-57 provider choice are written to `<home>/reviews/<project-key>/config.local.json` and read from there with the precedence `.crt/config.local.json` has today. The first write under the home in a run is announced once (`crt: created <path>`). Capture pruning (7 days) runs over the current review's `captures/`. Nothing under the home is ever read from a page: no route serves a path under it except the review page's own assets (F-135). Tested: unit rows for the key, the precedence, the announcement.
- **F-133 (Must) Reviews.** The current review per §5.3; `review.json` `{ name, status: "open" | "handed", created, project: { root, remote }, items: [{ id, keep, order }], handovers: [] }`, written atomically (temp file + rename). `crt review new [name]` starts a new open review (the previous stays `open` and is listed; the newest open one is current); `crt review list` prints every review of the project with its status and counts; `crt review --json` prints the current one for tooling. A name is `[a-z0-9][a-z0-9-]*`, default the local date, suffixed `-2`, `-3` on a clash.
- **F-134 (Must) Review ids, and what was reviewed.** In a review, `write_task` allocates `R-NN` by the same scan-the-folder rule (`R-01` … `R-99`, then `R-100`); `TASK_ID_RE` / `TASK_FILE_RE` and the validator accept both shapes, and `crt task R-03 --review` / `crt tasks --review` read the current review. Every task written by 0.8 — in a review or in `.crt/tasks/` — carries `branch:` and `commit:` (the full SHA) after `route:`, read at capture time from `<root>/.git` (`HEAD`, a ref file or `packed-refs`; no `git` spawn — the server spawns none at runtime) and `null` when there is none; `docs/task-format.md` shows them. A dirty working tree is not detected (Open question 3). Tested: allocation rows; validator rows for both id shapes and for files without the two keys (0.7 files stay valid); the git-reading rows over fixture `.git` directories (a branch, a detached HEAD, packed refs, a worktree's `.git` file, none).

### 6.3 Collation

- **F-135 (Must) `crt review`.** Per §5.4. The CLI prints one line per item in review order — `R-03  high    kept     /checkout   Cart total excludes applied discount` — then the totals and `crt handoff` as the next step; with no review, `crt: no review for <root> yet — run \`crt\`, send some feedback, then \`crt review\``, exit 0. The page at `/__crt/review` (constant in `routes.ts`; colours from `tokens.ts`; framework-free like the landing page; keyboard-operable — every control a real `<button>` or `<select>`) with `GET /__crt/review/items` and `PATCH /__crt/review/items/<id>` (`{ keep?, priority?, move?: "up" | "down" }`; group moves as `PATCH /__crt/review/groups`), all refusing an `Origin` that is not the CRT server's own (the page is served by CRT; an app page has no business editing a review). Screenshots are served from the review's assets by item id and file name only, never by path. Changing the priority rewrites that task file's `priority:` and `updated:` and appends a Log line; keep and order live in `review.json`. Tested: unit rows for the reducers (keep, drop, move within and across groups, group move); route rows for the origin rule; an e2e row that drops one item and raises another and sees both in `crt review --json`. **Should:** `Suggest merges` per §5.4, behind the existing session machinery with the stub scripted for the e2e.

### 6.4 Hand-over

- **F-136 (Must) `crt handoff` to the project.** `crt handoff [--to pr|branch|here] [--review <name>] [--branch <name>] [--yes] [--again]` per §5.5: the default destination rule; the plan and the one question (N-35); the temporary worktree for `pr` and `branch` (created under the OS temp dir with `git worktree add`, removed afterwards on success and on failure; a branch name that exists gets `-2`, `-3`); id allocation and the rewrites; the index; the commit; the push and `gh pr create --base <default branch> --title "CRT review <review>: N items" --body-file <temp file>` for `pr`; the summary; `review.json` updated and the review `handed`. `git` and `gh` are resolved and spawned the way `claude` is for `crt setup` (PATH and PATHEXT, `shell: false`, never a `.cmd` handed to `spawn` — N-10), only from `handoff.ts`, only inside this command. Every failure is one `crt:` line naming what was and was not done (`crt: pushed crt/review-2026-11-16 but could not open the pull request (<gh's line>) — open it with: gh pr create …`), and a failure before the commit leaves no branch behind. With nothing kept: `crt: review <review> has no kept items — nothing to hand over`, exit 0. Tested: against scratch repositories with a bare remote — the branch holds exactly the kept items with consecutive ids after the project's highest, assets moved, links rewritten, `crt task <ID> --validate` green for each, the index current; the developer's checkout has the same `HEAD`, branch and `git status --porcelain` before and after (N-35); `here` writes the same files uncommitted; a fake `gh` (`test/helpers/fake-cli.ts`) receives the title and a body containing the summary; `--again` and the refusal without it; a dropped item is not handed over.
- **F-137 (Should) `crt handoff --to bundle`.** Per §5.5: the folder, `REVIEW.md` with relative links to each item and its annotated screenshot, ids left as `R-NN` (the receiver's `crt handoff --from <folder>` — a later task — or a human allocates), `--out`. No archive format: Node has no zip built-in and a dependency for it is not worth it (CLAUDE.md conventions).
- **F-139 (Should) The worker reads a review in place.** `/crt:tasks --review` lists the current review; `/crt:next --review [R-NN]` works an item straight from it for the solo case — status changes and Log lines are written to the review's file, the branch is `crt/<R-NN>-<slug>`, and the close-out (F-122) is unchanged. The skills resolve the review through `crt tasks --review --json`, never by building a path under the home themselves.

### 6.5 Defaults, doctor, docs and release

- **F-131 (Must) `crt doctor` rows.** Added or changed (F-76 style): `ok    .crt      guest — not set up; this review is kept in <home>\reviews\<key> (crt init adopts CRT here)` replaces the `FAIL` / `warn` for a missing `.crt/tasks`; `ok    browser   Chrome 142 at C:\Program Files\Google\Chrome\Application\chrome.exe (CRT browser)` / `--    browser   none found — the integration or \`crt proxy\`` (the version from the executable's `--version`, 3 s cap, `unknown` on a timeout); `ok    review    2026-11-16 — 11 items, 9 kept` / `--    review    none`; the `integration` row's advice gains `or run \`crt\` — it opens the CRT browser`. `GET /__crt/doctor` serves the same rows (PRD-polish F-113); the landing page's "your app has not loaded the loader" state gains the CRT browser as the first suggestion.
- **F-132 (Must) Plain `crt` picks.** Per §5.6, with the decision a pure function of `{ integration, browser, mode, open }` (unit-tested, the `start.ts` pattern). The ready line names it: `(embedded; …)` as today with the integration, `(embedded, CRT browser; …)` otherwise. With neither: `crt: no CRT integration in this app and no Chrome or Edge found — run \`crt proxy\`, or set browser.command in .crt/config.local.json` and CRT stays up for a page that loads the loader later. The F-94 line fires only in case 1 (the integration was found but the page never asked for the loader) and gains `, or run \`crt browse\``.
- **F-138 (Must) Docs and release 0.8.0.** README: the front page leads with the zero-integration block of §4, and "Add CRT to your app" becomes the way to keep CRT in a project for good (still ≤ 200 lines, PRD-polish F-115); `docs/cli.md` (the new commands and flags, the guest line, the ready lines), `docs/how-it-works.md` (the CRT browser, the home, what is written where, the policy bypass and what it hides), `docs/integration.md` (when to add the integration at all), `docs/task-format.md` (`branch`, `commit`, `R-NN`), `docs/troubleshooting.md` (the browser failure lines, a hand-over that stopped half-way), a new reference page `docs/review.md` (the review, the page, the hand-over) — nine reference pages, `test/docs.test.ts` and the CI `changes` filter updated together. §9 rows applied and §10 ticked with evidence; version `0.8.0` in `packages/server/package.json`, both plugin manifests and the seven skills' pin (`claude-review-tool@0.8`; `test/skill-pin.test.ts`); `npm run screenshots` re-run (the landing page changed; a sixth image, `review.png`, of the review page is added to the spec and the README); `v0.8.0` tagged, the release workflow green, the staged version promoted on npm (Simon).

## 7. Non-functional requirements

- **N-31 No new runtime dependency, no listening debug port.** The CRT browser is driven with `node:child_process` and the pipe transport; `--remote-debugging-port` is never passed; `packages/server/package.json` gains no dependency in v0.8.
- **N-32 Loopback only, and only what is needed.** In the CRT browser the loader has no effect on a page whose hostname is not loopback (already true, F-96), and a `Content-Security-Policy` header is removed from no response but a main-frame document's on a loopback host. CRT reads nothing from the browser but target URLs and document responses (the body only of a document it re-serves), sends it nothing but the calls of §5.1, and evaluates no script in a page except the loader (the e2e seam of F-126 is test-only and absent from the CLI's surface). Nothing of an app's response is changed but that header and the three transport headers that no longer describe the re-served body; status, body and every other header — cookies included — arrive as sent.
- **N-33 A review leaves the project untouched.** From `crt` starting as a guest (or with `--review`) until `crt handoff`, no file or directory under the project root is created, modified or deleted by CRT or by the intake session. Tested: a recursive listing with sizes and mtimes of a scratch project before and after a start, a stub Send that writes a task, `crt review` and a stop — identical.
- **N-34 One home.** At runtime the server writes only under `.crt/` of a set-up project, the CRT home, and the OS temp dir (N-5 restated, §9). The first creation under the home is announced. The home holds nothing secret of CRT's own; the browser profile holds the cookies of whatever the developer signed in to in the CRT browser, which is why it is per project and never leaves the machine.
- **N-35 Hand-over says first, and is the only way in.** `crt handoff` is the only command that moves review items into a project. It prints its plan before any write and asks once on a terminal; for `pr` and `branch` the developer's working tree, index, current branch and stashes are byte-for-byte untouched; it never force-pushes, never merges, never pushes to a branch it did not create in this run; it writes `.crt/tasks/**` and nothing else.
- **N-36 What worked in 0.7.2 works the same.** A set-up project with the integration: the same ready line, the same browser (the default one), the same files written, the same task ids. Proxy mode: every requirement keeps its ID, its tests and its behaviour. The intake message, the proposal and the task sections are unchanged (PRD-chat N-28 holds). `e2e/embedded.spec.ts`, `proxy.spec.ts` and `chat.spec.ts` pass without edits other than the ready-line and doctor strings §9 names.

## 8. Milestones

Each milestone is one task file. DoD items are **worker-checkable** unless marked **Manual**; by the standing rule of 2026-09-18 the worker session runs the Manual rows itself and involves Simon only on a failure or when a step is user-only. Order: M28 and M29 are independent and may run in either order; M30 and M31 need M29 and are independent of each other; M32 needs all four.

**M28 — The CRT browser (`.crt/tasks/CRT-0049`).** F-125, F-126, F-127, F-128, N-31, N-32. `browser.ts`, the loader change and its injectable form, `crt browse`, `/__crt/internal/browse`, the lifecycle lines, the unit rows and `e2e/browser.spec.ts`. M28 does not change what plain `crt` opens (that is M32). DoD: `npm run check` and `npm run e2e` green; the loader's gzipped size before and after in the Log; **Manual**: on Windows with real Chrome and real Edge, `crt browse` on the trial app without its integration loaded and with its strict policy as committed — the button appears on `:3000`, a Send reaches a real Claude session, a second tab works, closing the window and stopping CRT behave per F-128; the browser versions in the Log.

**M29 — Guest start and the review store (`.crt/tasks/CRT-0050`).** F-129, F-130, F-133, F-134, N-33, N-34. `home.ts`, the guest path through `serve.ts` / `start.ts`, `--review`, `R-NN` ids, `branch` / `commit`, the session's readable directory, the health and welcome-card fields. DoD: `npm run check` and `npm run e2e` green; the N-33 snapshot row; **Manual**: `crt proxy` as a guest in a fresh clone of a real project with a real Claude session — an accepted proposal lands as `R-01` under the home with its screenshots, `git status` in the project is empty; the same with Codex when it is installed (§12 rule 5).

**M30 — Collation (`.crt/tasks/CRT-0051`).** F-135. The CLI list, the page, its routes and reducers. DoD: `npm run check` and `npm run e2e` green; the page keyboard-operable (an e2e row); **Manual**: a review of five or more real items on the trial app, dropped, prioritised and reordered on the page; a screenshot in the Log.

**M31 — Hand-over (`.crt/tasks/CRT-0052`).** F-136, F-137, F-139, N-35. `handoff.ts`, the three Must destinations, the bundle and the worker's `--review` as Shoulds. DoD: `npm run check` and `npm run e2e` green; the N-35 before/after row; `claude plugin validate ./plugin` green when the skills changed; **Manual**: a review of the trial app handed over as a real pull request on its repository from a checkout with uncommitted changes and a running dev server — the checkout and the server undisturbed, the pull request readable on GitHub, `/crt:next` picks the first item up after the merge; the pull request URL in the Log.

**M32 — Defaults, docs, release 0.8.0 (`.crt/tasks/CRT-0053`).** F-131, F-132, F-138, N-36, the §9 rows not yet applied, §10 evidence. Depends on M28–M31. DoD: versions and pins `0.8.0` / `@0.8`; `npm run screenshots` re-run; `v0.8.0` tagged; the release workflow green; promoted on npm (**Manual (Simon)** — with the tag push, the user-only steps); **Manual**: goal 1 end to end from the published package on a project that has never seen CRT — `npm run dev`, `npx claude-review-tool`, a Send, `crt review`, `crt handoff` — with `git status` empty until the hand-over; every §10 row ticked with evidence.

## 9. Amendments to the earlier PRDs, the docs and `CLAUDE.md`

Each row names the milestone that applies it; the `*v0.8: …*` notes inline in the earlier PRDs are written by M32, the way M27 wrote the `*v0.7: …*` notes, unless a row says otherwise.

| Statement | v0.8 |
|---|---|
| PRD §3 Non-goal 3 "Not a browser extension. The overlay is injected by a local proxy (or a script tag)…" | still not an extension; a third way joins the integration and the proxy: CRT launches a browser and injects the loader over the DevTools protocol (F-125, F-126) (M28). |
| PRD F-32 frontmatter; `docs/task-format.md` "Tasks live at `.crt/tasks/CRT-NNNN-<slug>.md`" | `branch:` and `commit:` follow `route:`; in a review the id is `R-NN` and the file lives under the CRT home until hand-over (F-134) (M29). |
| PRD F-35 "`.crt/` is committed. `crt init` …" | unchanged for a set-up project; a project that is not set up is reviewed as a guest with nothing written to it (F-129), and receives `.crt/tasks/**` only through `crt handoff` (F-136) (M29, M31). |
| PRD N-4 / PRD-providers N-12 / PRD-setup N-16 "Nothing leaves the machine except…" | restated: plus what `git push` and `gh pr create` send when the developer runs `crt handoff --to pr` and answers yes (M31). The CRT browser is a browser: its own traffic is its own, as the default browser's is today (M28). |
| PRD N-5 "The server never writes outside `.crt/` and the OS temp dir" | "… outside `.crt/`, the CRT home (`~/.crt`, `CRT_HOME`) and the OS temp dir" (N-34) (M29). |
| PRD-setup F-72 "written to `.crt/config.local.json`" | for a guest, to `<home>/reviews/<project-key>/config.local.json` (F-130) (M29). |
| PRD-setup F-76 / PRD-embedded F-103 doctor rows | the `.crt`, `browser` and `review` rows of F-131 (M32). |
| PRD-embedded §3 "Moving the tasks directory … Open question 2" | answered for reviews: the store is chosen by the server (project or review), and the skills reach a review through `crt tasks --review --json` (F-139); `tasksDir` itself is unchanged (M29, M31). |
| PRD-embedded F-91 landing page "the CRT button appears there once your app includes the CRT integration" | "… — or run `crt browse` and CRT opens a browser with the button already there" (F-131) (M32). |
| PRD-embedded F-94 "`crt: opened … but the page never loaded the CRT loader — add the integration …, or run \`crt proxy\``" | fires only when the integration was found; gains `, or run \`crt browse\``; without an integration plain `crt` opens the CRT browser instead (F-132) (M32). |
| PRD-embedded F-99 "`crt`, `crt serve` and `crt proxy` create nothing. When `<root>/.crt/` has no `tasks/` directory: interactive → … `Set up CRT in C:\my-app? [Y/n]` …; non-interactive without `--yes` → … exit 1" | they still create nothing in the project, and no longer ask or refuse: they start as a guest (F-129). `--yes` no longer runs `crt init`. `crt init` and `/crt:init` are unchanged (M29). |
| PRD-embedded F-105 `/crt:serve` step ½ "CRT is not set up in this project. Set it up now?" | the skill no longer asks: it starts CRT as a guest and says in its report that `/crt:init` adopts CRT in the project (M32). |
| PRD-embedded N-19 "The server at runtime … writes only under `.crt/` … and creates `.crt/` never" | "… writes only under `.crt/` of a set-up project and under the CRT home"; `crt handoff` is a second announced writer beside `crt init`, limited to `.crt/tasks/**` and to its printed plan (N-35) (M29, M31). |
| `CLAUDE.md` "Read `docs/PRD.md`, … and `docs/PRD-chat.md`" | "… `docs/PRD-chat.md` and `docs/PRD-zero.md`" with the seventh's one-line description (applied in the PR that adds this document). `.claude/agents/prd-reviewer.md` reads this document's §6, §7 and §9 too and knows F-125…F-139 / N-31…N-36 live here (same PR). |
| `CLAUDE.md` "What this is", entry points | the CRT browser as the third way the overlay reaches a page; `browser.ts`, `home.ts`, `review-page.ts`, `handoff.ts` (each by the milestone that adds the file). |
| `CLAUDE.md` Don'ts "Don't write outside `.crt/` from the server at runtime. `crt init` is the only command that writes `.gitignore`, `CLAUDE.md` or `AGENTS.md` …" | "Don't write outside `.crt/` and the CRT home (`~/.crt`) from the server at runtime. …"; a line: "`crt handoff` is the only command that moves review items into a project, and it writes `.crt/tasks/**` only (PRD-zero N-35)." (M29, M31). |
| `.claude/agents/prd-reviewer.md` invariants: writes "only under `.crt/` and the OS temp dir"; spawns "outside `providers/` — except the browser opener in `serve.ts`" | the CRT home joins the allowed write roots (M29); `browser.ts` (the browser) and `handoff.ts` (`git`, `gh`) join the allowed spawners, `shell: false` as everywhere (M28, M31). |
| README front page; `docs/cli.md`, `how-it-works.md`, `integration.md`, `task-format.md`, `troubleshooting.md`; "the eight reference pages" in `CLAUDE.md` and the CI filter | F-138: the zero-integration block first; `docs/review.md` makes nine (M32; each earlier milestone adds its own commands to `docs/cli.md`). |
| `CLAUDE.md` Commands "regenerates the five README screenshots" | six, with `review.png` (M32). |

## 10. Definition of done (v0.8)

Ticked by M32 with evidence (test name, e2e spec, task Log entry or run URL).

- [ ] On a project that has never seen CRT, `npm run dev` then `npx claude-review-tool` opens a browser on the app's own URL with the CRT button, with real Chrome and real Edge on Windows (M28, M32 Manual).
- [ ] The CRT browser works under a strict policy the integration and the proxy cannot (a nonce, `'strict-dynamic'`), and a policy is removed from no document but a loopback main-frame one (F-126, N-32; e2e + unit).
- [ ] Console errors logged by the app's first script are in the capture (F-127; e2e).
- [ ] No new runtime dependency and no listening debug port (N-31; `package.json` diff, the launch-arguments row).
- [ ] A whole review — start, several Sends, `crt review`, stop — creates, modifies and deletes nothing under the project root (N-33; the snapshot row + M29 Manual).
- [ ] Every item carries `branch` and `commit`; 0.7 task files still validate (F-134; unit).
- [ ] `crt review` lists the review, and its page keeps, drops, prioritises and orders items by keyboard and by pointer (F-135; e2e + M30 Manual).
- [ ] `crt handoff` produces one branch and one pull request holding exactly the kept items with fresh `CRT-NNNN` ids, assets and index, leaving the developer's checkout and dev server untouched; `/crt:next` works the first item after the merge (F-136, N-35; unit + M31 Manual).
- [ ] A set-up project with the integration behaves as in 0.7.2; proxy mode's specs pass unchanged but for the strings §9 names (N-36; `e2e/embedded.spec.ts`, `proxy.spec.ts`).
- [ ] The README leads with the zero-integration flow; `docs/review.md` exists; the six screenshots are current (F-138).
- [ ] CI green on `main`; `v0.8.0` tagged, published and promoted; the GitHub Release names M28–M31 (M32).

## 11. Risks

| Risk | Mitigation |
|---|---|
| Developers do not want a second browser window, or need their extensions and saved logins | The integration and proxy mode both remain; plain `crt` only chooses the CRT browser when no integration is present (§5.6); the profile persists, so the sign-in is once per project. |
| Browser vendors tighten debugging flags again | The pipe plus a dedicated profile is what Puppeteer and Playwright depend on, so it is the least likely path to be removed; M28's Manual row runs on real Chrome and real Edge; F-125's failure line points at `browser.command` and `crt proxy`. |
| Lifting the policy hides the app's own CSP violations from the developer while they use the CRT browser | Stated in `docs/how-it-works.md` (F-138); only the header of a loopback main-frame document is removed (N-32); the integration and `crt proxy` keep the app's policy for a developer who needs it enforced. |
| A sandboxed provider (Codex) cannot read the capture bundle outside its `cwd` | §12 rule 5; M29's Manual row runs it; the fallback keeps the project untouched. |
| A review goes stale before it is handed over | `branch` and `commit` on every item (F-134); the summary states how far the base has moved (§5.5); the receiving worker reproduces before it builds, as `/crt:next` already requires. |
| The hand-over stops half-way (the push is refused, `gh` is not logged in) | Each step's failure is one line that says what exists and gives the next command (F-136); nothing is half-written in the developer's checkout because nothing is written there (N-35); the review stays `open` until the destination's last step succeeds. |
| Two CRT servers for one project share a review | Ids are allocated by scanning the folder with the existing retry on a clash (`createTask`); `review.json` is written atomically; last writer wins on order, which is acceptable for one reviewer. |
| The home grows without bound (profiles, old reviews) | `crt doctor`'s `review` row names the store; `docs/review.md` says what is safe to delete; pruning anything but captures is Open question 2. |

## 12. Verification protocol for the builder

1. **A protocol method or flag differs from §5.1 but the capability exists** (another auto-attach option, a renamed flag): use the real one, record the browser and version in `browser.ts`'s header and the task Log, proceed. Do not add a dependency to paper over it (N-31).
2. **The pipe transport does not work on some platform or browser** (Windows handle inheritance, a Chromium fork): stop and report in the task Log with the evidence. Do **not** fall back to `--remote-debugging-port` on your own — an open debug port is a different security posture and needs a PRD change.
3. **The policy cannot be lifted the way §5.1 first said** (met in M28: `Page.setBypassCSP` never answers while a navigation is held, and `Fetch.continueResponse` with the header dropped leaves the page enforcing it): lift it per document by re-serving the paused response without the header, as §5.1 now describes, and record the browser version in `browser.ts`'s header and the Log. Never lift the policy for a non-loopback document, and never switch enforcement off for a whole tab, to make this simpler (N-32).
4. **The browser shows an infobar or a first-run page** in the dedicated profile: suppress it with documented flags where one exists, otherwise leave it and say so in `docs/how-it-works.md`; never pass `--enable-automation` or `--disable-web-security`.
5. **A sandboxed provider cannot read the review directory** (it lies outside the session's `cwd`): first try the provider's documented way to add a readable directory; failing that, for that provider only, hand it the capture bundle through the OS temp dir (already an allowed write root) and keep `write_task` on the server as the only write path. Never place captures in the project to make this work (N-33). Record what the provider needed in `docs/providers.md`.
6. **`.git` is a shape the F-134 reader does not handle** (a reftable repository, an unusual worktree layout): write `branch: null`, `commit: null`, log the shape once (`crt: could not read the current commit from .git (…)`), and add the fixture; do not spawn `git` from the server at runtime.
7. **`git worktree` is unavailable or refuses** (a very old git, a bare-less setup): `crt handoff` says so in one line and offers `--to here`; it never checks a branch out in the developer's working tree as a fallback (N-35).
8. **`docs.test.ts`, the CI `changes` filter or `skill-pin.test.ts` pins something a §9 row changes**: change the pin and the statement together in the same commit, keeping every other pinned string (PRD-chat §12 rule 6).

## 13. Decisions taken and open questions

**Decisions** (the builder does not revisit these):

1. **A launched browser, not an extension, and not a better proxy** (§3; the investigation of 2026-11-16 compared the five ways and prototyped this one).
2. **The debugging pipe and a per-project profile under the CRT home**; never a debug port, never the developer's default profile (§5.1, N-31).
3. **A review lives outside the project until `crt handoff`** — Simon, 2026-11-16: the feedback is collected and collated first, then passed back to the project to be managed. Task files are still the unit, unchanged in format, and still end up in `.crt/tasks/`.
4. **Ids are review-local (`R-NN`) until hand-over**, when the project's own allocator assigns `CRT-NNNN`; the Log line keeps the trail (§5.5).
5. **The first hand-over destination is task files on a branch with a pull request**, written through a temporary worktree so the developer's checkout is never touched (§5.5, N-35). Issues and other trackers come later.
6. **Guest start supersedes the idea of a `.crt/.gitignore`** floated in the investigation: with captures and tasks under the home, a guest writes nothing in the project at all, so there is nothing to ignore. `crt init`'s two `.gitignore` lines are unchanged.
7. **Collation is deterministic; the agent only suggests** (§5.4).
8. **Plain `crt` prefers the integration when the app has one** (§5.6, N-36): adopting CRT in a project is still the smoothest daily use, and nothing changes for those who did.

**Open questions** (not blocking; answer in a task's Notes when they come up):

1. Hand-over to GitHub issues: where do the screenshots live — a branch of the project, the issue's own attachments (no API for those), or links into the pull-request form? Which is the tracking issue's shape?
2. Should handed-over reviews and their browser profiles be pruned after some time, or only on `crt review prune`?
3. Should an item record that the working tree was dirty at capture time (and if so, how, without spawning `git` on every Send)?
4. Should the overlay itself show the review (`Review · 9 items` on the launcher, linking to the page)?
5. Should `crt handoff --from <bundle>` exist for the receiving side of F-137, with ids allocated on the way in?
6. Screenshots through the DevTools protocol in the CRT browser (§3): a v0.9 PRD of its own?
