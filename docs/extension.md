# The browser extension

How to review any site on its real URL in your own Chrome or Edge with nothing added to the site — installing the extension from the package, turning it on for a site, what it can and cannot see, every permission it asks for and why, and what to do when it and the server disagree. Back to the [README](../README.md).

```bash
# one-time, per machine
crt extension                     # copies the extension to ~/.crt/extension and prints the three steps below

# per session, in the project
crt                               # the CRT server on :4400, as always
# then open the site in your own browser and click the CRT toolbar button
```

The other three ways in put CRT on a page from the outside: a line in the app (the [integration](integration.md)), a copy of the app on another URL (`crt proxy`), or a browser window CRT starts itself (`crt browse`, [docs/review.md](review.md)). The extension is the fourth: the page stays on its own URL, in the browser profile you are already signed in to, and neither the app's code nor its Content-Security-Policy is touched. The server is the same `crt` you already run, and everything it does after Send — the session, the task file, the review, `crt handoff` — is unchanged.

## Install

`crt extension` copies the extension that ships inside the npm package to `~/.crt/extension` (`CRT_HOME` moves it) and prints:

```
crt: copied the extension 0.10.0 to C:\Users\you\.crt\extension
  1. Open chrome://extensions (Edge: edge://extensions) and turn on Developer mode.
  2. Click "Load unpacked" and choose C:\Users\you\.crt\extension
  3. Open your site, click the CRT button in the toolbar (pin it from the puzzle-piece menu) and allow the site.
```

`crt extension --path` prints the folder and writes nothing. The folder is the only thing the command writes. The extension is not in the Chrome Web Store yet, which is why the browser needs Developer mode and "Load unpacked"; Chrome may remind you of that on start.

After an update of the package, run `crt extension` again — it replaces the copy and prints `crt: updated the extension in <folder> (0.10.0 → 0.10.1)` — then click **Reload** on the CRT card in `chrome://extensions` and reload your page. `crt doctor` has an `extension` row that says which copy is installed and warns when it is older than the package.

## Turning it on for a site

CRT is off everywhere until you turn it on, one site at a time:

1. Start `crt` in the project (any mode; the extension only needs the server).
2. Open the site and click the CRT toolbar button, or press `Alt+Shift+C`.
3. The browser asks once whether CRT may read and change that site. Allow it, and the CRT button appears bottom-right, as it does in every other way in. The toolbar button shows `on`.

From then on CRT is on for that site — that scheme, host and port — in every tab and after a reload, until you click the toolbar button again. Turning it off removes the button, forgets the site and gives the permission back. If you decline the browser's question, CRT still runs on that one page until you reload or close it, and asks again next time.

The toolbar button also tells you when something is wrong: a red `!` when no CRT server answered or when its version differs from the extension's (both below). On a page that is not `http` or `https` (a new tab, `chrome://…`, the Web Store) it says CRT cannot run there.

The extension talks to the CRT server on `http://localhost:4400`. When your server is on another port (`crt --port 4410`), set the default port on the extension's Options page (right-click the toolbar button → Options). Only a loopback address is accepted.

## Choosing the project a site's reviews go to

A review goes to the project whose CRT server the site talks to: one server is one project, the folder you ran `crt` in. With one server running there is nothing to choose. With several — `crt` in a second project takes port 4401 while 4400 is busy, the next 4402 — the Options page decides, per site:

1. Run `crt` in each project you want to send reviews to. A project needs nothing added to it: one that is not set up is reviewed as a guest, and what you send is kept in its review under `~/.crt` until `crt handoff` ([docs/review.md](review.md)).
2. Open the extension's Options (right-click the toolbar button → Options). **CRT servers running on this machine** lists each one by its project's folder and port, for example `i-saw-a-sign — port 4401`, with the full path under it. **Refresh** looks again.
3. Under **Where each site's reviews go**, every site you have turned CRT on for has a list: **Default**, or one of the running servers. Pick the project, and reload the site's page.

The choice is kept per site, in the extension, until you turn the site off. A site with no choice uses the default port. If the chosen server is not running, the page says `CRT server not running on :<port>` and the Options page shows that choice as `not running`; start `crt` in that project or pick another. The first-visit card on the page names the server and the project it is talking to.

When a page already has CRT — the app carries the integration, or you opened it through `crt proxy` or `crt browse` — the extension stands down on that page and says so in the console; you never get two buttons.

## With no CRT server

The extension also works with nothing else running: no `crt`, no proxy, nothing in the project (PRD-connect F-165…F-167). When you turn a site on and no CRT server was chosen for it and none answers on port 4400, the review is kept in the browser.

- **Send** keeps the item — your notes, what you pointed at, the logs, the screenshot — as `R-01`, `R-02`, … The panel shows your words and says where the item is and where it goes. There is no agent in the page in this mode: what you type afterwards is added to the item, and the agent that receives the review asks its questions in its own session.
- **Open review**: right-click the CRT toolbar button and choose **Open review** (or Alt+Shift+R). The page lists every item by site. Untick one to leave it out, **Delete** removes it, the thumbnail saves the screenshot, and **What is sent** shows the text exactly as it would leave.
- **Copy as Markdown** and **Download Markdown** give you the kept items as one document. This is the way into a claude.ai chat or project: paste it.
- The launcher's tooltip says which mode the page is in: `CRT · Review ready · this browser`, or the project's folder when a server answers.

To keep one site in the browser while a CRT server is running, pick **This browser (no server)** for it under **Where each site's reviews go**. **Sites with no choice of their own** sets what the rest do; once you name a server there, a server that is not running gets the `CRT server not running` pill as before instead of falling back.

