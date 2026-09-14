/**
 * Component and framework detection (PRD F-18, F-22).
 *
 * React (dev builds): DOM nodes carry a `__reactFiber$<hash>` property pointing at their host
 * fiber. The chain is the *owner* chain (`_debugOwner`: the components whose JSX rendered this
 * element), which under Next.js app router also names server components (React ≥ 19 keeps them as
 * component-info records with `name` and `env: "Server"`) and skips framework wrappers such as
 * `InnerLayoutRouter`. Without owner info (production builds) it falls back to walking `.return`,
 * the parent tree. Named function/class components (plus the inner name of forwardRef/memo
 * wrappers) form the chain; `_debugSource` (React ≤ 18, set by the
 * JSX dev transform) gives file/line. React 19 removed `_debugSource` but keeps `_debugStack`, an
 * Error captured where the JSX was created, whose first non-React frame names the module that
 * rendered the element (e.g. `webpack-internal:///(app-pages-browser)/./components/Cart.tsx:88:12`
 * under Next.js); the file is exact, the line is the dev bundle's, so it is marked `owner_stack`.
 * Vue 3 exposes `__vueParentComponent` (with `type.name`/`type.__file`); Vue 2 exposes `__vue__`.
 * Everything else reports "unknown" (PRD §12 risk table: always keep selector + text as fallback).
 */
import type { ComponentInfo, FrameworkInfo, SourceInfo } from "../../server/src/capture-schema.js";

const MAX_COMPONENTS = 5; // F-18

export interface ComponentDetection {
  framework: "react" | "vue" | "unknown";
  components: ComponentInfo[];
  source: SourceInfo | null;
}

type AnyRecord = Record<string, unknown>;

interface Fiber {
  tag?: number;
  type: unknown;
  /** The element's original type; differs from `type` for SimpleMemoComponent (memo of a plain function). */
  elementType?: unknown;
  return: Fiber | null;
  _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number } | null;
  _debugStack?: { stack?: string } | string | null;
  _debugOwner?: Fiber | ServerComponentInfo | null;
}

/** React ≥ 19 record for a server component that owned an element (no fiber exists on the client). */
interface ServerComponentInfo {
  name?: string;
  env?: string;
  owner?: Fiber | ServerComponentInfo | null;
  debugStack?: { stack?: string } | null;
  stack?: unknown;
}

function isServerInfo(o: Fiber | ServerComponentInfo): o is ServerComponentInfo {
  return !("tag" in o) && !("return" in o) && typeof (o as ServerComponentInfo).name === "string";
}

const REACT_FORWARD_REF = Symbol.for("react.forward_ref");
const REACT_MEMO = Symbol.for("react.memo");

function fiberOf(el: Element): Fiber | null {
  for (const key of Object.keys(el)) {
    if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
      return (el as unknown as AnyRecord)[key] as Fiber;
    }
  }
  return null;
}

function nameOfType(type: unknown): { name: string; kind: ComponentInfo["kind"] } | null {
  if (typeof type === "function") {
    const fn = type as { displayName?: string; name?: string; prototype?: { isReactComponent?: unknown } };
    const name = fn.displayName || fn.name;
    if (!name) return null;
    return { name, kind: fn.prototype && fn.prototype.isReactComponent ? "class" : "function" };
  }
  if (typeof type === "object" && type !== null) {
    const t = type as { $$typeof?: symbol; render?: unknown; type?: unknown; displayName?: string };
    if (t.$$typeof === REACT_FORWARD_REF) {
      const inner = nameOfType(t.render);
      const name = t.displayName || inner?.name;
      return name ? { name, kind: "forward_ref" } : null;
    }
    if (t.$$typeof === REACT_MEMO) {
      const inner = nameOfType(t.type);
      const name = t.displayName || inner?.name;
      return name ? { name, kind: "memo" } : null;
    }
  }
  return null;
}

function sourceOf(fiber: Fiber): SourceInfo | null {
  const s = fiber._debugSource;
  if (s && typeof s.fileName === "string") {
    return {
      file: s.fileName,
      line: typeof s.lineNumber === "number" ? s.lineNumber : null,
      column: typeof s.columnNumber === "number" ? s.columnNumber : null,
      via: "debug_source",
    };
  }
  const st = fiber._debugStack;
  const stack = typeof st === "string" ? st : st && typeof st.stack === "string" ? st.stack : null;
  return stack ? parseOwnerStack(stack) : null;
}

