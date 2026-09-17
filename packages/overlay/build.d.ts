import type { BuildOptions } from "esbuild";

/** The IIFE loader build (`dist/loader.js`): auto-mounts, NODE_ENV defined as "development" (PRD-embedded F-96, F-98). */
export const LOADER_IIFE: BuildOptions;
/** The ES module loader build (`dist/integrations/loader.js`): no side effect on import, NODE_ENV left for the app's bundler. */
export const LOADER_ESM: BuildOptions;
export function buildAll(): Promise<void>;
