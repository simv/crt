/**
 * The extension's page-world half (PRD-extension §5.1, F-152, F-156; built to
 * `dist/extension/probe.js`). Registered for a site the developer turned on, in the page's own
 * JavaScript world at `document_start`, so the console and network hooks are in before the app's
 * first script (docs/spikes/extension-2026-11.md row 2) and the framework lookups can see what
 * only this world holds (row 3).
 *
 * It answers questions about the page over DOM events and does nothing else (probe-wire.ts): it
 * has no `chrome.*`, makes no request and cannot reach the service worker (N-42). It leaves no
 * property on `window` — the hooks' buffers stay inside this bundle (bag.ts) — so the only things
 * a page can observe are the wrapped `console.error` / `console.warn` / `fetch` /
 * `XMLHttpRequest` it can observe on every other way in (N-44).
 */
import { usePrivateBag } from "../bag.js";
import { installConsoleHooks } from "../console-hook.js";
import { installNetworkHooks } from "../network-hook.js";
import { answerProbe, ask } from "../probe-wire.js";
import { pageProbe } from "../probe.js";

/** F-156: the page already carries CRT — a loader (the integration, the proxy, the CRT browser) or its overlay. */
function present(): boolean {
  const crt = (window as unknown as { __crt?: { loader?: unknown } }).__crt;
  return !!crt?.loader || document.getElementById("crt-host") !== null;
}

// A second copy (the click's immediate injection on a page the registration already reached) finds
// the first by asking it, so there is no flag on `window` to find it by.
if (window.top === window && ask("probe", window) !== true) {
  usePrivateBag();
  installConsoleHooks();
  installNetworkHooks();
  answerProbe({ ...pageProbe, present }, window);
}
