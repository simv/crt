/**
 * Target dev-server detection (PRD F-1, amended by PRD-setup F-69/F-71).
 * Resolution — positional or `--target` → `.crt/config.local.json` → `.crt/config.json` → probe —
 * is decided in start.ts; this module owns the pieces: what counts as a target on the command
 * line (`looksLikeTarget`), how a value becomes an origin (`normalizeTarget`), and the probes.
 * Any HTTP status counts as "up"; only a connection failure or timeout counts as down. The probe
 * collects *every* responder on the well-known ports and labels it with the response's `<title>`
 * or `X-Powered-By` so a developer with two dev servers up can tell them apart (F-71).
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { CrtError } from "./errors.js";

export const PROBE_PORTS = [3000, 5173, 8080, 4200, 8000, 3001] as const;
export const PROBE_TIMEOUT_MS = 1500;
/** How much of a probed body is read for a `<title>`; a dev server's shell has it well before this. */
const LABEL_BYTES = 16 * 1024;

/**
 * F-69: the first argument that is not a command name is the target when it is bare digits,
 * `host:port` or `scheme://…`. `-h` and words like `doctor` are not targets.
 */
export function looksLikeTarget(arg: string): boolean {
  const s = arg.trim();
  if (!s || s.startsWith("-")) return false;
  if (/^\d{1,5}$/.test(s)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return true;
  return /^[a-z0-9.-]+(?:\.[a-z0-9-]+)*:\d{1,5}(?:\/.*)?$/i.test(s) || /^\[[0-9a-f:]+\]:\d{1,5}(?:\/.*)?$/i.test(s);
}

/** Accepts `3000`, `localhost:3000`, `http://localhost:3000/` and returns a normalised origin. */
export function normalizeTarget(input: string): string {
  let s = input.trim();
  if (/^\d+$/.test(s)) s = `http://localhost:${s}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new CrtError(`target "${input}" is not a valid URL — use e.g. --target http://localhost:3000`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CrtError(`target "${input}" must be http:// or https://`);
  }
  return url.origin;
}

/** F-71 prompt validation: the origin, or null when the answer is not a URL or port. */
export function parseTargetAnswer(answer: string): string | null {
  const s = answer.trim();
  if (!looksLikeTarget(s)) return null;
  try {
    return normalizeTarget(s);
  } catch {
    return null;
  }
}

export interface ProbeResult {
  up: boolean;
  /** The response's `<title>` or `X-Powered-By`, when the server sent one; null otherwise. */
  label: string | null;
}

/** GET `origin` once; up when anything answers HTTP within the timeout, with its label (F-71). */
export function probeOrigin(origin: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  const url = new URL(origin);
  const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
    method: "GET",
    timeout: timeoutMs,
    rejectUnauthorized: false,
    headers: { accept: "text/html, */*" },
  });
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: ProbeResult) => {
      if (settled) return;
      settled = true;
      req.destroy();
      resolve(r);
    };
    req.on("response", (res) => {
      const poweredBy = res.headers["x-powered-by"];
      const fallback = (Array.isArray(poweredBy) ? poweredBy[0] : poweredBy)?.trim() || null;
      const chunks: Buffer[] = [];
      let size = 0;
      const finish = () => done({ up: true, label: titleOf(Buffer.concat(chunks).toString("utf8")) ?? fallback });
      res.on("data", (c: Buffer) => {
        chunks.push(c);
        size += c.length;
        if (size >= LABEL_BYTES) finish();
      });
      res.on("end", finish);
      res.on("error", finish);
      // A server that streams forever (an SSE endpoint on /) still answers within the timeout.
      setTimeout(finish, timeoutMs).unref();
    });
    req.on("timeout", () => done({ up: false, label: null }));
    req.on("error", () => done({ up: false, label: null }));
    req.end();
  });
}

/** True when something answers HTTP at `origin` within the timeout, regardless of status. */
export async function isReachable(origin: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return (await probeOrigin(origin, timeoutMs)).up;
}

export interface ProbeHit {
  origin: string;
  label: string | null;
}

export interface ProbeAllOptions {
  ports?: readonly number[];
  host?: string;
  timeoutMs?: number;
}

/** F-71: every port that answers, in probe order, probed in parallel so the wait is one timeout. */
export async function probeAll(opts: ProbeAllOptions = {}): Promise<ProbeHit[]> {
  const host = opts.host ?? "localhost";
  const ports = opts.ports ?? PROBE_PORTS;
  const results = await Promise.all(
    ports.map(async (port) => {
      const origin = `http://${host}:${port}`;
      const r = await probeOrigin(origin, opts.timeoutMs);
      return r.up ? { origin, label: r.label } : null;
    }),
  );
  return results.filter((r): r is ProbeHit => r !== null);
}

/** The text of the first `<title>` in `html`, whitespace collapsed and entities left alone; null when absent. */
export function titleOf(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const text = m[1]!.replace(/\s+/g, " ").trim();
  return text ? (text.length > 60 ? `${text.slice(0, 57)}…` : text) : null;
}

/** `http://localhost:3000` → `3000` for the `crt <port>` hints; the origin itself when it is not a localhost port. */
export function shortTarget(origin: string): string {
  const url = new URL(origin);
  return url.hostname === "localhost" && url.protocol === "http:" && url.port ? url.port : origin;
}
