import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeFrame, readFrame, startFixture, type Fixture } from "../e2e/fixture/server.mjs";
import { INJECT_TAGS, OVERLAY_TAG } from "../src/inject.js";
import { createProxyServer } from "../src/proxy.js";
import { samplePost } from "./helpers/sample-capture.js";

let fixture: Fixture;
let proxy: Server;
let crt: string; // CRT origin
let tmp: string;
const overlayJs = 'console.log("overlay stub")';
const earlyJs = 'console.log("early stub")';

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "crt-proxy-"));
  writeFileSync(join(tmp, "overlay.js"), overlayJs);
  writeFileSync(join(tmp, "early.js"), earlyJs);
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
  it("serves /__crt/health with target and project root", async () => {
    const r = await raw("/__crt/health");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body.toString())).toEqual({ ok: true, target: fixture.url, projectRoot: tmp });
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
