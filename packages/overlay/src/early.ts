/**
 * Early hook (PRD F-20). Built to `dist/early.js` and injected by the proxy as a small blocking
 * script right before the deferred overlay tag, so console/error output from the page's own
 * inline scripts is captured. Shares its buffer with overlay.js via `window.__crt.__console`.
 */
import { installConsoleHooks } from "./console-hook.js";

installConsoleHooks();
