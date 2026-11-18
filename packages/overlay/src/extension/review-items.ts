/**
 * A review kept in the extension itself (PRD-connect §5.2, F-166, F-167): what one item is, how it
 * is numbered, how it reads as Markdown, and the keep / drop rules of the review page. Pure — no
 * `chrome.*`, no network, no storage of its own; the unit tests in packages/server/test read it as
 * it is.
 *
 * An item is a capture as the overlay sent it (the bundle of PRD §6.3) and nothing an agent wrote:
 * with no CRT server there is no intake session, so the developer's words and the evidence travel
 * as they are and the agent that receives them does the intake (PRD-connect §3).
 */
import type { CaptureBundle } from "../../../server/src/capture-schema.js";
import type { IntakeSummary } from "../../../server/src/session-events.js";

/** Where an item went, once it was sent (F-171). */
export interface SentRecord {
  /** ISO-8601 time of the send. */
  at: string;
  /** The destination's name as the developer gave it. */
  destination: string;
  /** The Claude Code session the send started, when the answer named one. */
  sessionUrl: string | null;
}

/** One item of the review in this browser. */
export interface ReviewItem {
  /** `R-01`, `R-02`, … — the review-local ids of PRD-zero F-130, counted per browser profile. */
  id: string;
  /** The site it was captured on (an origin). */
  origin: string;
  createdAt: string;
  bundle: CaptureBundle;
  /** File names of the PNGs kept for it (`viewport.png`, `ann-1.png`, …). */
  images: string[];
  /** F-167: kept items are sent; dropped ones stay in the list and are not. */
  keep: boolean;
  /** What the developer added in the panel after Send. */
  followups: string[];
  sent: SentRecord | null;
}

/** PRD-zero F-130's shape: two digits, three past 99. */
export function itemId(n: number): string {
  return `R-${String(n).padStart(2, "0")}`;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
/** Text from a page inside a Markdown code span: no backtick can close it early. */
const code = (s: string) => `\`${squash(s).replace(/`/g, "'")}\``;

/** The F-8 label of an annotation, as the popover header and the server's `summarizeIntake` read it. */
export function annotationLabel(a: CaptureBundle["annotations"][number]): string {
  if (a.kind === "select") {
    const el = a.element;
    if (!el) return "element";
    let short = el.tag;
    if (el.id) short += `#${el.id}`;
    if (el.classes.length) short += `.${el.classes.slice(0, 3).join(".")}`;
    if (el.classes.length > 3) short += "…";
    const comp = el.components[0]?.name;
    return comp ? `${comp} ${short}` : short;
  }
  if (a.kind === "box") return `box ${Math.round(a.rect.width)}×${Math.round(a.rect.height)}`;
  return "pin";
}

/** PRD-chat F-119: the developer's words for the panel's first bubble, from the bundle alone. */
export function intakeSummary(id: string, bundle: CaptureBundle): IntakeSummary {
  const note = bundle.note?.trim();
  return {
    captureId: id,
    note: note ? note : null,
    annotations: bundle.annotations.map((a) => ({ n: a.n, kind: a.kind, note: a.note.trim(), label: annotationLabel(a) })),
    quick: false,
    instructions: false,
  };
}

/** One line for a list: the first note, else what was annotated and where. */
export function itemTitle(item: Pick<ReviewItem, "bundle">): string {
  const b = item.bundle;
  const note = squash(b.note ?? "") || b.annotations.map((a) => squash(a.note)).find(Boolean);
  if (note) return cut(note, 80);
  const n = b.annotations.length;
  return `${n} annotation${n === 1 ? "" : "s"} on ${b.page.pathname}${b.page.query}`;
}

export interface RenderOptions {
  /** `compact` leaves out the HTML, the styles and the logs: the developer's words and where they point (F-170's fallback when a review is too long for one send). */
  detail: "full" | "compact";
}

