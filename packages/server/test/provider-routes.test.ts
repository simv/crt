import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixture, type Fixture } from "../e2e/fixture/server.mjs";
import { writeCapture } from "../src/captures.js";
import { readConfig } from "../src/init.js";
import { startStubSession, stubCapabilities } from "../src/providers/stub.js";
import type { PreflightResult, ProviderProfile } from "../src/providers/types.js";
import { createProxyServer } from "../src/proxy.js";
import { ProviderRegistry } from "../src/session.js";
import type { SessionEvent, StartSessionOptions } from "../src/session-events.js";
import { SessionRegistry } from "../src/sessions.js";
import { samplePost } from "./helpers/sample-capture.js";

// F-57 routes and their N-8 allowlist, against fake profiles with scripted preflights: `alpha`
// is usable, `beta` is not on PATH. The server is started with `--provider alpha` so the test can
// show PUT replacing the flag (F-43 step 2) without a restart.

let fixture: Fixture;
let proxy: Server;
let crt: string;
let root: string;
let providers: ProviderRegistry;
let sessions: SessionRegistry;
let preflights = 0;
const started: StartSessionOptions[] = [];

function fake(id: string, result: PreflightResult): ProviderProfile {
  return {
    id,
    displayName: id.toUpperCase(),
    agentName: `${id} CLI`,
    markers: { private: [`.${id}/`], shared: ["AGENTS.md"] },
    launchEnv: [],
    hints: { install: `install ${id}`, login: `${id} login` },
    capabilities: stubCapabilities("default"),
    telemetryOptOut: [],
    preflight: async () => {
      preflights++;
      return result;
    },
    resumeCommand: (n) => `${id} resume ${n}`,
    start: (opts) => {
      started.push(opts);
      return startStubSession(opts);
    },
  };
}

const alpha = fake("alpha", { installed: true, loggedIn: true, version: "1.0.0", problem: null });
const beta = fake("beta", { installed: false, loggedIn: "unknown", version: null, problem: "beta not found on PATH — install beta" });

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "crt-routes-"));
  mkdirSync(join(root, ".crt", "tasks"), { recursive: true });
  writeFileSync(join(root, ".crt", "config.json"), JSON.stringify({ tasksDir: ".crt/tasks", models: { alpha: "alpha-large" } }));
  fixture = await startFixture();
  providers = new ProviderRegistry({ root, env: {}, config: readConfig(root), flag: "alpha", profiles: [alpha, beta] });
  await providers.refresh();
  sessions = new SessionRegistry({ projectRoot: root, tasksDir: join(root, ".crt", "tasks"), intakePrompt: "INTAKE", providers, permissionTimeoutMs: 200 });
  proxy = createProxyServer({ target: fixture.url, projectRoot: root, overlayPath: join(root, "overlay.js"), sessions, providers });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  const port = (proxy.address() as { port: number }).port;
  sessions.mcpPort = port;
  crt = `http://localhost:${port}`;
});

afterAll(async () => {
  sessions.closeAll();
  proxy.closeAllConnections();
  await new Promise<void>((r) => proxy.close(() => r()));
  await fixture.close();
  rmSync(root, { recursive: true, force: true });
});

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(crt + path, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

describe("GET /__crt/providers (F-45, F-57)", () => {
  it("returns the F-57 payload — active, decision, one row per listed profile — and never the stub without CRT_SESSION_STUB (F-42, F-57)", async () => {
    const r = await api("GET", "/__crt/providers");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, active: "alpha", decision: { provider: expect.any(String) } });
    const rows = r.json.providers as Array<Record<string, unknown>>;
    expect(rows.map((p) => p.id)).toEqual(["alpha", "beta"]);
    expect(rows[0]).toEqual({ id: "alpha", displayName: "ALPHA", installed: true, loggedIn: true, version: "1.0.0", problem: null, markers: [], capabilities: stubCapabilities("default") });
    expect(rows[1]).toMatchObject({ id: "beta", installed: false, problem: "beta not found on PATH — install beta" });
    expect(Object.keys(rows[0]!).sort()).toEqual(["capabilities", "displayName", "id", "installed", "loggedIn", "markers", "problem", "version"]);
    expect((await api("POST", "/__crt/providers")).status).toBe(405);
  });

  it("?refresh=1 re-runs every preflight; without it the cache answers (F-56, F-57)", async () => {
    const before = preflights;
    await api("GET", "/__crt/providers");
    expect(preflights).toBe(before);
    await api("GET", "/__crt/providers?refresh=1");
    expect(preflights).toBe(before + 2);
  });
});

