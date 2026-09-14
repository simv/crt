import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";

describe("parseArgs", () => {
  it("parses command, positionals and flags", () => {
    const r = parseArgs(["serve", "--target", "http://localhost:3000", "--open", "--port=4400"]);
    expect(r.command).toBe("serve");
    expect(r.flags).toEqual({ target: "http://localhost:3000", open: true, port: "4400" });
  });

  it("keeps positionals after the command", () => {
    const r = parseArgs(["task", "CRT-0007"]);
    expect(r.command).toBe("task");
    expect(r.positionals).toEqual(["CRT-0007"]);
  });

  it("handles no arguments", () => {
    expect(parseArgs([]).command).toBeUndefined();
  });
});