The review lives in this browser profile only. Removing the extension removes it.

## Sending a review to Claude

A site's review can start a Claude Code session in a repository, in the cloud, with one click (PRD-connect F-168…F-171). Claude gives every scheduled task its own web address and token; you paste them once per repository. Claude has no sign-in for other tools and no list of your projects to pick from, so this paste is the connection. It needs a Claude plan with Claude Code on the web, and the repository on GitHub.

1. In the extension's Options, under **Send to Claude**, open **Claude's scheduled tasks** and create a task for the repository.
2. Give the task a prompt. **Copy "file the tasks"** has Claude write a task file per item and open a pull request; **Copy "fix them"** has it make the changes.
3. Edit the task, add an **API** trigger and **Generate token**. Claude shows the token once, with an example command.
4. Paste the address and the token into Options, with a name (the repository's is a good one), and **Save destination**. Pasting the whole example command into either field works. Chrome asks to let the extension reach `api.anthropic.com`.
5. Under **Where each site's reviews go**, pick **This browser, then Claude · <name>** for the site.

Then review as usual. On the review page the site has a **Send N to Claude · <name>** button: it sends the kept items that were not sent before, as one text, and shows **Open the Claude session**. Each item keeps the link.

- **Screenshots are not sent.** Claude's address takes text only; they stay on the review page, where you can save them.
- **One send is at most 65,536 characters.** A longer review goes without the HTML and the logs; if it is still too long the page says so and nothing is sent.
- **Claude allows 30 starts an hour per task.** Send a review, not single items.
- **The token** is kept in this browser profile, is sent only to Claude with a send, and is never shown again. **Remove** forgets it here; generating a new token on the task revokes the old one at Claude.
- **What a page said is sent as data.** Text copied from the page sits in code spans under a line that tells the agent so, and both prompts repeat it. Read **What is sent** before you send a review of a site you do not control.
- The address is an experimental part of Claude Code and may change.

## What it sees, and what it leaves alone

On a site you turned on, the extension collects exactly what the overlay collects in the other three ways in: the annotations you make, the page URL and title, the selector and component names of what you pointed at, the console and failed-request logs from the moment the page starts loading, and a screenshot when you Send. All of it goes to the CRT server on your machine — or, with no server, stays in the extension — and nowhere else until you send a review to a destination you chose.

- **Screenshots are the real pixels of the tab**, taken by the browser while the toolbar click that turned CRT on is still in force for that tab. When it is not — after a restart of the browser, say — the overlay draws the page itself, as it does without the extension, and the capture says which it was (`screenshots.via`: `browser` or `page`). Click the toolbar button twice (off, on) to get real pixels back.
- **The page's policy stays in force.** No header is changed, no policy is lifted, no cookie or storage entry of the site is written, and the URL is the site's own. What the page can notice is what it can notice of CRT anywhere: `console` and `fetch` are wrapped, and one element sits at the end of the document.
- **The page cannot drive CRT.** The overlay runs in the extension's own isolated world inside a closed shadow root, and it acts only on real input events. The one script that shares the page's world answers questions about the page (the logs, the component names) and takes no commands; a page script can at most add lines to the logs it already feeds.
- **A site that is not turned on is never touched.** No script runs there and nothing of it is read.
- **Annotations and drafts** are kept by the extension, per site, not in the site's own storage.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | the toolbar click lets CRT run in that tab and take a real screenshot of it, without a standing permission for every site |
| `contextMenus` | the **Open review** entry on the toolbar button's menu |
| `scripting` | registers the two CRT scripts for the sites you turned on, and removes them when you turn one off |
| `storage` | the list of sites that are on, the server port, and your annotations and drafts per site |
| `http://localhost/*`, `http://127.0.0.1/*` | the CRT server. Without a destination this is the only thing the extension ever sends a request to |
| *optional* `http://*/*`, `https://*/*` | never granted as a whole: the browser asks for one site at a time, when you turn CRT on there, and the grant is given back when you turn it off. The same list lets it ask for `https://api.anthropic.com/*` when you save a Claude destination |

There is no `<all_urls>`, no `tabs`, no `webRequest` or `declarativeNetRequest`, no `cookies`, no remote code and no analytics.

## When it does not work

- **``CRT server not running on :4400 — run `crt` in the project, then click here``** (a pill at the bottom of the page): a server was chosen for this site, or as the default, and it is not running or is on another port — see the Options page above.
- **`Claude did not accept the token`** on the review page: the task's token was regenerated or the task deleted. Generate a new one and save the destination again. Nothing is marked as sent unless Claude said it started a session.
- **``CRT extension 0.10.0 and CRT server 0.11.2 do not match — run `crt extension`, then Reload it in chrome://extensions``**: the overlay ships inside the extension, so the two must be the same major.minor. Run `crt extension` with the package the server runs from, then Reload.
- **Nothing happens on click**: the page is not `http(s)`, or the browser blocks extensions there (the Web Store, `chrome://` pages, a PDF viewer). The toolbar button's tooltip says which.
- **An enterprise-managed browser** may forbid unpacked extensions; `crt browse` and `crt proxy` need none.
- **Firefox and Safari** are not supported; the extension is for Chrome and Edge 120 or newer.
- The first line the server prints when the extension mounts is `crt: overlay loaded in the browser (the extension, on <the page's origin>)`. If you never see it, the page is talking to a different server, or to none.

Once the extension has mounted for a project, plain `crt` there opens your default browser instead of the CRT browser when the app carries no integration; `crt browse` still asks for the CRT browser by name.
