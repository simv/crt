/**
 * Early hook (PRD F-20, F-21). Built to `dist/early.js` and injected by the proxy as a small
 * blocking script right before the deferred overlay tag, so console/error output and failed
 * requests from the page's own inline scripts are captured. Shares its buffers with overlay.js
 * via `window.__crt.__console` and `window.__crt.__network`.
 */
import { installConsoleHooks } from "./console-hook.js";
import { installNetworkHooks } from "./network-hook.js";

installConsoleHooks();
installNetworkHooks();
