import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeUsage, shortPath, summarize } from "../../src/providers/format.js";

// The panel text every driver shares (PRD F-25; PRD-providers F-53, F-111).

describe("provider text helpers (F-25)", () => {
  it("summarize collapses whitespace and cuts at 160 characters (F-25)", () => {
    expect(summarize("  a\n\tb   c ")).toBe("a b c");
    expect(summarize("x".repeat(160))).toBe("x".repeat(160));
    expect(summarize("x".repeat(161))).toBe(`${"x".repeat(157)}…`);
  });

  it("shortPath is relative with / inside cwd, else unchanged (F-25)", () => {
    const cwd = join(tmpdir(), "proj");
    expect(shortPath(join(cwd, "src", "a.ts"), cwd)).toBe("src/a.ts");
    expect(shortPath(join(tmpdir(), "other", "b.ts"), cwd)).toBe(join(tmpdir(), "other", "b.ts"));
    expect(shortPath(cwd, cwd)).toBe(cwd);
  });

  it("describeUsage renders token counts, or nothing (F-25)", () => {
    expect(describeUsage({ input_tokens: 10, cached_input_tokens: 2, output_tokens: 5 })).toBe("tokens: input 10, cached input 2, output 5");
    expect(describeUsage({})).toBeUndefined();
    expect(describeUsage(undefined)).toBeUndefined();
    expect(describeUsage({ note: "x" } as unknown as Record<string, number>)).toBeUndefined();
  });
});
