#!/usr/bin/env node
/**
 * CRT command-line entry point.
 *
 * Commands (see docs/PRD.md §6):
 *   crt serve [--target <url>] [--port <n>] [--open]   F-1
 *   crt init                                           F-35
 *   crt tasks [--json]                                 F-33
 *   crt task <ID>                                      F-33
 *
 * M1 implements `serve` and `init`; `tasks`/`task` arrive in M3.
 */
import { parseArgs } from "./args.js";

const { command, flags } = parseArgs(process.argv.slice(2));

switch (command) {
  case "serve":
  case "init":
  case "tasks":
  case "task":
    console.error(`crt ${command}: not implemented yet (see docs/PRD.md milestones)`);
    console.error(`flags: ${JSON.stringify(flags)}`);
    process.exit(2);
    break;
  default:
    console.log(
      [
        "crt — Claude Review Tool",
        "",
        "Usage:",
        "  crt serve [--target <url>] [--port <n>] [--open]",
        "  crt init",
        "  crt tasks [--json]",
        "  crt task <ID>",
      ].join("\n"),
    );
    process.exit(command ? 1 : 0);
}
