# CRT v0.10 — The extension: review any site on its real URL, in your own browser — PRD

| | |
|---|---|
| **Status** | Proposed 2026-11-17 — planning only. Nothing is built until Simon says "build it"; the decisions of §13 are his to change first |
| **Owner** | Simon (simv) |
| **Repo** | https://github.com/simv/crt |
| **Baseline** | `main` at 13e2ad0 = v0.9.0 (PRD-destinations M33–M36) plus #132 and #133 |
| **Amends** | `docs/PRD.md` (§3 Non-goal 3, F-6, F-16, N-4), `docs/PRD-setup.md` (§3 non-goals, F-76), `docs/PRD-embedded.md` (§3 non-goals), `docs/PRD-zero.md` (§3 non-goals, F-131, F-132), `README.md`, the reference pages under `docs/`, `CLAUDE.md`, `.claude/agents/prd-reviewer.md` — every amended statement is listed in §9 |
| **Design inputs** | Simon's request of 2026-11-17 (§1); the spike of the same day (`docs/spikes/extension-2026-11.md`, with the extension and its runner next to it); the overlay as built (`packages/overlay/src/{loader,api,health,chat,component,screenshot,storage}.ts`); the server's origin rule as built (`packages/server/src/http.ts`) |

This document extends the eight earlier PRDs. Everything in them stays in force unless §9 amends it. Requirement IDs continue the numbering (F-151…F-163, N-41…N-45, after PRD-destinations F-150 / N-40); milestones are M37–M39 (after M36), one task file each (`.crt/tasks/CRT-0058…0060`). §12 tells the builder what to do when a real browser differs from what this document assumes.

---

## 1. Problem and scope

Simon, 2026-11-17:

> is there a way we can build this so it doesn't need a proxy, or edits to the site we are testings code? like can we make a chrome extension to do this so we can review any site, without disrupting how that site works by using a different url. it really makes testing hard at the moment using a proxy.

CRT reaches a page three ways today, and each one costs something this request names:

| Way | What it costs |
|---|---|
| The integration (one dev-only line in the app) | An edit to the app, and an edit to the app's security policy when it has one (the trial app needs `http://localhost:4400` in three directives). |
| `crt proxy` | Another URL. Cookies, sign-in redirects, OAuth callbacks, absolute URLs and the app's policy all belong to `:3000`, not `:4400`. This is the pain in the request. |
| The CRT browser (v0.8) | The real URL and no edit, but in a window CRT launched, with its own profile: no saved sign-ins, no extensions, loopback pages only, and the app's policy header removed to make it work. |

A browser extension is the one way to get the real URL, the developer's own browser and profile, no edit and no lifted policy at once. The three earlier PRDs that ruled it out did so for its cost (a second codebase, store review, version drift), and PRD-zero said when to look again: "when someone needs zero integration in their everyday browser profile and cannot use proxy mode". That is this request.

In scope: an extension for Chrome and Edge that puts the CRT overlay on any site the developer turns it on for, talking to the CRT server already running for the project. Out of scope: §3.

## 2. Goals

1. **The real URL, the everyday browser.** With the extension installed and `crt` running, the developer opens their app as they always do, clicks the CRT button in the toolbar, and reviews. Same cookies, same sign-in, same extensions, same DevTools.
2. **Nothing in the app and nothing changed about it.** No line of code, no policy edit, no header rewritten, no storage written. The app's own Content-Security-Policy stays in force, including on a page that allows nothing but `'self'`.
3. **Any site, on the developer's say-so.** `localhost`, a `.test` domain, a staging URL, production. Nothing runs on a site until the developer turns CRT on there.
4. **Better screenshots.** The browser's own picture of the tab in place of the in-page rasteriser's best effort.
5. **One overlay.** The extension carries the same overlay source as the other three ways, and they keep working as they do.

## 3. Non-goals (v0.10)

