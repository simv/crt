import { afterEach, describe, expect, it, vi } from "vitest";
import { crtJson, isSessionAlive, onRequestFailure, rasterFrameUrl, sessionEvents } from "../../overlay/src/api.js";
import { fetchHealth } from "../../overlay/src/health.js";
import { ANSWER_EVENT, answerProbe, ask, ASK_EVENT, MAX_ANSWER_CHARS, type ProbeSource, QUESTIONS, remoteProbe, UNKNOWN_COMPONENTS, UNKNOWN_FRAMEWORK } from "../../overlay/src/probe-wire.js";
import { pageProbe, probe, setProbe } from "../../overlay/src/probe.js";
import { pageRasteriser, setRasteriser, takeScreenshots } from "../../overlay/src/screenshot.js";
import { memoryStorage, safeGet, safeGetJson, safeRemove, safeSet, setStorageBacking, type StorageBacking, webStorage } from "../../overlay/src/storage.js";
import { type CrtRequest, pageTransport, setTransport, type StreamHandlers, type Transport, transport } from "../../overlay/src/transport.js";
import { HEALTH_PATH, RASTER_PATH, SESSIONS_PATH } from "../src/routes.js";

// PRD-extension M37: the four seams of the overlay, each read against a fake. The defaults are
// today's behaviour and are what every e2e spec runs (N-41).

afterEach(() => {
  setTransport(pageTransport);
  setProbe(pageProbe);
  setStorageBacking(webStorage);
  setRasteriser(pageRasteriser);
  onRequestFailure(null);
  vi.unstubAllGlobals();
});

function fakeTransport(answer: (path: string, init?: CrtRequest) => { ok: boolean; status: number; data: unknown }) {
  const calls: Array<{ path: string; init?: CrtRequest }> = [];
  const streams: Array<{ path: string; handlers: StreamHandlers; types: readonly string[]; closed: boolean }> = [];
  const t: Transport = {
    json: async (path, init) => {
      calls.push({ path, init });
      return answer(path, init);
    },
    events: (path, handlers, types = []) => {
      const stream = { path, handlers, types, closed: false };
      streams.push(stream);
      return { close: () => (stream.closed = true) };
    },
    url: (path) => `http://localhost:4400${path}`,
    origin: () => "http://localhost:4400",
  };
  return { t, calls, streams };
}

