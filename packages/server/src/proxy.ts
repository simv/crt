/**
 * The CRT server (PRD F-2, F-3, F-4, F-6; PRD-embedded F-91…F-94): the `/__crt/*` routes in
 * both modes, plus what happens to every other request.
 *
 * Embedded mode (`mode: "embedded"`, the v0.4 default, F-91): the server proxies nothing.
 *   • Every request outside /__crt/ is answered 200 text/html with the landing page (`landingPage`):
 *     the version and project, the app link when known, the `crt init` / `crt proxy` sentence, no scripts.
 *   • GET /__crt/loader.js serves dist/loader.js (F-94, F-96) with the F-6 CORS rules and no-store;
 *     health's `overlay.loader` counts it.
 *   • GET /__crt/favicon.svg (PRD-polish F-112) serves dist/favicon.svg — the mark the landing page links —
 *     with a day of cache and the F-6 CORS rules, in both modes; the PNG fallbacks sit beside it.
 *   • F-94: one 15 s timer per server, armed by `browserOpened(url)` (serve.ts calls it after opening
 *     the app); when it fires with neither the loader nor the overlay requested, the terminal says so once.
 *   • The F-75 "overlay loaded" line names the requesting page's origin (Origin, else Referer).
 *   • WebSocket upgrades are refused (nothing to forward to).
 *
 * Proxy mode (`mode: "proxy"`, `crt proxy`, F-92) — unchanged from v0.3 (N-21):
 *   • Everything not under /__crt/ is forwarded to the target with Host rewritten and
 *     X-Forwarded-* added; bodies stream both ways.
 *   • text/html responses are buffered, decompressed, injected with the overlay tag,
 *     and re-served uncompressed with a correct Content-Length (F-2).
 *   • WebSocket upgrades are replayed over a raw TCP/TLS socket and piped untouched,
 *     so Next.js / Vite HMR keep working (F-3).
 *   • /__crt/overlay.js, /__crt/early.js, /__crt/health, POST /__crt/captures (F-13, F-23), the
 *     /__crt/sessions routes (sessions.ts, F-24…F-30), /__crt/providers and /__crt/config
 *     (provider-routes.ts, F-57) are served here; anything else under /__crt/ is a 404 and never
 *     reaches the target (F-4).
 *   • /__crt/internal/* is for `crt mcp` (F-49) and `crt --replace` (PRD-setup F-79, the
 *     shutdown route) only, never a page (N-8): a request carrying an `Origin` header — which
 *     every browser sends on a POST and a Node process never does — is refused with 403 before
 *     anything else happens, CORS included.
 *   • /__crt/health is the whole story (PRD-setup F-78): version, start time, target, project,
 *     tasks, provider and its login, open sessions, and the overlay counters (injected HTML
 *     responses vs fetches of /__crt/overlay.js).
 *   • F-80: one 10 s timer per server, restarted by every injected HTML response and cleared by
 *     any request for /__crt/overlay.js; when it fires the terminal says, once, that the browser
 *     never asked for the overlay. Two more once-per-server lines (Should): a document request
 *     answered without text/html, and a CSP that relaxCsp cannot promise to fix ('strict-dynamic',
 *     a nonce, require-trusted-types-for, or a <meta http-equiv> policy). Health's `overlay` carries the counters plus
 *     `lastContentType` (the last document response) and `cspWarning` (the flagged policy).
 *   • Every other /__crt/ response carries CORS headers when the request's Origin is a localhost
 *     origin, so an app can load the overlay with a script tag instead of the proxy (F-6).
 * The caller binds the returned server to 127.0.0.1 (see serve.ts).
 */
