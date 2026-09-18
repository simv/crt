import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPluginMarketplace } from "../scripts/plugin-marketplace.mjs";

// PRD-setup F-85: the build lays `plugin/` and a generated marketplace manifest out as a complete
// Claude Code marketplace, the one `crt setup` registers from disk (F-86). CI runs
// `claude plugin validate` on the real dist/ output; this test pins the shape from a tmp dir.

const REPO = join(import.meta.dirname, "..", "..", "..");
const PKG = join(import.meta.dirname, "..", "package.json");

let out: string;
let manifest: ReturnType<typeof buildPluginMarketplace>;

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "crt-marketplace-"));
  writeFileSync(join(out, "stale.txt"), "from an earlier build\n");
  manifest = buildPluginMarketplace({ repo: REPO, pkg: PKG, out });
});

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe("bundled plugin marketplace (F-85)", () => {
  it("writes .claude-plugin/marketplace.json named crt with source ./plugin and the package version (F-85, F-87)", () => {
    const version = (JSON.parse(readFileSync(PKG, "utf8")) as { version: string }).version;
    const written = JSON.parse(readFileSync(join(out, ".claude-plugin", "marketplace.json"), "utf8")) as typeof manifest;
    expect(written).toEqual(manifest);
    expect(written.name).toBe("crt");
    expect(written.metadata.version).toBe(version);
    expect(written.plugins).toHaveLength(1);
    expect(written.plugins[0]).toMatchObject({ name: "crt", source: "./plugin", version });
    expect(written.owner).toEqual((JSON.parse(readFileSync(join(REPO, ".claude-plugin", "marketplace.json"), "utf8")) as typeof manifest).owner);
  });

  it("copies the whole plugin: manifest, hooks and the seven skills (F-85, F-104)", () => {
    const plugin = join(out, "plugin");
    const pluginJson = JSON.parse(readFileSync(join(plugin, ".claude-plugin", "plugin.json"), "utf8")) as { name: string; version: string };
    expect(pluginJson.name).toBe("crt");
    expect(pluginJson.version).toBe(manifest.metadata.version);
    expect(readFileSync(join(plugin, "hooks", "hooks.json"), "utf8")).toBe(readFileSync(join(REPO, "plugin", "hooks", "hooks.json"), "utf8"));
    expect(existsSync(join(plugin, "hooks", "session-start.mjs"))).toBe(true);
    for (const skill of ["serve", "next", "tasks", "task", "done", "intake", "init"]) {
      expect(readFileSync(join(plugin, "skills", skill, "SKILL.md"), "utf8")).toBe(readFileSync(join(REPO, "plugin", "skills", skill, "SKILL.md"), "utf8"));
    }
  });

  it("replaces an earlier layout instead of merging into it (F-85)", () => {
    expect(existsSync(join(out, "stale.txt"))).toBe(false);
  });
});
