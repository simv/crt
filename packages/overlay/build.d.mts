import type { BuildOptions } from "esbuild";

/** packages/server/dist: where `npm run build` writes the bundles. */
export const DEFAULT_DIST: string;
/** The IIFE loader build (`dist/loader.js`): auto-mounts, NODE_ENV defined as "development" (PRD-embedded F-96, F-98). */
export const LOADER_IIFE: BuildOptions;
/** The injectable loader build (`dist/loader-inject.js`): the IIFE with the injector's origin as a placeholder (PRD-zero F-127). */
export const LOADER_INJECT: BuildOptions;
/** The ES module loader build (`dist/integrations/loader.js`): no side effect on import, NODE_ENV left for the app's bundler. */
export const LOADER_ESM: BuildOptions;
/** The React entry build (`dist/integrations/react.js`, F-97): ES module, `react` external, "use client" first. */
export const REACT_ESM: BuildOptions;
/** Build every bundle into `dist` (packages/server/dist by default; tests pass a temp dir). */
export function buildAll(dist?: string, logLevel?: BuildOptions["logLevel"]): Promise<void>;
/** The ES-module entries only (F-97): `integrations/loader.js` and `integrations/react.js`. */
export function buildEntries(dist?: string, logLevel?: BuildOptions["logLevel"]): Promise<void>;
/** The extension's script names, built to `dist/extension/<name>.js` (PRD-extension F-154). */
export const EXTENSION_SCRIPTS: string[];
export const EXTENSION_BUILD: BuildOptions;
/** Extension icon file → its source under docs/brand. */
export const EXTENSION_ICONS: Record<string, string>;
/** `dist/extension/`: the scripts, the options page, the icons and the manifest at the server package's version (PRD-extension F-154). */
export function buildExtension(dist?: string, logLevel?: BuildOptions["logLevel"]): Promise<void>;
