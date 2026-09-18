import { vi } from "vitest";

/**
 * A DOM small enough for the loader's `mountCrt` (PRD-embedded F-96): the loopback guard, the
 * `window.__crt` global, the hooks and the appended overlay tag. Shared by loader.test.ts and
 * react-entry.test.ts; `vi.unstubAllGlobals()` in an afterEach undoes it.
 */
export class FakeScript {
  src = "";
  defer = false;
  dataset: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  addEventListener(name: string, fn: () => void) {
    this.listeners[name] = fn;
  }
  remove() {}
}

export function fakeDom(o: { hostname: string; top?: "self" | "other"; scriptSrc?: string | null; port?: string }) {
  const appended: FakeScript[] = [];
  const current = o.scriptSrc === undefined ? null : new FakeScript();
  if (current) {
    current.src = o.scriptSrc ?? "";
    if (o.port) current.dataset.crtPort = o.port;
  }
  const document = {
    currentScript: current,
    createElement: () => new FakeScript(),
    head: { appendChild: (s: FakeScript) => appended.push(s) },
    documentElement: { appendChild: (s: FakeScript) => appended.push(s) },
    addEventListener: () => undefined,
    visibilityState: "visible",
  };
  const window: Record<string, unknown> = { addEventListener: () => undefined };
  window.top = o.top === "other" ? {} : window;
  vi.stubGlobal("HTMLScriptElement", FakeScript);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("location", { hostname: o.hostname, href: `http://${o.hostname}:3000/page` });
  return { window, appended };
}
