import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeFrame, readFrame, startFixture, type Fixture } from "../e2e/fixture/server.mjs";
import { INJECT_TAGS, OVERLAY_TAG } from "../src/inject.js";
import { createProxyServer, landingPage, requestingOrigin } from "../src/proxy.js";
import { samplePost } from "./helpers/sample-capture.js";

let fixture: Fixture;
let proxy: Server;
let crt: string; // CRT origin
let tmp: string;
const overlayJs = 'console.log("overlay stub")';
const earlyJs = 'console.log("early stub")';
const loaderJs = 'console.log("loader stub")';

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "crt-proxy-"));
  writeFileSync(join(tmp, "overlay.js"), overlayJs);
  writeFileSync(join(tmp, "early.js"), earlyJs);
  writeFileSync(join(tmp, "loader.js"), loaderJs);
  fixture = await startFixture();
  proxy = createProxyServer({ target: fixture.url, projectRoot: tmp, overlayPath: join(tmp, "overlay.js") });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  crt = `http://localhost:${(proxy.address() as { port: number }).port}`;
});

afterAll(async () => {
  proxy.closeAllConnections();
  await new Promise<void>((r) => proxy.close(() => r()));
  await fixture.close();
  rmSync(tmp, { recursive: true, force: true });
});

interface Raw {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** Plain node:http request so we see the exact headers and bytes the proxy sends. */
function raw(path: string, opts: { method?: string; headers?: Record<string, string>; body?: Buffer } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(crt + path, { method: opts.method ?? "GET", headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

describe("HTML injection (F-2)", () => {
  it("injects the overlay tag before </head> and fixes Content-Length", async () => {
    const r = await raw("/");
    expect(r.status).toBe(200);
    const html = r.body.toString();
    expect(html).toContain(`${OVERLAY_TAG}</head>`);
    expect(html).toContain('window.__fixture = "ok"');
    expect(r.headers["content-length"]).toBe(String(r.body.length));
    expect(r.headers["content-encoding"]).toBeUndefined();
  });

  it.each(["gzip", "br"])("decompresses %s, injects, and serves uncompressed", async (enc) => {
    const r = await raw(`/${enc}`, { headers: { "accept-encoding": enc } });
    expect(r.status).toBe(200);
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.headers["content-length"]).toBe(String(r.body.length));
    expect(r.body.toString()).toContain(`${OVERLAY_TAG}</head>`);
  });

  it("handles chunked upstream HTML with no Content-Length", async () => {
    const r = await raw("/chunked");
    expect(r.headers["content-length"]).toBe(String(r.body.length));
    expect(r.body.toString()).toContain(`${OVERLAY_TAG}</head>`);
  });

  it("appends the tag when the document has no <head> or <body>", async () => {
    const r = await raw("/nohead");
    expect(r.body.toString()).toBe(`<p>no head, no body</p>${INJECT_TAGS}`);
  });

  it("never asks upstream for an encoding it cannot undo", async () => {
    const r = await raw("/echo-headers", { headers: { "accept-encoding": "zstd, gzip" } });
    expect((JSON.parse(r.body.toString()) as Record<string, string>)["accept-encoding"]).toBe("gzip");
  });

  it("relaxes a Content-Security-Policy so the same-origin overlay can load", async () => {
    const r = await raw("/csp");
    expect(r.headers["content-security-policy"]).toBe("default-src 'none'; script-src 'nonce-abc' 'self'");
  });

  it("leaves non-HTML responses untouched", async () => {
    const r = await raw("/api/json");
    expect(r.headers["content-type"]).toBe("application/json");
    expect(r.body.toString()).toBe('{"hello":"world"}');
  });

  it("does not inject into HEAD responses", async () => {
    const r = await raw("/", { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(0);
  });
});

describe("reverse proxy (F-4)", () => {
  it("rewrites Host, adds X-Forwarded-*, and forwards the request body", async () => {
    const h = await raw("/echo-headers");
    const seen = JSON.parse(h.body.toString()) as Record<string, string>;
    expect(seen.host).toBe(`localhost:${fixture.port}`);
    expect(seen["x-forwarded-host"]).toBe(new URL(crt).host);
    expect(seen["x-forwarded-proto"]).toBe("http");
    expect(seen["x-forwarded-for"]).toBe("127.0.0.1");

    const body = randomBytes(70_000);
    const echoed = await raw("/echo", { method: "POST", body, headers: { "content-length": String(body.length) } });
    expect(echoed.body.equals(body)).toBe(true);
  });

  it("rewrites absolute Location headers that point at the target to the CRT origin", async () => {
    const r = await raw("/redirect");
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe(`${crt}/?from=redirect`);
  });

  it("passes upstream 404s through", async () => {
    const r = await raw("/missing");
    expect(r.status).toBe(404);
    expect(r.body.toString()).toBe("fixture: no route /missing");
  });

  it("answers 502 with a clear message when the target is down", async () => {
    const dead = createProxyServer({ target: "http://127.0.0.1:1", projectRoot: tmp, overlayPath: join(tmp, "overlay.js") });
    await new Promise<void>((r) => dead.listen(0, "127.0.0.1", r));
    const port = (dead.address() as { port: number }).port;
    const r = await new Promise<Raw>((resolve, reject) => {
      httpRequest(`http://127.0.0.1:${port}/`, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      })
        .on("error", reject)
        .end();
    });
    await new Promise<void>((r) => dead.close(() => r()));
    expect(r.status).toBe(502);
    expect(r.body.toString()).toMatch(/^CRT: target http:\/\/127\.0\.0\.1:1 unreachable \(/);
  });
});

describe("CRT routes (F-4)", () => {
  it("serves /__crt/health with the F-78 shape: target, project root, provider (null without a registry), login, sessions, overlay (F-4, F-57, F-78)", async () => {
    const r = await raw("/__crt/health");
    expect(r.status).toBe(200);
    const health = JSON.parse(r.body.toString()) as Record<string, unknown>;
    expect(health).toMatchObject({ ok: true, target: fixture.url, projectRoot: tmp, provider: null, login: "unchecked", sessions: 0, tasks: 0 });
    // PRD-embedded F-93: `mode` and `app` (= `target`) join the payload; a bare proxy is proxy mode.
    expect(health).toMatchObject({ mode: "proxy", app: fixture.url });
    expect(Object.keys(health).sort()).toEqual(["app", "login", "mode", "ok", "overlay", "projectRoot", "provider", "sessions", "startedAt", "target", "tasks", "tasksDir", "version"]);
    // No version/startedAt/tasksDir were given to this bare proxy.
    expect(health.version).toBeNull();
    expect(health.startedAt).toBeNull();
    // overlay counts injected HTML responses and overlay fetches made so far in this file.
    const overlay = health.overlay as { injected: number; fetched: number };
    expect(overlay.injected).toBeGreaterThan(0);
    expect(overlay.fetched).toBeGreaterThanOrEqual(0);
  });

  it("counts overlay fetches and logs the first one; the shutdown route refuses Origin and needs a handler (F-75, F-78, F-79)", async () => {
    const before = (JSON.parse((await raw("/__crt/health")).body.toString()) as { overlay: { fetched: number } }).overlay.fetched;
    await raw("/__crt/overlay.js");
    const after = (JSON.parse((await raw("/__crt/health")).body.toString()) as { overlay: { fetched: number } }).overlay.fetched;
    expect(after).toBe(before + 1);
    // N-8: a page cannot stop the server; without a shutdown handler a local process gets 503.
    expect((await raw("/__crt/internal/shutdown", { method: "POST", headers: { origin: "http://localhost:4400" } })).status).toBe(403);
    expect((await raw("/__crt/internal/shutdown", { method: "POST" })).status).toBe(503);
    expect((await raw("/__crt/internal/shutdown")).status).toBe(405);
  });

  it("health's overlay object has the F-80 shape (F-78, F-80)", async () => {
    const health = JSON.parse((await raw("/__crt/health")).body.toString()) as { overlay: Record<string, unknown> };
    // `loader` counts /__crt/loader.js requests (PRD-embedded F-93).
    expect(Object.keys(health.overlay).sort()).toEqual(["cspWarning", "fetched", "injected", "lastContentType", "loader"]);
  });

  it("serves /__crt/overlay.js with no-cache headers", async () => {
    const r = await raw("/__crt/overlay.js");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/^text\/javascript/);
    expect(r.headers["cache-control"]).toContain("no-store");
    expect(r.body.toString()).toBe(overlayJs);
  });

  it("serves /__crt/early.js from next to the overlay bundle (F-20)", async () => {
    const r = await raw("/__crt/early.js");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/^text\/javascript/);
    expect(r.body.toString()).toBe(earlyJs);
  });

  it("returns 404 for unknown /__crt/ paths without touching the target", async () => {
    const r = await raw("/__crt/nope");
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body.toString())).toEqual({ ok: false, error: "no CRT route /__crt/nope" });
  });
});

describe("script-tag mode CORS (F-6)", () => {
  it("allows localhost origins on every /__crt/ route, with a preflight", async () => {
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:5173", "https://app.localhost", "http://[::1]:8080"]) {
      const r = await raw("/__crt/health", { headers: { origin } });
      expect(r.status).toBe(200);
      expect(r.headers["access-control-allow-origin"]).toBe(origin);
      expect(r.headers.vary).toBe("origin");
    }
    const pre = await raw("/__crt/sessions", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:3000", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(pre.headers["access-control-allow-methods"]).toContain("POST");
    expect(pre.headers["access-control-allow-headers"]).toContain("content-type");
    const js = await raw("/__crt/overlay.js", { headers: { origin: "http://localhost:3000" } });
    expect(js.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("gives non-local origins nothing (no header, preflight 403); same-origin requests are unaffected", async () => {
    for (const origin of ["http://evil.example", "http://localhost.evil.example", "http://localhost:3000/", "null", "file://"]) {
      const r = await raw("/__crt/health", { headers: { origin } });
      expect(r.status).toBe(200);
      expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    }
    const pre = await raw("/__crt/sessions", { method: "OPTIONS", headers: { origin: "http://evil.example" } });
    expect(pre.status).toBe(403);
    const plain = await raw("/__crt/health");
    expect(plain.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("POST /__crt/captures (F-13, F-23)", () => {
  const post = (body: unknown) =>
    raw("/__crt/captures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify(body)),
    });

  it("writes the capture under <projectRoot>/.crt/captures/<id>/ and answers 201 with the location", async () => {
    const r = await post(samplePost());
    expect(r.status).toBe(201);
    const body = JSON.parse(r.body.toString()) as { ok: boolean; id: string; dir: string; files: string[] };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^\d{8}-\d{6}-[a-f0-9]{4}$/);
    expect(body.dir).toBe(join(tmp, ".crt", "captures", body.id));
    expect(existsSync(join(body.dir, "viewport.png"))).toBe(true);
    const written = JSON.parse(readFileSync(join(body.dir, "capture.json"), "utf8")) as { id: string };
    expect(written.id).toBe(body.id);
  });

  it("answers 400 with the validation errors for a malformed bundle", async () => {
    const r = await post({ bundle: { version: 1 }, images: {} });
    expect(r.status).toBe(400);
    const body = JSON.parse(r.body.toString()) as { ok: boolean; errors: string[] };
    expect(body.ok).toBe(false);
    expect(body.errors).toContain("bundle.page: missing");
  });

  it("answers 400 for a body that is not JSON and 405 for GET", async () => {
    const bad = await raw("/__crt/captures", { method: "POST", body: Buffer.from("not json") });
    expect(bad.status).toBe(400);
    const get = await raw("/__crt/captures");
    expect(get.status).toBe(405);
  });
});

describe("WebSocket passthrough (F-3)", () => {
  it("completes the upgrade and echoes frames both ways", async () => {
    const { port } = new URL(crt);
    const socket = connect({ host: "127.0.0.1", port: Number(port) });
    await new Promise<void>((r) => socket.once("connect", r));
    const key = randomBytes(16).toString("base64");
    socket.write(
      [
        "GET /ws HTTP/1.1",
        `Host: localhost:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"),
    );
    let buf = Buffer.alloc(0);
    const waitFor = (pred: () => boolean) =>
      new Promise<void>((resolve, reject) => {
        const check = () => {
          if (pred()) {
            socket.off("data", onData);
            resolve();
          }
        };
        const onData = (c: Buffer) => {
          buf = Buffer.concat([buf, c]);
          check();
        };
        socket.on("data", onData);
        socket.once("error", reject);
        check();
      });

    await waitFor(() => buf.includes("\r\n\r\n"));
    const headerEnd = buf.indexOf("\r\n\r\n") + 4;
    const head = buf.subarray(0, headerEnd).toString();
    expect(head).toMatch(/^HTTP\/1\.1 101/);
    expect(head).toMatch(/sec-websocket-accept:/i);
    buf = buf.subarray(headerEnd);

    const message = Buffer.from("hello through crt ".repeat(20)); // > 125 bytes → 16-bit length
    socket.write(encodeFrame(0x1, message, randomBytes(4)));
    await waitFor(() => readFrame(buf) !== null);
    const frame = readFrame(buf)!;
    expect(frame.opcode).toBe(0x1);
    expect(frame.payload.toString()).toBe(message.toString());

    socket.write(encodeFrame(0x8, Buffer.alloc(0), randomBytes(4)));
    await new Promise<void>((r) => socket.once("close", () => r()));
  });
});

describe("overlay-fetch timer (PRD-setup F-80)", () => {
  /** A proxy of its own per case: the timer and the once-per-server lines are per server by design. */
  async function ownProxy(): Promise<{ lines: string[]; get: (path: string, headers?: Record<string, string>) => Promise<Raw>; health: () => Promise<{ overlay: Record<string, unknown> }>; close: () => Promise<void> }> {
    const lines: string[] = [];
    const server = createProxyServer({ target: fixture.url, projectRoot: tmp, overlayPath: join(tmp, "overlay.js"), log: (l) => lines.push(l), overlayTimeoutMs: 60 });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://localhost:${(server.address() as { port: number }).port}`;
    const get = (path: string, headers: Record<string, string> = {}) =>
      new Promise<Raw>((resolve, reject) => {
        const req = httpRequest(origin + path, { headers }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on("error", reject);
        req.end();
      });
    return {
      lines,
      get,
      health: async () => JSON.parse((await get("/__crt/health")).body.toString()) as { overlay: Record<string, unknown> },
      close: async () => {
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
      },
    };
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const MISSING = /^crt: injected the overlay into GET \/\S* but the browser never fetched \/__crt\/overlay\.js — a Content-Security-Policy or a JS-rendered shell is blocking it; see README › Overlay does not appear$/;

  it("says once that the browser never fetched the overlay when no fetch follows an injected page (F-80)", async () => {
    const p = await ownProxy();
    try {
      await p.get("/");
      await p.get("/gzip");
      expect((await p.health()).overlay).toMatchObject({ injected: 2, fetched: 0 });
      await sleep(150);
      expect(p.lines.filter((l) => MISSING.test(l))).toEqual(["crt: injected the overlay into GET /gzip but the browser never fetched /__crt/overlay.js — a Content-Security-Policy or a JS-rendered shell is blocking it; see README › Overlay does not appear"]);
      await p.get("/");
      await sleep(150);
      expect(p.lines.filter((l) => MISSING.test(l))).toHaveLength(1);
    } finally {
      await p.close();
    }
  });

  it("stays silent when the overlay is fetched in time, and never warns afterwards (F-80)", async () => {
    const p = await ownProxy();
    try {
      await p.get("/");
      await p.get("/__crt/overlay.js");
      await sleep(150);
      expect(p.lines).toEqual(["crt: overlay loaded in the browser (GET /)"]);
      await p.get("/nohead"); // a later page with no fetch: this browser session did load the overlay once
      await sleep(150);
      expect(p.lines.some((l) => MISSING.test(l))).toBe(false);
      expect((await p.health()).overlay).toMatchObject({ injected: 2, fetched: 1, cspWarning: null });
    } finally {
      await p.close();
    }
  });

  it("reports a document request answered without HTML, once, and records its content type (F-80 Should)", async () => {
    const p = await ownProxy();
    try {
      await p.get("/api/json", { "sec-fetch-dest": "document" });
      await p.get("/api/json", { "sec-fetch-dest": "document" });
      await p.get("/api/json"); // a fetch() from a page, not a navigation: not a document miss
      expect(p.lines).toEqual(["crt: GET /api/json answered application/json, not text/html — CRT injects only into HTML; use the script-tag fallback (README)"]);
      expect((await p.health()).overlay).toMatchObject({ injected: 0, lastContentType: "application/json" });
      await p.get("/", { "sec-fetch-dest": "document" });
      expect((await p.health()).overlay).toMatchObject({ injected: 1, lastContentType: "text/html" });
    } finally {
      await p.close();
    }
  });

  it("reports a CSP it cannot relax ('strict-dynamic', a nonce, a <meta> policy) once per server and keeps it in health (F-80)", async () => {
    const p = await ownProxy();
    try {
      await p.get("/");
      expect(p.lines).toEqual([]);
      const strict = await p.get("/csp-strict");
      expect(strict.headers["content-security-policy"]).toBe("script-src 'nonce-abc' 'strict-dynamic' 'self'");
      await p.get("/csp-meta");
      await p.get("/csp");
      expect(p.lines).toEqual(["crt: GET /csp-strict sends a CSP with 'strict-dynamic' that CRT cannot relax — the overlay may be blocked; use the script-tag fallback"]);
      expect((await p.health()).overlay).toMatchObject({ injected: 4, cspWarning: "default-src 'none'; script-src 'nonce-abc'" });
    } finally {
      await p.close();
    }
    // A nonce is on F-80's list too (its own server, since the line prints once each).
    const q = await ownProxy();
    try {
      await q.get("/csp");
      expect(q.lines).toEqual(["crt: GET /csp sends a CSP with a nonce that CRT cannot relax — the overlay may be blocked; use the script-tag fallback"]);
      await q.get("/csp-meta");
      expect(q.lines).toHaveLength(1);
      expect((await q.health()).overlay).toMatchObject({ cspWarning: `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">` });
    } finally {
      await q.close();
    }
  });
});

describe("embedded mode (PRD-embedded F-91, F-93, F-94)", () => {
  /** An embedded server of its own per case (the F-94 timer and line are per server). */
  async function embedded(opts: { target?: string | null; version?: string } = {}): Promise<{ lines: string[]; origin: string; get: (path: string, headers?: Record<string, string>, method?: string) => Promise<Raw>; health: () => Promise<Record<string, unknown>>; server: ReturnType<typeof createProxyServer>; close: () => Promise<void> }> {
    const lines: string[] = [];
    const server = createProxyServer({ mode: "embedded", target: opts.target ?? null, version: opts.version ?? "0.4.0", projectRoot: tmp, overlayPath: join(tmp, "overlay.js"), log: (l) => lines.push(l), loaderTimeoutMs: 60 });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://localhost:${(server.address() as { port: number }).port}`;
    const get = (path: string, headers: Record<string, string> = {}, method = "GET") =>
      new Promise<Raw>((resolve, reject) => {
        const req = httpRequest(origin + path, { headers, method }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on("error", reject);
        req.end();
      });
    return {
      lines,
      origin,
      get,
      server,
      health: async () => JSON.parse((await get("/__crt/health")).body.toString()) as Record<string, unknown>,
      close: async () => {
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
      },
    };
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const NEVER_LOADED = "crt: opened http://localhost:3000 but the page never loaded the CRT loader — add the integration (`crt init` prints the snippet, /crt:init applies it), or run `crt proxy`";

  it("answers every non-/__crt/ request with the landing page — version, project, the app link, the two ways forward, no scripts (F-91)", async () => {
    const e = await embedded({ target: "http://localhost:3000" });
    try {
      for (const path of ["/", "/app?x=1", "/deep/route"]) {
        const r = await e.get(path);
        expect(r.status, path).toBe(200);
        expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
        expect(r.headers["content-length"]).toBe(String(r.body.length));
        const html = r.body.toString();
        expect(html).toContain(`CRT 0.4.0 is running for ${tmp}. This is the CRT server, not your app.`);
        expect(html).toContain('<a href="http://localhost:3000">Open http://localhost:3000</a> — the CRT button appears there once your app includes the CRT integration');
        expect(html).toContain("Run <code>crt init</code> for the one-line snippet for your framework, or <code>crt proxy</code> to proxy your app instead.");
        expect(html).not.toMatch(/<script/i);
      }
      // HEAD gets the headers only; a POST gets the page too (nothing is forwarded anywhere).
      expect((await e.get("/", {}, "HEAD")).body.length).toBe(0);
      expect((await e.get("/api/save", {}, "POST")).status).toBe(200);
    } finally {
      await e.close();
    }
    // No app known: no link, the rest unchanged.
    expect(landingPage({ version: null, projectRoot: "C:\\my-app", app: null })).not.toContain("<a ");
    expect(landingPage({ version: null, projectRoot: "C:\\my-app", app: null })).toContain("CRT is running for C:\\my-app. This is the CRT server, not your app.");
    expect(landingPage({ version: "0.4.0", projectRoot: "C:\\<app>", app: null })).toContain("for C:\\&lt;app&gt;.");
  });

  it("serves /__crt/loader.js with CORS for a loopback origin and no-store, counts it in health, and refuses upgrades (F-93, F-94)", async () => {
    const e = await embedded({ target: "http://localhost:3000" });
    try {
      const r = await e.get("/__crt/loader.js", { origin: "http://localhost:3000" });
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toMatch(/^text\/javascript/);
      expect(r.headers["cache-control"]).toContain("no-store");
      expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
      expect(r.body.toString()).toBe(loaderJs);
      expect((await e.get("/__crt/loader.js", { origin: "http://evil.example" })).headers["access-control-allow-origin"]).toBeUndefined();
      const h = await e.health();
      expect(h).toMatchObject({ ok: true, mode: "embedded", app: "http://localhost:3000", target: "http://localhost:3000", version: "0.4.0" });
      expect(h.overlay).toMatchObject({ injected: 0, fetched: 0, loader: 2 });
      // Health keys are the proxy-mode keys plus nothing else: the same story in both modes.
      expect(Object.keys(h).sort()).toEqual(["app", "login", "mode", "ok", "overlay", "projectRoot", "provider", "sessions", "startedAt", "target", "tasks", "tasksDir", "version"]);
      // Nothing to forward a WebSocket to.
      const socket = connect({ host: "127.0.0.1", port: Number(new URL(e.origin).port) });
      await new Promise<void>((r) => socket.once("connect", r));
      socket.write("GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: abc\r\nSec-WebSocket-Version: 13\r\n\r\n");
      const answer = await new Promise<string>((r) => socket.once("data", (c: Buffer) => r(c.toString())));
      expect(answer).toMatch(/^HTTP\/1\.1 404/);
      socket.destroy();
    } finally {
      await e.close();
    }
  });

  it("health says `app: null` and `target: null` when no app is known (F-91, F-93)", async () => {
    const e = await embedded({ target: null });
    try {
      expect(await e.health()).toMatchObject({ mode: "embedded", app: null, target: null });
    } finally {
      await e.close();
    }
  });

  it("says once that the opened page never loaded the loader, 15 s (shortened) after CRT opened the browser (F-94)", async () => {
    const e = await embedded({ target: "http://localhost:3000" });
    try {
      e.server.browserOpened("http://localhost:3000");
      await sleep(150);
      expect(e.lines).toEqual([NEVER_LOADED]);
      e.server.browserOpened("http://localhost:3000");
      await sleep(150);
      expect(e.lines).toEqual([NEVER_LOADED]);
    } finally {
      await e.close();
    }
  });

  it("stays silent when the loader (or the overlay) was requested in time, and names the page's origin on the F-75 line (F-94)", async () => {
    const e = await embedded({ target: "http://localhost:3000" });
    try {
      e.server.browserOpened("http://localhost:3000");
      await e.get("/__crt/loader.js", { referer: "http://localhost:3000/app" });
      await sleep(150);
      expect(e.lines).toEqual([]);
      await e.get("/__crt/overlay.js", { referer: "http://localhost:3000/app" });
      expect(e.lines).toEqual(["crt: overlay loaded in the browser (from http://localhost:3000)"]);
      await e.get("/__crt/overlay.js", { origin: "http://127.0.0.1:5173" });
      expect(e.lines).toHaveLength(1);
    } finally {
      await e.close();
    }
    const o = await embedded({ target: "http://localhost:3000" });
    try {
      o.server.browserOpened("http://localhost:3000");
      await o.get("/__crt/overlay.js", { origin: "http://127.0.0.1:5173" });
      await sleep(150);
      expect(o.lines).toEqual(["crt: overlay loaded in the browser (from http://127.0.0.1:5173)"]);
    } finally {
      await o.close();
    }
    expect(requestingOrigin({ headers: {} })).toBe("an unknown origin");
    expect(requestingOrigin({ headers: { referer: "not a url" } })).toBe("an unknown origin");
    expect(requestingOrigin({ headers: { origin: "null", referer: "http://localhost:3000/x" } })).toBe("http://localhost:3000");
  });

  it("proxy mode is the default and still needs a target (F-92, N-21)", () => {
    expect(() => createProxyServer({ target: null, projectRoot: tmp, overlayPath: join(tmp, "overlay.js") })).toThrow(/proxy mode needs a target/);
    const p = createProxyServer({ target: "http://localhost:3000", projectRoot: tmp, overlayPath: join(tmp, "overlay.js") });
    expect(typeof p.browserOpened).toBe("function");
    p.browserOpened("http://localhost:3000"); // a no-op in proxy mode: F-80 owns that story
  });
});
