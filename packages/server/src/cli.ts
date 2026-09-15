#!/usr/bin/env node
/**
 * CRT command-line entry point.
 *
 * Commands (see docs/PRD.md §6 and docs/PRD-providers.md §6):
 *   crt serve [--target <url>] [--port <n>] [--open] [--provider <id>]   F-1, F-5, F-43
 *   crt init                                                             F-35
 *   crt tasks [--json]                                                   F-33 (also refreshes the README index, F-34)
 *   crt task <ID> [--validate]                                           F-33 (F-32 format check)
 *   crt providers [--json] [--refresh]                                   F-45 (every provider's state + the F-44 decision)
 *
 * Every failure is one `crt: <message>` line on stderr and a non-zero exit (N-6).
 */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";
import { CrtError } from "./errors.js";
import { initProject, readConfig } from "./init.js";
import { findProjectRoot } from "./project.js";
import { serve } from "./serve.js";
import { ProviderRegistry, renderProviders } from "./session.js";
import { findTaskFile, listTasks, validateTaskText, writeIndex } from "./tasks.js";

const USAGE = [
  "crt — Claude Review Tool",
  "",
  "Usage:",
  "  crt serve [--target <url>] [--port <n>] [--open] [--provider <id>]",
  "  crt init",
  "  crt tasks [--json]",
  "  crt task <ID> [--validate]",
  "  crt providers [--json] [--refresh]",
].join("\n");

async function main(argv: string[]): Promise<number> {
  const { command, positionals, flags } = parseArgs(argv);
  switch (command) {
    case "serve": {
      const handle = await serve({
        target: stringFlag(flags.target, "--target <url>"),
        port: portFlag(flags.port),
        open: flags.open === true,
        provider: stringFlag(flags.provider, "--provider <id>"),
        overlayPath: fileURLToPath(new URL("./overlay.js", import.meta.url)),
        intakePromptPath: fileURLToPath(new URL("./intake.md", import.meta.url)),
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
    case "tasks": {
      const tasksDir = tasksDirOf(findProjectRoot());
      const tasks = listTasks(tasksDir);
      writeIndex(tasksDir);
      if (flags.json === true) {
        console.log(JSON.stringify({ tasksDir, tasks }, null, 2));
        return 0;
      }
      if (!tasks.length) {
        console.log(`no tasks in ${tasksDir}`);
        return 0;
      }
      const statusW = Math.max(...tasks.map((t) => t.status.length));
      const priorityW = Math.max(...tasks.map((t) => t.priority.length));
      const providerW = Math.max(...tasks.map((t) => (t.provider ?? "").length));
      for (const t of tasks) {
        // F-48: the provider as one word after the status (blank for v0.1 files, column omitted when none has one).
        const provider = providerW ? `${(t.provider ?? "").padEnd(providerW)}  ` : "";
        console.log(`${t.id}  ${t.status.padEnd(statusW)}  ${provider}${t.priority.padEnd(priorityW)}  ${t.title}  (${t.updated.slice(0, 10)})`);
      }
      const backlog = tasks.filter((t) => t.status === "backlog").length;
      console.log(`${tasks.length} task${tasks.length === 1 ? "" : "s"}, ${backlog} in backlog`);
      return 0;
    }
    case "task": {
      const id = positionals[0];
      if (!id || !/^CRT-\d{4}$/i.test(id)) throw new CrtError("usage: crt task <CRT-NNNN> [--validate]", 2);
      const file = findTaskFile(tasksDirOf(findProjectRoot()), id);
      if (!file) throw new CrtError(`no task ${id.toUpperCase()} in .crt/tasks`);
      const text = readFileSync(file, "utf8");
      if (flags.validate === true) {
        const errors = validateTaskText(text, basename(file));
        if (errors.length) {
          console.error(`crt task: ${basename(file)} does not match the F-32 format:`);
          for (const e of errors) console.error(`  - ${e}`);
          return 1;
        }
        console.log(`crt task: ${basename(file)} is valid`);
        return 0;
      }
      process.stdout.write(text);
      return 0;
    }
    case "providers": {
      // F-45: one row per built-in profile and the F-44 decision. A CLI run is always fresh, so
      // --refresh (which bypasses a running server's cache) is accepted and changes nothing here.
      const root = findProjectRoot();
      const providers = new ProviderRegistry({ root, config: readConfig(root) });
      await providers.refresh();
      if (flags.json === true) {
        console.log(JSON.stringify(providers.payload(), null, 2));
        return 0;
      }
      console.log(renderProviders(providers.status(), providers.detection()));
      return 0;
    }
    case undefined:
      console.log(USAGE);
      return 0;
    default:
      console.error(`crt: unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}

function tasksDirOf(root: string): string {
  return resolve(root, readConfig(root).tasksDir);
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
