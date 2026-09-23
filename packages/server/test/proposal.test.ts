import { describe, expect, it } from "vitest";
import { ACCEPT_LINE, endsWithAcceptLine, summarizeProposal } from "../../overlay/src/proposal.js";
import { STUB_PROPOSALS } from "../src/providers/stub.js";

// PRD-chat §5.2 (F-120, N-29): the proposal's restatement, items and body, read without a DOM or a
// model from what the agent already writes.

describe("summarizeProposal (F-120, N-29)", () => {
  it("reads the stub's Allow proposal: the lead, two items, the body without the closing line", () => {
    const s = summarizeProposal(STUB_PROPOSALS.allow);
    expect(s.lead).toBe("Tests pass today, so the fix needs a new one.");
    expect(s.items).toEqual(["Cart total applies the promo discount", "Unit test covers the discounted total"]);
    expect(s.body).toBe(STUB_PROPOSALS.allow.slice(0, STUB_PROPOSALS.allow.indexOf(ACCEPT_LINE)).trimEnd());
    expect(s.body).not.toContain("Accept as-is");
    expect(s.body.endsWith("- [ ] Unit test covers the discounted total")).toBe(true);
  });

  it("reads the stub's Deny proposal as one item", () => {
    const s = summarizeProposal(STUB_PROPOSALS.deny);
    expect(s.lead).toBe("Understood, I won't run tests.");
    expect(s.items).toEqual(["Cart total applies the promo discount"]);
  });

  it("skips a heading and a fenced block before the checklist: the lead is the paragraph after the heading, fence lines are not items", () => {
    const text = [
      "## Ask",
      "Render the discounted total",
      "in the cart summary.",
      "",
      "```ts",
      "- not an item",
      "const total = subtotal - discount;",
      "```",
      "",
      "Proposed definition of done:",
      "- [x] Cart total applies the promo discount",
      "- [ ] Unit test covers it",
      "",
      ACCEPT_LINE,
    ].join("\n");
    const s = summarizeProposal(text);
    expect(s.lead).toBe("Render the discounted total in the cart summary.");
    expect(s.items).toEqual(["Cart total applies the promo discount", "Unit test covers it"]);
  });

  it("counts list items without boxes, numbered or starred", () => {
    const s = summarizeProposal(`Fix the total.\n\nProposed definition of done:\n- one\n* two\n1. three\n\n${ACCEPT_LINE}`);
    expect(s.items).toEqual(["one", "two", "three"]);
  });

  it("a message with no list has no items and the first paragraph as its lead (§12 rule 1)", () => {
    const s = summarizeProposal(`I'll make the total include the discount and add a test.\nNothing else changes.\n\n${ACCEPT_LINE}`);
    expect(s.items).toEqual([]);
    expect(s.lead).toBe("I'll make the total include the discount and add a test. Nothing else changes.");
  });

  it("falls back to the first line when every line is structure, and to an empty lead for an empty body", () => {
    expect(summarizeProposal(`## Plan\n- [ ] a\n\n${ACCEPT_LINE}`).lead).toBe("## Plan");
    expect(summarizeProposal(ACCEPT_LINE)).toEqual({ lead: "", items: [], body: "" });
  });

  it("removes the closing line with markdown emphasis, curly quotes and a line break (the endsWithAcceptLine tolerances)", () => {
    const text = "Fix it.\n\nProposed definition of done:\n- [ ] a\n\n**Accept as-is**, or tell me what to change,\nand I’ll write the task.  \n";
    expect(endsWithAcceptLine(text)).toBe(true);
    const s = summarizeProposal(text);
    expect(s.body).toBe("Fix it.\n\nProposed definition of done:\n- [ ] a");
    expect(s.items).toEqual(["a"]);
  });

  it("leaves a question untouched: no closing line, body === text (the caller gates on endsWithAcceptLine)", () => {
    const q = "Quick question before I write this: should the discount apply before or after tax?";
    expect(endsWithAcceptLine(q)).toBe(false);
    expect(summarizeProposal(q)).toEqual({ lead: q, items: [], body: q });
  });
});
