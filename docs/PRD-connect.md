# CRT v0.11 — Connect: the extension with no CRT server, and feedback sent to Claude — PRD

| | |
|---|---|
| **Status** | M40 and M41 built — Simon chose "Claude in the cloud first" on 2026-11-18 from the proposal of the same day, and said "build on the branch" (the branch of PRD-extension's pull request, #134). M42–M44 are planned here and not built. The manual rows of §8 (a real scheduled task and its token, Simon's own Chrome) are open. |
| **Owner** | Simon (simv) |
| **Repo** | https://github.com/simv/crt |
| **Baseline** | The head of pull request #134 (v0.10.0, PRD-extension M37–M39 and F-164) |
| **Amends** | `docs/PRD-extension.md` (§3, §5.4, F-154, F-159, F-164, N-43), `docs/PRD.md` (§3 non-goals: nothing off-machine), `docs/extension.md`, `CLAUDE.md` — every row in §9 |
| **Design inputs** | Simon's request of 2026-11-18 (§1); the proposal "CRT extension without a local server" (https://claude.ai/artifact/JiA81f15bwmChPF9CzyTW2); the spike of the same day (`docs/spikes/connect-2026-11.md`); the extension as built in #134 |

This document extends the nine earlier PRDs. Everything in them stays in force unless §9 amends it. Requirement IDs continue the numbering (F-165…F-175, N-46…N-49, after PRD-extension F-164 / N-45); milestones are M40–M44 (after M39), one task file each (`.crt/tasks/CRT-0062…0066`).

---

## 1. Problem and scope

Simon, 2026-11-18: "i want find a way to use the extension without having to run the proxy etc. … at the moment the user must run CRT in the folder of the site they are reviewing. what i actually want is the user to just install the extension, connect the extension to claude and then choose where to send feedback to. i want the experience to be very smooth easy. the user shouldn't have to run commands to edit the folder of the project they are reviewing."

The extension of v0.10 is a window onto a CRT server: its worker speaks to one loopback address and nothing else (PRD-extension N-43), and everything after Send — the session, the task file, the review, the hand-over — lives in that server. v0.11 lets the extension stand on its own: with no server it keeps the review itself, and it sends a review to a destination the developer chose for the site.

What the spike found fixes the scope (`docs/spikes/connect-2026-11.md`):

- There is no public way for another product to sign in to a Claude account, to list its projects, sessions or scheduled tasks, or to post into one. Subscription sign-in is reserved for Anthropic's own products. CRT does not build on a browser's claude.ai session.
- A Claude Code scheduled task (a "routine") can carry an API trigger: an address and a token of its own. A `POST` there starts a new cloud session in the task's repository and answers with the session's link. It takes text only (65,536 characters), 30 starts an hour per task. It is experimental.
- The lists that do exist are GitHub's repositories (after GitHub's own sign-in) and the folders Claude Code was used in on this machine (through a helper). They are M42 and M43.

## 2. Goals

1. A browser with only the extension in it reviews a site from the first click: no server, no command, nothing in the reviewed project.
2. The review is kept in the browser and can leave it as Markdown at any time.
3. One paste per repository connects a site to Claude Code in the cloud; after it, sending a review is one click and ends with a link to the session.
4. The mode with a CRT server is unchanged, and the extension says plainly which of the two a site is in.

## 3. Non-goals (v0.11)

- **A list of the developer's Claude projects, or a "Connect to Claude" sign-in.** Not possible today (§1). The connection is a pasted address and token.
- **Sending into a session that is already open.** A send starts a new session.
- **Screenshots to Claude directly.** The trigger takes text. They stay in the browser (and can be saved from the review page) until M42 gives them a place in the repository.
- **The conversation with the agent in the page, without a server.** In standalone mode the panel records; the agent that receives the review does the intake and asks its questions in its own session. The mode with a server keeps the chat.
- **Creating the scheduled task or its token for the developer.** Claude offers no interface for it.
- **A hosted CRT service.** Nothing of CRT's runs anywhere but the developer's browser and machine.
- **A Chrome Web Store listing** before the concept is proven (Simon, 2026-11-18): M44.

## 4. Scenario

Simon installs the extension, opens a staging site and clicks the CRT button. Nothing else is running. The overlay opens; he points at a heading, writes "wrong size on mobile" and presses Send. The panel shows his words and "Saved as R-01. It is kept in this browser until you copy it or choose where it goes". He adds two more. He right-clicks the CRT button, chooses "Open review", sees the three items, and under "Where feedback goes" follows four steps on Claude's scheduled tasks page, pastes the example command Claude shows, and names the destination `my-app`. He picks it for the site. Back on the review page the button reads "Send 3 to Claude · my-app"; he presses it and gets "Open the Claude session".