describe("PUT /__crt/config (F-43, F-57, N-8)", () => {
  it("rejects an object provider, a non-built-in id, an unusable id, a model with a space, extra keys and non-objects (F-57, N-8)", async () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ provider: { kind: "acp", command: "evil", args: [], name: "x" } }, /provider must be one of alpha, beta/],
      [{ provider: "gamma" }, /"gamma" is not a built-in provider/],
      [{ provider: "stub" }, /"stub" is not a built-in provider/],
      [{ provider: "beta" }, /beta not found on PATH/],
      [{ models: { alpha: "has a space" } }, /models\.alpha: a model name is 1–64 characters/],
      [{ models: { gamma: "x" } }, /models\.gamma: not a built-in provider/],
      [{ models: "alpha" }, /models must be an object/],
      [{ providers: { alpha: { command: ["evil"] } } }, /only provider and models can be set here \(got providers\)/],
      [{ provider: "alpha", target: "http://evil" }, /got target/],
      [{}, /nothing to set/],
      [[], /body must be a JSON object/],
      ["alpha", /body must be a JSON object/],
    ];
    for (const [body, error] of cases) {
      const r = await api("PUT", "/__crt/config", body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(String(r.json.error), JSON.stringify(body)).toMatch(error);
    }
    expect(existsSync(join(root, ".crt", "config.local.json"))).toBe(false);
    expect((await api("GET", "/__crt/config")).status).toBe(405);
  });

  it("writes provider and models to .crt/config.local.json only and replaces --provider for new sessions without a restart (F-43, F-57)", async () => {
    // A second usable profile to switch to: make beta usable for this test only.
    const gamma = fake("gamma", { installed: true, loggedIn: "unknown", version: "2.0.0", problem: null });
    const reg = new ProviderRegistry({ root, env: {}, config: readConfig(root), flag: "alpha", profiles: [alpha, gamma] });
    await reg.refresh();
    const sess = new SessionRegistry({ projectRoot: root, tasksDir: join(root, ".crt", "tasks"), intakePrompt: "INTAKE", providers: reg });
    const server = createProxyServer({ target: fixture.url, projectRoot: root, overlayPath: join(root, "overlay.js"), sessions: sess, providers: reg });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://localhost:${(server.address() as { port: number }).port}`;
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(base + path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    };
    try {
      expect((await call("GET", "/__crt/health")).json).toMatchObject({ ok: true, provider: "alpha" });
      const put = await call("PUT", "/__crt/config", { provider: "gamma", models: { gamma: "gamma-mini" } });
      expect(put.status).toBe(200);
      expect(put.json).toEqual({ ok: true, active: "gamma", provider: "gamma", models: { gamma: "gamma-mini" }, file: ".crt/config.local.json" });
      // F-43 step 2: the flag is replaced for the life of the process.
      expect((await call("GET", "/__crt/health")).json).toMatchObject({ provider: "gamma" });
      expect(reg.resolve(null)).toMatchObject({ provider: "gamma", layer: "active", source: "PUT /__crt/config" });
      expect((await call("GET", "/__crt/providers")).json).toMatchObject({ active: "gamma" });
      const created = await call("POST", "/__crt/sessions", {});
      expect(created.json.session).toMatchObject({ provider: "gamma" });
      // Only the local file, only the two keys; the committed file is untouched.
      const local = JSON.parse(readFileSync(join(root, ".crt", "config.local.json"), "utf8")) as Record<string, unknown>;
      expect(local).toEqual({ provider: "gamma", models: { gamma: "gamma-mini" } });
      expect(readFileSync(join(root, ".crt", "config.json"), "utf8")).toBe(JSON.stringify({ tasksDir: ".crt/tasks", models: { alpha: "alpha-large" } }));
      expect(readConfig(root)).toMatchObject({ provider: "gamma", providerSource: "local", models: { alpha: "alpha-large", gamma: "gamma-mini" } });
      // A later PUT of models alone keeps the remembered provider and merges the map.
      expect((await call("PUT", "/__crt/config", { models: { alpha: "alpha-small" } })).status).toBe(200);
      expect(JSON.parse(readFileSync(join(root, ".crt", "config.local.json"), "utf8"))).toEqual({ provider: "gamma", models: { gamma: "gamma-mini", alpha: "alpha-small" } });
      expect(reg.modelFor("alpha")).toBe("alpha-small");
      expect(reg.modelFor("gamma")).toBe("gamma-mini");
    } finally {
      sess.closeAll();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(join(root, ".crt", "config.local.json"), { force: true });
    }
  });
});

