/**
 * Helpers the overlay's modules share (CRT-0043): HTML escaping for the templates that still build
 * markup from strings, CSS escaping for attribute selectors, clamping, and what a session or thread
 * state is called on screen. `loader.ts` keeps its own few helpers (N-20: its bundle stays tiny).
 */
import type { SessionState } from "../../server/src/session-events.js";

/** F-67: what a marker shows for a thread; `task` once the task file exists, else the session state. */
export type ThreadState = SessionState | "task";

/** What a session or thread state is called: the marker pill, the chat head, the session list and the Chat dot (F-30, F-67). */
export const STATE_LABEL: Record<ThreadState, string> = {
  starting: "starting",
  running: "thinking…",
  waiting: "needs permission",
  idle: "your turn",
  task: "task written",
  ended: "ended",
  error: "error",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * `CSS.escape`, or (outside a browser) a backslash before every character but `[A-Za-z0-9_-]`,
 * which is a valid escape both in an identifier and inside a quoted attribute value.
 */
export function cssEscape(s: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(s) : s.replace(/([^\w-])/g, "\\$1");
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
