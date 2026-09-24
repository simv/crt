/** The marketplace name `crt setup` installs from (§5.5). */
export const MARKETPLACE_NAME: string;

export interface PluginMarketplaceManifest {
  name: string;
  owner: unknown;
  metadata: { version: string; [key: string]: unknown };
  plugins: Array<{ name: string; source: string; version: string; [key: string]: unknown }>;
}

/** Lay the bundled marketplace out under `out` from the repo's `plugin/` and the server's package.json; returns the manifest written. */
export function buildPluginMarketplace(opts: { repo: string; pkg: string; out: string }): PluginMarketplaceManifest;
