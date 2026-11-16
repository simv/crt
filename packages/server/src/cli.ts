#!/usr/bin/env node
/**
 * CRT command-line entry point.
 *
 * Commands (see docs/PRD.md §6, docs/PRD-providers.md §6, docs/PRD-setup.md §6.1, docs/PRD-embedded.md §6.1 and docs/PRD-zero.md §6.1):
 *   crt [target] [--port <n>] [--open|--no-open] [--yes] [--replace] [--provider <id>] [--review [name]]   F-69…F-73 (the guided start), embedded by default (F-91);
 *                                                                        a project that is not set up is reviewed as a guest (PRD-zero F-129)
 *   crt serve [target] [--target <url>] [--mode <embedded|proxy>] …      the same under its explicit name (F-1, F-5, F-43, F-91)
 *   crt proxy [target] …                                                 ≡ crt serve --mode proxy (F-92: the v0.3 reverse proxy)
 *   crt browse [target] …                                                PRD-zero F-128 (embedded, in a browser CRT launches: no integration in the app)
 *   crt doctor                                                           F-76
 *   crt setup [--claude <path>]                                          F-86 (registers the bundled plugin with Claude Code)
 *   crt init [--yes] [--no-instructions] [--snippet [--json]]              F-100 (explicit, itemised, idempotent; the F-101 section, the F-102 snippet)
 *   crt tasks [--json] [--review [name]]                                 F-33 (also refreshes the README index, F-34); PRD-zero F-134 (a review's items)
 *   crt task <ID> [--validate] [--review [name]]                         F-33 (F-32 format check); `R-NN` ids live in a review (PRD-zero F-134)
 *   crt review [--json] | crt review list | crt review new [name]       PRD-zero F-133 (the current review, every review, a new one)
 *   crt providers [--json] [--refresh]                                   F-45 (every provider's state + the F-44 decision)
 *   crt mcp                                                              F-49 (stdio write_task server; spawned by an agent, not by hand)
 *   crt skills install [--provider <id>] [--global] [--dir <path>]       F-58 (the plugin's skills as portable Agent Skills)
 *   crt help | --help | -h, crt --version                                F-69
 *
 * Every failure is one `crt: <message>` line on stderr and a non-zero exit (N-6). The server
 * and provider modules (and with them the Agent SDK) are imported only by the commands that
 * need them, so `crt mcp` starts fast and prints nothing but protocol frames on stdout.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";
import { readConfig } from "./config.js";
import { CrtError } from "./errors.js";
import { runInit } from "./init.js";
import { findProjectRoot } from "./project.js";
import { looksLikeTarget } from "./target.js";
import { findTaskFile, listTasks, TASK_ID_RE, validateTaskText, writeIndex } from "./tasks.js";
import { packageVersion } from "./version.js";

const USAGE = [
  "crt — Claude Review Tool",
  "",
  "Usage:",
  "  crt [target]            start the CRT server on http://localhost:4400 and open your app (embedded: the app loads the CRT loader)",
  "  crt serve [target]      the same, under its explicit name",
  "      [--mode <embedded|proxy>] [--target <url>] [--port <n>] [--open | --no-open] [--yes] [--replace] [--provider <id>] [--review [name]]",
  "  crt proxy [target]      proxy the dev server through http://localhost:4400 instead (the same flags; = crt serve --mode proxy)",
  "  crt browse [target]     the same server, with your app in a Chrome or Edge window CRT starts itself: nothing to add to the app",
  "      [--port <n>] [--no-open] [--yes] [--replace] [--provider <id>]",
  "  crt doctor              check node, project, .crt, mode, target, integration, instructions, port, providers, plugin",
  "  crt setup               register the bundled Claude Code plugin (/crt:serve, /crt:next, …) [--claude <path>]",
  "  crt init                set the project up: .crt/ (README, tasks, config), 2 .gitignore lines, a CRT section in CLAUDE.md — each announced — then the snippet for your framework",
  "      [--yes] [--no-instructions] [--snippet [--json]]",
  "  crt tasks [--json] [--review [name]]",
  "  crt task <ID> [--validate] [--review [name]]",
  "  crt review              the current review: its items, kept or dropped, and the totals [--json]",
  "  crt review list         every review of this project, with its status and counts",
  "  crt review new [name]   start a new review (named after today's date by default)",
  "  crt providers [--json] [--refresh]",
  "  crt mcp                 (stdio write_task server for agents; needs CRT_MCP_TOKEN and CRT_MCP_PORT)",
  "  crt --version",
  "",
  "A target is a port (3000), host:port (localhost:3000) or a URL. `crt` remembers the one you",
  "typed or picked in .crt/config.local.json; `crt <port>` switches it.",
  "",
  "In a project that is not set up (no .crt/tasks), CRT runs as a guest: feedback is kept in a review",
  "under ~/.crt (CRT_HOME) and nothing is written to the project; `crt init` adopts CRT in it.",
  "`--review` keeps a set-up project's feedback in a review too.",
].join("\n");

const COMMANDS = new Set(["serve", "proxy", "browse", "review", "doctor", "setup", "init", "tasks", "task", "providers", "mcp", "skills", "help"]);

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
    case "proxy":
    case "browse": {
      // F-91/F-92: `crt proxy [target]` ≡ `crt serve --mode proxy [target]`; the same flags and steps.
      // PRD-zero F-128: `crt browse [target]` ≡ `crt [target]` with the CRT browser forced.
      // PRD-zero F-129: `--review [name]`. `crt --review 3000` means the target 3000, not a review of that name.
      let review = flags.review;
      if (typeof review === "string" && positionals.length === 0 && looksLikeTarget(review)) {
        positionals = [review];
        review = true;
      }
      const positional = positionals[0];
      if (positional !== undefined && !looksLikeTarget(positional)) {
        throw new CrtError(`target "${positional}" is not a port, host:port or URL — try 3000, localhost:3000 or http://…`, 2);
      }
      if (positionals.length > 1) throw new CrtError(`unexpected argument "${positionals[1]}" — \`crt help\` lists commands`, 2);
      const { isInteractive, createTerminalPrompter } = await import("./prompt.js");
      const interactive = isInteractive({ yes: flags.yes === true });
      // §5.2: the browser opens by default on a terminal (`--no-open` suppresses) and only with `--open` otherwise.
      // `crt browse` names the browser it wants, so it opens it off a terminal too; `--no-open` never launches it (F-128).
      const open = flags["no-open"] === true ? false : flags.open === true || interactive || command === "browse";
      const { serve } = await import("./serve.js");
      const result = await serve({
        command,
        mode: stringFlag(flags.mode, "--mode <embedded|proxy>"),
        positional,
        target: stringFlag(flags.target, "--target <url>"),
        port: portFlag(flags.port),
        open,
        replace: flags.replace === true,
        yes: flags.yes === true,
        review: reviewFlag(review),
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
        // PRD-zero F-128: stopping CRT closes the CRT browser, and the line says so.
        console.log(`Stopping CRT … ${n} session${n === 1 ? "" : "s"} ended; ${handle.browser?.isOpen ? "the CRT browser was closed; " : ""}written task files are kept.`);
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
      // F-100: the plan, `Go ahead? [Y/n]` on a terminal without --yes (off a terminal it applies without asking:
      // the command is explicit), one line per write, then the F-102 snippet. The provider decides which file
      // to create when neither CLAUDE.md nor AGENTS.md exists (F-101): the F-43 resolution, as `crt providers`
      // gets it, resolved only then (preflight is the only spawn).
      const root = findProjectRoot();
      const { isInteractive, createTerminalPrompter } = await import("./prompt.js");
      const interactive = isInteractive({ yes: flags.yes === true });
      await runInit(root, {
        yes: flags.yes === true,
        instructions: flags["no-instructions"] !== true,
        snippet: flags.snippet === true,
        json: flags.json === true,
        interactive,
        ...(interactive ? { prompt: createTerminalPrompter({ input: process.stdin, output: process.stdout }) } : {}),
        version: packageVersion(),
        provider: async () => {
          const { ProviderRegistry } = await import("./session.js");
          const providers = new ProviderRegistry({ root, config: readConfig(root) });
          await providers.refresh();
          return providers.resolve(null).provider;
        },
        log: (line) => console.log(line),
      });
      return 0;
    }
    case "review": {
      // PRD-zero F-133: the forms that read and start reviews; the page is M30.
      const root = findProjectRoot();
      const { createReview, currentReview, listReviews, REVIEW_NAME_RE } = await import("./home.js");
      const { noReviewLine, renderReviewItems, reviewView, totalsLine } = await import("./review.js");
      const sub = positionals[0];
      if (sub === "new") {
        const name = positionals[1];
        if (name !== undefined && !REVIEW_NAME_RE.test(name)) throw new CrtError(`a review name is lower-case letters, digits and hyphens (got "${name}")`, 2);
        const { readGitRemote } = await import("./git-state.js");
        const { localIso } = await import("./tasks.js");
        // N-34: this command's whole job is to create under the home, and its one line says where.
        const review = createReview(root, name, { remote: readGitRemote(root), created: localIso() });
        console.log(`Review ${review.name} started in ${review.dir} — new feedback for ${root} goes there.`);
        return 0;
      }
      if (sub === "list") {
        const reviews = listReviews(root);
        if (!reviews.length) {
          console.log(noReviewLine(root));
          return 0;
        }
        const current = currentReview(root)?.name ?? null;
        const nameW = Math.max(...reviews.map((r) => r.name.length));
        for (const r of reviews) {
          const t = reviewView(r).totals;
          console.log(`${r.name.padEnd(nameW)}  ${r.manifest.status.padEnd(6)}  ${t.items} item${t.items === 1 ? "" : "s"}, ${t.kept} kept${r.name === current ? "  (current)" : ""}`);
        }
        return 0;
      }
      if (sub !== undefined) throw new CrtError("usage: crt review [--json] | crt review list | crt review new [name]", 2);
      const review = currentReview(root);
      if (flags.json === true) {
        console.log(JSON.stringify(review ? { review: review.name, ...reviewView(review) } : { review: null, items: [] }, null, 2));
        return 0;
      }
      if (!review) {
        console.log(noReviewLine(root));
        return 0;
      }
      const view = reviewView(review);
      for (const line of renderReviewItems(view)) console.log(line);
      console.log(`Review ${view.name}: ${totalsLine(view.totals)}`);
      return 0;
    }
    case "tasks": {
      const root = findProjectRoot();
      const tasksDir = await tasksDirFor(root, flags.review);
      if (tasksDir === null) {
        // PRD-zero F-134: no review yet is not an error either.
        const { noReviewLine } = await import("./review.js");
        console.log(flags.json === true ? JSON.stringify({ tasksDir: null, tasks: [] }, null, 2) : noReviewLine(root));
        return 0;
      }
      if (!existsSync(tasksDir)) {
        // F-99: an un-initialised project is not an error here.
        console.log(flags.json === true ? JSON.stringify({ tasksDir: null, tasks: [] }, null, 2) : "no tasks (CRT is not set up here — run crt init)");
        return 0;
      }
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
      if (!id || !TASK_ID_RE.test(id.toUpperCase())) throw new CrtError("usage: crt task <CRT-NNNN> [--validate], or crt task <R-NN> --review [name]", 2);
      // PRD-zero F-134: an `R-NN` id is a review's; `--review` reads the current (or the named) review.
      const tasksDir = await tasksDirFor(findProjectRoot(), flags.review);
      const file = tasksDir ? findTaskFile(tasksDir, id) : null;
      if (!file) throw new CrtError(flags.review === undefined ? `no task ${id.toUpperCase()} in .crt/tasks${/^R-/i.test(id) ? " — an R-NN id is in a review: add --review" : ""}` : `no task ${id.toUpperCase()} in ${tasksDir ?? "a review (there is none yet)"}`);
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

/** `--review [name]` as `serve()` takes it: absent, `true`, or a valid review name. */
function reviewFlag(value: string | boolean | undefined): boolean | string | undefined {
  if (value === undefined || value === true) return value;
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new CrtError(`--review takes a review name of lower-case letters, digits and hyphens (got "${String(value)}")`, 2);
  return value;
}

/**
 * The tasks directory `crt tasks` / `crt task` read: the project's, or — with `--review [name]`
 * (PRD-zero F-134) — the current (or the named) review's under the CRT home; null when there is no such review.
 */
async function tasksDirFor(root: string, review: string | boolean | undefined): Promise<string | null> {
  const flag = reviewFlag(review);
  if (flag === undefined) return tasksDirOf(root);
  const { currentReview, listReviews, reviewTasksDir } = await import("./home.js");
  const found = flag === true ? currentReview(root) : (listReviews(root).find((r) => r.name === flag) ?? null);
  return found ? reviewTasksDir(found.dir) : null;
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
