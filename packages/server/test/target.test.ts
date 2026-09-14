import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CrtError } from "../src/errors.js";
import { isReachable, normalizeTarget, resolveTarget } from "../src/target.js";

let server: Server;
let port: number;
let freePort: number;

beforeAll(async () => {
  server = createServer((_req, res) => {
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

describe("resolveTarget (F-1)", () => {
  it("uses the flag first, then config, and verifies reachability", async () => {
    expect(await resolveTarget({ flag: `127.0.0.1:${port}`, configTarget: "http://localhost:1" })).toEqual({
      origin: `http://127.0.0.1:${port}`,
      source: "flag",
    });
    expect(await resolveTarget({ configTarget: `http://127.0.0.1:${port}` })).toEqual({
      origin: `http://127.0.0.1:${port}`,
      source: "config",
    });
  });

  it("probes ports in order and reports the first that answers", async () => {
    const r = await resolveTarget({ ports: [freePort, port], host: "127.0.0.1" });
    expect(r).toEqual({ origin: `http://127.0.0.1:${port}`, source: "probe" });
  });

  it("fails with one actionable line when the explicit target is down (N-6)", async () => {
    await expect(resolveTarget({ flag: `http://127.0.0.1:${freePort}` })).rejects.toThrow(
      `target http://127.0.0.1:${freePort} is not responding — start your dev server there or pass --target <url>`,
    );
  });

  it("fails with one actionable line when nothing is found (N-6)", async () => {
    await expect(resolveTarget({ ports: [freePort], host: "127.0.0.1" })).rejects.toThrow(
      `no dev server found on ports ${freePort} — start it, or pass --target <url>`,
    );
  });
});
