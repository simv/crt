/**
 * Where the console and network hooks keep their buffers. By default it is `window.__crt`, the
 * overlay's one global: the hooks are bundled into early.js, the loader and overlay.js, and the
 * later copy adopts the earlier copy's buffers by finding them there (F-20, F-21).
 *
 * The extension's probe runs in the page's own world and must leave no property on `window`
 * (PRD-extension F-156), so it calls `usePrivateBag()` first and the buffers stay inside its
 * bundle. loader.ts keeps its own accessor (N-20: self-contained).
 */
let own: Record<string, unknown> | null = null;

/** The object the hooks hang their state on. */
export function crtBag(): Record<string, unknown> {
  if (own) return own;
  const w = window as unknown as { __crt?: Record<string, unknown> };
  return (w.__crt ??= {});
}

/** PRD-extension F-156: keep the hooks' state out of `window` from here on. */
export function usePrivateBag(): void {
  own ??= {};
}