import { readFile } from "node:fs/promises";
import {
  Agent as HttpAgent,
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { connect as netConnect } from "node:net";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import { CaptureValidationError, writeCapture } from "./captures.js";
import { applyCors, json, readJson } from "./http.js";
import type { CrtMode } from "./init.js";
import { decodeBody, EARLY_PATH, filterAcceptEncoding, injectOverlayTag, isHtml, OVERLAY_PATH, relaxCsp } from "./inject.js";
import { handleProviderRoute } from "./provider-routes.js";
import { loginField, type ProviderRegistry } from "./session.js";
import { handleInternalRoute, handleSessionRoute, INTERNAL_PREFIX, SESSIONS_PATH, type SessionRegistry } from "./sessions.js";
import { countTaskFiles } from "./tasks.js";

export interface ProxyOptions {
  /**
   * The app origin, e.g. `http://localhost:3000`: what proxy mode forwards to; what embedded mode
   * opens and links to from the landing page (null when none is known, F-91).
   */
  target: string | null;
  /** PRD-embedded F-91/F-92; defaults to `proxy` (which needs a target). */
  mode?: CrtMode;
  /** Reported by /__crt/health; every agent session CRT starts will use it as cwd. */
  projectRoot: string;
  /** Absolute path of the built overlay bundle (dist/overlay.js). */
  overlayPath: string;
  /** Intake sessions (F-24). Absent → the /__crt/sessions routes answer 503. */
  sessions?: SessionRegistry;
  /** Provider registry (F-57). Absent → /__crt/providers and /__crt/config answer 503, health has no provider. */
  providers?: ProviderRegistry;
  /** F-78 health fields: the package version and when this server started (ISO-8601). */
  version?: string;
  startedAt?: string;
  /** Absolute tasks directory; health counts its files. */
  tasksDir?: string;
  /** F-79: closes the server the way Ctrl+C does; absent → the shutdown route answers 503. */
  shutdown?: () => Promise<void>;
  /** Status lines (F-75 "overlay loaded", the F-80 lines); silent by default. */
  log?: (line: string) => void;
  /** F-80: how long the browser gets to fetch the overlay after an injected page (tests shorten it). */
  overlayTimeoutMs?: number;
  /** F-94: how long the opened app gets to request the loader or the overlay (tests shorten it). */
  loaderTimeoutMs?: number;
}

/** F-78/F-80/F-93: what health's `overlay` reports. */
export interface OverlayStats {
  /** HTML responses the proxy injected the overlay tag into. */
  injected: number;
  /** Requests for /__crt/overlay.js. */
  fetched: number;
  /** Requests for /__crt/loader.js (F-93). */
  loader: number;
  /** Content-Type of the last response to a document request (`sec-fetch-dest: document`); null before one. */
  lastContentType: string | null;
  /** The unrelaxable CSP the last injected page sent (F-80 Should), null when none was seen. */
  cspWarning: string | null;
}

/** F-80: the wait between an injected page and the "never fetched" line. */
export const OVERLAY_TIMEOUT_MS = 10_000;
/** F-94: the wait between CRT opening the app and the "never loaded the CRT loader" line. */
export const LOADER_TIMEOUT_MS = 15_000;

export const SHUTDOWN_PATH = "/__crt/internal/shutdown";

export const CRT_PREFIX = "/__crt";
export const CAPTURES_PATH = `${CRT_PREFIX}/captures`;
/** F-94/F-96: the IIFE loader, `dist/loader.js`, next to the overlay bundle. */
export const LOADER_PATH = `${CRT_PREFIX}/loader.js`;
/** PRD-polish F-112: the favicon the landing page links, `dist/favicon.svg`, next to the overlay bundle. */
export const FAVICON_PATH = `${CRT_PREFIX}/favicon.svg`;
/** F-112: the brand files the build copies into dist/ (copy-intake.mjs) — the favicon and its PNG fallbacks (Should). */
const BRAND_ASSETS = new Map<string, { file: string; type: string }>([
  [FAVICON_PATH, { file: "favicon.svg", type: "image/svg+xml" }],
  [`${CRT_PREFIX}/favicon-32.png`, { file: "favicon-32.png", type: "image/png" }],
  [`${CRT_PREFIX}/favicon-16.png`, { file: "favicon-16.png", type: "image/png" }],
]);

/** The server plus the one call embedded mode needs from serve.ts (F-94). */
export interface CrtServer extends Server {
  /** F-94: CRT just opened the browser on `url`; start the "never loaded the loader" timer (embedded mode only). */
  browserOpened(url: string): void;
}

/**
 * F-91: the page every non-/__crt/ request gets in embedded mode. Plain words, no scripts:
 * what this is, the app link when known, and the two ways forward.
 */
export function landingPage(o: { version: string | null; projectRoot: string; app: string | null }): string {
  const title = `CRT${o.version ? ` ${o.version}` : ""}`;
  const lines = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    `  <title>${escapeHtml(title)}</title>`,
    "  <style>body { margin: 40px auto; max-width: 640px; font: 15px/1.5 system-ui, sans-serif; color: #222; } code { background: #f3f3f3; padding: 1px 4px; border-radius: 3px; }</style>",
    "</head>",
    "<body>",
    `  <h1>${escapeHtml(title)} is running for ${escapeHtml(o.projectRoot)}. This is the CRT server, not your app.</h1>`,
    ...(o.app ? [`  <p><a href="${escapeHtml(o.app)}">Open ${escapeHtml(o.app)}</a> — the CRT button appears there once your app includes the CRT integration</p>`] : []),
    "  <p>Run <code>crt init</code> for the one-line snippet for your framework, or <code>crt proxy</code> to proxy your app instead.</p>",
    "</body>",
    "</html>",
    "",
  ];
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/** A capture is a JSON document with a few base64 PNGs; 64 MB is far beyond any real page. */
const MAX_CAPTURE_BODY = 64 * 1024 * 1024;

/** Headers that describe the current hop, not the message; never forwarded (RFC 7230 §6.1). */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function createProxyServer(opts: ProxyOptions): CrtServer {
  const mode: CrtMode = opts.mode ?? "proxy";
  if (mode === "proxy" && opts.target === null) throw new Error("proxy mode needs a target");
  const state: RouteState = {
    mode,
    overlay: { injected: 0, fetched: 0, loader: 0, lastContentType: null, cspWarning: null },
    lastInjected: "/",
    timer: null,
    loaderTimer: null,
    warned: { missing: false, nonHtml: false, csp: false, loader: false },
  };
  const log = opts.log ?? (() => undefined);
  const overlayTimeout = opts.overlayTimeoutMs ?? OVERLAY_TIMEOUT_MS;
  /** F-80: (re)start the one timer; it never keeps the process alive and dies with the server. */
  const armOverlayTimer = () => {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      if (state.overlay.fetched > 0 || state.warned.missing) return;
      state.warned.missing = true;
      log(
        `crt: injected the overlay into GET ${state.lastInjected} but the browser never fetched ${OVERLAY_PATH} — a Content-Security-Policy or a JS-rendered shell is blocking it; see README › Overlay does not appear`,
      );
    }, overlayTimeout);
    state.timer.unref();
  };
  const loaderTimeout = opts.loaderTimeoutMs ?? LOADER_TIMEOUT_MS;
  /** F-94: CRT opened the app; if the page asks for neither the loader nor the overlay in time, say so once per server. */
  const browserOpened = (url: string) => {
    if (mode !== "embedded") return;
    if (state.loaderTimer) clearTimeout(state.loaderTimer);
    state.loaderTimer = setTimeout(() => {
      state.loaderTimer = null;
      if (state.overlay.loader > 0 || state.overlay.fetched > 0 || state.warned.loader) return;
      state.warned.loader = true;
      log(`crt: opened ${url} but the page never loaded the CRT loader — add the integration (\`crt init\` prints the snippet, /crt:init applies it), or run \`crt proxy\``);
    }, loaderTimeout);
    state.loaderTimer.unref();
  };

  const proxy = mode === "proxy" ? proxyHandlers(new URL(opts.target!), opts, state, log, armOverlayTimer) : null;

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === CRT_PREFIX || url.startsWith(CRT_PREFIX + "/")) {
      void handleCrtRoute(url, req, res, opts, state);
      return;
    }
    if (!proxy) {
      // F-91: embedded mode proxies nothing; every other request gets the landing page.
      const page = landingPage({ version: opts.version ?? null, projectRoot: opts.projectRoot, app: opts.target });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": String(Buffer.byteLength(page)), "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : page);
      return;
    }
    proxy.request(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    if (!proxy) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    proxy.upgrade(req, socket, head);
  });
  server.on("close", () => {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (state.loaderTimer) clearTimeout(state.loaderTimer);
    state.loaderTimer = null;
  });

  return Object.assign(server, { browserOpened });
}