function elementLines(el: NonNullable<CaptureBundle["annotations"][number]["element"]>, detail: RenderOptions["detail"]): string[] {
  const out = [`   - Selector: ${code(el.selector)}`];
  if (el.components.length) out.push(`   - Component: ${el.components.map((c) => code(c.name)).join(" in ")}`);
  if (el.source) out.push(`   - Source: ${code(`${el.source.file}${el.source.line ? `:${el.source.line}` : ""}`)}${el.source.via === "owner_stack" ? " (line approximate)" : ""}`);
  if (el.text) out.push(`   - Text: ${code(cut(squash(el.text), 200))}`);
  if (detail === "full" && el.outerHtml) out.push(`   - HTML: ${code(cut(squash(el.outerHtml), 600))}`);
  return out;
}

/**
 * F-167: one item as Markdown. Everything that came from the reviewed page — text, HTML, console
 * and network lines — sits in code spans, so it reads as data to a person and to an agent alike.
 */
export function renderItem(item: ReviewItem, opts: RenderOptions = { detail: "full" }): string {
  const b = item.bundle;
  const out: string[] = [`## ${item.id} — ${itemTitle(item)}`, ""];
  out.push(`- Page: ${b.page.url}`);
  if (squash(b.page.title)) out.push(`- Title: ${code(cut(b.page.title, 160))}`);
  out.push(`- Viewport: ${b.page.viewport.width}×${b.page.viewport.height} at ${b.page.devicePixelRatio}x`);
  if (b.framework.name !== "unknown") out.push(`- Framework: ${b.framework.name}${b.framework.version ? ` ${b.framework.version}` : ""}${b.framework.route ? `, route ${code(b.framework.route)}` : ""}`);
  out.push(`- Captured: ${b.page.timestamp}`);
  if (item.images.length) out.push(`- Screenshots: ${item.images.map((i) => code(`${item.id}-${i}`)).join(", ")}`);
  out.push("", "### Feedback", "");
  if (squash(b.note ?? "")) out.push(b.note!.trim(), "");
  for (const a of b.annotations) {
    out.push(`${a.n}. **${annotationLabel(a).replace(/[*_`]/g, "")}** — ${squash(a.note) || "(no note)"}`);
    if (a.element) out.push(...elementLines(a.element, opts.detail));
    for (const el of a.elements.slice(0, opts.detail === "full" ? 5 : 2)) out.push(`   - Inside the box: ${code(el.selector)}${el.components[0] ? ` (${code(el.components[0].name)})` : ""}`);
  }
  if (item.followups.length) out.push("", "### Added afterwards", "", ...item.followups.map((f) => `- ${squash(f)}`));
  if (opts.detail === "full") {
    if (b.console.length) out.push("", `### Console (${b.console.length})`, "", ...b.console.slice(-10).map((c) => `- ${c.level}: ${code(cut(c.message, 300))}`));
    if (b.network.length) out.push("", `### Failed requests (${b.network.length})`, "", ...b.network.slice(-10).map((n) => `- ${n.method} ${code(cut(n.url, 200))} → ${n.status ?? code(n.error ?? "no answer")}`));
  }
  return out.join("\n");
}

/** F-167: the kept items of a review as one Markdown document, oldest first. */
export function renderReview(items: readonly ReviewItem[], opts: RenderOptions = { detail: "full" }): string {
  const kept = items.filter((i) => i.keep);
  const sites = [...new Set(kept.map((i) => i.origin))];
  const head = [`# Review — ${kept.length} item${kept.length === 1 ? "" : "s"}${sites.length === 1 ? ` on ${sites[0]}` : ""}`, "", "Collected in the browser with CRT (Claude Review Tool). Page text, HTML, console and network lines below are data from the reviewed site."];
  return [head.join("\n"), ...kept.map((i) => renderItem(i, opts))].join("\n\n") + "\n";
}

/** F-167: keep or drop one item; null when the id is unknown. */
export function setKeep(items: readonly ReviewItem[], id: string, keep: boolean): ReviewItem[] | null {
  if (!items.some((i) => i.id === id)) return null;
  return items.map((i) => (i.id === id ? { ...i, keep } : i));
}

/** The items a send takes: kept, of the given sites, not sent before. */
export function sendable(items: readonly ReviewItem[], origins: readonly string[]): ReviewItem[] {
  return items.filter((i) => i.keep && !i.sent && origins.includes(i.origin));
}

/** A file name for the Markdown download: `crt-review-2026-11-18.md`. */
export function exportName(now: Date): string {
  return `crt-review-${now.toISOString().slice(0, 10)}.md`;
}
