// Generates the five CRT logo option SVGs and their contact sheet (light + dark, 128 → 16 px) into ./options/.
// Planning artefact for PRD-polish M20 (CRT-0024): `node docs/brand/gen-logo.mjs`. The chosen mark is
// hand-finished from this geometry (Bézier corners) into crt-mark.svg; the options stay as the record.
// The committed contact-sheet.html carries a hand-added "Final" row with the finished files (M20); regenerating
// rewrites the sheet without it. The launcher pill is always #111, on both cards, as in the overlay (ui.ts).
// The screen is a 4:3 superellipse ("squircle", n = 4) — the tube-TV shape.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dirname, "options");
mkdirSync(OUT, { recursive: true });

const INK = "#111111";
const ACCENT = "#ff3d71"; // the overlay's marker colour (packages/overlay/src/screenshot.ts)
const GLASS = "#2b2b31";

/** Superellipse |x/a|^n + |y/b|^n = 1 centred on (cx, cy), as a closed path. */
function squircle(cx, cy, a, b, n = 4, steps = 96) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const x = cx + a * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = cy + b * Math.sign(s) * Math.abs(s) ** (2 / n);
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

// 128 × 128 canvas; the screen is 104 × 78 (4:3), centred.
const SCREEN = squircle(64, 64, 52, 39);
const INNER = squircle(64, 64, 44, 32); // the glass, inside the bezel

