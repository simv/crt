/**
 * HTML overlay injection (PRD F-2) and the response-body helpers it needs.
 * Pure functions over strings/buffers so they are unit-testable without a server;
 * proxy.ts decides *when* to call them.
 */
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from "node:zlib";

export const OVERLAY_PATH = "/__crt/overlay.js";
export const OVERLAY_TAG = `<script src="${OVERLAY_PATH}" defer></script>`;
/** F-20: a ~1 KB blocking script that hooks console/errors before the page's own scripts run. */
export const EARLY_PATH = "/__crt/early.js";
export const EARLY_TAG = `<script src="${EARLY_PATH}"></script>`;
export const INJECT_TAGS = EARLY_TAG + OVERLAY_TAG;

/** Content-Encodings we can decode in-process; anything else is passed through uninjected. */
export const SUPPORTED_ENCODINGS = ["gzip", "x-gzip", "deflate", "br", "identity"] as const;

export function isHtml(contentType: string | string[] | undefined): boolean {
  if (!contentType) return false;
  const v = Array.isArray(contentType) ? (contentType[0] ?? "") : contentType;
  return /^\s*text\/html\b/i.test(v);
}

/**
 * Insert the early-hook + overlay tags before `</head>`, else before `</body>`, else append.
 * Case-insensitive; the first match wins. Idempotent: an existing overlay tag is left alone.
 */
export function injectOverlayTag(html: string, tag: string = INJECT_TAGS): string {
  if (html.includes(OVERLAY_TAG)) return html;
  if (html.includes(tag)) return html;
  const head = /<\/head\s*>/i.exec(html);
  if (head) return html.slice(0, head.index) + tag + html.slice(head.index);
  const body = /<\/body\s*>/i.exec(html);
  if (body) return html.slice(0, body.index) + tag + html.slice(body.index);
  return html + tag;
}

/** Decode a response body per its Content-Encoding. Returns null for encodings we can't handle. */
export function decodeBody(body: Buffer, contentEncoding: string | undefined): Buffer | null {
  const enc = (contentEncoding ?? "identity").trim().toLowerCase();
  switch (enc) {
    case "":
    case "identity":
      return body;
    case "gzip":
    case "x-gzip":
      return gunzipSync(body);
    case "br":
      return brotliDecompressSync(body);
    case "deflate":
      // Some servers send raw deflate despite the name; try zlib-wrapped first.
      try {
        return inflateSync(body);
      } catch {
        return inflateRawSync(body);
      }
    default:
      return null;
  }
}

/**
 * Narrow a client's Accept-Encoding to what decodeBody can undo, so an upstream
 * never hands us HTML in an encoding we can't inject into (e.g. zstd).
 */
export function filterAcceptEncoding(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const wanted = value
    .split(",")
    .map((s) => s.trim().split(";")[0]!.toLowerCase())
    .filter((s) => (SUPPORTED_ENCODINGS as readonly string[]).includes(s) && s !== "identity");
  return wanted.length ? wanted.join(", ") : "identity";
}

/**
 * Relax a Content-Security-Policy just enough for the same-origin overlay script:
 * make sure the directive that governs scripts allows 'self'. Dev servers rarely send
 * CSP at all, so this is a cheap safety net rather than a full CSP rewriter.
 */
export function relaxCsp(csp: string): string {
  const directives = csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean);
  const find = (name: string) =>
    directives.findIndex((d) => {
      const l = d.toLowerCase();
      return l === name || l.startsWith(name + " ");
    });
  const allowsSelf = (d: string) => /(^|\s)'self'(\s|$)/i.test(d) || /(^|\s)\*(\s|$)/.test(d);

  const elem = find("script-src-elem");
  const scriptIdx = elem !== -1 ? elem : find("script-src");
  if (scriptIdx !== -1) {
    if (!allowsSelf(directives[scriptIdx]!)) directives[scriptIdx] = `${directives[scriptIdx]} 'self'`;
    return directives.join("; ");
  }
  const defaultIdx = find("default-src");
  if (defaultIdx !== -1 && !allowsSelf(directives[defaultIdx]!)) {
    const sources = directives[defaultIdx]!.replace(/^default-src\s*/i, "");
    directives.push(`script-src ${sources} 'self'`.replace(/\s+/g, " "));
  }
  return directives.join("; ");
}
