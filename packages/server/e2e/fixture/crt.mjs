// Starts `crt serve` for the e2e run from a scratch project under e2e/.project/ (gitignored),
// so captures, sessions and the task files the chat spec writes never touch this repo's .crt/.
// The folder gets a `.git` marker so findProjectRoot() stops there.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, "..", ".project");
mkdirSync(join(project, ".git"), { recursive: true });
process.chdir(project);
process.env.CRT_SESSION_STUB = "1";
process.argv = [process.argv[0], join(here, "..", "..", "dist", "cli.js"), "serve", ...process.argv.slice(2)];
await import("../../dist/cli.js");
