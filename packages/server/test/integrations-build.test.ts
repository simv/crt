import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildEntries } from "../../overlay/build.mjs";
import { buildIntegrations, ENTRY_FILES, NOOP_LOADER, NOOP_REACT } from "../scripts/integrations.mjs";
import { f98Found, SERVER_DIR } from "./helpers/entries.js";

// PRD-embedded F-97 / F-98: the package entries and their no-ops exist after a build, and
// package.json's `exports` points only at them. The build runs into a tmp dist through the same
// functions `npm run build` calls (packages/overlay/build.mjs, scripts/integrations.mjs — the
// plugin-marketplace.test.ts pattern), because CI runs the unit tests before the build.

const pkg = JSON.parse(readFileSync(join(SERVER_DIR, "package.json"), "utf8")) as {
  exports: Record<string, string | Record<string, string>>;
  files: string[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
  keywords: string[];
  main?: string;
};

let dist: string;

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), "crt-dist-"));
  await buildEntries(dist, "silent");
  buildIntegrations({ dist });
}, 60_000);

afterAll(() => {
  if (dist) rmSync(dist, { recursive: true, force: true });
});

describe("package entries — the build (F-97, F-98)", () => {
  it("produces dist/integrations/{loader,react,vite,noop-loader,noop-react}.js and the three .d.ts files (F-97)", () => {
    for (const f of ENTRY_FILES) expect(existsSync(join(dist, f)), f).toBe(true);
    expect(ENTRY_FILES).toEqual(
      expect.arrayContaining(["integrations/loader.js", "integrations/react.js", "integrations/vite.js", "integrations/noop-loader.js", "integrations/noop-react.js", "integrations/loader.d.ts", "integrations/react.d.ts", "integrations/vite.d.ts"]),
    );
  });

  it("every `exports` target is a built file under dist/, which `files` ships; `./loader`, `./react`, `./vite`, `./package.json` and nothing else, no main (F-97)", () => {
    expect(Object.keys(pkg.exports)).toEqual(["./loader", "./react", "./vite", "./package.json"]);
    expect(pkg.main).toBeUndefined();
    expect(pkg.files).toContain("dist");
    for (const [entry, value] of Object.entries(pkg.exports)) {
      const targets = typeof value === "string" ? [value] : Object.values(value);
      for (const t of targets) {
        if (t === "./package.json") continue;
        expect(t, `${entry} → ${t}`).toMatch(/^\.\/dist\/integrations\//);
        expect(existsSync(join(dist, t.replace(/^\.\/dist\//, ""))), `${entry} → ${t}`).toBe(true);
      }
    }
    // The browser entries route production builds to the no-ops and every entry names its types first (F-98 layer 1).
    expect(pkg.exports["./loader"]).toEqual({ types: "./dist/integrations/loader.d.ts", production: "./dist/integrations/noop-loader.js", default: "./dist/integrations/loader.js" });
    expect(pkg.exports["./react"]).toEqual({ types: "./dist/integrations/react.d.ts", production: "./dist/integrations/noop-react.js", default: "./dist/integrations/react.js" });
    expect(pkg.exports["./vite"]).toEqual({ types: "./dist/integrations/vite.d.ts", default: "./dist/integrations/vite.js" });
  });

  it("adds no runtime dependency: react and vite are optional peers, vite a devDependency (N-11, F-97)", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@anthropic-ai/claude-agent-sdk", "zod"]);
    expect(pkg.peerDependencies).toEqual({ react: ">=18", vite: ">=5" });
    expect(pkg.peerDependenciesMeta).toEqual({ react: { optional: true }, vite: { optional: true } });
    expect(pkg.devDependencies.vite).toMatch(/^\^\d/);
    expect(pkg.keywords).toEqual(expect.arrayContaining(["devtools", "vite-plugin", "nextjs"]));
  });

  it("the no-op modules export the same names as the entries and none of the F-98 strings (F-98)", () => {
    expect(readFileSync(join(dist, "integrations", "noop-loader.js"), "utf8")).toBe(NOOP_LOADER);
    expect(readFileSync(join(dist, "integrations", "noop-react.js"), "utf8")).toBe(NOOP_REACT);
    expect(NOOP_LOADER).toMatch(/^export function mountCrt\(\)/);
    expect(NOOP_REACT.split("\n")[0]).toBe('"use client";');
    expect(NOOP_REACT).toMatch(/export function CrtDevTools\(\)/);
    for (const text of [NOOP_LOADER, NOOP_REACT]) expect(f98Found(text.replace("mountCrt", ""))).toEqual([]); // the export name itself is the one allowed occurrence
  });

  it("the .d.ts files declare the public surface: mountCrt/MountOptions, CrtDevTools, crt (F-97)", () => {
    const loader = readFileSync(join(dist, "integrations", "loader.d.ts"), "utf8");
    const react = readFileSync(join(dist, "integrations", "react.d.ts"), "utf8");
    const vite = readFileSync(join(dist, "integrations", "vite.d.ts"), "utf8");
    expect(loader).toContain("export declare function mountCrt(options?: MountOptions): CrtLoader | null;");
    expect(loader).toContain("export interface MountOptions");
    expect(react).toContain("export declare function CrtDevTools(props: CrtDevToolsProps): null;");
    expect(react).toContain('from "./loader.js"');
    expect(vite).toContain("export declare function crt(options?: CrtVitePluginOptions): Plugin;");
    expect(vite).toContain('import type { Plugin } from "vite";');
    for (const text of [loader, react, vite]) expect(text).not.toContain("\r\n");
  });

  it("the built vite.js imports init.js and project.js only — never the server, providers or SDK (N-18)", () => {
    const js = readFileSync(join(dist, "integrations", "vite.js"), "utf8");
    const imports = [...js.matchAll(/^import .* from "([^"]+)";?$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["../init.js", "../project.js"]);
  });
});
