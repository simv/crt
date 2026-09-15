// One-time setup for the spike: a scratch git repo with an AGENTS.md (a sibling of this repo — the Windows sandbox denied a %TEMP% short path — or $SPIKE_REPO) and a tiny PNG
// for --image (./red.png). Idempotent. usage: node setup.mjs
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = process.env.SPIKE_REPO || join(here, "..", "..", "..", "..", "..", "crt-codex-spike-repo");

if (!existsSync(join(repo, ".git"))) {
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "AGENTS.md"), "# AGENTS.md\n\nThis is a scratch repository used to probe the Codex CLI. When asked to ping, call the `crt_ping` MCP tool once and report its result verbatim. Keep answers short.\n");
  writeFileSync(join(repo, "index.js"), "export const answer = 42;\n");
  const git = (...a) => spawnSync("git", ["-c", "user.email=spike@example.com", "-c", "user.name=spike", ...a], { cwd: repo, stdio: "inherit", shell: false });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  console.log(`created scratch repo at ${repo}`);
}

// 8x8 RGB PNG built by hand so nothing binary needs committing.
function crc32(buf) {
  let c;
  const t = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let r = 0xffffffff;
  for (const x of buf) r = t[(r ^ x) & 0xff] ^ (r >>> 8);
  return (r ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const w = 8, h = 8;
const raw = Buffer.alloc((w * 3 + 1) * h);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 255; raw[o + 1] = x * 32; raw[o + 2] = y * 32; }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(join(here, "red.png"), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log(`wrote ${join(here, "red.png")}`);
