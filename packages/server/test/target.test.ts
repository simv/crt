import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CrtError } from "../src/errors.js";
import { isReachable, looksLikeTarget, normalizeTarget, parseTargetAnswer, probeAll, probeOrigin, shortTarget, titleOf } from "../src/target.js";

let server: Server;
let port: number;
let freePort: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html", "x-powered-by": "Fixture" });
      res.end("<!doctype html><html><head><title>  Trial\n app </title></head><body></body></html>");
      return;
    }
    res.writeHead(404); // any HTTP answer counts as "up"
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
  // Grab and release a second port so we have one that is (almost certainly) closed.
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  freePort = (probe.address() as { port: number }).port;
  await new Promise<void>((r) => probe.close(() => r()));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("normalizeTarget (F-1)", () => {
  it("accepts a bare port, host:port and full URLs", () => {
    expect(normalizeTarget("3000")).toBe("http://localhost:3000");
    expect(normalizeTarget("localhost:5173")).toBe("http://localhost:5173");
    expect(normalizeTarget("http://127.0.0.1:8080/some/path?x=1")).toBe("http://127.0.0.1:8080");
    expect(normalizeTarget("https://app.local:8443/")).toBe("https://app.local:8443");
  });
  it("rejects garbage and non-http schemes with a CrtError", () => {
    expect(() => normalizeTarget("http://")).toThrow(CrtError);
    expect(() => normalizeTarget("ftp://x")).toThrow(CrtError);
  });
});

describe("isReachable (F-1)", () => {
  it("is true for any HTTP response and false for a closed port", async () => {
    expect(await isReachable(`http://127.0.0.1:${port}`)).toBe(true);
    expect(await isReachable(`http://127.0.0.1:${freePort}`, 500)).toBe(false);
  });
});

describe("probeAll / probeOrigin (PRD-setup F-71)", () => {
  it("labels a responder with its <title> (whitespace collapsed), falling back to X-Powered-By", async () => {
    expect(await probeOrigin(`http://127.0.0.1:${port}`)).toEqual({ up: true, label: "Trial app" });
    expect(await probeOrigin(`http://127.0.0.1:${freePort}`, 500)).toEqual({ up: false, label: null });
    expect(titleOf("<html><head><TITLE>x</TITLE>")).toBe("x");
    expect(titleOf("<html><title></title>")).toBeNull();
    expect(titleOf("no title here")).toBeNull();
    expect(titleOf(`<title>${"a".repeat(80)}</title>`)).toHaveLength(58);
  });

  it("collects every responder in probe order and skips closed ports", async () => {
    expect(await probeAll({ ports: [freePort, port], host: "127.0.0.1", timeoutMs: 500 })).toEqual([{ origin: `http://127.0.0.1:${port}`, label: "Trial app" }]);
    expect(await probeAll({ ports: [freePort], host: "127.0.0.1", timeoutMs: 500 })).toEqual([]);
  });
});

describe("looksLikeTarget / parseTargetAnswer / shortTarget (PRD-setup F-69, F-71)", () => {
  it("recognises bare digits, host:port and URLs as a positional target, nothing else", () => {
    for (const t of ["3000", "3100", "localhost:3000", "127.0.0.1:8080", "[::1]:3000", "http://localhost:3000", "https://app.local/x", "my-host.dev:5173/path"]) {
      expect(looksLikeTarget(t), t).toBe(true);
    }
    for (const t of ["", "doctor", "serve", "-h", "--yes", "abc", "localhost", "CRT-0001", "3000x"]) expect(looksLikeTarget(t), t).toBe(false);
  });

  it("turns a valid prompt answer into an origin and rejects the rest (F-71 validation)", () => {
    expect(parseTargetAnswer(" 3100 ")).toBe("http://localhost:3100");
    expect(parseTargetAnswer("localhost:3000")).toBe("http://localhost:3000");
    expect(parseTargetAnswer("http://127.0.0.1:8080/x")).toBe("http://127.0.0.1:8080");
    expect(parseTargetAnswer("abc")).toBeNull();
    expect(parseTargetAnswer("")).toBeNull();
    expect(parseTargetAnswer("ftp://x:1")).toBeNull();
  });

  it("shortens a localhost origin to its port for the crt <port> hints", () => {
    expect(shortTarget("http://localhost:3000")).toBe("3000");
    expect(shortTarget("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(shortTarget("https://localhost:8443")).toBe("https://localhost:8443");
  });
});
