/**
 * Reverse proxy (PRD F-2, F-3, F-4).
 *   • Everything not under /__crt/ is forwarded to the target with Host rewritten and
 *     X-Forwarded-* added; bodies stream both ways.
 *   • text/html responses are buffered, decompressed, injected with the overlay tag,
 *     and re-served uncompressed with a correct Content-Length (F-2).
 *   • WebSocket upgrades are replayed over a raw TCP/TLS socket and piped untouched,
 *     so Next.js / Vite HMR keep working (F-3).
 *   • /__crt/overlay.js and /__crt/health are served here; anything else under /__crt/
 *     is a 404 and never reaches the target (F-4).
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
import type { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import { decodeBody, filterAcceptEncoding, injectOverlayTag, isHtml, OVERLAY_PATH, relaxCsp } from "./inject.js";

export interface ProxyOptions {
  /** Target origin, e.g. `http://localhost:3000`. */
  target: string;
  /** Reported by /__crt/health; every Claude session CRT starts will use it as cwd. */
  projectRoot: string;
  /** Absolute path of the built overlay bundle (dist/overlay.js). */
  overlayPath: string;
}

export const CRT_PREFIX = "/__crt";

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

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === CRT_PREFIX || url.startsWith(CRT_PREFIX + "/")) {
      void handleCrtRoute(url, req, res, opts);
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
          delete outHeaders["content-encoding"];
          outHeaders["content-length"] = String(body.length);
          const csp = outHeaders["content-security-policy"];
          if (typeof csp === "string") outHeaders["content-security-policy"] = relaxCsp(csp);
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

  return server;
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

async function handleCrtRoute(
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProxyOptions,
): Promise<void> {
  const path = url.split("?")[0];
  if (path === OVERLAY_PATH) {
    try {
      const js = await readFile(opts.overlayPath);
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
    json(res, 200, { ok: true, target: opts.target, projectRoot: opts.projectRoot });
    return;
  }
  json(res, 404, { ok: false, error: `no CRT route ${path}` });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(text)),
    "cache-control": "no-store",
  });
  res.end(text);
}
