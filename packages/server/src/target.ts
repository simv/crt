/**
 * Target dev-server detection (PRD F-1).
 * Resolution order: `--target` flag → `.crt/config.json` `target` → probe the
 * well-known ports in order and take the first that answers HTTP at all.
 * Any HTTP status counts as "up"; only a connection failure or timeout counts as down.
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { CrtError } from "./errors.js";

export const PROBE_PORTS = [3000, 5173, 8080, 4200, 8000, 3001] as const;
const PROBE_TIMEOUT_MS = 1500;

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

/** True when something answers HTTP at `origin` within the timeout, regardless of status. */
export function isReachable(origin: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const url = new URL(origin);
  const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
    method: "GET",
    timeout: timeoutMs,
    rejectUnauthorized: false,
    headers: { accept: "*/*" },
  });
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      req.destroy();
      resolve(ok);
    };
    req.on("response", (res) => {
      res.resume();
      done(true);
    });
    req.on("timeout", () => done(false));
    req.on("error", () => done(false));
    req.end();
  });
}

export interface ResolveTargetOptions {
  /** `--target` flag value, if given. */
  flag?: string | undefined;
  /** `target` from .crt/config.json, if set. */
  configTarget?: string | null | undefined;
  /** Ports to probe when neither is set. */
  ports?: readonly number[];
  /** Host to probe on. */
  host?: string;
}

export interface ResolvedTarget {
  origin: string;
  source: "flag" | "config" | "probe";
}

export async function resolveTarget(opts: ResolveTargetOptions = {}): Promise<ResolvedTarget> {
  const host = opts.host ?? "localhost";
  const explicit = opts.flag ?? opts.configTarget ?? null;
  if (explicit) {
    const origin = normalizeTarget(explicit);
    if (!(await isReachable(origin))) {
      throw new CrtError(
        `target ${origin} is not responding — start your dev server there or pass --target <url>`,
      );
    }
    return { origin, source: opts.flag ? "flag" : "config" };
  }
  const ports = opts.ports ?? PROBE_PORTS;
  for (const port of ports) {
    const origin = `http://${host}:${port}`;
    if (await isReachable(origin)) return { origin, source: "probe" };
  }
  throw new CrtError(`no dev server found on ports ${ports.join(", ")} — start it, or pass --target <url>`);
}
