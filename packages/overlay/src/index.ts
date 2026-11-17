/**
 * CRT overlay entry point. Loaded by the CRT loader on the app's own origin from
 * `http://localhost:4400/__crt/overlay.js` (embedded mode, PRD-embedded F-95/F-96; see base.ts),
 * or injected by the CRT proxy as <script src="/__crt/overlay.js" defer> (proxy mode, F-2).
 * Everything renders inside a Shadow DOM host so host-page CSS cannot leak in or out (PRD §5.1).
 *
 * Boot order matters: console/error and failed-request hooks first (F-20, F-21; normally already
 * installed by early.js), then the UI (mount.ts). `window.__crt` is the only global (CLAUDE.md): a
 * debugging/test surface used by the Playwright specs to drive the tools without a real pointer.
 */
import { installConsoleHooks } from "./console-hook.js";
import { mountOverlay } from "./mount.js";
import { installNetworkHooks } from "./network-hook.js";

export type { CrtTestHooks } from "./mount.js";

installConsoleHooks();
installNetworkHooks();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => mountOverlay(), { once: true });
} else {
  mountOverlay();
}