## 5. Design

### 5.1 Two modes, decided when the page loads

The worker resolves a **target** for the page's site (`destinations.ts` `targetFor`): the site's own choice on the Options page, else the default, else `auto`. A target is a CRT server on a loopback origin (v0.10, unchanged), **this browser** with or without a destination, or `auto` — the server on port 4400 when one answers a health read within 800 ms, else this browser. The answer is pinned to the tab until its next load, so a page never talks to two places.

A default the developer set explicitly to a server behaves as in v0.10, the pill of F-159 included: only an install where nothing was ever chosen falls to this browser by itself.

### 5.2 Standalone: the worker answers the overlay

The overlay is not changed. Its transport (PRD-extension F-151) already ends in the worker; in standalone mode the worker hands each call to `standalone.ts` in place of a `fetch`: health, providers, captures, sessions and the session stream, over a key-value store in IndexedDB in the extension's own origin (`idb.ts`).

- A capture is validated with the server's own schema and kept as a **review item**: `R-01`, `R-02`, … (PRD-zero F-130's shape, counted per browser profile), with its site, its bundle and its PNGs.
- A session has no agent. Its stream is: the developer's words (PRD-chat F-119), the item's id where a task's would be, one message saying where the item is kept, where it goes and how to open the review. What is typed afterwards is added to the item.
- Health answers with the extension's own version (N-45 holds by construction) and names the target where a project's folder would be, so the launcher's tooltip reads `CRT · Review ready · this browser, then Claude · my-app`.

### 5.3 The review page and the destinations

`review.html` is an extension page: the items by site, keep or drop, delete, a thumbnail that saves the screenshot, "What is sent" for each, copy and download as Markdown (`review-items.ts` renders; text from the page sits in code spans). It opens from "Open review" on the toolbar button's menu, from Alt+Shift+R and from a link on the Options page.

A **destination** is a name, a scheduled task's fire address and its token, saved on the Options page in `chrome.storage.local` (never synced). The Options page gives the four steps, a link to Claude's page and two prompts to copy for the task ("file the tasks", "fix them"). A site is given a destination in the same list that gives it a server.

### 5.4 The send

On the review page, per site with a destination: one button, one request (`destinations.ts` `fireRequest`) — `POST` to the task's address with the site's kept, unsent items as one text, the token in the `Authorization` header and nowhere else. Past the limit the items go without their HTML and logs; past it still, nothing is sent and the page says to drop some. Items are marked sent, with the session's link, only when Claude answers 2xx. Every other answer is one line saying what to do.

## 6. Functional requirements

### 6.1 Standalone (M40)

- **F-165 (Must) A site works with no server.** Per §5.1. With nothing chosen and nothing on port 4400, turning a site on mounts the overlay; no pill, no command. A server chosen for the site or as the default behaves as in v0.10. Tested: unit rows on `targetFor`; e2e with no server started.
- **F-166 (Must) The review is kept in the browser.** Per §5.2: Send keeps the capture as an item with its pictures; the panel shows the developer's words, the item's id and where it goes; later messages are added to the item; a reload re-attaches the thread; Discard ends the conversation and keeps the item. Nothing is written to the site's storage. Tested: unit rows over an in-memory store; e2e through the real worker.
- **F-167 (Must) The review page.** Per §5.3: list by site, keep / drop, delete, the screenshot, copy and download as Markdown, reachable from the toolbar button's menu and a shortcut. What came from a page is rendered as text. Tested: unit rows on the Markdown; e2e on the page.

### 6.2 Destinations and Claude (M41)

- **F-168 (Must) A destination per site.** The Options page's per-site choice offers the running servers, "This browser" and each saved destination; the default offers the same plus `auto`. Turning a site off forgets its choice (as F-164). Removing a destination leaves its sites in this browser. Tested: unit rows; e2e.
- **F-169 (Must) Connecting a repository to Claude.** The Options page takes a name and the task's address and token — pasted separately or as the whole example command — refuses anything that is not a fire address at `api.anthropic.com` or not a task token with a line saying what it should look like, asks Chrome for that one host, and never shows the token again. It gives the steps and the prompts. Tested: unit rows; e2e saves one.
- **F-170 (Must) One send.** Per §5.4. Tested: unit rows read the whole request; the limit and the compact form; nothing sent for an empty or oversized review.
- **F-171 (Must) What came back.** A 2xx marks the items sent and shows the session's link when it is an `https://` address on `claude.ai`; 401, 403, 404, 429 and the rest each get their line; a failed request marks nothing. Tested: unit rows.

