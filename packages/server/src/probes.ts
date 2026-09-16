/**
 * Localhost probes behind the guided start and `crt doctor` (PRD-setup F-73, F-76, F-79, N-16):
 * is a port free, is the thing on it a CRT (its `/__crt/health`), and can it be asked to stop.
 * Nothing here talks to anything but 127.0.0.1; start.ts and doctor.ts receive these as
 * injected dependencies so their transcripts are unit rows without sockets.
 */
import { request } from "node:http";
import { createServer } from "node:net";
import { SHUTDOWN_PATH } from "./proxy.js";
import type { CrtHealth } from "./start.js";

/** F-73: a cold Node server on Windows can take longer than a few hundred ms to answer its first request. */
export const HEALTH_TIMEOUT_MS = 1_000;
/** F-79: how long `--replace` waits for the port after the shutdown was acknowledged. */
export const REPLACE_WAIT_MS = 5_000;

/** True when a throwaway server can bind `127.0.0.1:port` right now. */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

/**
 * F-73: `GET /__crt/health` on the port (1 s, retried once). The parsed payload when it is a CRT
 * — any version: v0.1/v0.2 servers answer without `version`/`startedAt`, which stay null — and
 * null when the port answers something else, nothing, or not in time.
 */
export async function fetchHealth(port: number, timeoutMs = HEALTH_TIMEOUT_MS): Promise<CrtHealth | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = await get(port, "/__crt/health", timeoutMs);
    if (body === null) continue;
    return parseHealth(body);
  }
  return null;
}

/** A CRT health payload → `CrtHealth`; null when the JSON is not a CRT's. */
export function parseHealth(body: string): CrtHealth | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const h = parsed as Record<string, unknown>;
  if (h.ok !== true || typeof h.target !== "string" || typeof h.projectRoot !== "string") return null;
  return {
    version: typeof h.version === "string" ? h.version : null,
    startedAt: typeof h.startedAt === "string" ? h.startedAt : null,
    target: h.target,
    projectRoot: h.projectRoot,
    sessions: typeof h.sessions === "number" ? h.sessions : 0,
  };
}

/**
 * F-79: ask the CRT on `port` to stop (`POST /__crt/internal/shutdown`, no Origin header — a Node
 * process never sends one, which is what lets it through N-8) and wait for the port to free up.
 */
export async function requestShutdown(port: number, waitMs = REPLACE_WAIT_MS): Promise<{ ok: true } | { ok: false; reason: string }> {
  const answer = await post(port, SHUTDOWN_PATH, HEALTH_TIMEOUT_MS * 2);
  if (answer === null) return { ok: false, reason: "no answer from its shutdown route" };
  if (answer.status !== 200) return { ok: false, reason: `its shutdown route answered ${answer.status}` };
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return { ok: true };
    await new Promise((r) => setTimeout(r, 100));
  }
  return { ok: false, reason: `still listening after ${Math.round(waitMs / 1000)} s` };
}

function get(port: number, path: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", timeout: timeoutMs, headers: { accept: "application/json" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(res.statusCode === 200 ? Buffer.concat(chunks).toString("utf8") : null));
      res.on("error", () => resolve(null));
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
    req.end();
  });
}

function post(port: number, path: string, timeoutMs: number): Promise<{ status: number } | null> {
  return new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port, path, method: "POST", timeout: timeoutMs, headers: { "content-length": "0" } }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      res.on("error", () => resolve(null));
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
    req.end();
  });
}