describe("the transport seam (PRD-extension F-151)", () => {
  it("is the page's own fetch and EventSource until it is replaced (F-151, N-41)", () => {
    expect(transport()).toBe(pageTransport);
    expect(pageTransport.origin()).toBe(""); // no script tag here: same-origin, as behind the proxy
    expect(pageTransport.url(RASTER_PATH)).toBe(RASTER_PATH);
  });

  it("carries every JSON call of api.ts: the answer's fields on ok, the server's error line and the failure listener otherwise (F-13, F-81, F-151)", async () => {
    const { t, calls } = fakeTransport((path) => (path.endsWith("/bad") ? { ok: false, status: 409, data: { ok: false, error: "no such session" } } : { ok: true, status: 200, data: { ok: true, id: "s1" } }));
    setTransport(t);
    const failed = vi.fn();
    onRequestFailure(failed);
    await expect(crtJson<{ id: string }>(SESSIONS_PATH, { method: "POST", body: "{}" }, ["id"])).resolves.toMatchObject({ id: "s1" });
    expect(calls[0]).toEqual({ path: SESSIONS_PATH, init: { method: "POST", body: "{}" } });
    await expect(crtJson(`${SESSIONS_PATH}/bad`)).rejects.toThrow("no such session");
    expect(failed).toHaveBeenCalledTimes(1);
    await expect(isSessionAlive("bad")).resolves.toBe(false);
    await expect(isSessionAlive("s1")).resolves.toBe(true);
  });

  it("says `CRT server answered <status>` when the body is not the server's JSON (F-151)", async () => {
    setTransport(fakeTransport(() => ({ ok: false, status: 502, data: "<html>" })).t);
    await expect(crtJson(SESSIONS_PATH)).rejects.toThrow("CRT server answered 502");
  });

  it("carries the health read: the payload on ok, `failed` for a refusal or a request that did not complete (F-81, F-151)", async () => {
    const { t, calls } = fakeTransport(() => ({ ok: true, status: 200, data: { ok: true, version: "0.10.0" } }));
    setTransport(t);
    await expect(fetchHealth()).resolves.toMatchObject({ version: "0.10.0" });
    expect(calls[0]).toEqual({ path: HEALTH_PATH, init: { cache: "no-store" } });
    setTransport(fakeTransport(() => ({ ok: false, status: 500, data: {} })).t);
    await expect(fetchHealth()).resolves.toBe("failed");
    setTransport({ ...t, json: () => Promise.reject(new Error("offline")) });
    await expect(fetchHealth()).resolves.toBe("failed");
  });

  it("carries the session stream with its replay point and the `live` marker, and the rasteriser frame's URL (F-16, F-25, F-151)", () => {
    const { t, streams } = fakeTransport(() => ({ ok: true, status: 200, data: {} }));
    setTransport(t);
    const handlers: StreamHandlers = { onEvent: vi.fn(), onError: vi.fn() };
    const stream = sessionEvents("s1", 7, handlers);
    expect(streams[0]).toMatchObject({ path: `${SESSIONS_PATH}/s1/events?after=7`, types: ["live"], handlers });
    stream.close();
    expect(streams[0]!.closed).toBe(true);
    expect(rasterFrameUrl()).toBe(`http://localhost:4400${RASTER_PATH}`);
  });
});