### 6.3 Planned, not built

- **F-172 (M42) GitHub.** Sign in with GitHub's device flow, pick a repository from a list, kept items become issues with their screenshots on an assets branch; a Claude destination for the same repository gets the issue links.
- **F-173 (M43) This computer.** One `npx claude-review-tool connect` registers a native-messaging helper; the extension starts a guest CRT server on demand for a folder picked from the ones Claude Code was used in, and the chat in the page works as in v0.10.
- **F-174 (M44) The store package.** A listing-ready build, the privacy text, the permission justifications.
- **F-175 (M44) Docs and release 0.11.0.**

## 7. Non-functional requirements

- **N-46 One address off the machine.** The extension's only request beyond loopback is the send of F-170, to `https://api.anthropic.com/v1/claude_code/routines/<id>/fire`, built in one module and checked when a destination is saved and when it is used. Addresses off the machine appear in `destinations.ts` only (a grep row).
- **N-47 The token is the developer's and stays put.** Kept in `chrome.storage.local`, sent only in the `Authorization` header of the send, never rendered, logged, put in a URL or synced.
- **N-48 Nothing leaves without the click.** In standalone mode the worker makes no request at all; a review leaves the browser only by the developer's Send, copy or download on the review page.
- **N-49 What the page said is data.** Page text, HTML, console and network lines are bounded by the capture schema on the way in, shown as text on the review page, and sent inside code spans under a first line that says so; the offered task prompts repeat it.

## 8. Milestones

**M40 — Standalone (`.crt/tasks/CRT-0062`).** The spike; F-165, F-166, F-167, N-48. DoD: `npm run check` and `npm run e2e` green.

**M41 — Destinations and Claude (`.crt/tasks/CRT-0063`).** F-168…F-171, N-46, N-47, N-49. DoD: as M40; **Manual (Simon)**: a real scheduled task on a test repository — the four steps, a send from his own Chrome, the session link, the pull request Claude opens; a 401 after regenerating the token.

**M42 — GitHub (`CRT-0064`)**, **M43 — This computer (`CRT-0065`)**, **M44 — Store package, docs, release 0.11.0 (`CRT-0066`)**: backlog.

## 9. Amendments to the earlier PRDs, the docs and `CLAUDE.md`

| Where | Was | Now |
|---|---|---|
| PRD-extension N-43 | The extension's one network peer is the loopback CRT server | And the send of F-170 to the one Claude address (N-46), on the developer's click |
| PRD-extension F-154 | Permissions exactly `activeTab`, `scripting`, `storage` | Plus `contextMenus`, for "Open review" on the toolbar button; a second page, `review.html` |
| PRD-extension F-159, §5.4 | No server on the port → the pill | Only where a server was chosen; with nothing chosen the site is reviewed in this browser (F-165) |
| PRD-extension F-164 | A site's choice is a server | A server, this browser, or a destination (F-168) |
| PRD §3, `CLAUDE.md` Don'ts | Nothing off-machine but the agent's own calls and what `crt handoff` runs | And the extension's send, after the developer's click, to the destination shown |
| `docs/extension.md` | — | "With no CRT server" and "Sending a review to Claude" |

## 10. Risks

- **The trigger is experimental.** Its shape, limits or existence may change; the Claude destination then breaks until CRT follows. Copy and download do not depend on it.
- **A token in the browser profile** can start sessions of one task. It is scoped to that task and revoked by generating a new one.
- **Feedback text reaches an agent with write access to a repository.** N-49 is the mitigation; the developer reads "What is sent" before sending.
- **No real send has been made from an extension yet** — only the address's answer to a bad token (§ spike). The Manual row of M41 is that check.

## 11. Decisions taken and open questions

1. Claude in the cloud first, then GitHub, then this computer — Simon, 2026-11-18.
2. The reviewed projects are on GitHub — Simon, 2026-11-18. So the cloud route fits them.
3. The store account waits until the concept is proven — Simon, 2026-11-18.
4. Built on the branch of #134 — Simon, 2026-11-18.
5. *Open:* send each item as it is captured, as an option beside "Send review"? Not built: 30 starts an hour per task argue for one send per review.
6. *Open:* the version stays 0.10.0 until M44; should 0.10.0 be released with M40 and M41 in it, or held for 0.11.0?
