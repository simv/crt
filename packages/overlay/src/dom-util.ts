/**
 * Helpers the overlay's modules share (CRT-0043): HTML escaping for the templates that still build
 * markup from strings, CSS escaping for attribute selectors, clamping, what a session or thread
 * state is called on screen, the status line's text parts and a style write that skips unchanged
 * values. `loader.ts` keeps its own few helpers (N-20: its bundle stays tiny).
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

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** N-3: a positioning write that skips an unchanged value (reading an inline style never forces layout). */
export function setStyle(el: HTMLElement, prop: "left" | "top" | "right" | "bottom" | "maxHeight", value: string): void {
  if (el.style[prop] !== value) el.style[prop] = value;
}

/** One piece of a status line: text, or text shown as code or in bold — never HTML. */
export type StatusPart = string | { code: string } | { b: string };

export function statusNode(part: StatusPart): Node {
  if (typeof part === "string") return document.createTextNode(part);
  const el = document.createElement("code" in part ? "code" : "b");
  el.textContent = "code" in part ? part.code : part.b;
  return el;
}
