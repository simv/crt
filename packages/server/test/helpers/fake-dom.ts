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

export function fakeDom(o: { hostname: string; top?: "self" | "other"; scriptSrc?: string | null; port?: string; rootless?: boolean }) {
  const appended: FakeScript[] = [];
  const current = o.scriptSrc === undefined ? null : new FakeScript();
  if (current) {
    current.src = o.scriptSrc ?? "";
    if (o.port) current.dataset.crtPort = o.port;
  }
  const root = { appendChild: (s: FakeScript) => appended.push(s) };
  // `rootless` (PRD-zero F-127): the document as an injected script finds it — no <html> yet; `addRoot()` parses one in.
  const document: Record<string, unknown> = {
    currentScript: current,
    createElement: () => new FakeScript(),
    head: o.rootless ? null : root,
    documentElement: o.rootless ? null : root,
    addEventListener: () => undefined,
    visibilityState: "visible",
  };
  /** Every MutationObserver the loader made: what it watches, and whether it is still connected. */
  const observers: Array<{ fire(): void; target: unknown; connected: boolean }> = [];
  class FakeObserver {
    private readonly entry = { fire: () => this.cb(), target: null as unknown, connected: false };
    constructor(private readonly cb: () => void) {
      observers.push(this.entry);
    }
    observe(target: unknown) {
      this.entry.target = target;
      this.entry.connected = true;
    }
    disconnect() {
      this.entry.connected = false;
    }
  }
  const mutate = () => {
    for (const ob of observers) if (ob.connected) ob.fire();
  };
  /** A node that is not the root arrives (a doctype): observers fire, the root is still missing. */
  const addOther = () => mutate();
  const addRoot = () => {
    document.documentElement = root;
    mutate();
  };
  const window: Record<string, unknown> = { addEventListener: () => undefined };
  window.top = o.top === "other" ? {} : window;
  vi.stubGlobal("HTMLScriptElement", FakeScript);
  vi.stubGlobal("MutationObserver", FakeObserver);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("location", { hostname: o.hostname, href: `http://${o.hostname}:3000/page` });
  return { window, appended, document, observers, addOther, addRoot };
}
