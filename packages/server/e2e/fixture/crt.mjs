// Starts `crt serve` for the e2e run from a scratch project under e2e/.project/ (gitignored),
// so captures, sessions and the task files the chat spec writes never touch this repo's .crt/.
// The folder gets a `.git` marker so findProjectRoot() stops there.
//
// CRT_SESSION_STUB defaults to `1` (the stub as Claude) unless the variable is present (even
// empty); playwright.config.ts starts a second server with `sandboxed` (PRD-providers F-46
// variant: no permission cards, images by path, instructions in the first message) from its own
// scratch root, CRT_E2E_PROJECT, and a third on the `codex` provider (F-61 codex axis) with
// CRT_E2E_FAKE_CODEX=1: the fake Codex CLI (fake-codex.mjs) is installed npm-style into
// `<project>/bin` and put first on PATH before the server preflights, so `--provider codex`
// resolves to it (the `.cmd` shim on Windows, an executable script elsewhere).
//
// Every status line the server prints is also appended to `<project>/crt-serve.log`, so the
// chat spec can grep the log the way PRD-providers F-49 asks (no token, ever).
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installFakeCodex } from "./fake-codex-install.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, "..", ".project", ...(process.env.CRT_E2E_PROJECT ? [process.env.CRT_E2E_PROJECT] : []));
mkdirSync(join(project, ".git"), { recursive: true });
process.chdir(project);
if (!("CRT_SESSION_STUB" in process.env)) process.env.CRT_SESSION_STUB = "1";
if (process.env.CRT_E2E_FAKE_CODEX) {
  const bin = installFakeCodex(join(project, "bin"));
  process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ""}`;
}
const logFile = join(project, "crt-serve.log");
writeFileSync(logFile, "");
for (const name of ["log", "error"]) {
  const original = console[name].bind(console);
  console[name] = (...args) => {
    appendFileSync(logFile, `${args.map(String).join(" ")}\n`);
    original(...args);
  };
}
// PRD-embedded F-92 / F-110: the primary e2e servers run embedded (M18 flipped them); `--proxy`
// becomes the `crt proxy` command (≡ `crt serve --mode proxy`) for the dedicated proxy server.
const args = process.argv.slice(2);
const proxy = args.includes("--proxy");
// PRD-embedded F-99: the scratch project is created here, so `--yes` sets it up (no terminal to ask on).
process.argv = [process.argv[0], join(here, "..", "..", "dist", "cli.js"), proxy ? "proxy" : "serve", ...args.filter((a) => a !== "--proxy"), ...(args.includes("--yes") ? [] : ["--yes"])];
await import("../../dist/cli.js");