/** Frames from React itself, the JSX runtime, Next's own client and bundler glue are not app code (webpack and turbopack spellings). */
const NON_APP_FRAME =
  /node_modules(?:[\/%_]|%2F)(?:react|react-dom|react-jsx-runtime|react-jsx-dev-runtime|react-server-dom-[\w-]+|scheduler|next)(?:[\/%_@.-]|$)|react-stack-(?:top|bottom)-frame|node:internal|<anonymous>/;

/**
 * First application frame of a React 19 `_debugStack`. Handles V8 (`at fn (url:l:c)`, `at url:l:c`)
 * and Firefox/Safari (`fn@url:l:c`) formats; strips bundler prefixes so the file reads as a path.
 */
export function parseOwnerStack(stack: string): SourceInfo | null {
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    if (!line || /^Error\b/.test(line) || line === "react-stack-top-frame") continue;
    const m =
      /^at (?:.*? )?\(?(.+?):(\d+):(\d+)\)?$/.exec(line) ?? /^(?:.*?@)?(.+?):(\d+):(\d+)$/.exec(line);
    if (!m) continue;
    const loc = m[1]!;
    if (NON_APP_FRAME.test(loc)) continue;
    return { file: cleanModuleUrl(loc), line: Number(m[2]), column: Number(m[3]), via: "owner_stack" };
  }
  return null;
}

