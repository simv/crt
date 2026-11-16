import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOADER_ESM, LOADER_IIFE, LOADER_INJECT } from "../../overlay/build.mjs";
import { DEFAULT_ORIGIN, isLoopbackHost, mountCrt, PILL_DISMISSED_KEY, pillText, resolveOrigin } from "../../overlay/src/loader.js";
import { INJECT_ORIGIN_PLACEHOLDER, loaderSource } from "../src/browser.js";
import { fakeDom } from "./helpers/fake-dom.js";

// PRD-embedded F-96 / N-20: the loader's pure parts (the loopback guard, the origin resolution,
// idempotence), tested from the source the way owner-stack.test.ts tests component.ts, and the
// two builds — made here with the same esbuild options as packages/overlay/build.mjs, so the
// size budget and the F-98 guard are asserted on exactly what ships.

const SIZE_BUDGET = 5 * 1024; // N-20: ≤ 5 KB gzipped

afterEach(() => vi.unstubAllGlobals());

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

  it("mounted before the document has a root: hooks at once, the overlay tag when the root exists, one observer and no timer (F-127)", () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const dom = fakeDom({ hostname: "localhost", rootless: true });
    const loader = mountCrt({ origin: "http://localhost:4409" });
    expect(loader).toEqual({ origin: "http://localhost:4409", retry: expect.any(Function) });
    // The hooks are in before anything of the page ran; nothing is appended and nothing threw.
    expect(dom.window.__crt as { __console: { installed: boolean }; __network: { installed: boolean } }).toMatchObject({ __console: { installed: true }, __network: { installed: true } });
    expect(dom.appended).toEqual([]);
    expect(dom.observers).toHaveLength(1);
    expect(dom.observers[0]).toMatchObject({ target: dom.document, connected: true });
    // A retry while the root is awaited (focus, visibility) starts no second observer.
    loader!.retry();
    expect(dom.observers).toHaveLength(1);
    // Another node first (the doctype): still waiting.
    dom.addOther();
    expect(dom.appended).toEqual([]);
    expect(dom.observers[0]!.connected).toBe(true);
    // The root arrives: the tag is appended once and the observer is gone.
    dom.addRoot();
    expect(dom.appended).toHaveLength(1);
    expect(dom.appended[0]).toMatchObject({ src: "http://localhost:4409/__crt/overlay.js", defer: true });
    expect(dom.observers[0]!.connected).toBe(false);
    dom.addRoot();
    expect(dom.appended).toHaveLength(1);
    expect(timers).not.toHaveBeenCalled();
    timers.mockRestore();
  });

  it("retry() re-appends after the first tag of a rootless mount failed to load (F-127)", () => {
    const dom = fakeDom({ hostname: "127.0.0.1", rootless: true });
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => (k === PILL_DISMISSED_KEY ? "1" : null), setItem: () => undefined });
    const loader = mountCrt({ origin: "http://localhost:4409" })!;
    dom.addRoot();
    expect(dom.appended).toHaveLength(1);
    dom.appended[0]!.listeners.error!();
    loader.retry();
    expect(dom.appended).toHaveLength(2);
    expect(dom.observers).toHaveLength(1);
  });
});

describe("loader — the builds (F-96, F-98, N-20; PRD-zero F-127)", () => {
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
    expect(js).toContain('process.env.NODE_ENV !== "production"');
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

  it("the injectable IIFE is ≤ 5 KB gzipped, carries its origin placeholder exactly once and no `process` reference (F-127, N-20)", async () => {
    const out = await build({ ...LOADER_INJECT, write: false });
    const js = out.outputFiles![0]!.text;
    const gz = gzipSync(js).length;
    console.log(`dist/loader-inject.js: ${Buffer.byteLength(js)} bytes, ${gz} bytes gzipped (budget ${SIZE_BUDGET})`);
    expect(gz).toBeLessThanOrEqual(SIZE_BUDGET);
    expect(js).not.toMatch(/\bprocess\b/);
    expect(js.split(INJECT_ORIGIN_PLACEHOLDER)).toHaveLength(2);
    expect(() => loaderSource("no placeholder here", "http://localhost:4400")).toThrow(/npm run build/);
  });

  it("the injectable IIFE mounts with the injector's origin before the root exists, never on CRT's own pages, and mounts nothing unreplaced (F-126, F-127)", async () => {
    const out = await build({ ...LOADER_INJECT, write: false });
    const js = out.outputFiles![0]!.text;
    tmp = mkdtempSync(join(tmpdir(), "crt-loader-"));
    const run = async (name: string, source: string, port: string) => {
      const dom = fakeDom({ hostname: "localhost", rootless: true });
      vi.stubGlobal("location", { hostname: "localhost", port, href: `http://localhost:${port}/` });
      const file = join(tmp, name);
      writeFileSync(file, source);
      await import(pathToFileURL(file).href);
      return dom;
    };
    // The app's page: mounted for the injector's origin, the tag appended once the root exists.
    const app = await run("app.js", loaderSource(js, "http://localhost:4409"), "3000");
    expect((app.window.__crt as { loader: { origin: string } }).loader.origin).toBe("http://localhost:4409");
    app.addRoot();
    expect(app.appended[0]).toMatchObject({ src: "http://localhost:4409/__crt/overlay.js" });
    vi.unstubAllGlobals();
    // CRT's own pages (the landing page, the review page) are not the app.
    const own = await run("own.js", loaderSource(js, "http://localhost:4409"), "4409");
    expect(own.window.__crt).toBeUndefined();
    vi.unstubAllGlobals();
    // An unreplaced build (the placeholder is not an origin) mounts nothing.
    const raw = await run("raw.js", js, "3000");
    expect(raw.window.__crt).toBeUndefined();
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
