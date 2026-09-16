/**
 * Reverse proxy (PRD F-2, F-3, F-4, F-6).
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
import { decodeBody, EARLY_PATH, filterAcceptEncoding, injectOverlayTag, isHtml, OVERLAY_PATH, relaxCsp } from "./inject.js";
import { handleProviderRoute } from "./provider-routes.js";
import { loginField, type ProviderRegistry } from "./session.js";
import { handleInternalRoute, handleSessionRoute, INTERNAL_PREFIX, SESSIONS_PATH, type SessionRegistry } from "./sessions.js";
import { countTaskFiles } from "./tasks.js";

export interface ProxyOptions {
  /** Target origin, e.g. `http://localhost:3000`. */
  target: string;
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
}

/** F-78/F-80: what health's `overlay` reports. */
export interface OverlayStats {
  /** HTML responses the proxy injected the overlay tag into. */
  injected: number;
  /** Requests for /__crt/overlay.js. */
  fetched: number;
  /** Content-Type of the last response to a document request (`sec-fetch-dest: document`); null before one. */
  lastContentType: string | null;
  /** The unrelaxable CSP the last injected page sent (F-80 Should), null when none was seen. */
  cspWarning: string | null;
}

/** F-80: the wait between an injected page and the "never fetched" line. */
export const OVERLAY_TIMEOUT_MS = 10_000;

export const SHUTDOWN_PATH = "/__crt/internal/shutdown";

export const CRT_PREFIX = "/__crt";
export const CAPTURES_PATH = `${CRT_PREFIX}/captures`;
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

export function createProxyServer(opts: ProxyOptions): Server {
  const target = new URL(opts.target);
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
  const state: RouteState = {
    overlay: { injected: 0, fetched: 0, lastContentType: null, cspWarning: null },
    lastInjected: "/",
    timer: null,
    warned: { missing: false, nonHtml: false, csp: false },
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

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === CRT_PREFIX || url.startsWith(CRT_PREFIX + "/")) {
      void handleCrtRoute(url, req, res, opts, state);
      return;
    }
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
  });

  server.on("upgrade", (req, socket, head) => {
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
  });
  server.on("close", () => {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
  });

  return server;
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
  overlay: OverlayStats;
  /** The last page the overlay tag went into, for the "overlay loaded" and F-80 lines. */
  lastInjected: string;
  /** F-80: the one "never fetched" timer, armed by an injected page. */
  timer: NodeJS.Timeout | null;
  /** F-80: each line prints once per server. */
  warned: { missing: boolean; nonHtml: boolean; csp: boolean };
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
  if (path === OVERLAY_PATH || path === EARLY_PATH) {
    if (path === OVERLAY_PATH && req.method !== "HEAD") {
      // F-75: the first fetch proves the injected tag reached a browser (F-80 reports the miss).
      if (state.overlay.fetched === 0) opts.log?.(`crt: overlay loaded in the browser (GET ${state.lastInjected})`);
      state.overlay.fetched++;
      if (state.timer) clearTimeout(state.timer); // F-80: the browser did ask for it
      state.timer = null;
    }
    try {
      const js = await readFile(path === OVERLAY_PATH ? opts.overlayPath : earlyPath(opts.overlayPath));
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "content-length": String(js.length),
        "cache-control": "no-store, max-age=0",
      });
      res.end(req.method === "HEAD" ? undefined : js);
    } catch {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`CRT: overlay bundle missing at ${opts.overlayPath} — run \`npm run build\``);
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
 * F-78: `{ ok, version, startedAt, target, projectRoot, tasksDir, tasks, provider, login, sessions, overlay }`
 * with `overlay` the F-80 object `{ injected, fetched, lastContentType, cspWarning }`.
 * `provider` is what a new session would run on right now (F-43 with no request value) and
 * `login` its F-74 state; both are null / "unchecked" without a registry.
 */
export function healthPayload(opts: ProxyOptions, overlay: OverlayStats): Record<string, unknown> {
  const resolution = opts.providers?.resolve(null) ?? null;
  return {
    ok: true,
    version: opts.version ?? null,
    startedAt: opts.startedAt ?? null,
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

/** early.js sits next to overlay.js in dist/. */
function earlyPath(overlayPath: string): string {
  return join(dirname(overlayPath), "early.js");
}