function cleanModuleUrl(url: string): string {
  let f = url;
  f = f.replace(/^about:\/\/React\/[A-Za-z]+\//, ""); // React 19 server-component frames
  f = f.replace(/^webpack-internal:\/\/\/(?:\([^)]*\)\/)?/, "");
  f = f.replace(/^webpack:\/\/[^/]*\//, "");
  f = f.replace(/^file:\/\/\/?/, "");
  f = f.replace(/^\.\//, "");
  f = f.replace(/\?\d+$/, ""); // webpack module id suffix
  return f;
}

export function detectReact(el: Element): ComponentDetection | null {
  let node: Element | null = el;
  let fiber: Fiber | null = null;
  while (node && !fiber) {
    fiber = fiberOf(node);
    node = node.parentElement;
  }
  if (!fiber) return null;
  let source: SourceInfo | null = null;
  const components: ComponentInfo[] = [];

  // Owner chain: who rendered this element, then who rendered them, and so on.
  let owner: Fiber | ServerComponentInfo | null | undefined = fiber._debugOwner;
  const seen = new Set<unknown>();
  source = sourceOf(fiber);
  while (owner && components.length < MAX_COMPONENTS && !seen.has(owner)) {
    seen.add(owner);
    if (isServerInfo(owner)) {
      if (owner.name) components.push({ name: owner.name, kind: "server" });
      if (!source && owner.debugStack?.stack) source = parseOwnerStack(owner.debugStack.stack);
      owner = owner.owner;
    } else {
      const named = nameOfType(owner.elementType ?? owner.type) ?? nameOfType(owner.type);
      if (named) components.push(named);
      if (!source) source = sourceOf(owner);
      owner = owner._debugOwner;
    }
  }
  if (components.length) return { framework: "react", components, source };

  // No owner info (production build, or older React): fall back to the parent tree.
  for (let f: Fiber | null = fiber; f; f = f.return) {
    if (!source) source = sourceOf(f);
    const named = nameOfType(f.elementType ?? f.type) ?? nameOfType(f.type);
    if (named && components.length < MAX_COMPONENTS) components.push(named);
    if (components.length >= MAX_COMPONENTS && source) break;
  }
  return { framework: "react", components, source };
}

interface VueInstance {
  type?: { name?: string; __name?: string; __file?: string };
  parent?: VueInstance | null;
}
interface Vue2Instance {
  $options?: { name?: string; _componentTag?: string; __file?: string };
  $parent?: Vue2Instance | null;
}

export function detectVue(el: Element): ComponentDetection | null {
  let node: Element | null = el;
  while (node) {
    const v3 = (node as unknown as { __vueParentComponent?: VueInstance }).__vueParentComponent;
    if (v3) {
      const components: ComponentInfo[] = [];
      let source: SourceInfo | null = null;
      for (let c: VueInstance | null | undefined = v3; c && components.length < MAX_COMPONENTS; c = c.parent) {
        const name = c.type?.name || c.type?.__name;
        if (name) components.push({ name, kind: "function" });
        if (!source && c.type?.__file) source = { file: c.type.__file, line: null, column: null, via: "vue_file" };
      }
      return { framework: "vue", components, source };
    }
    const v2 = (node as unknown as { __vue__?: Vue2Instance }).__vue__;
    if (v2) {
      const components: ComponentInfo[] = [];
      let source: SourceInfo | null = null;
      for (let c: Vue2Instance | null | undefined = v2; c && components.length < MAX_COMPONENTS; c = c.$parent) {
        const name = c.$options?.name || c.$options?._componentTag;
        if (name) components.push({ name, kind: "function" });
        if (!source && c.$options?.__file) source = { file: c.$options.__file, line: null, column: null, via: "vue_file" };
      }
      return { framework: "vue", components, source };
    }
    node = node.parentElement;
  }
  return null;
}

/** F-18: component chain + source for an element, or `unknown` with an empty chain. */
export function detectComponents(el: Element): ComponentDetection {
  try {
    return detectReact(el) ?? detectVue(el) ?? { framework: "unknown", components: [], source: null };
  } catch {
    return { framework: "unknown", components: [], source: null };
  }
}

/** Human label for the hover tooltip: nearest component name, if any. */
export function nearestComponentName(el: Element): string | null {
  return detectComponents(el).components[0]?.name ?? null;
}

/** F-22: framework and bundler hints from globals and the DOM. */
export function detectFramework(): FrameworkInfo {
  const w = window as unknown as AnyRecord;
  const hints: string[] = [];
  let name: FrameworkInfo["name"] = "unknown";
  let version: string | null = null;
  let route: string | null = null;
  let bundler: FrameworkInfo["bundler"] = "unknown";

  const nextData = w.__NEXT_DATA__ as { page?: string; buildId?: string } | undefined;
  const next = w.next as { version?: string } | undefined;
  if (nextData || next || document.getElementById("__next") || document.querySelector("script[src*='/_next/']")) {
    name = "next";
    if (nextData) hints.push("window.__NEXT_DATA__");
    if (next) hints.push("window.next");
    if (document.getElementById("__next")) hints.push("#__next");
    if (typeof next?.version === "string") version = next.version;
    if (typeof nextData?.page === "string") route = nextData.page;
    bundler = "webpack";
  } else if (hasReactFibers()) {
    name = "react";
    hints.push("__reactFiber$ on DOM nodes");
  } else if (w.__VUE__ || document.querySelector("[data-v-app]") || hasVueInstances()) {
    name = "vue";
    if (w.__VUE__) hints.push("window.__VUE__");
    const app = (document.querySelector("[data-v-app]") as unknown as { __vue_app__?: { version?: string } } | null)
      ?.__vue_app__;
    if (app?.version) version = app.version;
    if (typeof w.Vue === "object" && w.Vue && typeof (w.Vue as AnyRecord).version === "string") {
      version = (w.Vue as AnyRecord).version as string;
    }
  } else if (document.querySelector("[ng-version]")) {
    name = "angular";
    version = document.querySelector("[ng-version]")?.getAttribute("ng-version") ?? null;
    hints.push("[ng-version]");
  } else if (w.__svelte || document.querySelector("[class*='svelte-']")) {
    name = "svelte";
    hints.push(w.__svelte ? "window.__svelte" : "svelte- class prefix");
  }

  if (document.querySelector("script[src*='/@vite/client']") || w.__vite_plugin_react_preamble_installed__) {
    bundler = "vite";
    hints.push("/@vite/client");
  } else if (w.webpackChunk_N_E || w.webpackJsonp || Object.keys(w).some((k) => k.startsWith("webpackChunk"))) {
    bundler = "webpack";
    hints.push("webpackChunk global");
  }
  if (name === "unknown" && (w.React || document.querySelector("[data-reactroot]"))) {
    name = "react";
    hints.push(w.React ? "window.React" : "[data-reactroot]");
  }
  return { name, version, bundler, route, hints };
}

function hasReactFibers(): boolean {
  const els = document.body ? document.body.querySelectorAll("*") : [];
  const limit = Math.min(els.length, 200);
  for (let i = 0; i < limit; i++) if (fiberOf(els[i]!)) return true;
  return false;
}

function hasVueInstances(): boolean {
  const els = document.body ? document.body.querySelectorAll("*") : [];
  const limit = Math.min(els.length, 200);
  for (let i = 0; i < limit; i++) {
    const e = els[i] as unknown as AnyRecord;
    if (e.__vueParentComponent || e.__vue__ || e.__vue_app__) return true;
  }
  return false;
}
