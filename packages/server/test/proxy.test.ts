import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeFrame, readFrame, startFixture, type Fixture } from "../e2e/fixture/server.mjs";
import { INJECT_TAGS, OVERLAY_TAG } from "../src/inject.js";
import { createProxyServer, MAX_HTML_BODY, requestingOrigin } from "../src/proxy.js";
import { listen0 } from "./helpers/http.js";
import { samplePost } from "./helpers/sample-capture.js";

let fixture: Fixture;
let proxy: Server;
let crt: string; // CRT origin
let tmp: string;
const overlayJs = 'console.log("overlay stub")';
const earlyJs = 'console.log("early stub")';
const loaderJs = 'console.log("loader stub")';
const faviconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"/>';
const faviconPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "crt-proxy-"));
  writeFileSync(join(tmp, "overlay.js"), overlayJs);
  writeFileSync(join(tmp, "early.js"), earlyJs);
  writeFileSync(join(tmp, "loader.js"), loaderJs);
  writeFileSync(join(tmp, "favicon.svg"), faviconSvg);
  writeFileSync(join(tmp, "favicon-32.png"), faviconPng);
  writeFileSync(join(tmp, "favicon-16.png"), faviconPng);
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

  it("serves /__crt/favicon.svg from next to the overlay bundle: image/svg+xml, a day of cache, CORS for a loopback origin, HEAD allowed, other methods 405 (PRD-polish F-112)", async () => {
    const r = await raw("/__crt/favicon.svg");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("image/svg+xml");
    expect(r.headers["cache-control"]).toBe("max-age=86400");
    expect(r.headers["content-length"]).toBe(String(Buffer.byteLength(faviconSvg)));
    expect(r.body.toString()).toBe(faviconSvg);
    const head = await raw("/__crt/favicon.svg", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers["content-type"]).toBe("image/svg+xml");
    expect(head.body.length).toBe(0);
    // F-6: the CORS headers for a loopback origin, nothing for another origin.
    expect((await raw("/__crt/favicon.svg", { headers: { origin: "http://localhost:3000" } })).headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect((await raw("/__crt/favicon.svg", { headers: { origin: "http://evil.example" } })).headers["access-control-allow-origin"]).toBeUndefined();
    for (const method of ["POST", "PUT", "DELETE"]) {
      const bad = await raw("/__crt/favicon.svg", { method });
      expect(bad.status, method).toBe(405);
      expect(bad.headers.allow).toBe("GET, HEAD");
    }
    // The PNG fallbacks (F-112 Should) beside it, same headers.
    for (const name of ["favicon-32.png", "favicon-16.png"]) {
      const png = await raw(`/__crt/${name}`);
      expect(png.status, name).toBe(200);
      expect(png.headers["content-type"]).toBe("image/png");
      expect(png.headers["cache-control"]).toBe("max-age=86400");
      expect(png.body.equals(faviconPng)).toBe(true);
    }
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

/** A proxy of its own per case (the F-80 timer and the once-per-server lines are per server by design); the e2e fixture unless `target` names another app. */
async function ownProxy(target = fixture.url): Promise<{ lines: string[]; origin: string; get: (path: string, headers?: Record<string, string>) => Promise<Raw>; health: () => Promise<{ overlay: Record<string, unknown> }>; close: () => Promise<void> }> {
  const lines: string[] = [];
  const server = createProxyServer({ target, projectRoot: tmp, overlayPath: join(tmp, "overlay.js"), log: (l) => lines.push(l), overlayTimeoutMs: 60 });
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
    origin,
    get,
    health: async () => JSON.parse((await get("/__crt/health")).body.toString()) as { overlay: Record<string, unknown> },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

describe("overlay-fetch timer (PRD-setup F-80)", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const MISSING = /^crt: injected the overlay into GET \/\S* but the browser never fetched \/__crt\/overlay\.js — a Content-Security-Policy or a JS-rendered shell is blocking it; see docs\/troubleshooting\.md › Overlay does not appear$/;

  it("says once that the browser never fetched the overlay when no fetch follows an injected page (F-80)", async () => {
    const p = await ownProxy();
    try {
      await p.get("/");
      await p.get("/gzip");
      expect((await p.health()).overlay).toMatchObject({ injected: 2, fetched: 0 });
      await sleep(150);
      expect(p.lines.filter((l) => MISSING.test(l))).toEqual(["crt: injected the overlay into GET /gzip but the browser never fetched /__crt/overlay.js — a Content-Security-Policy or a JS-rendered shell is blocking it; see docs/troubleshooting.md › Overlay does not appear"]);
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

describe("proxy robustness (F-2, F-3, F-4)", () => {
  /** A target of its own: HTML under a content-encoding it is not in, a page above the buffer cap, and an upgrade handler that records every path it is asked for. */
  const PAGE = "<!doctype html><html><head><title>t</title></head><body>plain bytes</body></html>";
  let big: Buffer;
  const upgrades: string[] = [];
  let target: Awaited<ReturnType<typeof listen0>>;

  beforeAll(async () => {
    big = Buffer.concat([Buffer.from("<!doctype html><html><head></head><body>"), Buffer.alloc(MAX_HTML_BODY + 1024 * 1024, "x"), Buffer.from("</body></html>")]);
    const server = createServer((req, res) => {
      const enc = /^\/bad-(gzip|br|deflate)$/.exec(req.url ?? "/");
      if (enc) {
        // The bytes are plain HTML; only the label says otherwise.
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": enc[1], "content-length": String(Buffer.byteLength(PAGE)) });
        res.end(PAGE);
      } else if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/html", "content-length": String(big.length) });
        res.end(big);
      } else {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(PAGE);
      }
    });
    server.on("upgrade", (req, socket: Duplex) => {
      upgrades.push(req.url ?? "");
      socket.end("HTTP/1.1 418 I'm a teapot\r\nConnection: close\r\n\r\n");
    });
    target = await listen0(server);
  });
  afterAll(async () => {
    await target.close();
  });

  /** The first bytes CRT answers a WebSocket upgrade request for `path` with. */
  async function upgradeAnswer(origin: string, path: string): Promise<string> {
    const socket = connect({ host: "127.0.0.1", port: Number(new URL(origin).port) });
    await new Promise<void>((r) => socket.once("connect", r));
    socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: abc\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    const answer = await new Promise<string>((r) => socket.once("data", (c: Buffer) => r(c.toString())));
    socket.destroy();
    return answer;
  }

  it("serves HTML whose content-encoding does not decode as sent, says so once, and keeps serving (F-2)", async () => {
    const p = await ownProxy(target.origin);
    try {
      for (const enc of ["gzip", "br", "deflate"]) {
        const r = await p.get(`/bad-${enc}`, { "accept-encoding": enc });
        expect(r.status, enc).toBe(200);
        expect(r.headers["content-encoding"], enc).toBe(enc);
        expect(r.headers["content-length"], enc).toBe(String(Buffer.byteLength(PAGE)));
        expect(r.body.toString(), enc).toBe(PAGE);
      }
      expect(p.lines).toHaveLength(1);
      expect(p.lines[0]).toMatch(/^crt: GET \/bad-gzip is HTML labelled content-encoding: gzip that does not decode \(incorrect header check\) — served it as sent, without the overlay$/);
      // The server is still up: the next page is proxied and injected as usual.
      const ok = await p.get("/page");
      expect(ok.status).toBe(200);
      expect(ok.body.toString()).toContain(`${OVERLAY_TAG}</head>`);
      expect((await p.health()).overlay).toMatchObject({ injected: 1 });
    } finally {
      await p.close();
    }
  });

  it("streams an HTML page above the 16 MB cap through complete and uninjected, and says so once (F-2)", async () => {
    expect(MAX_HTML_BODY).toBe(16 * 1024 * 1024);
    const p = await ownProxy(target.origin);
    try {
      for (let i = 0; i < 2; i++) {
        const r = await p.get("/big");
        expect(r.status).toBe(200);
        expect(r.headers["content-length"]).toBe(String(big.length));
        expect(r.body.length).toBe(big.length);
        expect(r.body.equals(big)).toBe(true);
      }
      expect(p.lines).toEqual(["crt: GET /big is an HTML page over 16 MB — streamed it through without the overlay"]);
      expect((await p.get("/page")).body.toString()).toContain(`${OVERLAY_TAG}</head>`);
      expect((await p.health()).overlay).toMatchObject({ injected: 1 });
    } finally {
      await p.close();
    }
  });

  it("answers a WebSocket upgrade under /__crt/ with 404 and never forwards it to the target (F-3, F-4)", async () => {
    const p = await ownProxy(target.origin);
    try {
      for (const path of ["/__crt/anything", "/__crt", "/__crt/sessions/abc/ws"]) {
        expect(await upgradeAnswer(p.origin, path), path).toMatch(/^HTTP\/1\.1 404 /);
      }
      expect(upgrades).toEqual([]);
      // Every other path still reaches the target's upgrade handler (F-3).
      expect(await upgradeAnswer(p.origin, "/_next/webpack-hmr")).toMatch(/^HTTP\/1\.1 418 /);
      expect(upgrades).toEqual(["/_next/webpack-hmr"]);
    } finally {
      await p.close();
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

  it("answers every non-/__crt/ request with the landing page — the kicker, the project, the app link, the two ways forward, exactly one inline script (F-91, PRD-polish F-114)", async () => {
    const e = await embedded({ target: "http://localhost:3000" });
    try {
      for (const path of ["/", "/app?x=1", "/deep/route"]) {
        const r = await e.get(path);
        expect(r.status, path).toBe(200);
        expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
        expect(r.headers["content-length"]).toBe(String(r.body.length));
        const html = r.body.toString();
        expect(html).toContain("<title>CRT 0.4.0</title>");
        expect(html).toContain("This is the CRT server — not your app.");
        expect(html).toContain(`<span class="path">${tmp}</span>`);
        expect(html).toContain('<a class="btn" id="open" href="http://localhost:3000">Open http://localhost:3000 <span aria-hidden="true">↗</span></a>');
        expect(html).toContain("Run <code>crt init</code> for the one-line snippet for your framework, or <code>crt proxy</code> to proxy your app instead.");
        // PRD-polish §9: the F-91 "no scripts" becomes exactly one inline <script> with no src.
        expect(html.match(/<script/gi)).toHaveLength(1);
        expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
        expect(html).toContain('<link rel="icon" href="/__crt/favicon.svg">');
      }
      // HEAD gets the headers only; a POST gets the page too (nothing is forwarded anywhere).
      expect((await e.get("/", {}, "HEAD")).body.length).toBe(0);
      expect((await e.get("/api/save", {}, "POST")).status).toBe(200);
      // F-114: GET /__crt/ is the same page; other methods there are 405.
      const at = await e.get("/__crt/");
      expect(at.status).toBe(200);
      expect(at.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(at.body.toString()).toContain("This is the CRT server — not your app.");
      expect((await e.get("/__crt/", {}, "POST")).status).toBe(405);
    } finally {
      await e.close();
    }
    // No app known: the second hero state, no Open button.
    const none = await embedded({ target: null });
    try {
      const html = (await none.get("/")).body.toString();
      expect(html).toContain("<h1>No dev server found yet.</h1>");
      expect(html).not.toContain('id="open"');
    } finally {
      await none.close();
    }
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

  it("serves /__crt/favicon.svg in embedded mode too, with the same headers (PRD-polish F-112)", async () => {
    const e = await embedded({ target: "http://localhost:3000" });
    try {
      const r = await e.get("/__crt/favicon.svg", { origin: "http://localhost:3000" });
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toBe("image/svg+xml");
      expect(r.headers["cache-control"]).toBe("max-age=86400");
      expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
      expect(r.body.toString()).toBe(faviconSvg);
      expect((await e.get("/__crt/favicon.svg", {}, "POST")).status).toBe(405);
      // It does not count as a loader or overlay fetch.
      expect(((await e.health()).overlay as { loader: number; fetched: number })).toMatchObject({ loader: 0, fetched: 0 });
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
