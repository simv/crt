#!/usr/bin/env node
/**
 * CRT command-line entry point.
 *
 * Commands (see docs/PRD.md §6, docs/PRD-providers.md §6, docs/PRD-setup.md §6.1 and docs/PRD-embedded.md §6.1):
 *   crt [target] [--port <n>] [--open|--no-open] [--yes] [--replace] [--provider <id>]   F-69…F-73 (the guided start), embedded by default (F-91)
 *   crt serve [target] [--target <url>] [--mode <embedded|proxy>] …      the same under its explicit name (F-1, F-5, F-43, F-91)
 *   crt proxy [target] …                                                 ≡ crt serve --mode proxy (F-92: the v0.3 reverse proxy)
 *   crt doctor                                                           F-76
 *   crt setup [--claude <path>]                                          F-86 (registers the bundled plugin with Claude Code)
 *   crt init                                                             F-35
 *   crt tasks [--json]                                                   F-33 (also refreshes the README index, F-34)
 *   crt task <ID> [--validate]                                           F-33 (F-32 format check)
 *   crt providers [--json] [--refresh]                                   F-45 (every provider's state + the F-44 decision)
 *   crt mcp                                                              F-49 (stdio write_task server; spawned by an agent, not by hand)
 *   crt skills install [--provider <id>] [--global] [--dir <path>]       F-58 (the plugin's skills as portable Agent Skills)
 *   crt help | --help | -h, crt --version                                F-69
 *
 * Every failure is one `crt: <message>` line on stderr and a non-zero exit (N-6). The server
 * and provider modules (and with them the Agent SDK) are imported only by the commands that
 * need them, so `crt mcp` starts fast and prints nothing but protocol frames on stdout.
 */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";
import { CrtError } from "./errors.js";
import { describeInit, initProject, readConfig } from "./init.js";
import { findProjectRoot } from "./project.js";
import { looksLikeTarget } from "./target.js";
import { findTaskFile, listTasks, validateTaskText, writeIndex } from "./tasks.js";
import { packageVersion } from "./version.js";

const USAGE = [
  "crt — Claude Review Tool",
  "",
  "Usage:",
  "  crt [target]            start the CRT server on http://localhost:4400 and open your app (embedded: the app loads the CRT loader)",
  "  crt serve [target]      the same, under its explicit name",
  "      [--mode <embedded|proxy>] [--target <url>] [--port <n>] [--open | --no-open] [--yes] [--replace] [--provider <id>]",
  "  crt proxy [target]      proxy the dev server through http://localhost:4400 instead (the same flags; = crt serve --mode proxy)",
  "  crt doctor              check node, project, .crt, target, port, providers, plugin",
  "  crt setup               register the bundled Claude Code plugin (/crt:serve, /crt:next, …) [--claude <path>]",
  "  crt init",
  "  crt tasks [--json]",
  "  crt task <ID> [--validate]",
  "  crt providers [--json] [--refresh]",
  "  crt mcp                 (stdio write_task server for agents; needs CRT_MCP_TOKEN and CRT_MCP_PORT)",
  "  crt --version",
  "",
  "A target is a port (3000), host:port (localhost:3000) or a URL. `crt` remembers the one you",
  "typed or picked in .crt/config.local.json; `crt <port>` switches it.",
].join("\n");

const COMMANDS = new Set(["serve", "proxy", "doctor", "setup", "init", "tasks", "task", "providers", "mcp", "skills", "help"]);

