// Overlay build (PRD §5.1; PRD-embedded F-96, F-97, F-98; PRD-zero F-127): six bundles and the extension into packages/server/dist/, all
// from the esbuild API so the defines need no shell quoting (Windows is the primary dev platform).
//   overlay.js               the overlay (IIFE), served at /__crt/overlay.js in both modes
//   early.js                 the console/network hooks (IIFE), injected by proxy mode only (F-20)
//   loader.js                the loader (IIFE, auto-mounts), served at /__crt/loader.js (F-94, F-96);
//                            process.env.NODE_ENV is defined as "development" so the F-98 guard
//                            folds away and no `process` reference reaches a browser
//   loader-inject.js         the loader (IIFE) for the CRT browser to inject: its origin is a
//                            placeholder the injector replaces (PRD-zero F-126, F-127)
//   integrations/loader.js   the same source as an ES module with no side effect on import
//                            (`claude-review-tool/loader`); process.env.NODE_ENV is left for the
//                            app's bundler
//   integrations/react.js    the React entry (`claude-review-tool/react`, F-97): an ES module with
//                            `react` external and "use client" kept as its first statement
//   extension/               the browser extension (PRD-extension F-154), ready to load unpacked:
//                            probe.js (the page's world), content.js (the overlay in an isolated
//                            world), worker.js (the service worker), options.js + options.html, review.js + review.html,
//                            manifest.json with the server package's version, and the icons
// The no-op modules and the .d.ts files next to them come from packages/server/scripts/integrations.mjs.
// tsconfig.json sets useDefineForClassFields to false: the overlay's classes extend nothing, so
// [[Set]] fields behave the same, and es2020 output assigns them instead of calling a defineProperty
// helper once per field (CRT-0043 kept overlay.js from growing when ui.ts became several classes).
import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
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
/** PRD-zero F-127: the same loader with the injector's origin in place of a script tag (browser.ts). */
export const LOADER_INJECT = { ...LOADER_IIFE, entryPoints: [join(here, "src", "loader-inject.ts")] };
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

/**
 * PRD-extension F-154: the extension's four scripts. Classic scripts (IIFE), as a content script
 * and this service worker are loaded; NODE_ENV is defined so the loader's F-98 guard, which the
 * pill comes with, folds away and no `process` reference reaches a browser.
 */
export const EXTENSION_SCRIPTS = ["probe", "content", "worker", "options", "review"];
/** The extension's own pages: Options, and the review kept in the browser (PRD-connect F-167). */
export const EXTENSION_PAGES = ["options.html", "review.html"];
export const EXTENSION_BUILD = { bundle: true, format: "iife", target: "es2022", minify: true, define: { "process.env.NODE_ENV": '"development"' } };
/** The icons: the favicon PNGs and the two larger renders of the mark (docs/brand, PRD-polish F-112). */
export const EXTENSION_ICONS = { "icon-16.png": "favicon-16.png", "icon-32.png": "favicon-32.png", "icon-48.png": "icon-48.png", "icon-128.png": "icon-128.png" };

/** F-154: `dist/extension/` — the scripts, the options page, the icons and the manifest at the server package's version. */
export async function buildExtension(dist = DEFAULT_DIST, logLevel = "info") {
  const out = join(dist, "extension");
  const src = join(here, "src", "extension");
  await mkdir(out, { recursive: true });
  for (const name of EXTENSION_SCRIPTS) {
    await build({ ...EXTENSION_BUILD, logLevel, entryPoints: [join(src, `${name}.ts`)], outfile: join(out, `${name}.js`) });
  }
  const { version } = JSON.parse(await readFile(join(here, "..", "server", "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(src, "manifest.json"), "utf8"));
  await writeFile(join(out, "manifest.json"), JSON.stringify({ ...manifest, version }, null, 2) + "\n");
  for (const page of EXTENSION_PAGES) await copyFile(join(src, page), join(out, page));
  const brand = join(here, "..", "..", "docs", "brand");
  for (const [to, from] of Object.entries(EXTENSION_ICONS)) await copyFile(join(brand, from), join(out, to));
}

/** Build every bundle into `dist` (packages/server/dist by default; tests pass a temp dir). */
export async function buildAll(dist = DEFAULT_DIST, logLevel = "info") {
  await build({ ...common, logLevel, entryPoints: [join(here, "src", "index.ts")], outfile: join(dist, "overlay.js") });
  await build({ ...common, logLevel, entryPoints: [join(here, "src", "early.ts")], outfile: join(dist, "early.js") });
  await build({ ...LOADER_IIFE, logLevel, outfile: join(dist, "loader.js") });
  await build({ ...LOADER_INJECT, logLevel, outfile: join(dist, "loader-inject.js") });
  await buildEntries(dist, logLevel);
  await buildExtension(dist, logLevel);
}

/** The ES-module entries only (F-97): `integrations/loader.js` and `integrations/react.js`. */
export async function buildEntries(dist = DEFAULT_DIST, logLevel = "info") {
  await build({ ...LOADER_ESM, logLevel, outfile: join(dist, "integrations", "loader.js") });
  await build({ ...REACT_ESM, logLevel, outfile: join(dist, "integrations", "react.js") });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildAll();
}
