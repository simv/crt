// Overlay build (PRD §5.1; PRD-embedded F-96, F-97, F-98): five bundles into packages/server/dist/, all
// from the esbuild API so the defines need no shell quoting (Windows is the primary dev platform).
//   overlay.js               the overlay (IIFE), served at /__crt/overlay.js in both modes
//   early.js                 the console/network hooks (IIFE), injected by proxy mode only (F-20)
//   loader.js                the loader (IIFE, auto-mounts), served at /__crt/loader.js (F-94, F-96);
//                            process.env.NODE_ENV is defined as "development" so the F-98 guard
//                            folds away and no `process` reference reaches a browser
//   integrations/loader.js   the same source as an ES module with no side effect on import
//                            (`claude-review-tool/loader`); process.env.NODE_ENV is left for the
//                            app's bundler
//   integrations/react.js    the React entry (`claude-review-tool/react`, F-97): an ES module with
//                            `react` external and "use client" kept as its first statement
// The no-op modules and the .d.ts files next to them come from packages/server/scripts/integrations.mjs.
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIST = join(here, "..", "server", "dist");

/** The loader bundles, shared with test/loader.test.ts so the unit test builds exactly what ships. */
export const LOADER_IIFE = {
  entryPoints: [join(here, "src", "loader-auto.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  define: { "process.env.NODE_ENV": '"development"' },
};
export const LOADER_ESM = {
  entryPoints: [join(here, "src", "loader.ts")],
  bundle: true,
  format: "esm",
  target: "es2020",
  minify: false,
  // esbuild defines process.env.NODE_ENV itself for the browser platform; neutral leaves it to the app's bundler.
  platform: "neutral",
};

/** The React entry (F-97): not minified, so "use client" stays the first line and the F-98 guard stays readable. */
export const REACT_ESM = {
  entryPoints: [join(here, "src", "react.ts")],
  bundle: true,
  format: "esm",
  target: "es2020",
  minify: false,
  platform: "neutral",
  external: ["react"],
};

const common = { bundle: true, format: "iife", target: "es2020", minify: true };

/** Build every bundle into `dist` (packages/server/dist by default; tests pass a temp dir). */
export async function buildAll(dist = DEFAULT_DIST, logLevel = "info") {
  await build({ ...common, logLevel, entryPoints: [join(here, "src", "index.ts")], outfile: join(dist, "overlay.js") });
  await build({ ...common, logLevel, entryPoints: [join(here, "src", "early.ts")], outfile: join(dist, "early.js") });
  await build({ ...LOADER_IIFE, logLevel, outfile: join(dist, "loader.js") });
  await buildEntries(dist, logLevel);
}

/** The ES-module entries only (F-97): `integrations/loader.js` and `integrations/react.js`. */
export async function buildEntries(dist = DEFAULT_DIST, logLevel = "info") {
  await build({ ...LOADER_ESM, logLevel, outfile: join(dist, "integrations", "loader.js") });
  await build({ ...REACT_ESM, logLevel, outfile: join(dist, "integrations", "react.js") });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildAll();
}
