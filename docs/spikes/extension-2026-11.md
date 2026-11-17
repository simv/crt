# Spike — a browser extension as the fourth way in (2026-11-17)

**Question.** Can CRT reach a page on its real URL, in the developer's everyday browser, with no proxy, no edit to the app and no change to the app's security policy — by way of a Manifest V3 extension — and how much of the overlay as built survives the move?

**Answer.** Yes. Every mechanism the design in `docs/PRD-extension.md` §5 depends on was run against a page with a strict policy, and the result decides the split of the overlay across the two script worlds.

## What was run

`extension-2026-11/run.mjs` starts two servers on `127.0.0.1`: an app whose every document carries
`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-src 'none'`,
and a stand-in for the CRT server that, like `http.ts` `applyCors`, sends no CORS header to an origin it does not know. It loads the unpacked extension in `extension-2026-11/ext/` into Playwright's Chromium (153.0.8010.12, headless, Linux) and opens the app twice: on `127.0.0.1` and on another host name (`app.example.test`, mapped to the same address with `--host-resolver-rules`).

The extension has a page-world script and an isolated-world script, both at `document_start`, and a service worker.

## Results (identical on both host names)

| # | Probe | Result |
|---|---|---|
| 1 | The page's own `fetch` to the CRT server | **Refused** by the page's `connect-src`. This is why embedded mode needs the app's policy edited today. |
| 2 | A page-world content script at `document_start` | **Runs before the app's first script**, under `script-src 'self'`, with nothing in the page asking for it. The console and network hooks can be installed where `early.js` and the loader install them. |
| 3 | A framework's private property on a DOM node (`__reactFiber$…`), read from the isolated world | **Not visible.** The isolated world sees the DOM but not the page's JavaScript properties or globals. `component.ts` has to run in the page world. |
| 4 | The same property, read in the page world and posted to the isolated world | **Arrives.** One-way data from the page is enough for the framework lookups and the two logs. |
| 5 | A content script's own `fetch` to the CRT server | **Refused** (it is the page's request as far as CORS goes). The content script cannot be the client. |
| 6 | The service worker's `fetch` — `POST` with a JSON body — to the CRT server, asked for by the content script | **200**, body read. The server saw `Origin: chrome-extension://<id>` and needed no CORS header: the extension's host permission for the loopback origin is what admits it. |
| 7 | A `text/event-stream` read by the service worker and relayed over a `chrome.runtime` port | **Three events, 400 ms apart, arrived one by one** (not buffered). The session stream of F-25 can cross the bridge. |
| 8 | `chrome.tabs.captureVisibleTab` with a host permission for the page's origin only | **Refused:** `Either the '<all_urls>' or 'activeTab' permission is required.` |
| 9 | The same with `<all_urls>` granted | **A PNG of the real pixels.** With `activeTab` it needs the developer's click on the extension first (not drivable from Playwright; a Manual row). |
| 10 | A button in a closed shadow root, styled with a constructed stylesheet, added from the isolated world under `style-src 'self'` | **Styled.** The overlay's `adoptCss` path already works this way. |

## What it means for the design

- **No policy is lifted and no header is touched.** Rows 2, 6, 7 and 10 give the overlay its script, its API, its event stream and its styles without the page's policy being asked. The CRT browser has to remove the app's `Content-Security-Policy` header to do the same (PRD-zero N-32); the extension does not.
- **The overlay moves to the isolated world; a small probe stays in the page world.** Rows 3 and 4. The probe is the two hooks and `component.ts`; it sends data and takes no commands, so a page script has nothing to call.
- **The service worker is the only client of the CRT server.** Rows 1, 5 and 6. `api.ts`, `health.ts` and the chat's `EventSource` need one seam.
- **The server needs no change to be reachable.** Row 6. It answers the worker today.
- **Real screenshots need a click or the all-sites permission.** Rows 8 and 9. Turning CRT on with the toolbar button is that click.

## Not proven here

- **A page on a public address.** Both host names resolve to loopback, so Chrome's local-network-access check was never in play. The requests come from the extension, not from the page, which is the documented way around it; a real `https://` site is a Manual row of M38.
- **How long `activeTab` lasts** across reloads and same-site navigation. M38 measures it and the fallback of F-158 covers the gap.
- **Edge**, and Chrome on Windows. Manual rows.
- **A service worker held open by a long session stream.** Row 7 ran for about a second. Chrome keeps a worker alive while a port is open and carrying messages; M38 runs a stream past the 30-second idle limit.

## Running it again

`node docs/spikes/extension-2026-11/run.mjs` from the repository root, after `npm ci` and `npx playwright install chromium`. It prints one JSON object with the rows above.
