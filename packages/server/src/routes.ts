/**
 * Every `/__crt/*` path the CRT server answers (PRD F-4: CRT's own routes, never the target's),
 * in one module with no imports, so a small caller (probes.ts, `crt mcp`) names a route without
 * loading the server that serves it. proxy.ts dispatches on these; the modules that own a route
 * re-export its constant where tests import it from them. The overlay's api.ts and health.ts import
 * the paths they call from here too, so each path is written out in full rather than as a
 * `${CRT_PREFIX}/…` template: esbuild drops an unused string constant from the overlay bundle but
 * keeps an unused template (CRT-0043; test/overlay-structure.test.ts checks every path's prefix).
 */

export const CRT_PREFIX = "/__crt";

/** F-2/F-6: the overlay bundle, `dist/overlay.js`. */
export const OVERLAY_PATH = "/__crt/overlay.js";
/** F-20: the early console/network hooks, `dist/early.js`. */
export const EARLY_PATH = "/__crt/early.js";
/** PRD-embedded F-94/F-96: the IIFE loader, `dist/loader.js`, next to the overlay bundle. */
export const LOADER_PATH = "/__crt/loader.js";
/** PRD-polish F-112: the favicon the landing page links, `dist/favicon.svg`, next to the overlay bundle. */
export const FAVICON_PATH = "/__crt/favicon.svg";
/** PRD-setup F-78: version, project, tasks, provider, sessions and the overlay counters. */
export const HEALTH_PATH = "/__crt/health";
/** F-13, F-23: `POST` a capture bundle. */
export const CAPTURES_PATH = "/__crt/captures";
/** F-24…F-30: the intake sessions (sessions.ts). */
export const SESSIONS_PATH = "/__crt/sessions";
/** PRD-providers F-57: the provider list and the local config write (provider-routes.ts). */
export const PROVIDERS_PATH = "/__crt/providers";
export const CONFIG_PATH = "/__crt/config";
/** PRD-polish F-113: the `crt doctor` rows (doctor-route.ts). */
export const DOCTOR_PATH = "/__crt/doctor";

/** PRD-providers F-49, N-8: local processes only — a request carrying `Origin` is refused before anything else. */
export const INTERNAL_PREFIX = "/__crt/internal";
/** F-49: `crt mcp` posts `write_task` here with the session's bearer token. */
export const INTERNAL_WRITE_TASK_PATH = "/__crt/internal/write-task";
/** PRD-setup F-79: `crt --replace` stops the CRT on a port. */
export const SHUTDOWN_PATH = "/__crt/internal/shutdown";

/** F-4: a request or upgrade CRT answers itself; it never reaches the target. */
export function isCrtPath(url: string): boolean {
  return url === CRT_PREFIX || url.startsWith(CRT_PREFIX + "/");
}
