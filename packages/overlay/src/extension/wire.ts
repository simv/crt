/**
 * What the extension's content script and service worker say to each other, and the pure rules
 * both sides apply (PRD-extension §5.1, §5.3, §5.4; F-155, F-157, N-43, N-45). No `chrome.*` here:
 * the unit tests in packages/server/test read these as they are.
 */
import { isLoopbackHost } from "../loader.js";
import type { StorageArea } from "../storage.js";
import type { CrtAnswer, CrtRequest, StreamEvent } from "../transport.js";

/** §5.4: the CRT server the extension talks to unless the developer set another port. */
export const DEFAULT_SERVER = "http://localhost:4400";
/** `chrome.storage.local` key: the configured CRT origin. */
export const SERVER_KEY = "server";
/** `chrome.storage.local` key: F-164's routes — a site's origin → the CRT origin its reviews go to. */
export const ROUTES_KEY = "routes";
/** The name of the port a session stream is relayed over (F-157). */
export const EVENTS_PORT = "crt-events";
/** F-162: how the worker names itself and the page to the CRT server on every request. */
export const VIA_HEADER = "x-crt-via";
export const PAGE_HEADER = "x-crt-page";
export const VIA_EXTENSION = "extension";

export type Stored = Partial<Record<StorageArea, Record<string, string>>>;

/** Content script → worker. */
export type ToWorker =
  | { kind: "hello" }
  | { kind: "json"; path: string; init?: CrtRequest }
  | { kind: "capture" }
  | { kind: "store"; area: StorageArea; key: string; value: string | null }
  | { kind: "badge"; state: BadgeState };

/** `hello`'s answer: whether this page's site is on, and what the overlay needs before it mounts. */
export interface Hello {
  on: boolean;
  /** The CRT origin the worker talks to (for the overlay's own lines: the pill, the health tooltip). */
  server: string;
  /** PRD-connect F-165: no CRT server answers for this page — the worker does, and the review is kept in this browser. */
  standalone: boolean;
  /** The extension's version (N-45). */
  version: string;
  /** F-153: what the overlay stored for this site (local) and this tab (session). */
  stored: Stored;
}

/** `json`'s answer: the server's, or `failed` when the request did not complete or was refused here. */
export type JsonAnswer = CrtAnswer | { failed: string };
/** `capture`'s answer: the tab's picture as base64 PNG, or why Chrome refused (F-158). */
export type CaptureAnswer = { ok: true; png: string } | { ok: false; error: string };

/** Worker → content script. */
export type ToContent = { kind: "off" } | { kind: "on" };

/** Over the events port: content script → worker, then worker → content script. */
export interface StreamOpen {
  path: string;
  /** The last event id seen, for the replay after a reconnect (F-157). */
  lastEventId: string;
}
export type StreamMessage = { event: StreamEvent } | { open: true } | { end: "closed" | "dropped" } | { ping: true };

export type BadgeState = "on" | "no server" | "mismatch" | "off";

/**
 * N-43: the configured server as an origin, when it is http(s) on a loopback host; null for
 * anything else, so the worker can never be pointed at another machine.
 */
export function loopbackServer(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol === "http:" || url.protocol === "https:") && isLoopbackHost(url.hostname)) return url.origin;
  } catch {
    // not a URL
  }
  return null;
}

/** The options page's field: a port number → the origin on localhost; null when it is not a port. */
export function serverForPort(port: unknown): string | null {
  const n = typeof port === "number" ? port : typeof port === "string" && /^\d{1,5}$/.test(port.trim()) ? Number(port.trim()) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 65535 ? `http://localhost:${n}` : null;
}

/**
 * F-164: the CRT server a site's reviews go to — the route chosen for that site on the options
 * page, else the default server, else `DEFAULT_SERVER`. Each is loopback or ignored (N-43).
 */
export function routeFor(origin: string, routes: unknown, fallback: unknown): string {
  const route = routes && typeof routes === "object" && Object.hasOwn(routes, origin) ? (routes as Record<string, unknown>)[origin] : undefined;
  return loopbackServer(route) ?? loopbackServer(fallback) ?? DEFAULT_SERVER;
}

/** How far past its port a CRT server may have fallen back when the port was busy (start.ts `PORT_STEPS`). */
const PORT_STEPS = 9;

/**
 * F-164: where the options page looks for running CRT servers — port 4400 and the default
 * server's port, each with the nine ports a busy one falls back to, and every server a site is
 * already routed to. Loopback origins only (N-43), each once.
 */
export function scanTargets(fallback: unknown, routes: unknown): string[] {
  const out = new Set<string>();
  const from = (server: string) => {
    const url = new URL(server);
    const first = Number(url.port || "80");
    if (url.hostname !== "localhost" || url.protocol !== "http:") return void out.add(server);
    for (let p = first; p <= Math.min(first + PORT_STEPS, 65535); p++) out.add(`http://localhost:${p}`);
  };
  from(DEFAULT_SERVER);
  const configured = loopbackServer(fallback);
  if (configured) from(configured);
  if (routes && typeof routes === "object") {
    for (const value of Object.values(routes as Record<string, unknown>)) {
      const server = loopbackServer(value);
      if (server) out.add(server);
    }
  }
  return [...out];
}