describe("the probe seam (PRD-extension F-152)", () => {
  const entry = { level: "error" as const, message: "boom", stack: null, timestamp: "2026-11-17T00:00:00.000Z", url: "http://localhost:3000/" };
  const failure = { method: "GET", url: "/api", status: 500, error: null, via: "fetch" as const, durationMs: 3, timestamp: "2026-11-17T00:00:00.000Z" };
  const detection = { framework: "react" as const, components: [{ name: "Cart", kind: "function" as const }], source: null };
  const framework = { name: "react" as const, version: null, bundler: "vite" as const, route: null, hints: ["/@vite/client"] };

  function source(over: Partial<ProbeSource> = {}): ProbeSource {
    return {
      console: () => [entry],
      clearConsole: vi.fn(),
      network: () => [failure],
      clearNetwork: vi.fn(),
      components: () => detection,
      componentName: () => "Cart",
      framework: () => framework,
      present: () => false,
      ...over,
    };
  }
  /** Trusting cleaners: the shapes are the extension's to check (extension/clean.ts), the wire's job is to deliver them. */
  const clean = {
    console: (v: unknown) => (Array.isArray(v) ? (v as (typeof entry)[]) : []),
    network: (v: unknown) => (Array.isArray(v) ? (v as (typeof failure)[]) : []),
    components: (v: unknown) => (v && typeof v === "object" ? (v as typeof detection) : UNKNOWN_COMPONENTS),
    framework: (v: unknown) => (v && typeof v === "object" ? (v as typeof framework) : UNKNOWN_FRAMEWORK),
  };

  it("is the same-world readers until it is replaced (F-152, N-41)", () => {
    expect(probe()).toBe(pageProbe);
  });

  it("answers each question in the turn it was asked, as JSON on the target it was asked on (F-152)", () => {
    // Two realms share one event target and nothing else: what crosses is a question name and a string.
    const world = new EventTarget();
    const src = source();
    const stop = answerProbe(src, world);
    const remote = remoteProbe(() => world, clean);
    expect(remote.console()).toEqual([entry]);
    expect(remote.network()).toEqual([failure]);
    expect(remote.framework()).toEqual(framework);
    expect(remote.components(world as unknown as Element)).toEqual(detection);
    expect(remote.componentName(world as unknown as Element)).toBe("Cart");
    expect(remote.present()).toBe(false);
    remote.clearConsole();
    remote.clearNetwork();
    expect(src.clearConsole).toHaveBeenCalledTimes(1);
    expect(src.clearNetwork).toHaveBeenCalledTimes(1);
    stop();
    expect(remote.console()).toEqual([]); // nobody answers: the empty value, never a throw
  });

  it("sends a question name one way and a JSON string back, and nothing else (F-152, N-42)", () => {
    const world = new EventTarget();
    answerProbe(source(), world);
    const seen: unknown[] = [];
    world.addEventListener(ASK_EVENT, (e) => seen.push((e as CustomEvent<unknown>).detail));
    world.addEventListener(ANSWER_EVENT, (e) => seen.push((e as CustomEvent<unknown>).detail));
    ask("componentName", world);
    expect(seen.sort()).toEqual(['"Cart"', "componentName"]);
    expect(QUESTIONS).not.toContain("send");
    for (const q of QUESTIONS) expect(q, "a question reads or clears a log, or looks an element up").toMatch(/^(console|clearConsole|network|clearNetwork|components|componentName|framework|present|probe)$/);
  });

  it("gives the empty value when the page-world half is absent, throws, answers nonsense or answers too much (F-152, N-42)", () => {
    const world = new EventTarget();
    const remote = remoteProbe(() => world, clean);
    expect(remote.framework()).toEqual(UNKNOWN_FRAMEWORK);
    expect(remote.componentName(world as unknown as Element)).toBeNull();
    expect(remoteProbe(() => null, clean).network()).toEqual([]);

    const stop = answerProbe(source({ components: () => { throw new Error("getter on a fiber"); } }), world); // prettier-ignore
    expect(remote.components(world as unknown as Element)).toEqual(UNKNOWN_COMPONENTS);
    stop();

    // A page script that forges the answer: not JSON, then far too long.
    const forge = (detail: string) => (e: Event) => e.target!.dispatchEvent(new CustomEvent(ANSWER_EVENT, { detail }));
    const notJson = forge("{not json");
    world.addEventListener(ASK_EVENT, notJson);
    expect(ask("console", world)).toBeNull();
    world.removeEventListener(ASK_EVENT, notJson);
    world.addEventListener(ASK_EVENT, forge(`"${"x".repeat(MAX_ANSWER_CHARS)}"`));
    expect(ask("console", world)).toBeNull();
  });

  it("ignores an event that is not a question (F-152)", () => {
    const world = new EventTarget();
    const src = source({ console: vi.fn(() => []) });
    answerProbe(src, world);
    world.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: "send" }));
    world.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { question: "console" } }));
    expect(src.console).not.toHaveBeenCalled();
  });
});

