// Poor man's `strings` + grep over codex.exe. usage: node strings.mjs <exe> <regex> [max]
import { readFileSync } from "node:fs";
const [exe, pattern, max = "80"] = process.argv.slice(2);
const s = readFileSync(exe).toString("latin1");
const re = new RegExp(pattern, "i");
const seen = new Set();
for (const m of s.matchAll(/[\x20-\x7e]{6,}/g)) {
  const t = m[0];
  if (re.test(t) && !seen.has(t)) {
    seen.add(t);
    if (seen.size <= Number(max)) console.log(t.length > 240 ? t.slice(0, 240) + "…" : t);
  }
}
console.log(`--- ${seen.size} distinct matches`);
