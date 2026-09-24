/** packages/server/dist: where `npm run build` writes the entries. */
export const DEFAULT_DIST: string;
/** `claude-review-tool/loader` under the `production` condition (F-98): the same name, nothing else. */
export const NOOP_LOADER: string;
/** `claude-review-tool/react` under the `production` condition (F-98): a client component that renders nothing. */
export const NOOP_REACT: string;
/** Every file `exports` can resolve to, relative to dist/ (F-97). */
export const ENTRY_FILES: string[];
/** Write the no-op modules and the generated files into `<dist>/integrations/`; returns the paths written. */
export function buildIntegrations(opts?: { dist?: string }): string[];
