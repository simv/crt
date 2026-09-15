#!/usr/bin/env node
/**
 * CRT command-line entry point.
 *
 * Commands (see docs/PRD.md §6):
 *   crt serve [--target <url>] [--port <n>] [--open]   F-1, F-5
 *   crt init                                           F-35
 *   crt tasks [--json]                                 F-33
 *   crt task <ID>                                      F-33
 *
 * M1 implements `serve` and `init`; `tasks`/`task` arrive in M3.
 * Every failure is one `crt: <message>` line on stderr and a non-zero exit (N-6).
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";
import { CrtError } from "./errors.js";
import { initProject } from "./init.js";
import { findProjectRoot } from "./project.js";
import { serve } from "./serve.js";

const USAGE = [
  "crt — Claude Review Tool",
  "",
  "Usage:",
  "  crt serve [--target <url>] [--port <n>] [--open]",
  "  crt init",
  "  crt tasks [--json]",
  "  crt task <ID>",
].join("\n");

async function main(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case "serve": {
      const handle = await serve({
        target: stringFlag(flags.target, "--target <url>"),
        port: portFlag(flags.port),
        open: flags.open === true,
        overlayPath: fileURLToPath(new URL("./overlay.js", import.meta.url)),
      });
      const stop = () => {
        void handle.close().then(() => process.exit(0));
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      return -1; // keep running
    }
    case "init": {
      const root = findProjectRoot();
      const r = initProject(root);
      console.log(
        r.created.length
          ? `crt init: created ${r.created.join(", ")}`
          : `crt init: ${root} already initialised`,
      );
      return 0;
    }
    case "tasks":
    case "task":
      console.error(`crt ${command}: not implemented yet (see docs/PRD.md milestone M3)`);
      return 2;
    case undefined:
      console.log(USAGE);
      return 0;
    default:
      console.error(`crt: unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}

function stringFlag(value: string | boolean | undefined, usage: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value === "") throw new CrtError(`${usage} needs a value`);
  return value;
}

function portFlag(value: string | boolean | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new CrtError(`--port must be a number between 1 and 65535`);
  return n;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (err: unknown) => {
    if (err instanceof CrtError) {
      console.error(`crt: ${err.message}`);
      process.exit(err.exitCode);
    }
    console.error(err);
    process.exit(1);
  },
);
