/**
 * Text the drivers share for the panel: the one-liners of tool calls and errors (F-25), paths in
 * permission cards, and token counts in `result.detail`.
 */
import { relative } from "node:path";

/** Whitespace collapsed and cut to 160 characters. */
export function summarize(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

/** `p` relative to `cwd`, with `/`, when it lies inside it; otherwise `p` as given. */
export function shortPath(p: string, cwd: string): string {
  const r = relative(cwd, p);
  return r && !r.startsWith("..") ? r.split("\\").join("/") : p;
}

/** Token counts as one line for `result.detail` (`tokens: input 10, output 5`); undefined when there are none. */
export function describeUsage(usage: Record<string, number> | undefined): string | undefined {
  if (!usage) return undefined;
  const parts = Object.entries(usage)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `${k.replace(/_tokens$/, "").replace(/_/g, " ")} ${v}`);
  return parts.length ? `tokens: ${parts.join(", ")}` : undefined;
}
