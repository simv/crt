import { build as esbuild } from "esbuild";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build as viteBuild, createServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crt } from "../src/integrations/vite.js";
import { f98Found, fakeProject } from "./helpers/entries.js";

// PRD-embedded F-98 / N-18: a production build of an app that uses any CRT entry contains nothing
// from CRT — none of `__crt`, `/loader.js`, `overlay.js`, `mountCrt`, `4400` — and the development
// build of the same app does carry the loader, so the guard is proven in both directions. Two
// bundlers: esbuild (layer 1, the `production` condition; and layer 2 alone, the NODE_ENV guard)
// and Vite (`vite build` with the plugin and the React component both present). The package under
// test is built into a scratch project by the same code as `npm run build` (helpers/entries.ts).
// Versions: esbuild 0.25, Vite 8 (devDependencies).

let root: string;
let app: string;
let main: string;
let html: string;
const nodeEnv = process.env.NODE_ENV;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "crt-f98-"));
  ({ app, main, html } = await fakeProject(root));
}, 90_000);

afterAll(() => {
  // `vite build` sets process.env.NODE_ENV = "production" for the process; put it back for the next file.
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  if (root) rmSync(root, { recursive: true, force: true });
});

/** Bundle the fixture entry with esbuild from the app directory (node_modules resolution walks up to the scratch project). */
async function bundle(o: { nodeEnv: "production" | "development"; conditions?: string[]; minify?: boolean }): Promise<string> {
  const out = await esbuild({
    entryPoints: [main],
    absWorkingDir: app,
    bundle: true,
    format: "esm",
    write: false,
    minify: o.minify ?? false,
    define: { "process.env.NODE_ENV": JSON.stringify(o.nodeEnv) },
    ...(o.conditions ? { conditions: o.conditions } : {}),
    logLevel: "silent",
  });
  return out.outputFiles[0]!.text;
}

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

describe("production guarantee — esbuild (F-98, N-18)", () => {
  it("development build (NODE_ENV=development, no condition) carries mountCrt and the CRT origin (F-98)", async () => {
    const js = await bundle({ nodeEnv: "development" });
    expect(js).toContain("mountCrt");
    expect(js).toContain("http://localhost:4400");
    expect(js).toContain("/__crt/overlay.js");
    expect(f98Found(js).sort()).toEqual([...["__crt", "/loader.js", "overlay.js", "mountCrt", "4400"]].sort());
  });

  it("production build with --define:process.env.NODE_ENV='\"production\"' --conditions=production contains none of the F-98 strings (F-98 layer 1)", async () => {
    const js = await bundle({ nodeEnv: "production", conditions: ["production"], minify: true });
    expect(f98Found(js)).toEqual([]);
    // The unminified form is the same apart from esbuild's own path comments and the (renamed-when-minified) no-op names.
    const plain = await bundle({ nodeEnv: "production", conditions: ["production"] });
    expect(plain).toContain("noop-loader.js");
    expect(plain).toContain("noop-react.js");
    expect(plain).not.toContain("__crt");
    expect(plain).not.toContain("overlay.js");
    expect(plain).not.toContain("4400");
  });

  it("production build with the NODE_ENV guard alone (no `production` condition) is just as clean once minified (F-98 layer 2)", async () => {
    const js = await bundle({ nodeEnv: "production", minify: true });
    expect(f98Found(js)).toEqual([]);
    // Unminified: only esbuild's path comment (`…/integrations/loader.js`) and the emptied function name remain — no loader code, path or port.
    const plain = await bundle({ nodeEnv: "production" });
    expect(plain).not.toContain("__crt");
    expect(plain).not.toContain("overlay.js");
    expect(plain).not.toContain("4400");
    expect(plain).toContain("if (false) return mount(options);");
    expect(plain).not.toContain("function mount(");
  });
});

describe("production guarantee — Vite (F-98, N-18)", () => {
  it("vite dev: transformIndexHtml prepends the inline module with the port from .crt/config.json (F-97, F-98 development direction)", async () => {
    const server = await createServer({
      root: app,
      configFile: false,
      envFile: false,
      logLevel: "silent",
      appType: "custom",
      server: { middlewareMode: true, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [crt({ root })],
    });
    try {
      const out = await server.transformIndexHtml("/index.html", readFileSync(html, "utf8"));
      const head = out.slice(out.indexOf("<head>") + "<head>".length, out.indexOf("</head>"));
      // Vite's own dev HTML hook runs after ours (order: "pre"): it prepends its client script first
      // and turns our inline module into a proxied one (`?html-proxy&index=0.js`) — so ours is the
      // first tag after /@vite/client and before everything the page had (§12 rule 1, Vite 8).
      const tags = [...head.matchAll(/<(script|meta|title|link)[^>]*>/gi)].map((m) => m[0]); // case-insensitive: an assertion, not a filter (CodeQL js/bad-tag-filter)
      expect(tags[0], head).toContain("/@vite/client");
      expect(tags[1], head).toMatch(/^<script type="module" src="\/index\.html\?html-proxy&index=0\.js">$/);
      expect(tags[2], head).toContain("<meta");
      const proxied = await server.transformRequest("/index.html?html-proxy&index=0.js");
      expect(proxied?.code).toContain("mountCrt({ port: 4411 })");
      expect(proxied?.code).toMatch(/import \{ mountCrt \} from "[^"]*claude-review-tool\/dist\/integrations\/loader\.js[^"]*"/);
    } finally {
      await server.close();
    }
  }, 30_000);

  it("vite build with crt() in the plugins and <CrtDevTools /> in the app: every output file is clean, and the plugin never ran (apply: \"serve\") (F-98)", async () => {
    const outDir = join(root, "vite-out");
    // A shell `vite build` finds NODE_ENV unset and sets "production"; vitest has set it to "test", which
    // would make Vite build in development (the `development` condition, no NODE_ENV folding).
    process.env.NODE_ENV = "production";
    await viteBuild({
      root: app,
      configFile: false,
      envFile: false,
      logLevel: "silent",
      plugins: [crt({ root })],
      build: { outDir, emptyOutDir: true },
    });
    const files = walk(outDir);
    expect(files.some((f) => f.endsWith("index.html"))).toBe(true);
    expect(files.some((f) => f.endsWith(".js"))).toBe(true);
    for (const f of files) expect(f98Found(readFileSync(f, "utf8")), f).toEqual([]);
    expect(readFileSync(files.find((f) => f.endsWith("index.html"))!, "utf8")).not.toContain("claude-review-tool");
  }, 60_000);
});
