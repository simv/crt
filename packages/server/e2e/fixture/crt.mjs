// Starts `crt serve` for the e2e run from a scratch project under e2e/.project/ (gitignored),
// so captures, sessions and the task files the chat spec writes never touch this repo's .crt/.
// The folder gets a `.git` marker so findProjectRoot() stops there.
//
// CRT_SESSION_STUB defaults to `1` (the stub as Claude); playwright.config.ts starts a second
// server with `sandboxed` (PRD-providers F-46 variant: no permission cards, images by path,
// instructions in the first message) from its own scratch root, CRT_E2E_PROJECT.
//
// Every status line the server prints is also appended to `<project>/crt-serve.log`, so the
// chat spec can grep the log the way PRD-providers F-49 asks (no token, ever).
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, "..", ".project", ...(process.env.CRT_E2E_PROJECT ? [process.env.CRT_E2E_PROJECT] : []));
mkdirSync(join(project, ".git"), { recursive: true });
process.chdir(project);
process.env.CRT_SESSION_STUB ||= "1";
const logFile = join(project, "crt-serve.log");
writeFileSync(logFile, "");
for (const name of ["log", "error"]) {
  const original = console[name].bind(console);
  console[name] = (...args) => {
    appendFileSync(logFile, `${args.map(String).join(" ")}\n`);
    original(...args);
  };
}
process.argv = [process.argv[0], join(here, "..", "..", "dist", "cli.js"), "serve", ...process.argv.slice(2)];
await import("../../dist/cli.js");