/** A running CRT server as the options page lists it. */
export interface FoundServer {
  server: string;
  projectRoot: string | null;
  version: string | null;
}

/** F-164: a health answer as a list entry; null when it is not a CRT server's. What it says is shown as text, never used as a path or an address. */
export function foundServer(server: string, health: unknown): FoundServer | null {
  if (!health || typeof health !== "object" || (health as { ok?: unknown }).ok !== true) return null;
  const h = health as { projectRoot?: unknown; version?: unknown };
  const text = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 300) : null);
  return { server, projectRoot: text(h.projectRoot), version: text(h.version) };
}

/** The last folder of a project root, with either slash: `C:\Projects\my-app` → `my-app`. */
export function projectName(root: string | null): string {
  const parts = (root ?? "").split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "unknown project";
}

/** F-164: one line for a server in a list: `my-app — port 4401`. */
export function serverLabel(found: Pick<FoundServer, "server" | "projectRoot">): string {
  return `${projectName(found.projectRoot)} — port ${new URL(found.server).port || "80"}`;
}

/**
 * F-157, N-42: a path the worker will request for a page — a `/__crt/` route, never one of the
 * `/__crt/internal/` routes (local processes only, PRD-providers N-8), never anything that could
 * leave the CRT origin when resolved against it.
 */
export function isCrtApiPath(path: unknown): path is string {
  if (typeof path !== "string" || !path.startsWith("/__crt/") || path.startsWith("/__crt/internal")) return false;
  if (/[\\\s]/.test(path) || path.includes("//") || path.includes("..")) return false;
  return true;
}

/** F-155: a page the extension can be turned on for — http(s) only. Its origin, or null. */
export function siteOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * F-155: how one site is named to Chrome. The registration's match pattern carries the port, so
 * `http://localhost:3000` is on and `http://localhost:5173` is not; a host permission has no port
 * (Chrome grants a host, not an origin), so the permission names the scheme and host.
 */
export function sitePatterns(origin: string): { permission: string; match: string } {
  const u = new URL(origin);
  return { permission: `${u.protocol}//${u.hostname}/*`, match: `${u.origin}/*` };
}

export const PROBE_ID = "crt-probe:";
export const CONTENT_ID = "crt-overlay:";

/** One registration, in the shape `chrome.scripting.registerContentScripts` takes (spelled here so this module needs no `chrome` types). */
export interface SiteScript {
  id: string;
  matches: string[];
  js: string[];
  runAt: "document_start";
  world: "ISOLATED" | "MAIN";
  allFrames: boolean;
  persistAcrossSessions: boolean;
}

/** F-155: the two registrations of one site — the probe in the page's world, the overlay in the isolated one, both before the page's first script. */
export function siteScripts(origin: string): SiteScript[] {
  const { match } = sitePatterns(origin);
  const common = (): Omit<SiteScript, "id" | "js" | "world"> => ({ matches: [match], runAt: "document_start", allFrames: false, persistAcrossSessions: true });
  return [
    { ...common(), id: PROBE_ID + origin, js: ["probe.js"], world: "MAIN" },
    { ...common(), id: CONTENT_ID + origin, js: ["content.js"], world: "ISOLATED" },
  ];
}

/** The sites that are on, read back from the registrations (they are the one record, F-155). */
export function sitesOf(scripts: ReadonlyArray<{ id: string }>): string[] {
  return scripts.filter((s) => s.id.startsWith(CONTENT_ID)).map((s) => s.id.slice(CONTENT_ID.length));
}

/** N-45: the same major.minor. */
export function sameMinor(a: unknown, b: unknown): boolean {
  const mm = (v: unknown) => (typeof v === "string" ? /^(\d+)\.(\d+)\./.exec(v) : null);
  const x = mm(a);
  const y = mm(b);
  return !!x && !!y && x[1] === y[1] && x[2] === y[2];
}

/** §5.5 / N-45: the one line in place of the launcher when the versions differ. */
export function mismatchLine(extension: string, server: string | null): string {
  return `CRT extension ${extension} and CRT server ${server ?? "(unknown version)"} do not match — run \`crt extension\`, then Reload it in chrome://extensions`;
}

/**
 * F-157: a `text/event-stream` body as it arrives, chunk by chunk. `push` returns the events the
 * chunk completed. Comment lines and `retry:` are dropped; `id:` persists across events, as the
 * EventSource rules say.
 */
export function sseParser(): { push(chunk: string): StreamEvent[]; lastId(): string } {
  let buffer = "";
  let id = "";
  let type = "";
  let data: string[] = [];
  return {
    lastId: () => id,
    push(chunk) {
      buffer += chunk;
      const out: StreamEvent[] = [];
      for (;;) {
        const nl = buffer.search(/\r\n|\n|\r/);
        if (nl < 0) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + (buffer.startsWith("\r\n", nl) ? 2 : 1));
        if (line === "") {
          if (data.length) out.push({ type: type || "message", id, data: data.join("\n") });
          type = "";
          data = [];
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "data") data.push(value);
        else if (field === "event") type = value;
        else if (field === "id" && !value.includes("\0")) id = value;
      }
      return out;
    },
  };
}
