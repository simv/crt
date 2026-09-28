/**
 * Every `/__crt/*` path the CRT server answers (PRD F-4: CRT's own routes, never the target's),
 * in one module with no imports, so a small caller (probes.ts, `crt mcp`) names a route without
 * loading the server that serves it. proxy.ts dispatches on these; the modules that own a route
 * re-export its constant where tests import it from them.
 */

export const CRT_PREFIX = "/__crt";

/** F-2/F-6: the overlay bundle, `dist/overlay.js`. */
export const OVERLAY_PATH = `${CRT_PREFIX}/overlay.js`;
/** F-20: the early console/network hooks, `dist/early.js`. */
export const EARLY_PATH = `${CRT_PREFIX}/early.js`;
/** PRD-embedded F-94/F-96: the IIFE loader, `dist/loader.js`, next to the overlay bundle. */
export const LOADER_PATH = `${CRT_PREFIX}/loader.js`;
/** PRD-polish F-112: the favicon the landing page links, `dist/favicon.svg`, next to the overlay bundle. */
export const FAVICON_PATH = `${CRT_PREFIX}/favicon.svg`;
/** PRD-setup F-78: version, project, tasks, provider, sessions and the overlay counters. */
export const HEALTH_PATH = `${CRT_PREFIX}/health`;
/** F-13, F-23: `POST` a capture bundle. */
export const CAPTURES_PATH = `${CRT_PREFIX}/captures`;
/** F-24…F-30: the intake sessions (sessions.ts). */
export const SESSIONS_PATH = `${CRT_PREFIX}/sessions`;
/** PRD-providers F-57: the provider list and the local config write (provider-routes.ts). */
export const PROVIDERS_PATH = `${CRT_PREFIX}/providers`;
export const CONFIG_PATH = `${CRT_PREFIX}/config`;
/** PRD-polish F-113: the `crt doctor` rows (doctor-route.ts). */
export const DOCTOR_PATH = `${CRT_PREFIX}/doctor`;

/** PRD-providers F-49, N-8: local processes only — a request carrying `Origin` is refused before anything else. */
export const INTERNAL_PREFIX = `${CRT_PREFIX}/internal`;
/** F-49: `crt mcp` posts `write_task` here with the session's bearer token. */
export const INTERNAL_WRITE_TASK_PATH = `${INTERNAL_PREFIX}/write-task`;
/** PRD-setup F-79: `crt --replace` stops the CRT on a port. */
export const SHUTDOWN_PATH = `${INTERNAL_PREFIX}/shutdown`;

/** F-4: a request or upgrade CRT answers itself; it never reaches the target. */
export function isCrtPath(url: string): boolean {
  return url === CRT_PREFIX || url.startsWith(CRT_PREFIX + "/");
}
