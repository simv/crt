import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOADER_ESM, LOADER_IIFE } from "../../overlay/build.mjs";
import { DEFAULT_ORIGIN, isLoopbackHost, mountCrt, PILL_DISMISSED_KEY, pillText, resolveOrigin } from "../../overlay/src/loader.js";

// PRD-embedded F-96 / N-20: the loader's pure parts (the loopback guard, the origin resolution,
// idempotence), tested from the source the way owner-stack.test.ts tests component.ts, and the
// two builds — made here with the same esbuild options as packages/overlay/build.mjs, so the
// size budget and the F-98 guard are asserted on exactly what ships.

const SIZE_BUDGET = 5 * 1024; // N-20: ≤ 5 KB gzipped

afterEach(() => vi.unstubAllGlobals());

/** A DOM small enough for mountCrt: the guard, the global, the hooks and the appended tag. */
function fakeDom(o: { hostname: string; top?: "self" | "other"; scriptSrc?: string | null; port?: string }) {
  class FakeScript {
    src = "";
    defer = false;
    dataset: Record<string, string> = {};
    listeners: Record<string, () => void> = {};
    addEventListener(name: string, fn: () => void) {
      this.listeners[name] = fn;
    }
    remove() {}
  }
  const appended: FakeScript[] = [];
  const current = o.scriptSrc === undefined ? null : new FakeScript();
  if (current) {
    current.src = o.scriptSrc ?? "";
    if (o.port) current.dataset.crtPort = o.port;
  }
  const document = {
    currentScript: current,
    createElement: () => new FakeScript(),
    head: { appendChild: (s: FakeScript) => appended.push(s) },
    documentElement: { appendChild: (s: FakeScript) => appended.push(s) },
    addEventListener: () => undefined,
    visibilityState: "visible",
  };
  const window: Record<string, unknown> = { addEventListener: () => undefined };
  window.top = o.top === "other" ? {} : window;
  vi.stubGlobal("HTMLScriptElement", FakeScript);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("location", { hostname: o.hostname, href: `http://${o.hostname}:3000/page` });
  return { window, appended };
}

describe("loader — pure parts (F-96)", () => {
  it("step 1: only loopback hostnames qualify, the F-6 list (F-96)", () => {
    for (const h of ["localhost", "LOCALHOST", "app.localhost", "127.0.0.1", "[::1]", "::1"]) expect(isLoopbackHost(h), h).toBe(true);
    for (const h of ["example.com", "localhost.evil.example", "127.0.0.2", "10.0.0.5", "", "0.0.0.0"]) expect(isLoopbackHost(h), h).toBe(false);
  });

  it("step 4: options.origin, else options.port, else the script's own origin, else http://localhost:4400 (F-96)", () => {
    const page = "http://localhost:3000/app";
    expect(resolveOrigin({ origin: "http://127.0.0.1:4405/" }, "http://localhost:4400/__crt/loader.js", page)).toBe("http://127.0.0.1:4405");
    expect(resolveOrigin({ origin: "https://app.localhost:4405/x" }, null, page)).toBe("https://app.localhost:4405");
    expect(resolveOrigin({ origin: "nonsense", port: 4406 }, null, page)).toBe("http://localhost:4406");
    expect(resolveOrigin({ port: 4406 }, "http://localhost:4400/__crt/loader.js", page)).toBe("http://localhost:4406");
    expect(resolveOrigin({ port: 0 }, "http://localhost:4400/__crt/loader.js", page)).toBe("http://localhost:4400");
    expect(resolveOrigin(undefined, "http://localhost:4401/__crt/loader.js", page)).toBe("http://localhost:4401");
    expect(resolveOrigin(undefined, "http://[::1]:4402/__crt/loader.js", page)).toBe("http://[::1]:4402");
    // A same-origin src (a bundled loader served by the app itself) says nothing about where CRT is.
    expect(resolveOrigin(undefined, "http://localhost:3000/assets/main.js", page)).toBe(DEFAULT_ORIGIN);
    expect(resolveOrigin(undefined, "/assets/main.js", page)).toBe(DEFAULT_ORIGIN);
    expect(resolveOrigin(undefined, null, page)).toBe(DEFAULT_ORIGIN);
    expect(resolveOrigin({}, "", page)).toBe(DEFAULT_ORIGIN);
    expect(DEFAULT_ORIGIN).toBe("http://localhost:4400");
  });

  it("step 4 accepts loopback origins only: a non-loopback option or script src is skipped, never used (N-20, PRD-embedded Goal 6)", () => {
    const page = "http://localhost:3000/app";
    for (const bad of ["http://evil.example:4400", "https://crt.example", "http://localhost.evil.example:4400", "http://10.0.0.5:4400", "ftp://localhost:4400", "file:///x"]) {
      expect(resolveOrigin({ origin: bad }, null, page), bad).toBe(DEFAULT_ORIGIN);
      expect(resolveOrigin({ origin: bad, port: 4407 }, null, page), bad).toBe("http://localhost:4407");
      expect(resolveOrigin(undefined, `${bad}/__crt/loader.js`, page), bad).toBe(DEFAULT_ORIGIN);
    }
    // Even on a loopback page, a loader served from elsewhere does not redirect the overlay there.
    expect(resolveOrigin(undefined, "https://cdn.example/loader.js", "http://127.0.0.1:5173/")).toBe(DEFAULT_ORIGIN);
  });

  it("the pill names the port and the fix, step 6 (F-96)", () => {
    expect(pillText("http://localhost:4400")).toBe("CRT server not running on :4400 — run `crt` in the project, then click here");
    expect(pillText("http://127.0.0.1:4401")).toContain(":4401");
    expect(PILL_DISMISSED_KEY).toBe("crt.loader.dismissed.v1");
  });

  it("mountCrt does nothing without a DOM, off loopback, or in a frame — step 1 (F-96, N-20)", () => {
    expect(mountCrt()).toBeNull();
    const off = fakeDom({ hostname: "example.com" });
    expect(mountCrt()).toBeNull();
    expect(off.appended).toEqual([]);
    expect(off.window.__crt).toBeUndefined();
    vi.unstubAllGlobals();
    const framed = fakeDom({ hostname: "localhost", top: "other" });
    expect(mountCrt()).toBeNull();
    expect(framed.appended).toEqual([]);
  });

  it("mountCrt mounts once and returns the same loader on every later call — steps 2, 5, 7 (F-96)", () => {
    const dom = fakeDom({ hostname: "localhost", scriptSrc: "http://localhost:4400/__crt/loader.js" });
    const first = mountCrt({ port: 4407 });
    expect(first).toEqual({ origin: "http://localhost:4407", retry: expect.any(Function) });
    expect(dom.appended).toHaveLength(1);
    expect(dom.appended[0]).toMatchObject({ src: "http://localhost:4407/__crt/overlay.js", defer: true });
    // The hooks went in first (step 3) and the only global is window.__crt.
    expect((dom.window.__crt as { __console: { installed: boolean }; __network: { installed: boolean }; loader: unknown })).toMatchObject({ __console: { installed: true }, __network: { installed: true }, loader: first });
    expect(mountCrt({ port: 9999 })).toBe(first);
    expect(mountCrt()).toBe(first);
    expect(dom.appended).toHaveLength(1);
    // A retry while the script is still pending is a no-op (one request at a time); after an error it re-appends
    // (the pill is skipped here: this tab dismissed it, so no shadow DOM is needed).
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => (k === PILL_DISMISSED_KEY ? "1" : null), setItem: () => undefined });
    first!.retry();
    expect(dom.appended).toHaveLength(1);
    dom.appended[0]!.listeners.error!();
    expect(dom.appended).toHaveLength(1);
    first!.retry();
    expect(dom.appended).toHaveLength(2);
    expect(dom.appended[1]).toMatchObject({ src: "http://localhost:4407/__crt/overlay.js" });
  });
});

