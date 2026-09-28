import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as tokens from "../../overlay/src/tokens.js";

// CRT-0043: the overlay's structure rules, read from the source. One /__crt/ client, one copy of
// each shared helper, colours only from tokens.ts (F-112), a status line built without HTML.
// `loader.ts` is exempt throughout: it stays self-contained and tiny (N-20).

const SRC = join(import.meta.dirname, "..", "..", "overlay", "src");
const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
/** A module's code without its comments (a `//` after a colon is a URL, not a comment). */
const source = (f: string) =>
  readFileSync(join(SRC, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const using = (re: RegExp) => files.filter((f) => re.test(source(f))).sort();

describe("overlay structure (CRT-0043)", () => {
  it("talks to /__crt/ only from api.ts and health.ts (the loader adds a script tag): nothing else builds a CRT URL or calls fetch but the screenshot's stylesheet reads", () => {
    expect(using(/\bfetch\(/)).toEqual(["api.ts", "health.ts", "screenshot.ts"]);
    expect(using(/\bcrtUrl\(/)).toEqual(["api.ts", "base.ts", "health.ts"]);
    expect(using(/server\/src\/routes\.js/)).toEqual(["api.ts", "health.ts"]);
    expect(source("screenshot.ts")).not.toMatch(/__crt|from "\.\/base\.js"/);
  });

  it("defines escapeHtml, cssEscape and clamp once, in dom-util.ts", () => {
    for (const name of ["escapeHtml", "cssEscape", "clamp"]) {
      const defs = using(new RegExp(`\\b(function\\s+${name}\\b|(const|let)\\s+${name}\\s*=)`)).filter((f) => f !== "loader.ts");
      expect(defs, name).toEqual(["dom-util.ts"]);
    }
  });

  it("reads and writes Web Storage only through storage.ts", () => {
    expect(using(/\b(localStorage|sessionStorage)\s*\.|\?\s*localStorage\s*:|:\s*sessionStorage\b/).filter((f) => f !== "loader.ts")).toEqual(["storage.ts"]);
  });

  it("repeats no tokens.ts colour as a literal: every hex and every rgba() of a token is interpolated (F-112)", () => {
    const values = new Set<string>();
    for (const v of Object.values(tokens)) {
      if (typeof v === "string") values.add(v.toLowerCase());
      else if (Array.isArray(v)) for (const x of v) values.add(String(x).toLowerCase());
      else if (v && typeof v === "object") for (const pair of Object.values(v)) for (const x of pair as readonly string[]) values.add(x.toLowerCase());
    }
    const rgb = [...values].map((hex) => tokens.tint(hex, 1).replace(/,1\)$/, ","));
    for (const f of files.filter((x) => x !== "tokens.ts" && x !== "loader.ts")) {
      const text = source(f);
      const hexes = (text.match(/#[0-9a-fA-F]{3,6}\b/g) ?? []).map((h) => h.toLowerCase());
      expect(hexes.filter((h) => values.has(h)), f).toEqual([]);
      for (const prefix of rgb) expect(text.replace(/\s/g, ""), `${f}: ${prefix}`).not.toContain(prefix);
    }
  });

  it("tint writes a token at an alpha the way the stylesheet always has", () => {
    expect(tokens.tint(tokens.ACCENT, 0.08)).toBe("rgba(255,61,113,.08)");
    expect(tokens.tint(tokens.INK, 0.9)).toBe("rgba(17,17,17,.9)");
    expect(tokens.tint("#2e9e5b", 1)).toBe("rgba(46,158,91,1)");
  });

  it("keeps ui.ts to composing its parts: at most 700 lines", () => {
    expect(readFileSync(join(SRC, "ui.ts"), "utf8").trimEnd().split("\n").length).toBeLessThanOrEqual(700);
  });

  it("builds the status line as DOM: showStatus never assigns innerHTML", () => {
    const ui = source("ui.ts");
    const start = ui.indexOf("private showStatus(");
    expect(start).toBeGreaterThan(0);
    const body = ui.slice(start, ui.indexOf("\n  }\n", start));
    expect(body).toContain("replaceChildren");
    expect(body).not.toMatch(/innerHTML|insertAdjacentHTML/);
  });
});