describe("the storage seam (PRD-extension F-153)", () => {
  /** A Web Storage stand-in for the default backing. */
  function fakeWebStorage() {
    const make = () => {
      const m = new Map<string, string>();
      return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    };
    vi.stubGlobal("localStorage", make());
    vi.stubGlobal("sessionStorage", make());
  }
  const backings: Array<[string, () => StorageBacking]> = [
    ["Web Storage", () => (fakeWebStorage(), webStorage)],
    ["memory", () => memoryStorage()],
  ];

  for (const [name, make] of backings) {
    it(`reads, writes and removes the same keys against ${name}, the two areas apart (F-12, F-56, F-153)`, () => {
      setStorageBacking(make());
      expect(safeGet("session", "crt.annotations.v1")).toBeNull();
      safeSet("session", "crt.annotations.v1", '[{"n":1}]');
      safeSet("local", "crt.launcher.v1", '{"right":16}');
      expect(safeGetJson("session", "crt.annotations.v1")).toEqual([{ n: 1 }]);
      expect(safeGet("local", "crt.annotations.v1")).toBeNull();
      expect(safeGetJson("local", "crt.launcher.v1")).toEqual({ right: 16 });
      safeRemove("session", "crt.annotations.v1");
      expect(safeGet("session", "crt.annotations.v1")).toBeNull();
      safeSet("local", "bad", "{");
      expect(safeGetJson("local", "bad")).toBeNull();
    });
  }

  it("never throws when the backing does: the `unavailable` value on a read, nothing on a write (CRT-0043, F-153)", () => {
    const refuse = () => {
      throw new Error("blocked");
    };
    setStorageBacking({ get: refuse, set: refuse, remove: refuse });
    expect(safeGet("local", "k", "unavailable")).toBe("unavailable");
    expect(() => safeSet("local", "k", "v")).not.toThrow();
    expect(() => safeRemove("local", "k")).not.toThrow();
  });

  it("starts a memory backing from what was stored and reports each write and removal once (F-153, N-44)", () => {
    const writes: unknown[] = [];
    setStorageBacking(memoryStorage({ session: { a: "1" } }, (which, key, value) => writes.push([which, key, value])));
    expect(safeGet("session", "a")).toBe("1");
    safeSet("local", "b", "2");
    safeRemove("session", "a");
    safeRemove("session", "a");
    expect(writes).toEqual([["local", "b", "2"], ["session", "a", null]]); // prettier-ignore
  });
});

describe("the rasteriser seam (PRD-extension F-158)", () => {
  /** A canvas that records what was drawn on it; enough DOM for takeScreenshots. */
  function fakeDom() {
    const made: Array<{ width: number; height: number; drawn: unknown[][] }> = [];
    const canvas = () => {
      const c = { width: 0, height: 0, drawn: [] as unknown[][] };
      const ctx = new Proxy({ drawImage: (...a: unknown[]) => void c.drawn.push(a), measureText: () => ({ width: 8 }) } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => undefined), set: () => true });
      made.push(c);
      return Object.assign(c, { getContext: () => ctx, toDataURL: () => `data:image/png;base64,${c.width}x${c.height}` });
    };
    vi.stubGlobal("document", { createElement: canvas });
    vi.stubGlobal("window", { innerWidth: 400, innerHeight: 300 });
    return { made, canvas };
  }

  it("draws the markers and cuts the crops on whatever canvas the rasteriser returns, and says which way it came (F-16, F-158)", async () => {
    const { canvas } = fakeDom();
    const fromBrowser = Object.assign(canvas(), { width: 800, height: 600 }); // the tab's own pixels at DPR 2
    setRasteriser(async () => ({ canvas: fromBrowser as unknown as HTMLCanvasElement, via: "browser" }));
    const shots = await takeScreenshots([{ n: 1, kind: "box", rect: { x: 10, y: 20, width: 100, height: 50 }, point: null }]);
    expect(shots.error).toBeNull();
    expect(shots.via).toBe("browser");
    expect(shots.viewport).toBe("viewport.png");
    expect(shots.images["viewport.png"]).toBe("800x600");
    expect(shots.images["viewport-annotated.png"]).toBe("800x600");
    expect(shots.crops.get(1)).toBe("ann-1.png");
    expect(Object.keys(shots.images).sort()).toEqual(["ann-1.png", "viewport-annotated.png", "viewport.png"]);
  });

  it("carries the rasteriser's refusal as the screenshots error, with no picture and no `via` (F-16, F-158)", async () => {
    fakeDom();
    setRasteriser(() => Promise.reject(new Error("rasterisation failed: the tab could not be captured")));
    const shots = await takeScreenshots([]);
    expect(shots).toMatchObject({ viewport: null, annotated: null, error: "rasterisation failed: the tab could not be captured" });
    expect(shots.via).toBeUndefined();
    expect(shots.images).toEqual({});
  });
});
