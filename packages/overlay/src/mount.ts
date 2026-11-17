/**
 * The overlay itself (PRD §5.1): the annotation store, the UI and the `window.__crt` test hooks,
 * mounted by an entry that has first put the hooks, the transport, the probe, the storage and the
 * rasteriser in place — index.ts on the three ways in that share the page's world, with every
 * seam at its default; extension/content.ts in the extension's isolated world (PRD-extension §5.2).
 */
import type { CaptureBundle } from "../../server/src/capture-schema.js";
import type { ProvidersPayload, SessionInfo } from "../../server/src/session-events.js";
import { type Annotation, AnnotationStore } from "./annotations.js";
import { listSessions, type SendResult } from "./api.js";
import { EMBEDDED_MODE } from "./base.js";
import { capture } from "./capture.js";
import type { ChatSnapshot } from "./chat.js";
import { describeElement } from "./element.js";
import { type Probe, probe } from "./probe.js";
import { selectorFor, xpathFor } from "./selector.js";
import { canQuickNote } from "./send-plan.js";
import type { HealthPayload, HealthState } from "./health.js";
import { transport } from "./transport.js";
import { OverlayUI, type SendOptions, type ThreadSummary, type Tool } from "./ui.js";


export interface CrtTestHooks {
  version: 1;
  toggle(force?: boolean): void;
  isOpen(): boolean;
  setTool(tool: Tool | null): void;
  currentTool(): Tool | null;
  hoverAt(x: number, y: number): Element | null;
  annotations(): Array<{ n: number; kind: string; note: string; label: string | null; detached: boolean; sessionId: string | null }>;
  addSelect(target: Element | string): number;
  addBox(rect: { x: number; y: number; width: number; height: number }): number;
  addPin(x: number, y: number): number;
  setNote(n: number, note: string): void;
  remove(n: number): void;
  clear(): void;
  capture(): Promise<{ bundle: CaptureBundle; imageNames: string[] }>;
  /**
   * F-13/F-65 Send annotation `n` (default: the most recent unsent one), the F-14 quick note with
   * `{ quick: true }`, the F-11 grouping with `{ include: true }`, or the F-68 page-level chat with
   * `{ message }`; runs on `providers.sendProvider()`.
   */
  send(opts?: SendOptions): Promise<SendResult>;
  canQuickNote(n?: number): boolean;
  /** F-66/F-67: every live thread with its annotations and state. */
  threads(): ThreadSummary[];
  /** F-65: open/close annotation `n`'s popover. */
  togglePop(n: number, force?: boolean): void;
  /** F-68: open/close the page-level compose box. */
  togglePageChat(force?: boolean): void;
  /** F-56: the provider menu (split Send button / toolbar Agent button). */
  providers: {
    toggle(force?: boolean): Promise<void>;
    load(refresh?: boolean): Promise<ProvidersPayload>;
    /** The id the next send will ask for (per-send pick, else the server's active provider). */
    sendProvider(): string | null;
    /** Pick a provider for the next send only (null clears the pick). */
    pick(id: string | null): void;
    /** Pick and persist via PUT /__crt/config, as the "Remember" checkbox does. */
    remember(id: string): Promise<void>;
  };
  selectorFor(target: Element | string): string;
  xpathFor(target: Element | string): string;
  describe(target: Element | string): ReturnType<typeof describeElement>;
  componentsFor(target: Element | string): ReturnType<Probe["components"]>;
  framework(): ReturnType<Probe["framework"]>;
  consoleEntries(): ReturnType<Probe["console"]>;
  clearConsole(): void;
  networkEntries(): ReturnType<Probe["network"]>;
  clearNetwork(): void;
  /** F-81: re-read health now (the dot follows) and the state it painted. */
  checkHealth(): Promise<HealthPayload | "failed">;
  healthState(): HealthState;
  /** F-82: open the welcome card on demand, whatever the suppression rules say. */
  welcome(): Promise<void>;
  /** F-6/F-95: "" behind the proxy, the CRT origin in embedded mode. */
  crtOrigin(): string;
  embeddedMode(): boolean;
  /** F-30: the session list in the toolbar. */
  sessions: {
    toggle(force?: boolean): Promise<void>;
    list(): Promise<SessionInfo[]>;
  };
  /**
   * Chat panel (M3): drive and observe the current thread — the one whose popover is open, else
   * the most recent (F-66). `open` targets any session id; the rest act on the current thread.
   */
  chat: {
    snapshot(): ChatSnapshot;
    isOpen(): boolean;
    open(sessionId: string): void;
    show(open: boolean): void;
    send(text: string): Promise<void>;
    respond(permissionId: string, behavior: "allow" | "deny"): Promise<void>;
    interrupt(): Promise<void>;
    discard(): Promise<void>;
  };
}

