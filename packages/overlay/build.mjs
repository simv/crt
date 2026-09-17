// Overlay build (PRD §5.1; PRD-embedded F-96, F-98): four bundles into packages/server/dist/, all
// from the esbuild API so the defines need no shell quoting (Windows is the primary dev platform).
//   overlay.js               the overlay (IIFE), served at /__crt/overlay.js in both modes
//   early.js                 the console/network hooks (IIFE), injected by proxy mode only (F-20)
//   loader.js                the loader (IIFE, auto-mounts), served at /__crt/loader.js (F-94, F-96);
//                            process.env.NODE_ENV is defined as "development" so the F-98 guard
//                            folds away and no `process` reference reaches a browser
//   integrations/loader.js   the same source as an ES module with no side effect on import
//                            (`claude-review-tool/loader`); process.env.NODE_ENV is left for the
//                            app's bundler
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "server", "dist");

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

const common = { bundle: true, format: "iife", target: "es2020", minify: true, logLevel: "info" };

export async function buildAll() {
  await build({ ...common, entryPoints: [join(here, "src", "index.ts")], outfile: join(dist, "overlay.js") });
  await build({ ...common, entryPoints: [join(here, "src", "early.ts")], outfile: join(dist, "early.js") });
  await build({ ...LOADER_IIFE, logLevel: "info", outfile: join(dist, "loader.js") });
  await build({ ...LOADER_ESM, logLevel: "info", outfile: join(dist, "integrations", "loader.js") });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildAll();
}
