/**
 * The CRT loader (PRD-embedded F-96, N-20): the one small script an app includes in development
 * so the overlay appears on the app's own URL. It (1) does nothing off a loopback hostname or
 * inside a frame, (2) is idempotent, (3) installs the F-20/F-21 console and network hooks at
 * once — the reason early.js existed in proxy mode — (4) resolves the CRT origin, (5) appends
 * the deferred overlay tag so the overlay always comes from the running server, (6) shows a pill
 * when that script fails to load, retried on click, on the tab becoming visible and on window
 * focus (never on a timer), dismissable per tab, and (7) exposes `window.__crt.loader` and no
 * other global.
 *
 * One source, two builds (packages/overlay/build.mjs): `dist/loader.js`, an IIFE served by CRT
 * at /__crt/loader.js that auto-mounts (loader-auto.ts, which reads `data-crt-port` off its own
 * tag), and `dist/integrations/loader.js`, an ES module with no side effect on import that
 * bundlers ship with the app (`claude-review-tool/loader`). The body sits behind
 * `process.env.NODE_ENV !== "production"` (F-98): the app's bundler defines it, the IIFE build
 * defines it as "development" so the guard folds away. Framework-free, no dependencies, ≤ 5 KB
 * gzipped; the pure parts are unit-tested from packages/server/test.
 */
import { installConsoleHooks } from "./console-hook.js";
import { installNetworkHooks } from "./network-hook.js";

declare const process: { env: Record<string, string | undefined> };

export interface MountOptions {
  /** The CRT origin, e.g. `http://localhost:4400`; wins over `port`. */
  origin?: string;
  /** The CRT port on localhost (`port` in .crt/config.json when it is not 4400). */
  port?: number;
}

export interface CrtLoader {
  /** The CRT origin the overlay is loaded from. */
  origin: string;
  /** Re-append the overlay script (what the pill's click and the focus/visibility events do). */
  retry(): void;
}

export const DEFAULT_ORIGIN = "http://localhost:4400";
export const OVERLAY_PATH = "/__crt/overlay.js";
/** sessionStorage key: the pill was closed in this tab. */
export const PILL_DISMISSED_KEY = "crt.loader.dismissed.v1";
export const PILL_HOST_ID = "crt-loader-pill";
export const pillText = (origin: string) => `CRT server not running on :${portOf(origin)} — run \`crt\` in the project, then click here`;

/** F-96 step 1 / F-6: `localhost`, `*.localhost`, `127.0.0.1` and `[::1]` (as `location.hostname` spells it). */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

/**
 * F-96 step 4: `options.origin`, else `http://localhost:<options.port>`, else the loader script's
 * own origin, else 4400. N-20 / PRD-embedded Goal 6: every candidate must be a loopback origin
 * (http or https on the F-6 hosts) — anything else is skipped, so the loader can never be pointed
 * at a machine other than this one, whatever an app passes.
 */
export function resolveOrigin(options: MountOptions | undefined, scriptSrc: string | null, pageHref: string): string {
  const fromOption = loopbackOrigin(options?.origin, undefined); // absolute only: "nonsense" must not resolve against the page
  if (fromOption) return fromOption;
  if (options?.port && Number.isInteger(options.port) && options.port > 0 && options.port <= 65535) return `http://localhost:${options.port}`;
  const fromScript = loopbackOrigin(scriptSrc, pageHref);
  if (fromScript && fromScript !== loopbackOrigin(pageHref, pageHref)) return fromScript; // the app's own bundle says nothing about where CRT is
  return DEFAULT_ORIGIN;
}

/** The origin of `value` (resolved against `base`) when it is http(s) on a loopback host; null otherwise. */
function loopbackOrigin(value: string | null | undefined, base: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    if ((url.protocol === "http:" || url.protocol === "https:") && isLoopbackHost(url.hostname)) return url.origin;
  } catch {
    // not a URL
  }
  return null;
}

