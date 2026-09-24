import type { Server } from "node:http";
import { startStubSession, stubCapabilities } from "../../src/providers/stub.js";
import type { PreflightResult, ProviderProfile } from "../../src/providers/types.js";
import type { StartSessionOptions } from "../../src/session-events.js";

// HTTP plumbing the route tests share: a server on an ephemeral loopback port, a JSON client for
// its `/__crt/*` routes, and a provider profile with a scripted preflight.

/** Listen on 127.0.0.1 at a port the OS picks; `close()` drops open connections first. */
export async function listen0(server: Server): Promise<{ port: number; origin: string; close(): Promise<void> }> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    origin: `http://localhost:${port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export type Api = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; json: Record<string, unknown> }>;

/**
 * A JSON client for the server at `origin()` (a function, so a suite can bind it before its
 * `beforeAll` has listened). A body is sent as JSON; a response that is not JSON reads as `{}`.
 */
export function apiAt(origin: () => string): Api {
  return async (method, path, body, headers = {}) => {
    const res = await fetch(origin() + path, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
}

/**
 * A provider profile `id` whose preflight answers `result` and whose sessions are the scripted stub
 * (F-42). `on.preflight` / `on.start` observe the calls.
 */
export function fakeProvider(id: string, result: PreflightResult, on: { preflight?: () => void; start?: (opts: StartSessionOptions) => void } = {}): ProviderProfile {
  return {
    id,
    displayName: id.toUpperCase(),
    agentName: `${id} CLI`,
    markers: { private: [`.${id}/`], shared: ["AGENTS.md"] },
    launchEnv: [],
    hints: { install: `install ${id}`, login: `${id} login` },
    capabilities: stubCapabilities("default"),
    telemetryOptOut: [],
    skillsDirs: () => ({ project: null, user: null }),
    preflight: async () => {
      on.preflight?.();
      return result;
    },
    resumeCommand: (n) => `${id} resume ${n}`,
    start: (opts) => {
      on.start?.(opts);
      return startStubSession(opts);
    },
  };
}