/** Proxy mode (F-2, F-3, F-4, F-80), verbatim from v0.3 (N-21): the request and upgrade handlers for one target. */
function proxyHandlers(
  target: URL,
  opts: ProxyOptions,
  state: RouteState,
  log: (line: string) => void,
  armOverlayTimer: () => void,
): { request(req: IncomingMessage, res: ServerResponse): void; upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void } {
  const secure = target.protocol === "https:";
  const targetPort = Number(target.port) || (secure ? 443 : 80);
  const agent = secure
    ? new HttpsAgent({ keepAlive: true, rejectUnauthorized: false })
    : new HttpAgent({ keepAlive: true });
  const request = secure ? httpsRequest : httpRequest;
  /** Every way a dev server might spell its own origin in a Location header. */
  const targetOrigins = new Set(
    ["localhost", "127.0.0.1", "[::1]", "0.0.0.0", target.hostname].map((h) => `${target.protocol}//${h}:${targetPort}`),
  );

  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    const crtOrigin = `http://${req.headers.host ?? "localhost"}`;

    const headers: OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || HOP_BY_HOP.has(k)) continue;
      headers[k] = v;
    }
    headers.host = target.host;
    const ae = filterAcceptEncoding(req.headers["accept-encoding"]);
    if (ae !== undefined) headers["accept-encoding"] = ae;
    headers["x-forwarded-host"] = req.headers.host ?? "";
    headers["x-forwarded-proto"] = "http";
    const prior = req.headers["x-forwarded-for"];
    const remote = req.socket.remoteAddress ?? "";
    headers["x-forwarded-for"] = prior ? `${prior}, ${remote}` : remote;

    let upstreamDone = false;
    const upstream = request(
      { host: target.hostname, port: targetPort, method: req.method, path: url, headers, agent },
      (up) => {
        const status = up.statusCode ?? 502;
        const outHeaders = responseHeaders(up.headers, targetOrigins, crtOrigin);
        const inject =
          isHtml(up.headers["content-type"]) && req.method !== "HEAD" && status !== 204 && status !== 304;
        if (req.headers["sec-fetch-dest"] === "document" && req.method === "GET") {
          // F-80 (Should): a navigation answered without HTML gets no overlay, and the terminal says so once.
          const ct = contentTypeOf(up.headers["content-type"]);
          state.overlay.lastContentType = ct;
          if (ct && !inject && status < 300 && !state.warned.nonHtml) {
            state.warned.nonHtml = true;
            log(`crt: GET ${url} answered ${ct}, not text/html — CRT injects only into HTML; use the script-tag fallback (README)`);
          }
        }
        up.on("end", () => {
          upstreamDone = true;
        });
        up.on("error", () => res.destroy());
        if (!inject) {
          res.writeHead(status, outHeaders);
          up.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        up.on("data", (c: Buffer) => chunks.push(c));
        up.on("end", () => {
          const raw = Buffer.concat(chunks);
          const decoded = decodeBody(raw, up.headers["content-encoding"]);
          if (decoded === null) {
            // Unknown encoding: serve it untouched rather than corrupt it.
            res.writeHead(status, outHeaders);
            res.end(raw);
            return;
          }
          // latin1 round-trips every byte, so injection is safe for any charset.
          const body = Buffer.from(injectOverlayTag(decoded.toString("latin1")), "latin1");
          state.overlay.injected++;
          state.lastInjected = url;
          armOverlayTimer();
          delete outHeaders["content-encoding"];
          outHeaders["content-length"] = String(body.length);
          const csp = outHeaders["content-security-policy"];
          if (typeof csp === "string") outHeaders["content-security-policy"] = relaxCsp(csp);
          const unrelaxable = unrelaxableCsp(typeof csp === "string" ? csp : null, decoded.toString("latin1"));
          if (unrelaxable) {
            // F-80 (Should): relaxCsp added 'self', but this policy ignores it; say so once.
            state.overlay.cspWarning = unrelaxable.policy;
            if (!state.warned.csp) {
              state.warned.csp = true;
              log(`crt: GET ${url} sends a CSP with ${unrelaxable.why} that CRT cannot relax — the overlay may be blocked; use the script-tag fallback`);
            }
          }
          res.writeHead(status, outHeaders);
          res.end(body);
        });
      },
    );
    upstream.on("error", (err: NodeJS.ErrnoException) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`CRT: target ${opts.target} unreachable (${err.code ?? err.message})`);
    });
    res.on("close", () => {
      if (!upstreamDone) upstream.destroy();
    });
    req.pipe(upstream);
  };

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const up = secure
      ? tlsConnect({ host: target.hostname, port: targetPort, servername: target.hostname, rejectUnauthorized: false })
      : netConnect({ host: target.hostname, port: targetPort });
    up.once(secure ? "secureConnect" : "connect", () => {
      up.write(rawUpgradeRequest(req, target.host));
      if (head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    wireClose(up, socket);
  };

  return { request: onRequest, upgrade: onUpgrade };
}

/** The media type of a Content-Type header, without parameters; null when absent. */
function contentTypeOf(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  return v.split(";")[0]!.trim().toLowerCase() || null;
}

/**
 * F-80 (Should): a policy relaxCsp cannot promise to make work for the same-origin overlay —
 * 'strict-dynamic' (host sources and 'self' are ignored), a nonce (listed by F-80; browsers do
 * honour the added 'self' next to a nonce, so this one is a warning, not a verdict),
 * require-trusted-types-for (the overlay assigns innerHTML), or a policy in a <meta http-equiv>
 * tag (headers are all the proxy rewrites). Returns what to say.
 */
export function unrelaxableCsp(headerCsp: string | null, html: string): { why: string; policy: string } | null {
  if (headerCsp) {
    const l = headerCsp.toLowerCase();
    if (l.includes("'strict-dynamic'")) return { why: "'strict-dynamic'", policy: headerCsp };
    if (l.includes("require-trusted-types-for")) return { why: "require-trusted-types-for", policy: headerCsp };
    if (/'nonce-[^']+'/.test(l)) return { why: "a nonce", policy: headerCsp };
  }
  const meta = /<meta\s+[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/i.exec(html);
  if (meta) return { why: "a <meta http-equiv> tag", policy: meta[0] };
  return null;
}

/** Replay the client's upgrade request verbatim, with Host rewritten and X-Forwarded-* added. */
function rawUpgradeRequest(req: IncomingMessage, targetHost: string): string {
  const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
  const raw = req.rawHeaders;
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i]!;
    const value = name.toLowerCase() === "host" ? targetHost : raw[i + 1]!;
    lines.push(`${name}: ${value}`);
  }
  lines.push(`X-Forwarded-Host: ${req.headers.host ?? ""}`, "X-Forwarded-Proto: http", "", "");
  return lines.join("\r\n");
}