- **Firefox and Safari.** Chrome and Edge share the extension as built. Firefox needs its own manifest and a pass over the worker; revisit on demand.
- **Chrome Web Store publication.** v0.10 installs from the npm package (§5.5). The store is a separate step with Simon's developer account (§13 decision 3).
- **Fetching the overlay from the server at run time.** Manifest V3 forbids remotely hosted code; the overlay ships inside the extension and the versions are checked instead (N-45).
- **Frames.** The top document only, as today (F-96 step 1).
- **A site with no CRT server.** The extension is a way in, not a second CRT: with no server on the configured port it says so and does nothing else.
- **Replacing a way in.** The integration, `crt proxy` and the CRT browser stay; the CRT browser remains the answer where nothing may be installed in the browser.
- **Authenticating the extension to the server.** The server's exposure to local callers is what it was (PRD-providers §13 open question 2); N-42 stops the extension from widening it.

## 4. Scenario

Simon runs `npm run dev` and `crt` in the trial app. He opens `http://localhost:3000` in his own Chrome, signed in as usual, and clicks the CRT toolbar button. The button's badge turns on, the CRT launcher appears bottom-right, and from here everything is CRT as he knows it: Select, note, Send, the chat, the task file. He reloads; CRT is still there. He opens the staging site in another tab; CRT is not there until he clicks the button on that tab too. He clicks it again on `localhost:3000` and CRT is off for that site.

## 5. Design

### 5.1 Three parts

The spike (`docs/spikes/extension-2026-11.md`) fixes the shape. An extension's scripts run in one of two worlds on a page: the **page world**, which is the app's own JavaScript, and an **isolated world**, which sees the same DOM but none of the app's variables, and which the app cannot see into.

| Part | Runs in | Holds | Talks to |
|---|---|---|---|
| **The probe** | The page world, at document start | The console and network hooks (`console-hook.ts`, `network-hook.ts`) and the framework lookups (`component.ts`) — the three things that need the app's own JavaScript (spike rows 2–4) | The overlay, one way: it posts data and answers a lookup for an element; it takes no other command |
| **The overlay** | The isolated world | Everything else, as built: launcher, tools, markers, popovers, chat, capture | The probe (DOM events) and the worker (`chrome.runtime`) |
| **The worker** | The extension's service worker | Which sites are on, the CRT server's address, the bridge, the tab capture | The CRT server on loopback, and nothing else |

The page cannot reach the overlay or the worker: there is no global, the shadow root is closed, and `chrome.runtime` does not exist in the page world. This is tighter than the other three ways, where the overlay shares the page's world.

### 5.2 The seams in the overlay

The overlay as built assumes one world and its own `fetch`. Four narrow seams, each with today's behaviour as its default implementation, let the same source run both ways (N-41):

- **Transport** (F-151): `api.ts` `crtJson`, `health.ts` and the chat's `EventSource` go through one `transport` with `json(path, init)` and `events(path, onEvent)`. Default: `fetch` and `EventSource` on `crtUrl(path)`. Extension: a message to the worker, and a port for the stream (spike rows 6, 7).
- **Probe** (F-152): the console log, the network log and `component.ts`'s lookups are read through one `probe`. Default: direct calls, same world. Extension: the probe posts log entries as they happen and answers a lookup when the overlay dispatches a DOM event on the element in question.
- **Storage** (F-153): `storage.ts` gains a backing choice. Default: the page's `localStorage` / `sessionStorage`. Extension: `chrome.storage.local` / `.session` keyed by origin, so nothing is written into the site's storage.
- **Screenshot** (F-158): `takeScreenshots` asks a `rasteriser` for the viewport canvas. Default: `modern-screenshot` and the raster frame. Extension: the worker's `captureVisibleTab` with the overlay's own UI hidden for that frame; on refusal, the default.

### 5.3 Turning it on

Nothing runs on any site until the developer clicks the toolbar button (or presses its shortcut) on a tab. That click:

1. gives the extension `activeTab` for the tab, which is what a real screenshot needs (spike rows 8, 9);
2. asks Chrome for the host permission for that one origin (Chrome shows its own prompt the first time);
3. registers the probe and the overlay as content scripts for that origin (`chrome.scripting.registerContentScripts`, probe in `MAIN` at `document_start`), so CRT is there after a reload and on every page of the site, and injects them into the current tab at once.

