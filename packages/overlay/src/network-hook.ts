/**
 * Failed-request hooks (PRD F-21): every `fetch` or XMLHttpRequest that ends with a status ≥ 400
 * or throws, plus any other resource (img, script, stylesheet, …) whose PerformanceObserver entry
 * carries a `responseStatus` ≥ 400, goes into a ring buffer of MAX_ENTRIES. The originals still run
 * and their results are untouched.
 *
 * Bundled into both `early.js` and `overlay.js` exactly like console-hook.ts: the buffer lives on
 * `window.__crt.__network`, so the second copy adopts the first copy's hooks. Requests to CRT's own
 * `/__crt/` routes are never recorded.
 */
import type { NetworkEntry } from "../../server/src/capture-schema.js";

const MAX_ENTRIES = 50; // F-21
const MAX_URL = 2000;
const MAX_ERROR = 500;

interface NetworkState {
  entries: NetworkEntry[];
  installed: boolean;
}

interface XhrMeta {
  method: string;
  url: string;
  started: number;
}

function state(): NetworkState {
  const w = window as unknown as { __crt?: { __network?: NetworkState } };
  const crt = (w.__crt ??= {});
  return (crt.__network ??= { entries: [], installed: false });
}

function push(entry: NetworkEntry): void {
  if (/\/__crt\//.test(entry.url) || /^(data|blob):/i.test(entry.url)) return;
  const { entries } = state();
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

function record(via: NetworkEntry["via"], method: string, url: string, status: number | null, error: unknown, started: number | null): void {
  push({
    method: method.toUpperCase(),
    url: String(url).slice(0, MAX_URL),
    status,
    error: error === null || error === undefined ? null : describeError(error),
    via,
    durationMs: started === null ? null : Math.round(performance.now() - started),
    timestamp: new Date().toISOString(),
  });
}

function describeError(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.slice(0, MAX_ERROR);
}

function requestParts(input: RequestInfo | URL, init?: RequestInit): { method: string; url: string } {
  if (typeof input === "string") return { method: init?.method ?? "GET", url: input };
  if (input instanceof URL) return { method: init?.method ?? "GET", url: input.href };
  return { method: init?.method ?? input.method ?? "GET", url: input.url };
}

export function installNetworkHooks(): void {
  const st = state();
  if (st.installed) return;
  st.installed = true;

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const started = performance.now();
      let parts = { method: "GET", url: "" };
      try {
        parts = requestParts(input, init);
      } catch {
        // an exotic input: still let the request through
      }
      const result = originalFetch.call(this === undefined ? window : this, input, init);
      // Observe on a branch so the caller's own chain (and its rejection handling) is unchanged.
      result.then(
        (res) => {
          if (res.status >= 400) record("fetch", parts.method, parts.url, res.status, null, started);
        },
        (err: unknown) => record("fetch", parts.method, parts.url, null, err, started),
      );
      return result;
    };
  }

  if (typeof XMLHttpRequest === "function") {
    const proto = XMLHttpRequest.prototype;
    const originalOpen = proto.open;
    const originalSend = proto.send;
    const meta = new WeakMap<XMLHttpRequest, XhrMeta>();
    proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      meta.set(this, { method: String(method), url: String(url), started: 0 });
      return (originalOpen as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
    } as typeof proto.open;
    proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const m = meta.get(this);
      if (m) {
        m.started = performance.now();
        this.addEventListener(
          "loadend",
          () => {
            try {
              if (this.status >= 400) record("xhr", m.method, m.url, this.status, null, m.started);
              else if (this.status === 0) record("xhr", m.method, m.url, null, "request failed (no response: network error, CORS or abort)", m.started);
            } catch {
              // never let the hook break the page
            }
          },
          { once: true },
        );
      }
      return originalSend.call(this, body);
    };
  }

  // Sub-resources (img, script, link, css, …): Chromium ≥ 109 exposes the status on the timing
  // entry. fetch/XHR entries are skipped here because the hooks above already saw them.
  if (typeof PerformanceObserver === "function") {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          const status = (entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus;
          if (typeof status !== "number" || status < 400) continue;
          if (entry.initiatorType === "fetch" || entry.initiatorType === "xmlhttprequest") continue;
          push({
            method: "GET",
            url: entry.name.slice(0, MAX_URL),
            status,
            error: null,
            via: "resource",
            durationMs: Math.round(entry.duration),
            timestamp: new Date().toISOString(),
          });
        }
      });
      observer.observe({ type: "resource", buffered: true });
    } catch {
      // older engines without `type`/`buffered`: fetch/XHR coverage still applies
    }
  }
}

/** Snapshot of the buffer, oldest first. */
export function networkEntries(): NetworkEntry[] {
  return state().entries.slice();
}

export function clearNetworkEntries(): void {
  state().entries.length = 0;
}
