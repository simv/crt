/**
 * `crt [target]` / `crt serve [target]` / `crt proxy [target]` (PRD F-1, F-4, F-5, F-23, F-24,
 * N-6; PRD-providers F-43, F-44; PRD-setup F-70…F-75, F-78, F-79; PRD-embedded F-91…F-94, F-99):
 * preflight the providers and pick one, make sure the project is set up (start.ts
 * `ensureInitialised` — never silently: the F-100 plan and a question on a terminal, `--yes`
 * otherwise, else one refusal line; nothing here creates `.crt/`, N-19), prune stale captures
 * when `.crt/captures/` exists, resolve the mode
 * (init.ts `resolveMode`: `crt proxy` / `--mode` / config, default embedded), choose the target
 * (start.ts `chooseTarget` — in proxy mode found, remembered, asked for, or waited on; in
 * embedded mode the soft form: the app URL CRT opens, never waited for), wire the session
 * registry, bind the server to 127.0.0.1 (start.ts `bindPort` — reusing or stepping around a
 * stale CRT), print the ready line (F-93: mode, app, project, tasks, provider, login), and
 * optionally open the browser — the app's own URL in embedded mode (then arm the F-94 timer),
 * the CRT URL in proxy mode. Every failure surfaces as a CrtError with a single actionable line.
 *
 * The two guided steps are pure over `StartDeps`; this module supplies the real probes
 * (target.ts, probes.ts) and the prompter cli.ts chose (prompt.ts on a terminal, none otherwise).
 *
 * `CRT_SESSION_STUB=1` selects the `stub` provider ahead of every other resolution step (tests
 * only). `CRT_BROWSER=<command>` replaces the platform opener (tests only: the e2e "opens" the app
 * with a command that does nothing, so the F-94 timer can be observed without a real browser).
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { relative, resolve } from "node:path";
import { capturesDir, pruneCaptures } from "./captures.js";
import { collectDoctorFacts, doctorRows, hasDevScript, renderRow } from "./doctor.js";
import { CrtError } from "./errors.js";
import { applyInit, type CrtMode, isInitialised, planInit, readConfig, renderPlan, resolveMode, writeLocalConfig } from "./init.js";
import { fetchHealth, isPortFree, requestShutdown } from "./probes.js";
import { findProjectRoot } from "./project.js";
import { createProxyServer, type CrtServer } from "./proxy.js";
import { describeResolution, loginField, ProviderRegistry } from "./session.js";
import { SessionRegistry } from "./sessions.js";
import { bindPort, chooseTarget, type CrtHealth, ensureInitialised, type Prompter, type StartDeps } from "./start.js";
import { countTaskFiles, parseFrontmatter } from "./tasks.js";
import { isReachable, normalizeTarget, PROBE_PORTS, probeAll } from "./target.js";
import { packageVersion } from "./version.js";

export interface ServeOptions {
  /** Launch directory; the project root is found from here. */
  cwd?: string;
  /** `crt proxy` is `--mode proxy` (F-92); default `serve`. */
  command?: "serve" | "proxy";
  /** `--mode <embedded|proxy>`: outranks the config files (F-91). */
  mode?: string | undefined;
  /** `--target` value, if given — the scripting form, never remembered (F-72). */
  target?: string | undefined;
  /** The positional target (`crt 3100`), remembered once it responds (F-69, F-72). */
  positional?: string | undefined;
  /** `--port` value; falls back to config (local over project) then 4400. Never stepped around (F-73). */
  port?: number | undefined;
  /** `--open`: launch the default browser on the CRT URL. */
  open?: boolean;
  /** `--provider <id>`: the active provider (F-43 step 2); else `CRT_PROVIDER`, config, detection. */
  provider?: string | undefined;
  /** `--replace`: stop a CRT holding the port (F-79). */
  replace?: boolean;
  /** `--yes`: set up an un-initialised project without asking (PRD-embedded F-99). Default false. */
  yes?: boolean;
  /** PRD-setup §5.2: may ask on the terminal; requires `prompt`. Default false. */
  interactive?: boolean;
  prompt?: Prompter;
  /** Absolute path of dist/overlay.js. */
  overlayPath: string;
  /** Absolute path of the intake instructions (a copy of plugin/skills/intake/SKILL.md). */
  intakePromptPath: string;
  /** Where status lines go (stdout by default). */
  log?: (line: string) => void;
  /** This package's version (health, reuse comparison); read from package.json by default. */
  version?: string;
  /** Probe overrides (tests). */
  deps?: Partial<StartDeps>;
}

export interface ServeHandle {
  server: Server;
  url: string;
  mode: CrtMode;
  /** The app URL; null in embedded mode when none was found (F-91). */
  target: string | null;
  projectRoot: string;
  /** The provider new sessions use, as printed on the ready line. */
  provider: string;
  providers: ProviderRegistry;
  /** Intake sessions still open (the F-77 stop line counts them). */
  openSessions(): number;
  close(): Promise<void>;
}