function resolve(target: Element | string): Element {
  if (typeof target !== "string") return target;
  const el = document.querySelector(target);
  if (!el) throw new Error(`__crt: no element matches ${target}`);
  return el;
}

export interface MountOptions {
  /**
   * PRD-extension F-156: a closed shadow root, for an overlay in a world the page cannot reach.
   * Open by default, as the e2e and a developer's DevTools expect on the other ways in.
   */
  closed?: boolean;
}

/**
 * Mount the overlay once per document: null when a CRT overlay is already there. The test hooks
 * go on this world's `window.__crt` — the page's own on every way in but the extension, where the
 * overlay's world is not the page's and the page sees none of it (F-156).
 */
export function mountOverlay(options: MountOptions = {}): HTMLElement | null {
  if (document.getElementById("crt-host")) return null;
  const store = new AnnotationStore();
  const ui = new OverlayUI(store, options);

  const summary = (a: Annotation) => ({
    n: a.n,
    kind: a.kind,
    note: a.note,
    label: a.elementInfo?.selector ?? null,
    detached: a.kind === "select" ? !a.element?.isConnected : false,
    sessionId: a.sessionId,
  });
  const empty: ChatSnapshot = { sessionId: null, state: null, taskId: null, provider: null, quiet: false, events: [] };
  const current = () => ui.currentThread()?.chat ?? null;

  const hooks: CrtTestHooks = {
    version: 1,
    toggle: (force) => ui.toggle(force),
    isOpen: () => ui.isOpen(),
    setTool: (tool) => ui.setTool(tool),
    currentTool: () => ui.tools.current(),
    hoverAt: (x, y) => ui.tools.hoverAt(x, y),
    annotations: () => store.all().map(summary),
    addSelect: (target) => store.addSelect(resolve(target)).n,
    addBox: (rect) => store.addBox(rect).n,
    addPin: (x, y) => store.addPin(x, y).n,
    setNote: (n, note) => store.setNote(n, note),
    remove: (n) => store.remove(n),
    clear: () => store.clear(),
    capture: async () => {
      const r = await capture(store);
      return { bundle: r.bundle, imageNames: Object.keys(r.images) };
    },
    send: (opts) => ui.sendToAgent(opts),
    canQuickNote: (n) => canQuickNote(store.all(), { n }),
    threads: () => ui.threads.summaries(),
    togglePop: (n, force) => ui.togglePop(n, force),
    togglePageChat: (force) => ui.togglePageChat(force),
    providers: {
      toggle: (force) => ui.providers.toggle(force),
      load: (refresh) => ui.providers.load(refresh === true),
      sendProvider: () => ui.providers.sendProvider(),
      pick: (id) => ui.providers.pick(id),
      remember: (id) => ui.providers.choose(id, true),
    },
    selectorFor: (t) => selectorFor(resolve(t)),
    xpathFor: (t) => xpathFor(resolve(t)),
    describe: (t) => describeElement(resolve(t)),
    componentsFor: (t) => probe().components(resolve(t)),
    framework: () => probe().framework(),
    consoleEntries: () => probe().console(),
    clearConsole: () => probe().clearConsole(),
    networkEntries: () => probe().network(),
    clearNetwork: () => probe().clearNetwork(),
    checkHealth: () => ui.launcher.checkHealth(),
    healthState: () => ui.launcher.healthState(),
    welcome: () => ui.welcome(),
    crtOrigin: () => transport().origin(),
    embeddedMode: () => EMBEDDED_MODE,
    sessions: {
      toggle: (force) => ui.sessions.toggle(force),
      list: () => listSessions(),
    },
    chat: {
      snapshot: () => current()?.snapshot() ?? empty,
      isOpen: () => current()?.isOpen() ?? false,
      open: (id) => ui.threads.open(id),
      show: (open) => current()?.show(open),
      send: (text) => current()?.send(text) ?? Promise.resolve(),
      respond: (id, behavior) => current()?.respond(id, behavior) ?? Promise.resolve(),
      interrupt: () => current()?.interrupt() ?? Promise.resolve(),
      discard: () => current()?.discard() ?? Promise.resolve(),
    },
  };
  // Merge onto the object early.js may already have created (it holds the console buffer).
  const w = window as unknown as { __crt?: object };
  Object.assign((w.__crt ??= {}), hooks);
  return ui.host;
}