function wireClose(a: Duplex, b: Duplex): void {
  a.on("error", () => b.destroy());
  b.on("error", () => a.destroy());
  a.on("close", () => b.destroy());
  b.on("close", () => a.destroy());
}

/** Copy upstream response headers minus hop-by-hop ones, rewriting Location to the CRT origin. */
function responseHeaders(
  headers: IncomingHttpHeaders,
  targetOrigins: Set<string>,
  crtOrigin: string,
): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || HOP_BY_HOP.has(k)) continue;
    out[k] = v;
  }
  const location = out.location;
  if (typeof location === "string") {
    for (const origin of targetOrigins) {
      if (location === origin || location.startsWith(origin + "/") || location.startsWith(origin + "?")) {
        out.location = crtOrigin + location.slice(origin.length);
        break;
      }
    }
  }
  return out;
}

/** Per-server counters behind the health payload (one server = one browser session, F-80). */
interface RouteState {
  mode: CrtMode;
  overlay: OverlayStats;
  /** The last page the overlay tag went into, for the "overlay loaded" and F-80 lines. */
  lastInjected: string;
  /** F-80: the one "never fetched" timer, armed by an injected page. */
  timer: NodeJS.Timeout | null;
  /** F-94: the one "never loaded the loader" timer, armed when CRT opens the app. */
  loaderTimer: NodeJS.Timeout | null;
  /** F-80/F-94: each line prints once per server. */
  warned: { missing: boolean; nonHtml: boolean; csp: boolean; loader: boolean };
}