/** F-77: a second Ctrl+C within this window exits at once. */
const FORCE_EXIT_MS = 2_000;

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  let { command, positionals } = parsed;
  const { flags } = parsed;

  // F-69: `crt --version`, `crt help` / `--help` / `-h`.
  if (command === undefined && flags.version === true) {
    const { sdkVersion } = await import("./providers/claude.js");
    console.log(`crt ${packageVersion()} (agent sdk ${sdkVersion() ?? "not installed"})`);
    return 0;
  }
  if (command === "help" || command === "-h" || flags.help === true || flags.h === true) {
    console.log(USAGE);
    return 0;
  }
  // F-69: bare `crt` and `crt <target>` start.
  if (command === undefined || looksLikeTarget(command)) {
    positionals = command === undefined ? [] : [command, ...positionals];
    command = "serve";
  } else if (!COMMANDS.has(command)) {
    throw new CrtError(`unknown command "${command}" — a target is a port, host:port or URL; \`crt help\` lists commands`, 2);
  }

  switch (command) {
    case "mcp": {
      // F-49: stdout is the MCP transport from here on; nothing else may write to it.
      const { runMcpStdio } = await import("./mcp-stdio.js");
      return runMcpStdio({ input: process.stdin, output: process.stdout, env: process.env });
    }
    case "serve":
    case "proxy": {
      // F-91/F-92: `crt proxy [target]` ≡ `crt serve --mode proxy [target]`; the same flags and steps.
      const positional = positionals[0];
      if (positional !== undefined && !looksLikeTarget(positional)) {
        throw new CrtError(`target "${positional}" is not a port, host:port or URL — try 3000, localhost:3000 or http://…`, 2);
      }
      if (positionals.length > 1) throw new CrtError(`unexpected argument "${positionals[1]}" — \`crt help\` lists commands`, 2);
      const { isInteractive, createTerminalPrompter } = await import("./prompt.js");
      const interactive = isInteractive({ yes: flags.yes === true });
      // §5.2: the browser opens by default on a terminal (`--no-open` suppresses) and only with `--open` otherwise.
      const open = flags["no-open"] === true ? false : flags.open === true || interactive;
      const { serve } = await import("./serve.js");
      const result = await serve({
        command,
        mode: stringFlag(flags.mode, "--mode <embedded|proxy>"),
        positional,
        target: stringFlag(flags.target, "--target <url>"),
        port: portFlag(flags.port),
        open,
        replace: flags.replace === true,
        provider: stringFlag(flags.provider, "--provider <id>"),
        interactive,
        ...(interactive ? { prompt: createTerminalPrompter({ input: process.stdin, output: process.stdout }) } : {}),
        overlayPath: fileURLToPath(new URL("./overlay.js", import.meta.url)),
        intakePromptPath: fileURLToPath(new URL("./intake.md", import.meta.url)),
      });
      if (result.kind === "reused") return 0;
      const { handle } = result;
      // F-77: Ctrl+C / SIGTERM close cleanly and exit 0; a second Ctrl+C within 2 s exits at once.
      let stopping = false;
      const stop = () => {
        if (stopping) process.exit(0);
        stopping = true;
        const n = handle.openSessions();
        console.log(`Stopping CRT … ${n} session${n === 1 ? "" : "s"} ended; written task files are kept.`);
        void handle.close().then(() => process.exit(0));
        setTimeout(() => process.exit(0), FORCE_EXIT_MS).unref();
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      return -1; // keep running
    }
    case "doctor": {
      const { runDoctor } = await import("./doctor.js");
      const r = await runDoctor({ version: packageVersion() });
      console.log(r.text);
      return r.exitCode;
    }
    case "setup": {
      // F-86: the marketplace built by F-85 sits next to cli.js in the published package.
      const { runSetup } = await import("./setup.js");
      const r = await runSetup({
        version: packageVersion(),
        marketplaceDir: resolve(fileURLToPath(new URL("./plugin-marketplace/", import.meta.url))),
        claude: stringFlag(flags.claude, "--claude <path>") ?? null,
      });
      for (const line of r.lines) console.log(line);
      return 0;
    }
    case "init": {
      const root = findProjectRoot();
      const r = initProject(root);
      console.log(describeInit(root, r) ?? `crt init: ${root} already initialised`);
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
      const { ProviderRegistry, renderProviders } = await import("./session.js");
      const providers = new ProviderRegistry({ root, config: readConfig(root) });
      await providers.refresh();
      if (flags.json === true) {
        console.log(JSON.stringify(providers.payload(), null, 2));
        return 0;
      }
      console.log(renderProviders(providers.status(), providers.detection()));
      return 0;
    }
    case "skills": {
      // F-58: the plugin's skills as Agent Skills for another agent; the sources ship in dist/skills.
      if (positionals[0] !== "install") throw new CrtError("usage: crt skills install [--provider <id>] [--global] [--dir <path>]", 2);
      const root = findProjectRoot();
      const dir = stringFlag(flags.dir, "--dir <path>") ?? null;
      const providerId = stringFlag(flags.provider, "--provider <id>");
      const { ProviderRegistry } = await import("./session.js");
      const { installSkills } = await import("./skills.js");
      const providers = new ProviderRegistry({ root, config: readConfig(root) });
      let profile = null;
      if (providerId) {
        profile = providers.get(providerId);
        if (!profile) throw new CrtError(`--provider must be one of ${providers.ids().join(", ")} (got "${providerId}")`);
      } else if (!dir) {
        // No --provider and no --dir: the provider the project resolves to (F-43 layers 3–6).
        profile = providers.get(providers.resolve(null).provider);
      }
      const r = installSkills({ sourceDir: fileURLToPath(new URL("./skills/", import.meta.url)), root, profile, global: flags.global === true, dir });
      for (const p of r.written) console.log(`crt skills: wrote ${p}`);
      console.log(r.written.length ? `crt skills: ${r.written.length} skill${r.written.length === 1 ? "" : "s"} installed in ${r.dir}` : `crt skills: ${r.dir} already up to date (${r.unchanged.length} skills)`);
      return 0;
    }
    default:
      console.log(USAGE);
      return 0;
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
