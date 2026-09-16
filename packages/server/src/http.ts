/** Small helpers shared by the /__crt/ route handlers (proxy.ts, sessions.ts). */
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * F-6 script-tag mode: an app on another local origin (`http://localhost:3000`) may call the
 * `/__crt/` API cross-origin. Only loopback origins qualify — `localhost`, `*.localhost`,
 * `127.0.0.1` and `[::1]`, any port, http or https — so a page from the internet cannot.
 */
export function isLocalOrigin(origin: string | undefined): origin is string {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.origin !== origin) return false; // an Origin header is exactly scheme://host[:port]
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]";
}

export const CORS_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
export const CORS_HEADERS = "content-type, last-event-id";

/**
 * Add the CORS response headers for an allowed local origin (a no-op for same-origin requests,
 * which carry no Origin, and for anything not local). Returns whether the origin was allowed.
 */
export function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (!isLocalOrigin(origin)) return false;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-methods", CORS_METHODS);
  res.setHeader("access-control-allow-headers", CORS_HEADERS);
  res.setHeader("access-control-max-age", "600");
  res.setHeader("vary", "origin");
  return true;
}

export class BodyTooLarge extends Error {
  constructor(limit: number) {
    super(`body exceeds ${limit} bytes`);
    this.name = "BodyTooLarge";
  }
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new BodyTooLarge(limit));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Parse a JSON body; the returned status is what to answer with when it fails. */
export async function readJson(req: IncomingMessage, limit: number): Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }> {
  try {
    const raw = await readBody(req, limit);
    return { ok: true, value: raw.length ? JSON.parse(raw.toString("utf8")) : {} };
  } catch (err) {
    return { ok: false, status: err instanceof BodyTooLarge ? 413 : 400, error: `body: ${(err as Error).message}` };
  }
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(text)),
    "cache-control": "no-store",
  });
  res.end(text);
}