/** `serving` holds the server; `reused` means another CRT already serves this project in this mode (F-73, F-93) — exit 0. */
export type ServeResult = { kind: "serving"; handle: ServeHandle } | { kind: "reused"; url: string; target: string | null; projectRoot: string; health: CrtHealth };

const NO_PROMPT: Prompter = {
  ask: () => Promise.reject(new Error("prompted on a non-interactive run")),
  waitFor: () => Promise.reject(new Error("prompted on a non-interactive run")),
};

export async function serve(opts: ServeOptions): Promise<ServeResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const interactive = opts.interactive === true;
  const version = opts.version ?? packageVersion();
  const projectRoot = findProjectRoot(opts.cwd ?? process.cwd());
  const prompt = opts.prompt ?? NO_PROMPT;

  // Read before init: `readConfig` tolerates an absent `.crt/` (defaults), and `crt init` never changes what it would read here.
  const config = readConfig(projectRoot);
  const port = opts.port ?? config.port;
  // F-91/F-92: `crt proxy` > `--mode` > config.local.json > config.json > embedded.
  const mode = resolveMode({ command: opts.command ?? "serve", flag: opts.mode, config });

  // F-43/F-44: preflight every provider once, detect, and validate an explicit --provider / CRT_PROVIDER.
  // Before the target step, so the F-76 rows before a prompt can name a provider's problem.
  const providers = new ProviderRegistry({ root: projectRoot, config, flag: opts.provider ?? null, log });
  const named = opts.provider ?? process.env.CRT_PROVIDER?.trim();
  if (named && !providers.ids().includes(named)) {
    throw new CrtError(`${opts.provider ? "--provider" : "CRT_PROVIDER"} must be one of ${providers.ids().join(", ")} (got "${named}")`);
  }
  await providers.refresh();
  const resolution = providers.resolve(null);

  // F-99: never create `.crt/` silently — the F-100 plan and a question, or `--yes`, or one refusal line.
  let plan: Awaited<ReturnType<typeof planInit>> | null = null;
  await ensureInitialised(
    { initialised: isInitialised(projectRoot), root: projectRoot, yes: opts.yes === true },
    {
      interactive,
      log,
      prompt,
      plan: async () => renderPlan((plan = await planInit(projectRoot, { instructions: true, version, provider: async () => resolution.provider }))),
      apply: async () => applyInit(plan!, { version, log }),
    },
  );
  if (existsSync(capturesDir(projectRoot))) {
    const pruned = pruneCaptures(projectRoot);
    if (pruned.length) log(`crt: pruned ${pruned.length} capture${pruned.length === 1 ? "" : "s"} older than 7 days`);
  }

  let server: CrtServer | null = null;
  let warned = false;
  const deps: StartDeps = {
    interactive,
    log,
    prompt,
    isReachable: (origin) => isReachable(origin),
    probeAll: () => probeAll(),
    health: (p) => fetchHealth(p),
    isFree: (p) => isPortFree(p),
    listen: (p) => {
      if (!server) throw new Error("listen before the server exists");
      return listen(server, p);
    },
    replace: (p) => requestShutdown(p),
    beforePrompt: async () => {
      // F-76: only FAIL/warn rows, once, before the first question (no target row — that is the question; no plugin row — never spawn `claude` here).
      if (warned) return;
      warned = true;
      const report = doctorRows(await collectDoctorFacts({ cwd: projectRoot, version, target: false, plugin: false, providers, mode }));
      for (const row of report.rows) if (row.status === "FAIL" || row.status === "warn") log(renderRow(row));
    },
    ...opts.deps,
  };

  const chosen = await chooseTarget(
    {
      positional: opts.positional ?? null,
      flag: opts.target ?? null,
      config: { target: config.target, source: config.targetSource },
      hasDevScript: hasDevScript(projectRoot),
      ports: PROBE_PORTS,
      required: mode === "proxy", // F-91: embedded mode never waits and never fails
    },
    deps,
  );
  const target = chosen.origin;
  if (mode === "proxy" && target === null) throw new Error("proxy mode resolved no target"); // unreachable: the required form always answers or throws
  if (target && chosen.remember && !(config.targetSource === "local" && safeOrigin(config.target) === target)) {
    // F-72: typed, picked or positional targets are remembered per machine once they responded.
    writeLocalConfig(projectRoot, { target });
    log(`Remembered ${target} in .crt/config.local.json — \`crt <port>\` switches.`);
  }
  /** F-91: the app URL to open — known and responding. */
  const app = chosen.down ? null : target;

  const tasksDir = resolve(projectRoot, config.tasksDir);
  const sessions = new SessionRegistry({
    projectRoot,
    tasksDir,
    intakePrompt: loadIntakePrompt(opts.intakePromptPath),
    providers,
    port, // F-49: where `crt mcp` posts write_task back to; corrected below if the port was stepped
    log,
  });
  const close = (): Promise<void> =>
    new Promise<void>((done) => {
      sessions.closeAll();
      if (!server) return done();
      server.closeAllConnections();
      server.close(() => done());
    });
  server = createProxyServer({
    target,
    mode,
    projectRoot,
    overlayPath: opts.overlayPath,
    sessions,
    providers,
    version,
    startedAt: new Date().toISOString(),
    tasksDir,
    shutdown: close,
    log,
  });

  const bound = await bindPort(
    { port, explicit: opts.port !== undefined, replace: opts.replace === true, projectRoot, target, version, open: opts.open === true, mode },
    deps,
  );
  if (bound.kind === "reused") {
    // F-93: embedded mode opens the app (this run's, else the running server's); proxy mode opens the CRT URL.
    const toOpen = mode === "embedded" ? (app ?? bound.health.target) : bound.url;
    if (opts.open && toOpen) openBrowser(toOpen, log);
    return { kind: "reused", url: bound.url, target, projectRoot, health: bound.health };
  }
  sessions.mcpPort = bound.port;

  const url = `http://localhost:${bound.port}`;
  const tasks = countTaskFiles(tasksDir);
  const login = loginField(resolution, providers);
  const tasksLabel = relative(projectRoot, tasksDir) || ".";
  const details = `project: ${projectRoot}, ${tasks} task${tasks === 1 ? "" : "s"} in ${tasksLabel}, provider: ${describeResolution(resolution)}, login: ${login}`;
  // F-93: `CRT ready at <url> for <app> (embedded; …)` / `CRT ready at <url> → <target> (proxy; …)`.
  log(mode === "embedded" ? `CRT ready at ${url}${target ? ` for ${target}` : ""} (embedded; ${details})` : `CRT ready at ${url} → ${target} (proxy; ${details})`);
  if (mode === "embedded" && bound.port !== port) {
    // F-93: a stepped port (F-73) leaves the app's loader pointing at the configured one.
    log(`crt: your app's CRT loader expects :${port} — run \`crt --replace\`, or set port in .crt/config.json and in the snippet`);
  }
  if (login === "missing") {
    // F-74: the N-6 line at start, before anyone writes a note.
    const problem = providers.preflight(resolution.provider).problem;
    if (problem) log(`crt: ${problem}`);
  } else if (interactive) {
    const where = mode === "embedded" ? (app ? `Open ${app}` : "Open your dev server in the browser") : `Open ${url}`;
    log(`${where} → CRT button bottom-right (Ctrl/Cmd+Shift+.) → Select · note · Send. Ctrl+C stops CRT; your dev server keeps running.`);
  }
  if (opts.open) {
    if (mode === "proxy") openBrowser(url, log);
    else if (app) {
      // F-91: embedded mode opens the app's own URL (nothing when none is known); F-94 watches for the loader.
      openBrowser(app, log);
      server.browserOpened(app);
    }
  }

  return {
    kind: "serving",
    handle: {
      server,
      url,
      mode,
      target,
      projectRoot,
      provider: resolution.provider,
      providers,
      openSessions: () => sessions.list().filter((s) => s.state !== "ended" && s.state !== "error").length,
      close,
    },
  };
}

function safeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return normalizeTarget(value);
  } catch {
    return null;
  }
}

/**
 * F-24/F-39: the intake instructions are the body of `plugin/skills/intake/SKILL.md` (below its
 * frontmatter), copied into dist/ at build time so the published package carries them.
 */
export function loadIntakePrompt(path: string): string {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new CrtError(`intake instructions missing at ${path} — run npm run build`);
  }
  const fm = parseFrontmatter(text);
  return (fm ? fm.body : text).trim();
}

/** Bind on 127.0.0.1; `in-use` lets start.ts diagnose the port (F-73), any other error is fatal. */
function listen(server: Server, port: number): Promise<"ok" | "in-use"> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      if (err.code === "EADDRINUSE") resolve("in-use");
      else reject(new CrtError(`cannot listen on 127.0.0.1:${port} (${err.code ?? err.message})`));
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve("ok");
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

/** Open `url` in the default browser via the platform opener (or `CRT_BROWSER`, a test seam), spawned without a shell. */
export function openBrowser(url: string, log: (line: string) => void): void {
  const custom = process.env.CRT_BROWSER?.trim();
  const [cmd, args]: [string, string[]] = custom
    ? [custom, [url]]
    : process.platform === "win32"
      ? ["cmd.exe", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(cmd, args, { shell: false, stdio: "ignore", detached: true, windowsHide: true });
  child.on("error", (err) => log(`crt: could not open browser (${err.message}); open ${url} yourself`));
  child.unref();
}
