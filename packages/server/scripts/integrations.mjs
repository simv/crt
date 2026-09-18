// Build step for the package entries (PRD-embedded F-97, F-98): what `exports` in package.json
// points at under dist/integrations/ besides the two ES modules esbuild makes (packages/overlay/build.mjs):
//   noop-loader.js, noop-react.js   the `production` condition targets — same export names, empty
//                                   bodies, none of the F-98 strings
//   loader.d.ts, react.d.ts         generated from packages/overlay/src with the overlay tsconfig
//   vite.js, vite.d.ts              generated from src/integrations/vite.ts with the server tsconfig
//                                   (tsc -p emits vite.js too; this emit is byte-identical, and it
//                                   lets a test build the whole set into a temp dir without tsc -p)
// Declarations come from the TypeScript API rather than hand-written files so they cannot drift
// from the sources. Called by copy-intake.mjs; `buildIntegrations({ dist })` is what the unit
// tests call (test/integrations-build.test.ts, test/production-guard.test.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..");
const overlay = join(server, "..", "overlay");
export const DEFAULT_DIST = join(server, "dist");

/** `claude-review-tool/loader` under the `production` condition (F-98): the same name, nothing else. */
export const NOOP_LOADER = "export function mountCrt() { return null; }\n";
/** `claude-review-tool/react` under the `production` condition (F-98): a client component that renders nothing. */
export const NOOP_REACT = '"use client";\nexport function CrtDevTools() { return null; }\n';

/** Every file `exports` can resolve to, relative to dist/ (asserted to exist after a build, F-97). */
export const ENTRY_FILES = [
  "integrations/loader.js",
  "integrations/loader.d.ts",
  "integrations/noop-loader.js",
  "integrations/react.js",
  "integrations/react.d.ts",
  "integrations/noop-react.js",
  "integrations/vite.js",
  "integrations/vite.d.ts",
];

/**
 * Write the no-op modules and the generated files into `<dist>/integrations/`. Returns the paths
 * written. Throws on a TypeScript error, so a broken entry fails the build rather than shipping
 * without types.
 */
export function buildIntegrations({ dist = DEFAULT_DIST } = {}) {
  const out = join(dist, "integrations");
  mkdirSync(out, { recursive: true });
  const written = [];
  for (const [name, text] of [
    ["noop-loader.js", NOOP_LOADER],
    ["noop-react.js", NOOP_REACT],
  ]) {
    writeFileSync(join(out, name), text, "utf8");
    written.push(join(out, name));
  }
  written.push(
    // The overlay hooks import capture-schema.ts from the server package, so the program's root is
    // packages/ (computed) and the two declarations are picked out of the emit by their suffix.
    ...emit({
      tsconfig: join(overlay, "tsconfig.json"),
      rootNames: [join(overlay, "src", "loader.ts"), join(overlay, "src", "react.ts")],
      outDir: out,
      keep: [
        ["overlay/src/loader.d.ts", join(out, "loader.d.ts")],
        ["overlay/src/react.d.ts", join(out, "react.d.ts")],
      ],
      emitDeclarationOnly: true,
    }),
    ...emit({
      tsconfig: join(server, "tsconfig.json"),
      rootNames: [join(server, "src", "integrations", "vite.ts")],
      outDir: dist, // tsc -p's outDir, so vite.js.map's `sources` is the same relative path
      keep: [
        ["integrations/vite.js", join(out, "vite.js")],
        ["integrations/vite.js.map", join(out, "vite.js.map")],
        ["integrations/vite.d.ts", join(out, "vite.d.ts")],
      ],
      emitDeclarationOnly: false,
    }),
  );
  return written;
}

/**
 * One TypeScript program from `tsconfig`'s options (rootDir computed by tsc), writing only the
 * outputs whose emitted path ends in a `keep` suffix (`/`-separated), each to its own destination.
 */
function emit({ tsconfig, rootNames, outDir, keep, emitDeclarationOnly }) {
  const read = ts.readConfigFile(tsconfig, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(tsconfig));
  const options = {
    ...parsed.options,
    noEmit: false,
    declaration: true,
    declarationMap: false,
    emitDeclarationOnly,
    rootDir: undefined,
    outDir, // every write is redirected below; only the source-map paths depend on it
  };
  const program = ts.createProgram({ rootNames, options });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    const host = { getCanonicalFileName: (f) => f, getCurrentDirectory: () => server, getNewLine: () => "\n" };
    throw new Error(`integrations: ${ts.formatDiagnostics(diagnostics, host)}`);
  }
  const pending = new Map(keep);
  const written = [];
  program.emit(undefined, (fileName, text) => {
    const emitted = resolve(fileName).split(sep).join("/");
    for (const [suffix, dest] of pending) {
      if (!emitted.endsWith("/" + suffix)) continue;
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, text.replace(/\r\n/g, "\n"), "utf8");
      written.push(dest);
      pending.delete(suffix);
    }
  });
  if (pending.size) throw new Error(`integrations: not emitted: ${[...pending.keys()].join(", ")}`);
  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const p of buildIntegrations()) console.log(`wrote ${p}`);
}