describe("POST /__crt/sessions { provider } (F-43, F-57)", () => {
  it("accepts a listed id, answers 400 to an object or unknown id, and fails a listed-but-unusable one at once with the N-7 line (F-43, F-57, N-7)", async () => {
    const cap = writeCapture(root, samplePost());
    expect((await api("POST", "/__crt/sessions", { captureId: cap.id, provider: { kind: "acp", command: "evil" } })).status).toBe(400);
    expect((await api("POST", "/__crt/sessions", { captureId: cap.id, provider: "gamma" })).status).toBe(400);
    expect((await api("POST", "/__crt/sessions", { captureId: cap.id, provider: "stub" })).status).toBe(400);
    expect((await api("POST", "/__crt/sessions", { captureId: cap.id, provider: 7 })).status).toBe(400);

    const bad = await api("POST", "/__crt/sessions", { provider: "beta" });
    expect(bad.status).toBe(201);
    expect(bad.json.session).toMatchObject({ provider: "beta", state: "starting" });
    await new Promise((r) => setTimeout(r, 30));
    expect(sessions.get(bad.json.id as string)?.state).toBe("error");
    const events: SessionEvent[] = [];
    sessions.subscribe(bad.json.id as string, 0, (_s, e) => events.push(e));
    expect(events[0]).toEqual({ type: "error", message: "beta not found on PATH — install beta" });

    const good = await api("POST", "/__crt/sessions", { captureId: cap.id, provider: "alpha" });
    expect(good.status).toBe(201);
    expect(good.json.session).toMatchObject({ provider: "alpha" });
    sessions.close(good.json.id as string);
  });

  it("hands the driver the F-49 MCP launch (token in env, never in args) and the F-57 model (F-49, F-57)", async () => {
    const before = started.length;
    const r = await api("POST", "/__crt/sessions", { provider: "alpha" });
    const opts = started[before]!;
    const token = sessions.tokenOf(r.json.id as string)!;
    expect(opts.mcp.command).toBe(process.execPath);
    expect(opts.mcp.args.at(-1)).toBe("mcp");
    expect(opts.mcp.args.join(" ")).not.toContain(token);
    expect(opts.mcp.env).toEqual({ CRT_MCP_TOKEN: token, CRT_MCP_PORT: String(sessions.mcpPort) });
    expect(opts.model).toBe("alpha-large");
    expect(opts.systemPromptAppend).toBe("INTAKE");
    expect(JSON.stringify(r.json)).not.toContain(token);
    sessions.close(r.json.id as string);
  });
});
