/**
 * Where the CRT server is (PRD F-6; PRD-embedded F-95). Behind the proxy the overlay is
 * same-origin and every API path is relative. In embedded mode the page loads
 * `http://localhost:4400/__crt/overlay.js` from its own origin (the loader appends the tag,
 * F-96, or a script tag does), so the CRT origin is taken from the script's `src` (available as
 * `document.currentScript` while the bundle evaluates) and prefixed onto every request; the
 * server allows those cross-origin calls for loopback origins only.
 */

function detectOrigin(): string {
  try {
    const script = document.currentScript;
    if (!(script instanceof HTMLScriptElement) || !script.src) return "";
    const origin = new URL(script.src, location.href).origin;
    return origin === location.origin ? "" : origin;
  } catch {
    return "";
  }
}

/** Empty behind the proxy; `http://localhost:<port>` in embedded mode. */
export const CRT_ORIGIN = detectOrigin();
/** The overlay came from another origin than the page: embedded mode (or a hand-written script tag). */
export const EMBEDDED_MODE = CRT_ORIGIN !== "";

/** Absolute or relative URL for a `/__crt/…` path, whichever this page needs. */
export function crtUrl(path: string): string {
  return CRT_ORIGIN + path;
}
