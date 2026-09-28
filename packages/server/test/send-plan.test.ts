import { describe, expect, it } from "vitest";
import type { Annotation } from "../../overlay/src/annotations.js";
import { canQuickNote, planSend } from "../../overlay/src/send-plan.js";

// CRT-0043: one rule for what a Send or Quick note carries (F-13, F-14, F-65, F-68), shared by the
// popover's buttons and sendToAgent. Before it, the Quick note button honoured "include" and the
// canQuickNote hook did not.

function ann(n: number, note = "", sessionId: string | null = null): Annotation {
  return {
    id: `a${n}`,
    n,
    kind: "pin",
    note,
    pageRect: { x: 0, y: 0, width: 1, height: 1 },
    point: { x: 0, y: 0 },
    element: null,
    elementInfo: null,
    elements: [],
    sessionId,
  };
}

describe("planSend (F-13, F-14, F-65, F-68)", () => {
  it("sends the most recent unsent annotation by default, or the one numbered n (F-65)", () => {
    const items = [ann(1, "one"), ann(2, "two", "s1"), ann(3, "three"), ann(4, "four", "s2")];
    expect(planSend(items)).toEqual({ ids: ["a3"] });
    expect(planSend(items, { n: 1 })).toEqual({ ids: ["a1"] });
  });

  it("with include, also carries every other unsent annotation, the chosen one first (F-65, F-11)", () => {
    const items = [ann(1, "one"), ann(2, "two", "s1"), ann(3), ann(4, "four")];
    expect(planSend(items, { n: 3, include: true })).toEqual({ ids: ["a3", "a1", "a4"] });
    expect(planSend(items, { include: true })).toEqual({ ids: ["a4", "a1", "a3"] });
  });

  it("refuses an empty store, an unknown number and an annotation already sent", () => {
    expect(() => planSend([])).toThrow("nothing to send: add an annotation first");
    expect(() => planSend([ann(1, "x", "s1")])).toThrow("nothing to send: add an annotation first");
    expect(() => planSend([ann(1)], { n: 7 })).toThrow("no annotation 7");
    expect(() => planSend([ann(1, "x", "s1")], { n: 1 })).toThrow("annotation 1 was already sent");
  });

  it("a quick note needs a note on every annotation it carries, the included ones too (F-14)", () => {
    const items = [ann(1, "one"), ann(2, "  ")];
    expect(() => planSend(items, { n: 2, quick: true })).toThrow("quick note needs a note on every annotation");
    expect(planSend(items, { n: 1, quick: true })).toEqual({ ids: ["a1"] });
    expect(() => planSend(items, { n: 1, quick: true, include: true })).toThrow("quick note needs a note on every annotation");
  });

  it("a page-level chat carries no annotations and its trimmed message, never a blank one (F-68)", () => {
    expect(planSend([ann(1, "one")], { message: "  why is this slow?  " })).toEqual({ ids: [], note: "why is this slow?" });
    expect(() => planSend([], { message: " \n " })).toThrow("nothing to send: type a message first");
  });
});

describe("canQuickNote (F-14): planSend's rule, so the button never offers a send that fails", () => {
  it("needs an unsent annotation with a note", () => {
    expect(canQuickNote([])).toBe(false);
    expect(canQuickNote([ann(1)])).toBe(false);
    expect(canQuickNote([ann(1, "note")])).toBe(true);
    expect(canQuickNote([ann(1, "note", "s1")], { n: 1 })).toBe(false);
  });

  it("with include, every other unsent annotation needs a note too", () => {
    const items = [ann(1, "one"), ann(2, "two"), ann(3)];
    expect(canQuickNote(items, { n: 1 })).toBe(true);
    expect(canQuickNote(items, { n: 1, include: true })).toBe(false);
    expect(canQuickNote([ann(1, "one"), ann(2, "two")], { n: 1, include: true })).toBe(true);
  });

  it("a page-level quick note needs a message", () => {
    expect(canQuickNote([], { message: "" })).toBe(false);
    expect(canQuickNote([], { message: "add a footer" })).toBe(true);
  });
});
