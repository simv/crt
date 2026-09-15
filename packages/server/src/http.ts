/** Small helpers shared by the /__crt/ route handlers (proxy.ts, sessions.ts). */
import type { IncomingMessage, ServerResponse } from "node:http";

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
