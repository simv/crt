import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildEntries } from "../../../overlay/build.mjs";
import { buildIntegrations } from "../../scripts/integrations.mjs";

/**
 * PRD-embedded F-98: the strings a production build of an app using any CRT entry must not contain.
 * `CrtDevTools` is deliberately absent (an export name may survive in an RSC manifest, §12 rule 4).
 */
export const F98_STRINGS = ["__crt", "/loader.js", "overlay.js", "mountCrt", "4400"] as const;

/** Which of the F-98 strings `text` contains (expected `[]` for production output). */
export function f98Found(text: string): string[] {
  return F98_STRINGS.filter((s) => text.includes(s));
}

export const SERVER_DIR = join(import.meta.dirname, "..", "..");

/**
 * A scratch project for the F-98 builds: `node_modules/claude-review-tool` is a copy of this
 * package's `package.json` (so `exports` and its conditions are the real ones) with
 * `dist/integrations/` built by the same code as `npm run build` — never the repo's own dist/,
 * which CI has not built when the unit tests run. `node_modules/react` is a stub (the entries
 * import `useEffect` only). The project root carries `.git` and `.crt/config.json` with `port`
 * 4411, and `app/` is a Vite/esbuild fixture: `index.html` plus `main.ts` importing both entries.
 */
export async function fakeProject(root: string, o: { port?: number } = {}): Promise<{ pkg: string; app: string; main: string; html: string }> {
  const pkg = join(root, "node_modules", "claude-review-tool");
  mkdirSync(join(pkg, "dist"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), readFileSync(join(SERVER_DIR, "package.json")));
  await buildEntries(join(pkg, "dist"), "silent");
  buildIntegrations({ dist: join(pkg, "dist") });

  const react = join(root, "node_modules", "react");
  mkdirSync(react, { recursive: true });
  writeFileSync(join(react, "package.json"), JSON.stringify({ name: "react", version: "18.3.1", type: "module", main: "index.js" }) + "\n");
  writeFileSync(join(react, "index.js"), "export function useEffect() {}\n");

  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, ".crt"), { recursive: true });
  writeFileSync(join(root, ".crt", "config.json"), JSON.stringify({ port: o.port ?? 4411 }) + "\n");

  const app = join(root, "app");
  mkdirSync(app, { recursive: true });
  const html = join(app, "index.html");
  const main = join(app, "main.ts");
  writeFileSync(html, '<!doctype html>\n<html><head><meta charset="utf-8"><title>fixture</title></head><body><script type="module" src="/main.ts"></script></body></html>\n');
  writeFileSync(main, 'import { mountCrt } from "claude-review-tool/loader";\nimport { CrtDevTools } from "claude-review-tool/react";\nmountCrt();\nCrtDevTools({});\n');
  return { pkg, app, main, html };
}