Clicking again on a site that is on turns it off: the scripts are unregistered, the permission is removed, the overlay unmounts. The badge shows on / off / no server. The manifest asks for `activeTab`, `scripting`, `storage`, host access to loopback (for the server), and *optional* host access to everything else, granted one origin at a time.

When the page already has CRT (the integration, the proxy, or the CRT browser put `window.__crt.loader` there), the probe reports it and the extension stands down on that page with one console line.

### 5.4 The server

The server needs no change to be reached (spike row 6): the worker's requests carry `Origin: chrome-extension://<id>`, the server sends no CORS header for it, and the extension's host permission is what lets the worker read the answer. The `/__crt/internal/*` routes refuse it as they refuse every `Origin`.

Two small additions. The worker names itself on its health call, so the server can count it and log `crt: overlay loaded in the browser (the extension, on <page origin>)` once (F-162). And a capture's page URL may now be any `http(s)` URL: the loopback rule for *pages* (F-6, PRD-zero N-32) was the loader's and the CRT browser's, and stays theirs; the rule that the *server* is loopback is the extension's too (N-43).

Which server: `http://localhost:4400` unless the developer sets another port in the extension's popup. One server is one project, so a staging site reviewed while `crt` runs in project A files its tasks in project A; the launcher's health tooltip already says which project.

### 5.5 Install and versions

The built extension ships inside the npm package (`dist/extension/`). `crt extension` copies it to `<home>/extension/` — a path that survives an `npx` cache and a version bump — and prints the three steps: open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, Load unpacked → that folder. A later `crt extension` refreshes the copy and says to press Reload.

The overlay inside the extension and the server can now be different versions, which no other way in allows. The extension compares its own version with health's: equal major.minor → mount; otherwise the launcher is replaced by one line, `CRT extension <a> and CRT server <b> do not match — run \`crt extension\`, then Reload it in chrome://extensions` (N-45).

### 5.6 What changes where

| Where | Change |
|---|---|
| `packages/overlay/src/` | the four seams (M37); `extension/{probe,content,worker}.ts`, `extension/manifest.json`, the popup (M38) |
| `packages/overlay/build.mjs` | three more outputs under `packages/server/dist/extension/` plus the manifest, icons and popup (M38) |
| `packages/server/src/` | `extension.ts` (`crt extension`), the health counter, the `openDecision` step, the doctor row (M39) |
| `packages/server/e2e/` | `extension.spec.ts`: Playwright's Chromium with the unpacked extension on the fixture's `/untouched` page under a strict policy, on a loopback host and on a mapped host name (M38) |
| The app under review | nothing |

## 6. Functional requirements

### 6.1 The seams

- **F-151 (Must) One transport.** Every request the overlay makes to the CRT server — the JSON calls of `api.ts`, the health read, the session event stream, the raster frame URL — goes through one module with a default implementation that behaves as today. No other overlay module calls `fetch`, `EventSource` or `crtUrl` for a CRT route. Tested: a unit row with a fake transport; a grep row in `overlay-structure.test.ts`.
- **F-152 (Must) One probe.** The console log, the network log and the framework lookups are read through one module with a same-world default. The cross-world form posts entries as they are recorded and answers a lookup for the element a DOM event was dispatched on; what crosses is JSON, bounded by the limits the logs already have. Tested: unit rows for the message shapes and for a lookup round trip in a two-realm fixture.
- **F-153 (Must) Storage with a backing choice.** `storage.ts` reads and writes through a backing that defaults to Web Storage; every existing key keeps its name and meaning. Tested: the existing storage rows against both backings.

### 6.2 The extension

