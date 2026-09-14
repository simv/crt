/**
 * CRT overlay entry point. Injected by the CRT proxy as <script src="/__crt/overlay.js" defer>.
 * Everything renders inside a Shadow DOM host so host-page CSS cannot leak in or out (PRD §5.1).
 *
 * Boot order matters: console/error hooks first (F-20; normally already installed by early.js),
 * then the UI. `window.__crt` is the only global (CLAUDE.md): a debugging/test surface used by the
 * Playwright specs to drive the tools without a real pointer.
 */
import type { CaptureBundle } from "../../server/src/capture-schema.js";
import { type Annotation, AnnotationStore } from "./annotations.js";
import { capture, type SendResult } from "./capture.js";
import { detectComponents, detectFramework } from "./component.js";
import { clearConsoleEntries, consoleEntries, installConsoleHooks } from "./console-hook.js";
import { describeElement } from "./element.js";
import { selectorFor, xpathFor } from "./selector.js";
import { OverlayUI, type Tool } from "./ui.js";

installConsoleHooks();

export interface CrtTestHooks {
  version: 1;
  toggle(force?: boolean): void;
  isOpen(): boolean;
  setTool(tool: Tool | null): void;
  currentTool(): Tool | null;
  hoverAt(x: number, y: number): Element | null;
  annotations(): Array<{ n: number; kind: string; note: string; label: string | null; detached: boolean }>;
  addSelect(target: Element | string): number;
  addBox(rect: { x: number; y: number; width: number; height: number }): number;
  addPin(x: number, y: number): number;
  setNote(n: number, note: string): void;
  remove(n: number): void;
  clear(): void;
  capture(): Promise<{ bundle: CaptureBundle; imageNames: string[] }>;
  send(): Promise<SendResult>;
  selectorFor(target: Element | string): string;
  xpathFor(target: Element | string): string;
  describe(target: Element | string): ReturnType<typeof describeElement>;
  componentsFor(target: Element | string): ReturnType<typeof detectComponents>;
  framework(): ReturnType<typeof detectFramework>;
  consoleEntries(): ReturnType<typeof consoleEntries>;
  clearConsole(): void;
}

function resolve(target: Element | string): Element {
  if (typeof target !== "string") return target;
  const el = document.querySelector(target);
  if (!el) throw new Error(`__crt: no element matches ${target}`);
  return el;
}

function mount(): void {
  if (document.getElementById("crt-host")) return;
  const store = new AnnotationStore();
  const ui = new OverlayUI(store);

  const summary = (a: Annotation) => ({
    n: a.n,
    kind: a.kind,
    note: a.note,
    label: a.elementInfo?.selector ?? null,
    detached: a.kind === "select" ? !a.element?.isConnected : false,
  });

  const hooks: CrtTestHooks = {
    version: 1,
    toggle: (force) => ui.toggle(force),
    isOpen: () => ui.isOpen(),
    setTool: (tool) => ui.setTool(tool),
    currentTool: () => ui.currentTool(),
    hoverAt: (x, y) => ui.hoverAt(x, y),
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
    send: () => ui.sendToClaude(),
    selectorFor: (t) => selectorFor(resolve(t)),
    xpathFor: (t) => xpathFor(resolve(t)),
    describe: (t) => describeElement(resolve(t)),
    componentsFor: (t) => detectComponents(resolve(t)),
    framework: () => detectFramework(),
    consoleEntries: () => consoleEntries(),
    clearConsole: () => clearConsoleEntries(),
  };
  // Merge onto the object early.js may already have created (it holds the console buffer).
  Object.assign((window as unknown as { __crt: object }).__crt, hooks);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
