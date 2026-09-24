import { build } from "esbuild";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REACT_ESM } from "../../overlay/build.mjs";
import { CrtDevTools } from "../../overlay/src/react.js";
import { fakeDom } from "./helpers/fake-dom.js";

// PRD-embedded F-97: `<CrtDevTools />` renders null, touches no DOM at render (SSR-safe) and mounts
// the loader from an effect; the built ES module keeps "use client" as its first statement,
// leaves `process.env.NODE_ENV` for the app's bundler and imports `react` only (F-98).

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("react");
  vi.resetModules();
});

describe("claude-review-tool/react (F-97)", () => {
  it("renders null — an empty string on the server, with no document/window in scope (F-97)", () => {
    expect(typeof document).toBe("undefined");
    expect(renderToString(createElement(CrtDevTools, {}))).toBe("");
    expect(renderToString(createElement(CrtDevTools, { port: 4409 }))).toBe("");
  });

  it("the effect calls mountCrt once with the props: the loader mounts on a loopback page (F-97, F-96)", async () => {
    const effects: Array<() => void> = [];
    vi.doMock("react", () => ({ useEffect: (fn: () => void) => void effects.push(fn) }));
    const { CrtDevTools: Mocked } = await import("../../overlay/src/react.js");
    expect(Mocked({ port: 4409 })).toBeNull();
    expect(effects).toHaveLength(1);
    const dom = fakeDom({ hostname: "localhost" });
    effects[0]!();
    expect((dom.window.__crt as { loader: { origin: string } }).loader.origin).toBe("http://localhost:4409");
    expect(dom.appended[0]).toMatchObject({ src: "http://localhost:4409/__crt/overlay.js", defer: true });
    // A second render (Strict Mode, a re-render) is a no-op: the loader is idempotent.
    effects[0]!();
    expect(dom.appended).toHaveLength(1);
  });

  it("the effect does nothing under NODE_ENV=production (F-98 layer 2)", async () => {
    const effects: Array<() => void> = [];
    vi.doMock("react", () => ({ useEffect: (fn: () => void) => void effects.push(fn) }));
    const { CrtDevTools: Mocked } = await import("../../overlay/src/react.js");
    vi.stubEnv("NODE_ENV", "production");
    try {
      Mocked({});
      const dom = fakeDom({ hostname: "localhost" });
      effects[0]!();
      expect(dom.window.__crt).toBeUndefined();
      expect(dom.appended).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('the built file starts with "use client", keeps process.env.NODE_ENV for the bundler, imports react only and has no side effect on import (F-97, F-98)', async () => {
    const out = await build({ ...REACT_ESM, write: false });
    const js = out.outputFiles![0]!.text;
    expect(js.split("\n")[0]).toBe('"use client";');
    expect(js).toContain('process.env.NODE_ENV !== "production"');
    expect([...js.matchAll(/^import .* from "([^"]+)";?$/gm)].map((m) => m[1])).toEqual(["react"]);
    expect(js).toMatch(/export \{[^}]*\bCrtDevTools\b/);
    // The only calls to mountCrt are its definition and the one inside the effect: nothing runs at import.
    expect(js.match(/mountCrt\(/g)).toHaveLength(2);
    expect(js).not.toMatch(/^CrtDevTools\(/m);
  });
});
