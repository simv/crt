/**
 * Console and error hooks (PRD F-20): every `console.error`/`console.warn`, uncaught error and
 * unhandled rejection is kept in a ring buffer of MAX_CONSOLE_ENTRIES; the original console
 * methods still run.
 *
 * This module is bundled twice: into `early.js`, a tiny blocking script the proxy injects ahead of
 * the deferred overlay so errors thrown by the page's own inline scripts are caught, and into
 * `overlay.js`. The buffer lives on `window.__crt.__console` so the second copy adopts the first
 * copy's hooks instead of wrapping console again (script-tag mode, F-6, loads only overlay.js and
 * installs from there).
 */
import type { ConsoleEntry } from "../../server/src/capture-schema.js";

const MAX_ENTRIES = 50; // F-20
const MAX_MESSAGE = 2000;
const MAX_STACK = 4000;

interface ConsoleState {
  entries: ConsoleEntry[];
  installed: boolean;
}

function state(): ConsoleState {
  const w = window as unknown as { __crt?: { __console?: ConsoleState } };
  const crt = (w.__crt ??= {});
  return (crt.__console ??= { entries: [], installed: false });
}

function push(entry: ConsoleEntry): void {
  const { entries } = state();
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

function formatArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try {
    const s = JSON.stringify(a);
    return s === undefined ? String(a) : s;
  } catch {
    return String(a);
  }
}

/** Minimal printf-style handling so `console.error("x %s", y)` reads naturally. */
export function formatConsoleArgs(args: unknown[]): string {
  if (args.length === 0) return "";
  const [first, ...rest] = args;
  if (typeof first === "string" && /%[sdifoOc]/.test(first)) {
    let i = 0;
    const out = first.replace(/%[sdifoOc]/g, (m) => {
      if (m === "%c") {
        i++;
        return "";
      }
      return i < rest.length ? formatArg(rest[i++]) : m;
    });
    return [out, ...rest.slice(i).map(formatArg)].join(" ");
  }
  return args.map(formatArg).join(" ");
}

function record(level: ConsoleEntry["level"], args: unknown[], error?: unknown): void {
  const err = error instanceof Error ? error : args.find((a): a is Error => a instanceof Error);
  push({
    level,
    message: formatConsoleArgs(args).slice(0, MAX_MESSAGE),
    stack: err?.stack ? err.stack.slice(0, MAX_STACK) : null,
    timestamp: new Date().toISOString(),
    url: location.href,
  });
}

export function installConsoleHooks(): void {
  const st = state();
  if (st.installed) return;
  st.installed = true;
  for (const level of ["error", "warn"] as const) {
    const original = console[level];
    console[level] = function (this: unknown, ...args: unknown[]) {
      try {
        record(level, args);
      } catch {
        // never let the hook break the page
      }
      return original.apply(this === undefined ? console : this, args);
    };
  }
  window.addEventListener("error", (e) => {
    const msg = e.error instanceof Error ? e.error.message : e.message || "Uncaught error";
    const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : "";
    record("uncaught", [msg + where], e.error);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason: unknown = e.reason;
    const msg = reason instanceof Error ? reason.message : formatArg(reason);
    record("unhandledrejection", [`Unhandled promise rejection: ${msg}`], reason);
  });
}

/** Snapshot of the buffer, oldest first. */
export function consoleEntries(): ConsoleEntry[] {
  return state().entries.slice();
}

export function clearConsoleEntries(): void {
  state().entries.length = 0;
}
