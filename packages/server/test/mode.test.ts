import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CrtError } from "../src/errors.js";
import { DEFAULT_CONFIG, DEFAULT_CONFIG_FILE, isMode, readConfig, resolveMode } from "../src/init.js";

// PRD-embedded F-91 / F-92 (the F-110 mode-selection rows): `crt` is embedded, `crt proxy` is
// proxy, `--mode` outranks the config files, and `mode` in .crt/config.local.json wins over
// .crt/config.json.

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "crt-mode-"));
  mkdirSync(join(tmp, ".crt"), { recursive: true });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const write = (file: string, value: unknown) => writeFileSync(join(tmp, ".crt", file), JSON.stringify(value), "utf8");

describe("mode selection (F-91, F-92)", () => {
  it("`crt` is embedded by default: DEFAULT_CONFIG_FILE and readConfig say so (F-91)", () => {
    expect(DEFAULT_CONFIG_FILE.mode).toBe("embedded");
    expect(DEFAULT_CONFIG.mode).toBe("embedded");
    expect(readConfig(tmp)).toMatchObject({ mode: "embedded", modeSource: null });
    expect(resolveMode({ command: "serve", config: readConfig(tmp) })).toBe("embedded");
  });

  it("`crt proxy` is `--mode proxy` (F-92)", () => {
    expect(resolveMode({ command: "proxy", config: DEFAULT_CONFIG })).toBe("proxy");
    expect(resolveMode({ command: "proxy", flag: "proxy", config: DEFAULT_CONFIG })).toBe("proxy");
    expect(() => resolveMode({ command: "proxy", flag: "embedded", config: DEFAULT_CONFIG })).toThrow(CrtError);
  });

  it("`--mode` outranks both config files; a bad value is one crt: line (F-91)", () => {
    write("config.json", { mode: "proxy" });
    write("config.local.json", { mode: "proxy" });
    expect(resolveMode({ command: "serve", flag: "embedded", config: readConfig(tmp) })).toBe("embedded");
    expect(resolveMode({ command: "serve", flag: "proxy", config: DEFAULT_CONFIG })).toBe("proxy");
    for (const bad of ["", true, "PROXY", "http"]) {
      expect(() => resolveMode({ command: "serve", flag: bad, config: DEFAULT_CONFIG }), String(bad)).toThrow(/--mode must be embedded or proxy/);
    }
  });

  it("`mode` in config.local.json wins over config.json; junk values are ignored (F-91, §5.3)", () => {
    write("config.json", { mode: "proxy" });
    expect(readConfig(tmp)).toMatchObject({ mode: "proxy", modeSource: "project" });
    expect(resolveMode({ command: "serve", config: readConfig(tmp) })).toBe("proxy");
    write("config.local.json", { mode: "embedded" });
    expect(readConfig(tmp)).toMatchObject({ mode: "embedded", modeSource: "local" });
    write("config.local.json", { mode: "nonsense" });
    expect(readConfig(tmp)).toMatchObject({ mode: "proxy", modeSource: "project" });
    write("config.json", { mode: 42 });
    expect(readConfig(tmp)).toMatchObject({ mode: "embedded", modeSource: null });
  });

  it("isMode accepts exactly the two ids (F-91)", () => {
    expect(isMode("embedded")).toBe(true);
    expect(isMode("proxy")).toBe(true);
    for (const v of ["Proxy", "", null, undefined, 1, {}]) expect(isMode(v)).toBe(false);
  });
});
