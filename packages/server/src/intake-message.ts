/**
 * The first user message of an intake session (PRD F-24): a readable summary of the capture, the
 * developer's notes, the absolute path of the capture bundle, and the screenshots as image
 * content blocks. Everything else (outer HTML, computed styles, XPath, console entries) stays in
 * capture.json, which the intake instructions tell Claude to read first.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type CaptureBundle, validateCaptureBundle } from "./capture-schema.js";
import type { UserImage, UserInput } from "./session-events.js";

/** The Messages API caps images at 5 MB; stay under it with headroom for base64. */
export const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
/** Annotated viewport + up to this many per-annotation crops. */
export const MAX_ANNOTATION_IMAGES = 6;

export class CaptureNotFoundError extends Error {
  constructor(id: string, cause: string) {
    super(`capture ${id} not found: ${cause}`);
    this.name = "CaptureNotFoundError";
  }
}

export function readCaptureBundle(captureDir: string): CaptureBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(captureDir, "capture.json"), "utf8"));
  } catch (err) {
    throw new CaptureNotFoundError(captureDir, (err as Error).message);
  }
  const errors = validateCaptureBundle(raw);
  if (errors.length) throw new CaptureNotFoundError(captureDir, `invalid capture.json (${errors[0]})`);
  return raw as CaptureBundle;
}

export function buildIntakeMessage(captureDir: string, bundle: CaptureBundle = readCaptureBundle(captureDir)): UserInput {
  const images: UserImage[] = [];
  const attach = (name: string | null, label: string) => {
    if (!name || images.length > MAX_ANNOTATION_IMAGES) return;
    try {
      const file = join(captureDir, name);
      if (statSync(file).size > MAX_IMAGE_BYTES) return;
      images.push({ mediaType: "image/png", data: readFileSync(file).toString("base64"), label });
    } catch {
      // A missing image is not fatal; the text still says which files exist.
    }
  };
  attach(bundle.screenshots.annotated ?? bundle.screenshots.viewport, bundle.screenshots.annotated ? "viewport (annotated)" : "viewport");
  for (const a of bundle.annotations) attach(a.image, `annotation ${a.n}`);

  return { text: renderIntakeText(captureDir, bundle, images.map((i) => i.label)), images };
}

export function renderIntakeText(captureDir: string, b: CaptureBundle, attached: string[]): string {
  const p = b.page;
  const lines: string[] = [];
  lines.push(`CRT intake for capture ${b.id}.`, `Capture bundle: ${join(captureDir, "capture.json")} (read it first; the PNGs are next to it).`, "");
  lines.push(`Page: ${p.url}`);
  lines.push(`  route ${p.pathname}${p.query}${p.hash} · title "${p.title}" · viewport ${p.viewport.width}×${p.viewport.height} @ ${p.devicePixelRatio}x · captured ${p.timestamp}`);
  const fw = b.framework;
  lines.push(`Framework: ${fw.name}${fw.version ? ` ${fw.version}` : ""}${fw.bundler !== "unknown" ? ` (${fw.bundler})` : ""}${fw.route ? ` · route pattern ${fw.route}` : ""}`);
  if (b.console.length) {
    const errors = b.console.filter((c) => c.level !== "warn");
    lines.push(`Console since load: ${b.console.length} entries, ${errors.length} errors${errors[0] ? ` — first: ${truncate(errors[0].message, 160)}` : ""}`);
  } else {
    lines.push("Console since load: clean");
  }
  lines.push("", `Annotations (${b.annotations.length}):`);
  for (const a of b.annotations) lines.push(...describeAnnotation(a));
  lines.push("");
  lines.push(attached.length ? `Attached images: ${attached.join(", ")}.` : "No screenshots could be rasterised for this capture.");
  if (b.screenshots.error) lines.push(`Screenshot note: ${b.screenshots.error}`);
  return lines.join("\n");
}

function describeAnnotation(a: CaptureBundle["annotations"][number]): string[] {
  const note = a.note.trim() ? `"${a.note.trim()}"` : "(no note)";
  const out: string[] = [];
  if (a.kind === "select" && a.element) {
    const el = a.element;
    out.push(`${a.n}. [select] ${note}`);
    out.push(`   element: <${el.tag}${el.id ? ` id="${el.id}"` : ""}${el.classes.length ? ` class="${el.classes.join(" ")}"` : ""}>${el.role ? ` role=${el.role}` : ""}${el.ariaLabel ? ` aria-label="${el.ariaLabel}"` : ""}${el.detached ? " (detached at send time)" : ""}`);
    out.push(`   selector: ${el.selector}`);
    if (el.text) out.push(`   text: ${JSON.stringify(truncate(el.text, 120))}`);
    if (el.components.length) out.push(`   components: ${el.components.map((c) => `${c.name}${c.kind === "server" ? " (server)" : ""}`).join(" ← ")}`);
    if (el.source) out.push(`   source: ${el.source.file}${el.source.line ? `:${el.source.line}` : ""} (${el.source.via}${el.source.via === "owner_stack" ? ", line approximate" : ""})`);
    const size = `${Math.round(el.rect.width)}×${Math.round(el.rect.height)} at (${Math.round(el.rect.x)}, ${Math.round(el.rect.y)})`;
    out.push(`   box: ${size}; display ${el.styles.display ?? "?"}, position ${el.styles.position ?? "?"}`);
  } else if (a.kind === "box") {
    out.push(`${a.n}. [box] ${note}`);
    out.push(`   region: ${Math.round(a.rect.width)}×${Math.round(a.rect.height)} at (${Math.round(a.rect.x)}, ${Math.round(a.rect.y)}), ${a.elements.length} element${a.elements.length === 1 ? "" : "s"} inside`);
    for (const el of a.elements.slice(0, 5)) {
      const comp = el.components[0] ? ` — ${el.components[0].name}` : "";
      out.push(`   - ${el.selector}${comp}${el.text ? ` ${JSON.stringify(truncate(el.text, 60))}` : ""}`);
    }
  } else {
    out.push(`${a.n}. [pin] ${note}`);
    out.push(`   point: (${Math.round(a.rect.x)}, ${Math.round(a.rect.y)}) in the viewport — no element bound; look at the crop`);
  }
  return out;
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
