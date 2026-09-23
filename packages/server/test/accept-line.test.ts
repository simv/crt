import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCEPT_LINE, ACCEPT_REPLY, endsWithAcceptLine } from "../../overlay/src/chat.js";

// F-27 step 5: the intake skill, the stub and the overlay agree on one closing line, so the
// Accept button appears exactly when the agent is waiting for the developer to accept a proposal.

const skill = readFileSync(join(import.meta.dirname, "..", "..", "..", "plugin", "skills", "intake", "SKILL.md"), "utf8");
const stub = readFileSync(join(import.meta.dirname, "..", "src", "providers", "stub.ts"), "utf8");

describe("accept line (F-27)", () => {
  it("the skill and the stub end their proposals with the overlay's ACCEPT_LINE verbatim", () => {
    expect(skill).toContain(`\`${ACCEPT_LINE}\``);
    expect(skill).toContain(`a reply of \`${ACCEPT_REPLY}\``);
    expect(stub).toContain(ACCEPT_LINE);
  });

  it("the skill states the four-part proposal shape and the stub proposes in it (F-120)", () => {
    expect(skill).toContain("the line `Proposed definition of done:`");
    expect(skill).toContain("one `- [ ]` item per line");
    expect(skill).toContain("one paragraph restating the ask (no heading, no list)");
    expect(stub).toContain("\\n\\nProposed definition of done:\\n- [ ] ");
  });

  it("endsWithAcceptLine matches the line at the end of a message, tolerating markdown and curly quotes", () => {
    expect(endsWithAcceptLine(`Proposed DoD:\n- [ ] a\n- [ ] b\n\n${ACCEPT_LINE}`)).toBe(true);
    expect(endsWithAcceptLine(`${ACCEPT_LINE}\n\n`)).toBe(true);
    expect(endsWithAcceptLine("**Accept as-is**, or tell me what to change, and I’ll write the task.")).toBe(true);
    expect(endsWithAcceptLine("accept as-is, or tell me what to change,\nand I'll write the task.")).toBe(true);
  });

  it("endsWithAcceptLine rejects questions, confirmations and a line that is not last", () => {
    expect(endsWithAcceptLine("Should the discount apply before or after tax?")).toBe(false);
    expect(endsWithAcceptLine("Written **CRT-0007** at `.crt/tasks/CRT-0007-x.md`.")).toBe(false);
    expect(endsWithAcceptLine(`${ACCEPT_LINE}\n\nOne more thing: which branch?`)).toBe(false);
    expect(endsWithAcceptLine("")).toBe(false);
  });
});
