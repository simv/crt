import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixture, type Fixture } from "../e2e/fixture/server.mjs";
import { DOCTOR_PATH, DOCTOR_TTL_MS, type DoctorPayload, DoctorRoute, PLUGIN_TTL_MS } from "../src/doctor-route.js";
import { readConfig } from "../src/init.js";
import { createProxyServer } from "../src/proxy.js";
import { ProviderRegistry } from "../src/session.js";
import { fakeProvider, listen0 } from "./helpers/http.js";

// PRD-polish F-113 / N-24: `GET /__crt/doctor` — the doctor rows built inside the server. The
// class rows use its seams (a fake clock, a fake target probe, a fake plugin spawn) to pin the
// caches; the server rows go through createProxyServer for the wire shape (403 on Origin, HEAD,
// 405, 503 without a registry, the self port row against the real listening port).

const alpha = fakeProvider("alpha", { installed: true, loggedIn: true, version: "1.0.0", problem: null });
const beta = fakeProvider("beta", { installed: true, loggedIn: false, version: "2.0.0", problem: "beta not logged in — beta login" });

let root: string;
let providers: ProviderRegistry;
let fixture: Fixture;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "crt-doctor-route-"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, ".crt", "tasks"), { recursive: true });
  writeFileSync(join(root, ".crt", "README.md"), "# .crt\n");
  writeFileSync(join(root, ".crt", "config.json"), JSON.stringify({ tasksDir: ".crt/tasks", target: "http://localhost:3100", port: 4400 }));
  providers = new ProviderRegistry({ root, env: {}, config: readConfig(root), flag: "alpha", profiles: [alpha, beta] });
  await providers.refresh();
  fixture = await startFixture();
});

afterAll(async () => {
  await fixture.close();
  rmSync(root, { recursive: true, force: true });
});

const row = (p: DoctorPayload, name: string) => p.rows.find((r) => r.name === name);

