// Build step (PRD-setup F-85): the npm package ships the Claude Code plugin. `plugin/` is copied
// to `<out>/plugin/` and a marketplace manifest is generated at `<out>/.claude-plugin/marketplace.json`
// (name `crt`, `source: ./plugin`, version = the package version), so `dist/plugin-marketplace/` is a
// complete marketplace on disk that `crt setup` registers with `claude plugin marketplace add <dir>`
// (F-86) — no GitHub access, and the plugin version equals the server version by construction (F-87).
// Called from copy-intake.mjs; exported so test/plugin-marketplace.test.ts can run it into a tmp dir.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The marketplace name `crt setup` installs from; the same as the GitHub marketplace so it replaces rather than duplicates (§5.5). */
export const MARKETPLACE_NAME = "crt";

/**
 * Lay the bundled marketplace out under `out`, replacing whatever was there. `repo` is the
 * repository root (`plugin/` and `.claude-plugin/marketplace.json` are read from it) and `pkg`
 * the server's package.json. Returns the manifest that was written.
 */
export function buildPluginMarketplace({ repo, pkg, out }) {
  const version = JSON.parse(readFileSync(pkg, "utf8")).version;
  const source = JSON.parse(readFileSync(join(repo, ".claude-plugin", "marketplace.json"), "utf8"));
  const plugin = source.plugins.find((p) => p.name === MARKETPLACE_NAME) ?? source.plugins[0];
  const manifest = {
    name: MARKETPLACE_NAME,
    owner: source.owner,
    metadata: { ...source.metadata, version },
    plugins: [{ ...plugin, name: MARKETPLACE_NAME, source: "./plugin", version }],
  };
  rmSync(out, { recursive: true, force: true });
  cpSync(join(repo, "plugin"), join(out, "plugin"), { recursive: true });
  const file = join(out, ".claude-plugin", "marketplace.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