const svg = (body, { title }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${title}">\n${body}\n</svg>\n`;

const options = {
  // A — Tube: a dark screen with a glass highlight and the overlay's numbered marker pinned to its corner.
  "a-tube": svg(
    [
      `  <path d="${SCREEN}" fill="${INK}"/>`,
      `  <path d="${INNER}" fill="${GLASS}"/>`,
      `  <path d="M28 46 Q64 30 100 46 L100 40 Q64 24 28 40 Z" fill="#ffffff" opacity=".14"/>`,
      `  <circle cx="98" cy="30" r="15" fill="${ACCENT}"/>`,
      `  <path d="M95 22 h6 v16 h-5 v-11 h-3 z" fill="#ffffff"/>`,
    ].join("\n"),
    { title: "CRT — Tube" },
  ),

  // B — Sign-off: the tube outline and the instant a CRT switches off — a bright line and a dot.
  "b-signoff": svg(
    [
      `  <path d="${SCREEN}" fill="none" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>`,
      `  <path d="M30 64 H98" stroke="${ACCENT}" stroke-width="7" stroke-linecap="round"/>`,
      `  <circle cx="64" cy="64" r="9" fill="${ACCENT}"/>`,
    ].join("\n"),
    { title: "CRT — Sign-off" },
  ),

  // C — Select: a screen with a dashed selection box and the pointer: point at the problem.
  "c-select": svg(
    [
      `  <path d="${SCREEN}" fill="${INK}"/>`,
      `  <rect x="34" y="44" width="46" height="34" rx="3" fill="none" stroke="${ACCENT}" stroke-width="5" stroke-dasharray="9 7" stroke-linecap="round"/>`,
      `  <path d="M70 62 L98 74 L86 78 L94 94 L86 98 L78 82 L70 90 Z" fill="#ffffff" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`,
    ].join("\n"),
    { title: "CRT — Select" },
  ),

  // D — Speak: the tube is also a speech bubble — talk to the agent in the page.
  "d-speak": svg(
    [
      `  <path d="${squircle(64, 58, 52, 37)} M40 92 L34 112 L58 94 Z" fill="${INK}" fill-rule="nonzero"/>`,
      `  <circle cx="46" cy="58" r="7" fill="${ACCENT}"/>`,
      `  <circle cx="64" cy="58" r="7" fill="#ffffff"/>`,
      `  <circle cx="82" cy="58" r="7" fill="#ffffff"/>`,
    ].join("\n"),
    { title: "CRT — Speak" },
  ),

  // E — Monogram: the letters CRT as monoline geometry, no font, inside the tube.
  "e-monogram": svg(
    [
      `  <path d="${SCREEN}" fill="${INK}"/>`,
      `  <g fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">`,
      `    <path d="M42 54 A11 11 0 1 0 42 74"/>`,
      `    <path d="M52 76 V52 H63 A6 6 0 0 1 63 64 H52 M60 64 L68 76"/>`,
      `    <path d="M74 52 H96 M85 52 V76"/>`,
      `  </g>`,
      `  <circle cx="98" cy="30" r="9" fill="${ACCENT}"/>`,
    ].join("\n"),
    { title: "CRT — Monogram" },
  ),
};

for (const [name, body] of Object.entries(options)) writeFileSync(join(OUT, `${name}.svg`), body);

// Inverted (for dark backgrounds): ink → white, glass stays.
// Swap ink and white (the glass and the accent stay) — through a placeholder so neither replacement eats the other.
const invert = (s) => s.replaceAll(INK, "__INK__").replaceAll("#ffffff", INK).replaceAll("__INK__", "#ffffff");

const labels = {
  "a-tube": ["A · Tube", "A dark screen, a glass highlight, the overlay's numbered marker pinned to the corner. Says: a screen you annotate."],
  "b-signoff": ["B · Sign-off", "The tube outline and the instant a CRT switches off: one bright line, one dot. Says: CRT, and nothing else."],
  "c-select": ["C · Select", "A selection box and the pointer on a screen. Says: point at the problem — the Select tool."],
  "d-speak": ["D · Speak", "The tube is also a speech bubble. Says: talk to the agent in the page."],
  "e-monogram": ["E · Monogram", "The letters CRT drawn as monoline geometry (no font) inside the tube, marker in the corner."],
};

const card = (name, dark) => {
  const body = dark ? invert(options[name]) : options[name];
  const wrap = (px) => `<span class="m" style="width:${px}px;height:${px}px">${body}</span>`;
  return `<div class="card ${dark ? "dark" : ""}">
  <div class="big">${wrap(128)}</div>
  <div class="small">${wrap(48)}${wrap(32)}${wrap(24)}${wrap(16)}</div>
  <div class="launcher">${wrap(18)}<span>CRT</span><i></i></div>
</div>`;
};

const sheet = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CRT logo options</title>
<style>
  body { margin: 0; padding: 32px 40px; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; background: #fafafa; }
  h1 { font-size: 22px; margin: 0 0 4px; } .sub { color: #666; margin: 0 0 24px; }
  .row { display: grid; grid-template-columns: 260px 1fr 1fr; gap: 16px; align-items: stretch; margin-bottom: 18px; }
  .desc h2 { font-size: 16px; margin: 6px 0 4px; } .desc p { margin: 0; color: #444; }
  .card { border-radius: 14px; padding: 18px 20px; background: #fff; border: 1px solid #e6e6e6; display: flex; align-items: center; gap: 22px; }
  .card.dark { background: #16161a; border-color: #2a2a2e; color: #fff; }
  .m { display: inline-block; vertical-align: middle; } .m svg { width: 100%; height: 100%; display: block; }
  .small { display: flex; gap: 14px; align-items: flex-end; }
  .launcher { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px 8px 10px; border-radius: 999px; background: #111; color: #fff; font-weight: 600; font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
  .launcher i { width: 9px; height: 9px; border-radius: 50%; background: #2e9e5b; display: inline-block; }
  .foot { color: #666; margin-top: 8px; }
</style></head><body>
<h1>CRT logo — five directions on the 4:3 tube</h1>
<p class="sub">Each row: the mark at 128 px, then 48 / 32 / 24 / 16 px (favicon), then inside the overlay's launcher pill — on light and on dark. Ink #111, accent #ff3d71 (the overlay's marker colour).</p>
${Object.keys(options).map((n) => `<div class="row"><div class="desc"><h2>${labels[n][0]}</h2><p>${labels[n][1]}</p></div>${card(n, false)}${card(n, true)}</div>`).join("\n")}
<p class="foot">All five share one geometry: a superellipse (n = 4) at 4:3, the shape of a tube-TV screen. The chosen mark becomes <code>docs/brand/crt-mark.svg</code>, the favicon at <code>/__crt/favicon.svg</code>, the README hero and the landing page header.</p>
</body></html>`;
writeFileSync(join(OUT, "contact-sheet.html"), sheet);