/** A route with a fake clock (`t`), a scripted probe and a counted plugin spawn. */
function route(over: { target?: string | null; up?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  let t = 1_000_000;
  let spawns = 0;
  let probes = 0;
  const r = new DoctorRoute({
    projectRoot: root,
    mode: "embedded",
    target: over.target === undefined ? "http://localhost:3100" : over.target,
    version: "0.6.0",
    providers,
    env: over.env ?? {},
    now: () => t,
    isReachable: async () => {
      probes++;
      return over.up ?? true;
    },
    plugin: async () => {
      spawns++;
      await new Promise((res) => setTimeout(res, 20));
      return { claudeOnPath: true, installed: "0.6.0" };
    },
  });
  return { r, tick: (ms: number) => (t += ms), spawns: () => spawns, probes: () => probes };
}

describe("GET /__crt/doctor — the rows (PRD-polish F-113)", () => {
  it("renders the self port row, the running mode, the provider rows and `checkedAt` as ISO-8601; the plugin row only with ?plugin=1 (F-113)", async () => {
    const { r } = route();
    const p = await r.report(4400, false);
    expect(row(p, "port")).toEqual({ status: "ok", name: "port", detail: "4400 — this server" });
    expect(row(p, "mode")).toEqual({ status: "ok", name: "mode", detail: "embedded" });
    expect(row(p, "alpha")).toEqual({ status: "ok", name: "alpha", detail: "alpha CLI 1.0.0 — logged in" });
    expect(row(p, "beta")).toEqual({ status: "warn", name: "beta", detail: "beta CLI 2.0.0 — not logged in — beta login" });
    expect(row(p, "plugin")).toBeUndefined();
    expect(p.decision).toBe("→ alpha (--provider)");
    expect(p.exitCode).toBe(0);
    expect(new Date(p.checkedAt).toISOString()).toBe(p.checkedAt);
    expect(Object.keys(p).sort()).toEqual(["checkedAt", "decision", "exitCode", "rows"]);
    // The doctor's order, minus the plugin row (F-76).
    expect(p.rows.map((x) => x.name)).toEqual(["node", "project", ".crt", "mode", "target", "integration", "instructions", "port", "alpha", "beta"]);
    const withPlugin = await r.report(4400, true);
    expect(row(withPlugin, "plugin")).toEqual({ status: "ok", name: "plugin", detail: "crt@crt 0.6.0 installed (claude on PATH)" });
    expect(withPlugin.rows.at(-1)!.name).toBe("plugin");
  });

  it("target: the config's label when the URL matches it, `--` when none is known (embedded), `warn` when it is down — the F-103 rules (F-113)", async () => {
    expect(row(await route().r.report(4400, false), "target")).toEqual({ status: "ok", name: "target", detail: "http://localhost:3100 (.crt/config.json) — responding" });
    expect(row(await route({ target: "http://localhost:3999" }).r.report(4400, false), "target")).toEqual({ status: "ok", name: "target", detail: "http://localhost:3999 (found) — responding" });
    expect(row(await route({ target: null }).r.report(4400, false), "target")).toEqual({ status: "--", name: "target", detail: "none set; crt opens nothing (crt <port> to remember one)" });
    const down = await route({ up: false }).r.report(4400, false);
    expect(row(down, "target")).toEqual({ status: "warn", name: "target", detail: "http://localhost:3100 (.crt/config.json) — not responding" });
    expect(down.exitCode).toBe(0);
  });

  it("computes the default response at most once per 5 s: a second call inside the window returns the cached checkedAt and probes nothing; concurrent calls share one computation (N-24)", async () => {
    const { r, tick, probes } = route();
    const [a, b] = await Promise.all([r.report(4400, false), r.report(4400, false)]);
    expect(b.checkedAt).toBe(a.checkedAt);
    expect(probes()).toBe(1);
    tick(DOCTOR_TTL_MS - 1);
    expect((await r.report(4400, false)).checkedAt).toBe(a.checkedAt);
    expect(probes()).toBe(1);
    tick(1);
    const c = await r.report(4400, false);
    expect(c.checkedAt).not.toBe(a.checkedAt);
    expect(probes()).toBe(2);
    // The last default report is what the landing page renders (never computed for it).
    expect(r.cached()).toBe(c);
  });

  it("spawns the plugin check only for ?plugin=1, once per 30 s, shared by concurrent callers (N-24)", async () => {
    const { r, tick, spawns } = route();
    await r.report(4400, false);
    expect(spawns()).toBe(0);
    const [a, b] = await Promise.all([r.report(4400, true), r.report(4400, true)]);
    expect(spawns()).toBe(1);
    expect(row(a, "plugin")).toEqual(row(b, "plugin"));
    tick(PLUGIN_TTL_MS - 1);
    await r.report(4400, true);
    expect(spawns()).toBe(1);
    tick(1);
    await r.report(4400, true);
    expect(spawns()).toBe(2);
    // The fast rows follow their own 5 s cache (30 s have passed: recomputed); the page gets the fullest last report, plugin row included.
    expect(r.cached()!.checkedAt).not.toBe(a.checkedAt);
    expect(r.cached()!.rows.at(-1)!.name).toBe("plugin");
  });

  it("nothing is cached before the first request, and a failed collection is not cached (N-24)", async () => {
    const r = new DoctorRoute({ projectRoot: root, mode: "embedded", target: null, version: "0.6.0" });
    expect(r.cached()).toBeNull();
    await expect(r.report(4400, false)).rejects.toThrow("providers are not enabled on this server");
    expect(r.cached()).toBeNull();
  });
});

describe("GET /__crt/doctor — on the wire (PRD-polish F-113, N-23)", () => {
  function server(opts: { providers?: ProviderRegistry; target?: string | null } = {}) {
    return listen0(createProxyServer({ mode: "embedded", target: opts.target === undefined ? fixture.url : opts.target, projectRoot: root, overlayPath: join(root, "overlay.js"), providers: opts.providers, version: "0.6.0", env: {} }));
  }

  it("answers 200 application/json with the self row on the listening port and the app probed; HEAD is allowed, other methods are 405 (F-113)", async () => {
    const s = await server({ providers });
    try {
      const started = Date.now();
      const res = await fetch(s.origin + DOCTOR_PATH);
      expect(Date.now() - started).toBeLessThan(2_000); // N-24: the fast rows, no plugin spawn
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const p = (await res.json()) as DoctorPayload;
      expect(row(p, "port")).toEqual({ status: "ok", name: "port", detail: `${s.port} — this server` });
      expect(row(p, "target")).toEqual({ status: "ok", name: "target", detail: `${fixture.url} (found) — responding` });
      expect(row(p, "plugin")).toBeUndefined();
      const head = await fetch(s.origin + DOCTOR_PATH, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      const post = await fetch(s.origin + DOCTOR_PATH, { method: "POST" });
      expect(post.status).toBe(405);
      expect(post.headers.get("allow")).toBe("GET, HEAD");
      // The route is not CORS-enabled and the 404 fallthrough is untouched.
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      await s.close();
    }
  });

  it("refuses any request carrying an Origin header with 403 before anything else — even a loopback origin, even HEAD (N-23, the /__crt/internal/* rule)", async () => {
    const s = await server({ providers });
    try {
      for (const origin of ["http://localhost:3000", "http://evil.example", "null"]) {
        const res = await fetch(s.origin + DOCTOR_PATH, { headers: { origin } });
        expect(res.status, origin).toBe(403);
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
      }
      expect((await fetch(s.origin + DOCTOR_PATH, { method: "HEAD", headers: { origin: "http://localhost:3000" } })).status).toBe(403);
      // A browser preflight gets nothing either.
      expect((await fetch(s.origin + DOCTOR_PATH, { method: "OPTIONS", headers: { origin: "http://localhost:3000" } })).status).toBe(403);
    } finally {
      await s.close();
    }
  });

  it("answers 503 { error } without a provider registry, as /__crt/providers does (F-113)", async () => {
    const s = await server();
    try {
      const res = await fetch(s.origin + DOCTOR_PATH);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: "providers are not enabled on this server — no doctor rows" });
    } finally {
      await s.close();
    }
  });

  it("a down app is a warn row in embedded mode; a second call within 5 s returns the cached checkedAt (F-113, N-24)", async () => {
    const s = await server({ providers, target: "http://127.0.0.1:1" });
    try {
      const a = (await (await fetch(s.origin + DOCTOR_PATH)).json()) as DoctorPayload;
      expect(row(a, "target")).toEqual({ status: "warn", name: "target", detail: "http://127.0.0.1:1 (found) — not responding" });
      expect(a.exitCode).toBe(0);
      const b = (await (await fetch(s.origin + DOCTOR_PATH)).json()) as DoctorPayload;
      expect(b.checkedAt).toBe(a.checkedAt);
    } finally {
      await s.close();
    }
  });
});
