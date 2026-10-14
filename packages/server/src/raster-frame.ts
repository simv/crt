/**
 * PRD F-16 (CRT-0047): the rasteriser frame. The overlay snapshots the page as an SVG with a
 * foreignObject (modern-screenshot), and Chromium draws such an SVG onto a canvas without tainting it
 * only when it is a `data:` image — which a strict app policy (`img-src 'self'`) refuses. So under
 * such a policy the overlay hands the SVG text to this page in a hidden iframe instead: it is CRT's
 * own document with its own policy, not the app's, so it loads the `data:` image, draws it and
 * posts the PNG back as a Blob, which the page decodes with `createImageBitmap` (no fetch, no
 * policy check). Nothing about the app's policy is loosened; the frame is same-origin behind the
 * proxy (the app's `frame-src 'self'` covers it) and the CRT origin in embedded mode.
 *
 * The frame runs only the one script below (its hash is in the policy), answers any page's message
 * (it reads nothing and holds nothing) and replies to the sender alone.
 */
import { createHash } from "node:crypto";

/** The message the overlay posts, and the one the frame answers with (same `id`). */
export const RASTER_MESSAGE = "crt-raster";

const SCRIPT = `addEventListener("message", async (e) => {
  const m = e.data;
  if (!m || m.type !== "${RASTER_MESSAGE}" || typeof m.svg !== "string" || !e.source) return;
  const reply = (r) => e.source.postMessage(Object.assign({ type: "${RASTER_MESSAGE}", id: m.id }, r), e.origin === "null" ? "*" : e.origin);
  try {
    const img = new Image();
    img.decoding = "sync";
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(m.svg);
    await img.decode();
    const c = document.createElement("canvas");
    c.width = m.width;
    c.height = m.height;
    const x = c.getContext("2d");
    const draw = () => {
      x.clearRect(0, 0, c.width, c.height);
      if (m.background) {
        x.fillStyle = m.background;
        x.fillRect(0, 0, c.width, c.height);
      }
      x.drawImage(img, 0, 0, c.width, c.height);
    };
    draw();
    // As modern-screenshot does: an SVG with embedded images can draw before they decode.
    for (let i = 0; i < (m.redraws | 0); i++) {
      await new Promise((r) => setTimeout(r, i + 100));
      draw();
    }
    const png = await new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("the canvas gave no PNG"))), "image/png"));
    reply({ png });
  } catch (err) {
    reply({ error: String((err && err.message) || err || "the SVG did not decode") });
  }
});`;

/** The frame's own policy: its one script, and `data:` images, fonts and inline styles for the SVG it draws. */
export const RASTER_FRAME_CSP = `default-src 'none'; script-src 'sha256-${createHash("sha256").update(SCRIPT).digest("base64")}'; img-src data:; font-src data:; style-src 'unsafe-inline'`;

export const RASTER_FRAME_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>CRT rasteriser</title></head><body><script>${SCRIPT}</script></body></html>
`;