function portOf(origin: string): string {
  try {
    const u = new URL(origin);
    return u.port || (u.protocol === "https:" ? "443" : "80");
  } catch {
    return "4400";
  }
}

/** The `window.__crt` bag the hooks and the overlay share; created here when the loader is first. */
function crtGlobal(): { loader?: CrtLoader } {
  const w = window as unknown as { __crt?: { loader?: CrtLoader } };
  return (w.__crt ??= {});
}

/**
 * F-96: mount CRT on this page. Returns the loader (the same object on every call), or null when
 * this page gets nothing: a non-loopback host, a frame, no DOM, or a production build.
 */
export function mountCrt(options?: MountOptions): CrtLoader | null {
  if (process.env.NODE_ENV === "production") return null; // F-98: the bundler folds this away
  if (typeof window === "undefined" || typeof document === "undefined" || typeof location === "undefined") return null;
  if (!isLoopbackHost(location.hostname) || window.top !== window) return null; // step 1
  const crt = crtGlobal();
  if (crt.loader) return crt.loader; // step 2

  installConsoleHooks(); // step 3
  installNetworkHooks();

  const own = document.currentScript;
  const origin = resolveOrigin(options, own instanceof HTMLScriptElement && own.src ? own.src : null, location.href); // step 4
  const src = new URL(OVERLAY_PATH, origin).href; // a loopback origin by construction (resolveOrigin), never a bare string

  let script: HTMLScriptElement | null = null;
  let pill: PillHandle | null = null;
  let loaded = false;

  const append = () => {
    // step 5: the overlay always comes from the running server, so its version equals the server's.
    if (script) script.remove();
    script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.addEventListener("load", () => {
      loaded = true;
      pill?.remove(); // step 6: a successful load removes it
      pill = null;
    });
    script.addEventListener("error", () => {
      script?.remove();
      script = null;
      if (loaded || dismissed()) return;
      pill ??= mountPill(origin, retry);
      pill.show();
    });
    (document.head ?? document.documentElement).appendChild(script);
  };
  const retry = () => {
    if (loaded || script) return; // one request at a time (N-20)
    append();
  };
  // step 6: retry once per user action — the tab coming back, the window regaining focus — never on a timer.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") retry();
  });
  window.addEventListener("focus", retry);

  const loader: CrtLoader = { origin, retry };
  crt.loader = loader; // step 7
  append();
  return loader;
}

function dismissed(): boolean {
  try {
    return sessionStorage.getItem(PILL_DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

interface PillHandle {
  show(): void;
  remove(): void;
}

const PILL_CSS = `
  :host { all: initial; }
  .pill { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; display: flex; align-items: center; gap: 8px;
          max-width: calc(100vw - 32px); padding: 8px 10px 8px 12px; border-radius: 999px; background: #222; color: #fff;
          font: 13px/1.3 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.25); cursor: pointer; }
  .pill code { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .pill button { all: unset; cursor: pointer; padding: 0 4px; font-size: 15px; line-height: 1; opacity: .7; }
  .pill button:hover { opacity: 1; }
`;

/** F-96 step 6: the pill in its own shadow root, bottom-right; a click retries, × hides it for the tab. */
function mountPill(origin: string, retry: () => void): PillHandle {
  const host = document.createElement("div");
  host.id = PILL_HOST_ID;
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = PILL_CSS;
  const pill = document.createElement("div");
  pill.className = "pill";
  pill.setAttribute("role", "status");
  const text = document.createElement("span");
  text.className = "text";
  text.textContent = pillText(origin);
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    try {
      sessionStorage.setItem(PILL_DISMISSED_KEY, "1");
    } catch {
      // no sessionStorage: hides until the next error
    }
    host.remove();
  });
  pill.addEventListener("click", retry);
  pill.append(text, close);
  root.append(style, pill);
  return {
    show: () => {
      if (!host.isConnected) (document.body ?? document.documentElement).appendChild(host);
    },
    remove: () => host.remove(),
  };
}