async function handleCrtRoute(
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProxyOptions,
  state: RouteState,
): Promise<void> {
  const qs = url.indexOf("?");
  const path = qs === -1 ? url : url.slice(0, qs);
  const query = new URLSearchParams(qs === -1 ? "" : url.slice(qs + 1));
  if (path === INTERNAL_PREFIX || path.startsWith(INTERNAL_PREFIX + "/")) {
    // F-49/N-8: local processes only. A browser always sends Origin on a POST; refuse before CORS or a body read.
    if (req.headers.origin !== undefined) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (path === SHUTDOWN_PATH) {
      // F-79: `crt --replace`. Answer first, then close the way Ctrl+C does.
      if (req.method !== "POST") {
        json(res, 405, { ok: false, error: "POST here to stop this CRT" });
        return;
      }
      if (!opts.shutdown) {
        json(res, 503, { ok: false, error: "this server cannot be stopped over HTTP" });
        return;
      }
      json(res, 200, { ok: true });
      const stop = opts.shutdown;
      res.on("finish", () => void stop());
      return;
    }
    if (!opts.sessions) {
      json(res, 503, { ok: false, error: "intake sessions are not enabled on this server" });
      return;
    }
    await handleInternalRoute(path, req, res, opts.sessions);
    return;
  }
  const cors = applyCors(req, res);
  if (req.method === "OPTIONS") {
    // F-6 preflight for the JSON POSTs from script-tag mode; non-local origins get nothing.
    res.writeHead(cors ? 204 : 403);
    res.end();
    return;
  }
  if (path === OVERLAY_PATH || path === EARLY_PATH || path === LOADER_PATH) {
    if (path === OVERLAY_PATH && req.method !== "HEAD") {
      // F-75: the first fetch proves the tag reached a browser (F-80 / F-94 report the miss). Embedded
      // mode names the page's origin, since the tag came from the app, not from an injected page.
      if (state.overlay.fetched === 0) {
        opts.log?.(state.mode === "embedded" ? `crt: overlay loaded in the browser (from ${requestingOrigin(req)})` : `crt: overlay loaded in the browser (GET ${state.lastInjected})`);
      }
      state.overlay.fetched++;
      if (state.timer) clearTimeout(state.timer); // F-80: the browser did ask for it
      state.timer = null;
    }
    if (path === LOADER_PATH && req.method !== "HEAD") state.overlay.loader++; // F-93
    const file = path === OVERLAY_PATH ? opts.overlayPath : siblingOf(opts.overlayPath, path === EARLY_PATH ? "early.js" : "loader.js");
    try {
      const js = await readFile(file);
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "content-length": String(js.length),
        "cache-control": "no-store, max-age=0",
      });
      res.end(req.method === "HEAD" ? undefined : js);
    } catch {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`CRT: overlay bundle missing at ${file} — run \`npm run build\``);
    }
    return;
  }
  const asset = BRAND_ASSETS.get(path);
  if (asset) {
    // F-112: a static file with a day of cache (the bundles above are no-store on purpose; the mark never changes at runtime).
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("allow", "GET, HEAD");
      json(res, 405, { ok: false, error: `GET ${path}` });
      return;
    }
    const file = siblingOf(opts.overlayPath, asset.file);
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": asset.type, "content-length": String(body.length), "cache-control": "max-age=86400" });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`CRT: ${asset.file} missing at ${file} — run \`npm run build\``);
    }
    return;
  }
  if (path === `${CRT_PREFIX}/health`) {
    json(res, 200, healthPayload(opts, state.overlay));
    return;
  }
  if (path === `${CRT_PREFIX}/providers` || path === `${CRT_PREFIX}/config`) {
    if (!opts.providers) {
      json(res, 503, { ok: false, error: "providers are not enabled on this server" });
      return;
    }
    await handleProviderRoute(path, query, req, res, opts.providers, opts.projectRoot);
    return;
  }
  if (path === CAPTURES_PATH) {
    if (req.method !== "POST") {
      json(res, 405, { ok: false, error: "POST a capture bundle here" });
      return;
    }
    const body = await readJson(req, MAX_CAPTURE_BODY);
    if (!body.ok) {
      json(res, body.status, { ok: false, error: `capture ${body.error}` });
      return;
    }
    try {
      const written = writeCapture(opts.projectRoot, body.value);
      json(res, 201, { ok: true, id: written.id, dir: written.dir, files: written.files });
    } catch (err) {
      if (err instanceof CaptureValidationError) {
        json(res, 400, { ok: false, error: err.message, errors: err.errors });
      } else {
        json(res, 500, { ok: false, error: `could not write capture: ${(err as Error).message}` });
      }
    }
    return;
  }
  if (path === SESSIONS_PATH || path.startsWith(SESSIONS_PATH + "/")) {
    if (!opts.sessions) {
      json(res, 503, { ok: false, error: "intake sessions are not enabled on this server" });
      return;
    }
    await handleSessionRoute(path, query, req, res, opts.sessions);
    return;
  }
  json(res, 404, { ok: false, error: `no CRT route ${path}` });
}