- **F-154 (Must) The package.** A Manifest V3 extension built by `npm run build` into `packages/server/dist/extension/`: the probe, the overlay content script, the worker, the popup, the icons (the mark, PRD-polish F-112). Permissions exactly `activeTab`, `scripting`, `storage`; host permissions exactly `http://localhost/*` and `http://127.0.0.1/*`; optional host permissions `http://*/*` and `https://*/*`. Its `version` is the package's. Tested: a unit row reads the built manifest.
- **F-155 (Must) On and off, per site.** Per §5.3: off everywhere at install; the toolbar button or the shortcut turns the current tab's origin on (permission, registration, immediate injection) and off again; the choice survives a browser restart; the badge shows the state. A page Chrome does not let extensions touch gets a one-line popup saying so. Tested: e2e drives the same function the click calls.
- **F-156 (Must) The overlay mounts in the isolated world.** Closed shadow root, no property added to `window`, top document only; the probe is in before the app's first script. Where the page already has a CRT loader the extension stands down (§5.3). Tested: e2e on a page whose policy is `default-src 'self'` and nothing else — launcher visible, a `console.error` from the app's first script in the capture, the component name of a React element in the capture, `window.__crt` undefined in the page.
- **F-157 (Must) The bridge.** The worker performs the transport's JSON calls and relays the event stream over a port, to the configured CRT origin only. A stream survives the worker's idle limit for as long as its port is open; a dropped stream is reconnected from the last event id, as `EventSource` does. Tested: e2e — a full stub intake (Send, proposal, accept, task file written) through the extension; a stream held past 30 s.
- **F-158 (Must) Screenshots from the browser.** On Send the overlay hides its own UI, the worker captures the visible tab, and the markers and crops are drawn as today. When Chrome refuses the capture (the click's grant has lapsed), the in-page rasteriser is used and `capture.json` says which made the picture. Tested: e2e for the fallback; **Manual** for the real capture, which needs a real click.
- **F-159 (Must) Saying what is wrong.** No server on the port → the loader's pill, with the port; versions differ → the §5.5 line; a different project than this tab first saw → the existing health state. Never a silent nothing.
- **F-160 (Must) Any site.** A page on any `http(s)` host can be reviewed once turned on; its URL is recorded in the capture as the browser shows it; the server accepts it. The loader's and the CRT browser's loopback rules are unchanged. Tested: e2e on a mapped non-loopback host name; a unit row on the capture schema.

### 6.3 Install, defaults, docs

- **F-161 (Must) `crt extension`.** Copies `dist/extension/` to `<home>/extension/`, prints the folder and the three steps for Chrome and Edge, and on a later version refreshes the copy and says to reload. `--path` prints the folder only. Writes nowhere else. Tested: unit rows against a temp `CRT_HOME`.
- **F-162 (Should) The server knows.** Health gains `overlay.extension` (a count); the first extension mount logs its line (§5.4); `crt doctor` gains an `extension` row (installed copy and its version, or how to install); when the extension has been seen for this project, plain `crt` in an app without the integration opens the default browser, not the CRT browser (`openDecision`; `crt browse` still forces the CRT browser).
- **F-163 (Must) Docs and release 0.10.0.** A README block; `docs/extension.md` (install, turning it on, what it can and cannot see, the permission list and why each); `docs/how-it-works.md` and `docs/troubleshooting.md` rows; the comparison of the four ways in in `docs/integration.md`; versions and pins `0.10.0` / `@0.10`.

## 7. Non-functional requirements

- **N-41 The other three ways do not change.** The integration, the proxy and the CRT browser behave as in v0.9: their e2e specs pass with no assertion changed, and the overlay and loader bundles stay within their size budgets (N-20).
- **N-42 The page cannot drive CRT.** Through the extension a page script can add entries to the logs it already feeds and nothing more: it cannot start a session, post a capture, read a task or reach the worker. The overlay acts only on trusted input events. Everything the probe sends is treated as data from the page.
- **N-43 The extension talks to this machine only.** Its one network peer is the CRT server on a loopback origin; a configured address that is not loopback is refused. No remote code, no analytics, no other request. Nothing of a page is read on a site that is not turned on.
- **N-44 The site is left as it is.** No request or response header is changed (no `declarativeNetRequest`), no policy is lifted, no cookie or storage entry is written, the URL is the site's own. What the page can observe is what it can observe of CRT today: wrapped `console` and `fetch` functions and one element at the end of the document.
- **N-45 One version.** The extension mounts only against a server of its own major.minor (§5.5).

## 8. Milestones

Each milestone is one task file. M38 needs M37; M39 needs M38.

**M37 — The seams (`.crt/tasks/CRT-0058`).** F-151, F-152, F-153, N-41, and the rasteriser seam of F-158 with its default only. A refactor with no change in behaviour. DoD: `npm run check` and `npm run e2e` green with no e2e assertion changed; bundle sizes before and after in the Log.

**M38 — The extension (`.crt/tasks/CRT-0059`).** F-154…F-160, N-42, N-43, N-44. DoD: `npm run check` and `npm run e2e` green with `extension.spec.ts`; **Manual**: on Windows in Simon's own Chrome and Edge profiles — the trial app on `localhost:3000` with its policy as committed (no CRT entries), signed in, a real Claude session to a written task with a real tab screenshot; one public `https://` site turned on, a capture sent, and no local-network prompt; `activeTab`'s lifetime across a reload and a same-site navigation recorded.

**M39 — Install, defaults, docs, release 0.10.0 (`.crt/tasks/CRT-0060`).** F-161, F-162, F-163, N-45, the §9 rows, §10 evidence. DoD: versions and pins; `npm run screenshots` re-run when the overlay's UI changed; **Manual**: `npx claude-review-tool extension` from the published package on a machine that has never had it, to a first Send; `v0.10.0` tagged and promoted on npm (**Manual (Simon)**).

## 9. Amendments to the earlier PRDs, the docs and `CLAUDE.md`

Applied by the milestone named in each row, with a `*v0.10: …*` note inline in the earlier PRD.

| Statement | v0.10 |
|---|---|
| PRD §3 Non-goal 3 "Not a browser extension…"; PRD-setup §3 "a browser extension"; PRD-embedded §3 and PRD-zero §3 "A browser extension (unchanged since v1.0)" | an extension is the fourth way in, for the developer's own browser on any site (F-154…F-160); the store listing stays a non-goal (M38). |
| PRD F-6 "localhost origins only"; PRD-embedded F-96 step 1; PRD-zero N-32 | unchanged for the loader, the proxy and the CRT browser. Through the extension a page on any host can be reviewed after the developer turns it on (F-155, F-160); the server is loopback in every case (N-43) (M38). |
| PRD F-16 "rasterise the current viewport in-page … best-effort" | still the default; through the extension the picture is the browser's own, with the in-page rasteriser as its fallback (F-158) (M38). |
| PRD N-4 "Nothing leaves the machine except…" | unchanged, and restated for the extension by N-43 (M38). |
| PRD-setup F-76 / PRD-zero F-131 doctor rows | plus the `extension` row (F-162) (M39). |
| PRD-zero F-132 "what plain `crt` opens" | one more step: the default browser when the extension has been seen for this project (F-162) (M39). |
| `CLAUDE.md` "Read `docs/PRD.md`, …" and `.claude/agents/prd-reviewer.md` | this document joins the list with its one-line description; F-151…F-163 / N-41…N-45 live here (the PR that adds this document). |
| `CLAUDE.md` "What this is", entry points, Conventions | the extension as the fourth way; `packages/overlay/src/extension/`, the seams, `extension.ts`; "no globals except `window.__crt`" gains "and none at all through the extension" (M37–M39). |
| `CLAUDE.md` Don'ts; the reviewer's invariants | a line for N-43 and N-44: the extension requests nothing but the loopback CRT server, changes no header and uses no permission beyond F-154's list (M38). |
| README; `docs/integration.md`, `how-it-works.md`, `troubleshooting.md`, `cli.md`; "the ten reference pages" | F-163; `docs/extension.md` makes eleven (M39). |

## 10. Definition of done (v0.10)

Ticked by M39 with evidence.

- [ ] With the extension on, the trial app is reviewed on `localhost:3000` in Simon's everyday Chrome, with no CRT line in the app and no CRT entry in its policy, through to a written task (goals 1, 2).
- [ ] A page whose policy allows only `'self'` gets the overlay, the logs, the component names and a screenshot, and its policy is still enforced (goal 2, N-44).
- [ ] A site that was never turned on is never touched; a site turned off is left clean (goal 3, N-43).
- [ ] A page script cannot start a session or post a capture through the extension (N-42).
- [ ] The integration, the proxy and the CRT browser pass their v0.9 e2e unchanged (goal 5, N-41).
- [ ] 0.10.0 is on npm and `crt extension` installs from it.

## 11. Risks

| Risk | Answer |
|---|---|
| Moving the overlay to the isolated world breaks something that quietly relied on the page's world | M37 lands the seams alone, with every existing e2e as its gate, before any extension code exists. |
| Chrome's local-network-access rules stop a public page's extension from reaching loopback | The requests are the worker's, under the extension's own host permission, which is the documented path; the spike could not prove it on a public address, so it is M38's first Manual row and §12 rule 2. |
| The service worker is stopped mid-session | An open port carrying messages keeps it alive; the bridge reconnects from the last event id, and the session itself lives in the CRT server, not in the worker (F-157). |
| `activeTab` lapses, so a later screenshot is refused | The fallback of F-158; the shortcut renews it; decision 2 of §13 is the alternative. |
| Unpacked install is three manual steps, and Chrome may nag about developer-mode extensions | `crt extension` prints them; the store listing (§13 decision 3) removes them when Simon wants it. |
| The extension and the server drift apart | N-45: refused with the command that fixes it. |
| Reviewing a production site records real user data in a capture | Captures stay on the machine as today; `docs/extension.md` says what a capture holds; nothing is on until the developer turns it on (F-155). |
| A second codebase to keep | It is the same overlay source behind four seams, plus about three small files; the e2e runs it in CI on every change. |

## 12. Verification protocol for the builder

1. **A seam needs to be wider than §5.2 says** (a fifth place the overlay touches the page's world or the network): add it to the same seam module, name it in the Log, keep the default behaviour byte-for-byte; do not add a second mechanism.
2. **The worker cannot reach the CRT server from a tab on a public address**: stop and report with the evidence. Do not add a header rule, a native-messaging host or a relay through the page on your own; each is a different security posture and needs a PRD change.
3. **`activeTab` cannot be had in the e2e** (Playwright cannot click the toolbar): the e2e covers the fallback and everything else; the real capture is the Manual row. Do not add `<all_urls>` to the manifest to make a test pass.
4. **Chrome refuses a page-world content script on some page** (a policy with `require-trusted-types-for`, a sandboxed document): the overlay still mounts, the logs and component names are absent, and the capture says so in its existing "not available" fields.
5. **The capture schema or a server route refuses a non-loopback page URL**: widen that one check for pages, keep every check on the *server's* own origin, and add the unit row (F-160).
6. **A size budget, `docs.test.ts`, the CI `changes` filter or `skill-pin.test.ts` pins something a §9 row changes**: change the pin and the statement together in the same commit.

## 13. Decisions taken and open questions

**Decisions proposed** (Simon's to change before "build it"; after that the builder does not revisit them):

1. **Per-site, on a click — not everywhere, always.** The extension does nothing until turned on for a site, and asks Chrome for that one origin. The alternative is one install-time grant for all sites: no click, and it reads as "can read and change all your data on all websites".
2. **Screenshots use the click's grant, with the in-page rasteriser as the fallback.** The alternative is the all-sites permission, which makes every screenshot the real one.
3. **Install from the npm package now; the Chrome Web Store later.** Unpacked install keeps the extension and the server on one version and needs no account or review. A store listing is a separate task when wanted: Simon's developer account, a privacy statement, and a review each release.
4. **Any site, not loopback only.** The request says "any site". The server stays loopback-only.
5. **Chrome and Edge first.** Firefox on demand.
6. **The overlay moves to the isolated world; only the probe shares the page's world.** Decided by the spike, and it is what makes N-42 possible.

**Open questions:**

1. Should a site reviewed through the extension that is not the project's own app (staging, production) be marked as such in the task file, so the worker knows the code it reads may be newer than the page was?
2. One server is one project. With two `crt` servers running, should the popup offer the choice per site, or is the port field enough?
