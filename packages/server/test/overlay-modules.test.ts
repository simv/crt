import { afterEach, describe, expect, it, vi } from "vitest";
import type { Annotation } from "../../overlay/src/annotations.js";
import { clampLauncher, parseLauncherPos } from "../../overlay/src/launcher.js";
import { safeGet, safeGetJson, safeRemove, safeSet } from "../../overlay/src/storage.js";
import { groupThreads, parsePageThreads, threadTitle } from "../../overlay/src/threads.js";

// CRT-0043: the pure logic lifted out of ui.ts with the split — which threads a reload re-attaches
// (F-66, F-68), the popover head's title, where the launcher may go (F-7) — and storage that
// never throws.

function ann(n: number, sessionId: string | null, o: Partial<Annotation> = {}): Annotation {
  return {
    id: `a${n}`,
    n,
    kind: "pin",
    note: "",
    pageRect: { x: 10, y: 20, width: 1, height: 1 },
    point: { x: 10, y: 20 },
    element: null,
    elementInfo: null,
    elements: [],
    sessionId,
    ...o,
  };
}

describe("threads (F-66, F-68)", () => {
  it("groupThreads: one thread per session the annotations were sent to, their ids in order, then the page-level chats", () => {
    const items = [ann(1, "s1"), ann(2, null), ann(3, "s2"), ann(4, "s1")];
    expect([...groupThreads(items, ["p1", "s2", "p2"])]).toEqual([
      ["s1", ["a1", "a4"]],
      ["s2", ["a3"]],
      ["p1", []],
      ["p2", []],
    ]);
    expect([...groupThreads([ann(1, null)], [])]).toEqual([]);
  });

  it("parsePageThreads keeps only the strings of a stored array", () => {
    expect(parsePageThreads(["s1", 2, null, "s2"])).toEqual(["s1", "s2"]);
    expect(parsePageThreads({ s1: true })).toEqual([]);
    expect(parsePageThreads(null)).toEqual([]);
  });

  it("threadTitle: the first annotation's number, how many more, and what it is; a page-level chat's otherwise", () => {
    expect(threadTitle(ann(2, "s1"), 1)).toBe("#2 · Pin at 10, 20");
    expect(threadTitle(ann(2, "s1"), 3)).toBe("#2 +2 · Pin at 10, 20");
    expect(threadTitle(undefined, 0)).toBe("Chat about this page");
  });
});

describe("the launcher's position (F-7)", () => {
  it("clampLauncher keeps it inside the window, 60 × 40 px from the far edges", () => {
    const viewport = { width: 800, height: 600 };
    expect(clampLauncher({ right: 16, bottom: 16 }, viewport)).toEqual({ right: 16, bottom: 16 });
    expect(clampLauncher({ right: -30, bottom: 900 }, viewport)).toEqual({ right: 0, bottom: 560 });
    expect(clampLauncher({ right: 790, bottom: -1 }, viewport)).toEqual({ right: 740, bottom: 0 });
    expect(clampLauncher({ right: 30, bottom: 30 }, { width: 40, height: 20 })).toEqual({ right: 0, bottom: 0 });
  });

  it("parseLauncherPos accepts two finite numbers and nothing else", () => {
    expect(parseLauncherPos({ right: 20, bottom: 40 })).toEqual({ right: 20, bottom: 40 });
    expect(parseLauncherPos({ right: "20", bottom: 40 })).toBeNull();
    expect(parseLauncherPos({ right: Infinity, bottom: 40 })).toBeNull();
    expect(parseLauncherPos(null)).toBeNull();
  });
});

describe("storage.ts never throws (F-12 Should, F-56, F-66, F-81, F-82)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads, writes and removes through Web Storage", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
    safeSet("session", "k", JSON.stringify({ a: 1 }));
    expect(safeGet("session", "k")).toBe('{"a":1}');
    expect(safeGetJson("session", "k")).toEqual({ a: 1 });
    safeSet("session", "bad", "{not json");
    expect(safeGetJson("session", "bad")).toBeNull();
    safeRemove("session", "k");
    expect(safeGet("session", "k")).toBeNull();
  });

  it("when storage throws (a sandboxed iframe, a full quota) reads give null or `unavailable` and writes do nothing", () => {
    const refuse = () => {
      throw new DOMException("denied", "SecurityError");
    };
    vi.stubGlobal("localStorage", { getItem: refuse, setItem: refuse, removeItem: refuse });
    expect(safeGet("local", "k")).toBeNull();
    expect(safeGet("local", "k", "unavailable")).toBe("unavailable");
    expect(safeGetJson("local", "k")).toBeNull();
    expect(() => safeSet("local", "k", "v")).not.toThrow();
    expect(() => safeRemove("local", "k")).not.toThrow();
  });
});
