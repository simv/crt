import { describe, expect, it } from "vitest";
import type { ElementInfo } from "../src/capture-schema.js";
import type { ProviderRow } from "../src/session-events.js";
import { type Annotation, describeAnnotation } from "../../overlay/src/annotations.js";
import { providerState } from "../../overlay/src/provider-menu.js";
import { threadState } from "../../overlay/src/threads.js";

// CRT-0043: the overlay's pure labels — a thread's marker state (F-67), a provider row's state
// (F-45/F-56) and an annotation's one-line description (the popover head and the thread title,
// F-65/F-66) — pinned (from ui.ts) before ui.ts was split into modules.

function info(o: Partial<ElementInfo>): ElementInfo {
  return { selector: "div", tag: "div", id: "", components: [], ...o } as ElementInfo;
}

function ann(o: Partial<Annotation>): Annotation {
  return {
    id: "a1",
    n: 1,
    kind: "select",
    note: "",
    pageRect: { x: 0, y: 0, width: 0, height: 0 },
    point: null,
    element: null,
    elementInfo: null,
    elements: [],
    sessionId: null,
    ...o,
  };
}

function row(o: Partial<ProviderRow>): ProviderRow {
  return {
    id: "codex",
    displayName: "Codex",
    installed: true,
    loggedIn: true,
    version: "0.154.0",
    problem: null,
    markers: [],
    capabilities: { streaming: true, toolEvents: true, permissions: "sandboxed", images: "path", resume: true, interrupt: true },
    ...o,
  } as ProviderRow;
}

describe("threadState (F-67)", () => {
  it("is `task` once a task exists, else the session state, `starting` before the first event", () => {
    expect(threadState(null, null)).toBe("starting");
    expect(threadState("idle", null)).toBe("idle");
    expect(threadState("waiting", null)).toBe("waiting");
    expect(threadState("running", "CRT-0007")).toBe("task");
    expect(threadState(null, "CRT-0007")).toBe("task");
  });
});

describe("providerState (F-45, F-56)", () => {
  it("derives the menu row's state the way the server's preflight does", () => {
    expect(providerState(row({ installed: false, problem: "codex is not on PATH" }))).toBe("not on PATH");
    expect(providerState(row({ loggedIn: false, problem: "Codex is not logged in" }))).toBe("not logged in");
    expect(providerState(row({}))).toBe("ready");
    expect(providerState(row({ loggedIn: "unknown" }))).toBe("ready");
    expect(providerState(row({ problem: "codex 0.1.0 is too old (need ≥ 0.40)" }))).toBe("too old");
    expect(providerState(row({ problem: "could not run codex --version" }))).toBe("unknown");
  });
});

describe("describeAnnotation (F-65, F-66)", () => {
  it("a Select annotation: the nearest component and the selector, or the selector alone", () => {
    expect(describeAnnotation(ann({ elementInfo: info({ selector: "article.card", components: [{ name: "ProductCard", kind: "function" }] }) }))).toBe(
      "ProductCard · article.card",
    );
    expect(describeAnnotation(ann({ elementInfo: info({ selector: "#heading" }) }))).toBe("#heading");
    expect(describeAnnotation(ann({}))).toBe("element");
  });

  it("a Box: its rounded size, the element count and the first element", () => {
    const elements = [
      { el: null, info: info({ tag: "section", id: "hero" }) },
      { el: null, info: info({ tag: "h1" }) },
    ];
    expect(describeAnnotation(ann({ kind: "box", pageRect: { x: 0, y: 0, width: 120.4, height: 80.6 }, elements }))).toBe("Box 120×81 · 2 elements (section#hero)");
    expect(describeAnnotation(ann({ kind: "box", pageRect: { x: 0, y: 0, width: 10, height: 10 }, elements: elements.slice(1) }))).toBe("Box 10×10 · 1 element (h1)");
    expect(describeAnnotation(ann({ kind: "box", pageRect: { x: 0, y: 0, width: 10, height: 10 } }))).toBe("Box 10×10 · 0 elements (region)");
  });

  it("a Pin: its rounded document position", () => {
    expect(describeAnnotation(ann({ kind: "pin", pageRect: { x: 10.4, y: 20.6, width: 1, height: 1 } }))).toBe("Pin at 10, 21");
  });
});