describe("loader — the two builds (F-96, F-98, N-20)", () => {
  let tmp: string;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("the IIFE is ≤ 5 KB gzipped and carries no `process` reference, the F-98 guard folded away (F-96, N-20)", async () => {
    const out = await build({ ...LOADER_IIFE, write: false });
    const js = out.outputFiles![0]!.text;
    const gz = gzipSync(js).length;
    console.log(`dist/loader.js: ${Buffer.byteLength(js)} bytes, ${gz} bytes gzipped (budget ${SIZE_BUDGET})`);
    expect(gz).toBeLessThanOrEqual(SIZE_BUDGET);
    expect(js).not.toMatch(/\bprocess\b/);
    expect(js).toContain("/__crt/overlay.js");
  });

  it("the ES module exports mountCrt, keeps process.env.NODE_ENV for the app's bundler, and has no side effect on import (F-96, F-98)", async () => {
    const out = await build({ ...LOADER_ESM, write: false });
    const js = out.outputFiles![0]!.text;
    expect(js).toContain('process.env.NODE_ENV === "production"');
    expect(js).toMatch(/export \{[^}]*\bmountCrt\b/);
    // The only call to mountCrt is its definition: nothing runs at import.
    expect(js.match(/mountCrt\(/g)).toHaveLength(1);
    tmp = mkdtempSync(join(tmpdir(), "crt-loader-"));
    const file = join(tmp, "loader.mjs");
    writeFileSync(file, js);
    const trap = new Proxy({}, { get: (_t, key) => { throw new Error(`touched document.${String(key)} at import`); } });
    vi.stubGlobal("document", trap);
    vi.stubGlobal("window", trap);
    const mod = (await import(pathToFileURL(file).href)) as { mountCrt: unknown };
    expect(typeof mod.mountCrt).toBe("function");
  });

  it("the IIFE auto-mounts and reads data-crt-port off its own tag (F-96)", async () => {
    const out = await build({ ...LOADER_IIFE, write: false });
    tmp = mkdtempSync(join(tmpdir(), "crt-loader-"));
    const file = join(tmp, "loader.js");
    writeFileSync(file, out.outputFiles![0]!.text);
    const dom = fakeDom({ hostname: "127.0.0.1", scriptSrc: "http://localhost:4400/__crt/loader.js", port: "4408" });
    await import(pathToFileURL(file).href);
    expect((dom.window.__crt as { loader: { origin: string } }).loader.origin).toBe("http://localhost:4408");
    expect(dom.appended[0]).toMatchObject({ src: "http://localhost:4408/__crt/overlay.js" });
  });
});