/**
 * F-78/F-93: `{ ok, version, startedAt, mode, app, target, projectRoot, tasksDir, tasks, provider, login, sessions, overlay }`
 * with `overlay` the F-80 object `{ injected, fetched, loader, lastContentType, cspWarning }`.
 * `app` is the app URL (null when embedded mode found none) and `target` equals it for the
 * skills and the e2e assertions. `provider` is what a new session would run on right now (F-43
 * with no request value) and `login` its F-74 state; both are null / "unchecked" without a registry.
 */
export function healthPayload(opts: ProxyOptions, overlay: OverlayStats): Record<string, unknown> {
  const resolution = opts.providers?.resolve(null) ?? null;
  return {
    ok: true,
    version: opts.version ?? null,
    startedAt: opts.startedAt ?? null,
    mode: opts.mode ?? "proxy",
    app: opts.target,
    target: opts.target,
    projectRoot: opts.projectRoot,
    tasksDir: opts.tasksDir ?? null,
    tasks: opts.tasksDir ? countTaskFiles(opts.tasksDir) : 0,
    provider: resolution?.provider ?? null,
    login: resolution && opts.providers ? loginField(resolution, opts.providers) : "unchecked",
    sessions: opts.sessions ? opts.sessions.list().filter((s) => s.state !== "ended" && s.state !== "error").length : 0,
    overlay: { ...overlay },
  };
}

/** early.js and loader.js sit next to overlay.js in dist/. */
function siblingOf(overlayPath: string, name: string): string {
  return join(dirname(overlayPath), name);
}

/** F-94: the origin of the page that requested a bundle — `Origin`, else `Referer`'s origin, else "an unknown origin". */
export function requestingOrigin(req: Pick<IncomingMessage, "headers">): string {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin && origin !== "null") return origin;
  const referer = req.headers.referer;
  if (typeof referer === "string") {
    try {
      return new URL(referer).origin;
    } catch {
      // fall through
    }
  }
  return "an unknown origin";
}
