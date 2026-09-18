/**
 * `claude-review-tool/vite` (PRD-embedded F-97, §5.3): `crt()`, a dev-only Vite plugin. In `vite`
 * (serve) it prepends one inline module to `<head>` of every `index.html`,
 * `import { mountCrt } from "claude-review-tool/loader"; mountCrt({ port: <n> })`, so the F-20/F-21
 * hooks install before the app's own module runs. `<n>` is `options.port`, else `port` from
 * `.crt/config.local.json` / `.crt/config.json` of the nearest project root above `options.root`
 * (else Vite's resolved root), else 4400 — read per request, so a config edit needs no restart.
 *
 * Production guarantee (F-98, N-18): `apply: "serve"` keeps the plugin out of `vite build`
 * entirely, and the handler is behind `process.env.NODE_ENV !== "production"` too. This module
 * imports `init.ts` and `project.ts` only (pure `node:fs`) — never the server, providers or SDK.
 * Written against Vite 8.3 (`transformIndexHtml` `{ order: "pre", handler }`, `injectTo:
 * "head-prepend"`), the same hook shape since Vite 3.
 */
import type { Plugin } from "vite";
import { readConfig } from "../init.js";
import { findProjectRoot } from "../project.js";

export interface CrtVitePluginOptions {
  /** The CRT port; wins over the config files. */
  port?: number;
  /** Where to look for the project's `.crt/`; default Vite's `root`. */
  root?: string;
}

export const PLUGIN_NAME = "claude-review-tool";

/** The inline module the plugin prepends to `<head>` (F-97). */
export function loaderModule(port: number): string {
  return `import { mountCrt } from "claude-review-tool/loader"; mountCrt({ port: ${port} })`;
}

/** F-97: `options.port`, else `readConfig(findProjectRoot(root)).port` (local file over project file), else 4400. */
export function resolvePort(options: CrtVitePluginOptions | undefined, viteRoot: string | undefined): number {
  if (options?.port !== undefined && Number.isInteger(options.port) && options.port > 0 && options.port <= 65535) return options.port;
  return readConfig(findProjectRoot(options?.root ?? viteRoot ?? process.cwd())).port;
}

export function crt(options?: CrtVitePluginOptions): Plugin {
  let viteRoot: string | undefined;
  return {
    name: PLUGIN_NAME,
    apply: "serve",
    configResolved(config) {
      viteRoot = config.root;
    },
    transformIndexHtml: {
      order: "pre",
      handler() {
        if (process.env.NODE_ENV === "production") return; // F-98, on top of apply: "serve"
        return [{ tag: "script", attrs: { type: "module" }, children: loaderModule(resolvePort(options, viteRoot)), injectTo: "head-prepend" }];
      },
    },
  };
}
