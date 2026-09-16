/**
 * The guided start (PRD-setup §5.1, §5.2, F-70…F-73, F-79): the two steps of `crt [target]`
 * that may *ask* instead of fail — which dev server to proxy, and what to do when the port is
 * held — as pure functions over injected probes and a prompter, so every transcript in
 * PRD-setup §6.1 is a unit-test row (test/start.test.ts) and `serve.ts` only wires the real
 * `isReachable`, `probeAll`, `health`, `listen` and the readline prompter (prompt.ts) to them.
 *
 * Interactive iff `deps.interactive` (a TTY on stdin and stdout, `CI` unset, no `--yes` — decided
 * in cli.ts). Non-interactive runs never call `prompt`: every question collapses to its default
 * or to one `crt:` line, so the plugin skills (background Bash) and the e2e fixture see today's
 * F-36/N-6 contracts unchanged.
 */
import { CrtError } from "./errors.js";
import { normalizeTarget, parseTargetAnswer, type ProbeHit, shortTarget } from "./target.js";

/** What `GET /__crt/health` on a busy port told us (F-73); null when the occupant is not a CRT. */
export interface CrtHealth {
  version: string | null;
  startedAt: string | null;
  target: string;
  projectRoot: string;
  sessions: number;
}

export type WaitOutcome = { kind: "ready" } | { kind: "answer"; text: string };

/** The terminal side of a prompt (prompt.ts); tests script it. */
export interface Prompter {
  /** Print `question`, return the trimmed answer ("" for Enter alone). Ctrl+C throws `CrtError("cancelled", 130)` (F-77). */
  ask(question: string): Promise<string>;
  /**
   * F-71 wait loop: print `line`, then return `ready` as soon as `check` answers true (polled every
   * 2 s) or `answer` when the developer presses Enter (retry, "") or types something else.
   */
  waitFor(line: string, check: () => Promise<boolean>): Promise<WaitOutcome>;
}

export interface StartDeps {
  interactive: boolean;
  log(line: string): void;
  prompt: Prompter;
  isReachable(origin: string): Promise<boolean>;
  /** Every responder on the well-known ports, in probe order (target.ts `probeAll`). */
  probeAll(): Promise<ProbeHit[]>;
  /** `GET /__crt/health` on the port, 1 s, retried once; null when it is not a CRT (F-73). */
  health(port: number): Promise<CrtHealth | null>;
  /** Can this port be bound right now? (a throwaway bind, released at once) */
  isFree(port: number): Promise<boolean>;
  /** Bind the real server; `in-use` on EADDRINUSE. Called until it answers `ok`, never after. */
  listen(port: number): Promise<"ok" | "in-use">;
  /** F-79: `POST /__crt/internal/shutdown` on the port, then wait up to 5 s for it to free up. */
  replace(port: number): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** F-76: called before every prompt; serve.ts prints the FAIL/warn doctor rows once. */
  beforePrompt?(): Promise<void>;
}

// ---- target (F-71, F-72) --------------------------------------------------------------------------

export interface TargetInput {
  /** `crt 3100` — remembered once it responds (F-72). */
  positional: string | null;
  /** `--target <url>` — the scripting form; never remembered. */
  flag: string | null;
  /** `readConfig().target` and where it came from (local wins). */
  config: { target: string | null; source: "local" | "project" | null };
  /** Root `package.json` has `scripts.dev` (the F-71 hint). */
  hasDevScript: boolean;
  ports: readonly number[];
}

export type TargetSource = "positional" | "flag" | "local" | "project" | "probe" | "picked" | "typed" | "alternative";

export interface TargetOutcome {
  origin: string;
  source: TargetSource;
  /** F-72: write it to `.crt/config.local.json` (positional, picked from the list, typed at a prompt). */
  remember: boolean;
}

const INVALID_ANSWER = (text: string) => `"${text}" is not a URL or port — try 3000, localhost:3000 or http://…`;
const WAIT_LINE = (origin: string) => `${origin} is not responding yet — start it, then press Enter to retry (type another URL to change, Ctrl+C to quit)`;

export async function chooseTarget(input: TargetInput, deps: StartDeps): Promise<TargetOutcome> {
  const explicit: { value: string; source: TargetSource } | null = input.positional
    ? { value: input.positional, source: "positional" }
    : input.flag
      ? { value: input.flag, source: "flag" }
      : input.config.target && input.config.source
        ? { value: input.config.target, source: input.config.source }
        : null;

  if (explicit) {
    const origin = normalizeTarget(explicit.value);
    const remember = explicit.source === "positional";
    if (await deps.isReachable(origin)) return { origin, source: explicit.source, remember };
    if (!deps.interactive) throw new CrtError(`target ${origin} is not responding — start your dev server there, or run \`crt <port>\``);
    await deps.beforePrompt?.();
    const other = (await deps.probeAll()).find((h) => h.origin !== origin);
    if (other) {
      const suffix = explicit.source === "local" ? " (remembered)" : explicit.source === "project" ? " (.crt/config.json)" : "";
      const answer = await deps.prompt.ask(`${origin}${suffix} is not responding, but ${other.origin} is. Use ${shortTarget(other.origin)}? [Y/n]`);
      // F-72: a Y here is not remembered — the remembered value stays; `crt <port>` switches it.
      if (isYes(answer)) return { origin: other.origin, source: "alternative", remember: false };
    }
    return waitUntilUp(origin, explicit.source, remember, deps);
  }

  const hits = await deps.probeAll();
  if (hits.length === 1) {
    deps.log(`Found ${hits[0]!.origin}.`);
    return { origin: hits[0]!.origin, source: "probe", remember: false };
  }
  if (hits.length > 1) {
    if (!deps.interactive) {
      deps.log(`crt: found ${hits.length} dev servers (${hits.map((h) => h.origin).join(", ")}); using ${hits[0]!.origin} — run \`crt <port>\` to pick another`);
      return { origin: hits[0]!.origin, source: "probe", remember: false };
    }
    await deps.beforePrompt?.();
    deps.log(`Found ${hits.length} dev servers:`);
    hits.forEach((h, i) => deps.log(`  ${i + 1}) ${h.origin}${h.label ? ` — ${h.label}` : ""}`));
    for (;;) {
      const answer = await deps.prompt.ask("Which one? [1]");
      const n = answer === "" ? 1 : /^\d+$/.test(answer) ? Number(answer) : NaN;
      if (n >= 1 && n <= hits.length) return { origin: hits[n - 1]!.origin, source: "picked", remember: true };
      deps.log(`Answer 1–${hits.length}.`);
    }
  }

  const ports = input.ports.join(", ");
  if (!deps.interactive) throw new CrtError(`no dev server found on ports ${ports} — start it, or run \`crt <port>\``);
  await deps.beforePrompt?.();
  deps.log(`No dev server on ports ${ports}.`);
  if (input.hasDevScript) deps.log("(This project has `npm run dev`.)");
  const origin = await askForTarget(deps);
  if (await deps.isReachable(origin)) return { origin, source: "typed", remember: true };
  return waitUntilUp(origin, "typed", true, deps);
}

/** `Dev server URL or port:` with validation; an empty answer re-prompts. */
async function askForTarget(deps: StartDeps): Promise<string> {
  for (;;) {
    const answer = await deps.prompt.ask("Dev server URL or port:");
    if (answer === "") continue;
    const origin = parseTargetAnswer(answer);
    if (origin) return origin;
    deps.log(INVALID_ANSWER(answer));
  }
}

/** The F-71 wait loop: re-probe every 2 s, Enter retries, another URL switches (and is then remembered). */
async function waitUntilUp(origin: string, source: TargetSource, remember: boolean, deps: StartDeps): Promise<TargetOutcome> {
  for (;;) {
    const r = await deps.prompt.waitFor(WAIT_LINE(origin), () => deps.isReachable(origin));
    if (r.kind === "ready") return { origin, source, remember };
    if (r.text !== "") {
      const next = parseTargetAnswer(r.text);
      if (!next) {
        deps.log(INVALID_ANSWER(r.text));
        continue;
      }
      origin = next;
      source = "typed";
      remember = true;
    }
    if (await deps.isReachable(origin)) return { origin, source, remember };
  }
}

// ---- port (F-73, F-79) ----------------------------------------------------------------------------

/** How far past the configured port a fallback may go (4401…4409 for 4400). */
export const PORT_STEPS = 9;

export interface PortInput {
  port: number;
  /** `--port <n>` was given: never stepped around (F-73). */
  explicit: boolean;
  /** `--replace`: stop whatever CRT holds the port (F-79). */
  replace: boolean;
  projectRoot: string;
  target: string;
  /** This package's version, compared with the occupant's. */
  version: string;
  /** Whether the caller will open the browser (the reuse line says so). */
  open: boolean;
}

export type PortOutcome =
  | { kind: "bound"; port: number }
  /** Another CRT already serves this project and target on the port: exit 0 after opening (F-73). */
  | { kind: "reused"; port: number; url: string; health: CrtHealth };

export async function bindPort(input: PortInput, deps: StartDeps): Promise<PortOutcome> {
  const { port } = input;
  if ((await deps.listen(port)) === "ok") return { kind: "bound", port };
  const h = await deps.health(port);
  const url = `http://localhost:${port}`;

  if (h && input.replace) return replaceAndBind(port, h, deps);

  if (h && sameProject(h.projectRoot, input.projectRoot) && h.target === input.target) {
    const version = h.version ?? "(unknown version)";
    if (h.version !== input.version && deps.interactive) {
      await deps.beforePrompt?.();
      const answer = await deps.prompt.ask(`That is CRT ${version}; this is ${input.version}. Replace it? [Y/n]`);
      if (isYes(answer)) return replaceAndBind(port, h, deps);
    }
    deps.log(`CRT ${version} is already serving ${h.target} for this project at ${url}${since(h)} — ${input.open ? "opened it" : "open it in your browser"}.`);
    if (h.version !== input.version && !deps.interactive) deps.log(`crt: that is CRT ${version}, this is ${input.version} — run \`crt --replace\` to swap it`);
    return { kind: "reused", port, url, health: h };
  }

  if (input.explicit) {
    // F-73: an explicit --port is never stepped around; the F-1 line, extended with what health found.
    const who = h ? `by CRT ${h.version ?? "(unknown version)"} (→ ${h.target}, project ${h.projectRoot})` : "by a process that is not CRT";
    throw new CrtError(`port ${port} is already in use ${who} — stop the other process${h ? ", run \`crt --replace\`," : ""} or pass --port <n>`);
  }

  if (h) {
    if (!deps.interactive) {
      const bound = await stepPorts(port, deps);
      deps.log(`crt: port ${port} is held by another CRT (→ ${h.target}, project ${h.projectRoot}); using ${bound}`);
      return { kind: "bound", port: bound };
    }
    await deps.beforePrompt?.();
    deps.log(`Port ${port} is held by another CRT: → ${h.target}, project ${h.projectRoot}${since(h, ", since ")}, ${h.sessions} session${h.sessions === 1 ? "" : "s"} open.`);
    const next = await nextFreePort(port, deps);
    deps.log(`1) Start this one on ${next}  2) Replace it  3) Quit`);
    for (;;) {
      const answer = await deps.prompt.ask("Which? [1]");
      if (answer === "" || answer === "1") return { kind: "bound", port: await stepPorts(port, deps) };
      if (answer === "2") return replaceAndBind(port, h, deps);
      if (answer === "3") throw new CrtError("cancelled", 130);
      deps.log("Answer 1, 2 or 3.");
    }
  }

  if (!deps.interactive) {
    const bound = await stepPorts(port, deps);
    deps.log(`crt: port ${port} is in use by a process that is not CRT; using ${bound}`);
    return { kind: "bound", port: bound };
  }
  await deps.beforePrompt?.();
  const next = await nextFreePort(port, deps);
  const answer = await deps.prompt.ask(`Port ${port} is in use by something that is not CRT. Start on ${next} instead? [Y/n]`);
  if (!isYes(answer)) throw new CrtError(`port ${port} is in use by a process that is not CRT — stop it, or run \`crt --port ${next}\``);
  return { kind: "bound", port: await stepPorts(port, deps) };
}

/** F-79: stop the CRT on `port`, wait for it, bind. */
async function replaceAndBind(port: number, h: CrtHealth, deps: StartDeps): Promise<PortOutcome> {
  const fix = `stop it yourself, or run \`crt --port ${port + 1}\``;
  const r = await deps.replace(port);
  if (!r.ok) throw new CrtError(`could not stop the CRT on port ${port} (${r.reason}) — ${fix}`);
  if ((await deps.listen(port)) !== "ok") throw new CrtError(`could not stop the CRT on port ${port} (still listening after 5 s) — ${fix}`);
  deps.log(`Stopped CRT ${h.version ?? "(unknown version)"} on port ${port}.`);
  return { kind: "bound", port };
}

/** Bind the first free port in `port+1 … port+PORT_STEPS`. */
async function stepPorts(port: number, deps: StartDeps): Promise<number> {
  for (let p = port + 1; p <= port + PORT_STEPS; p++) {
    if ((await deps.listen(p)) === "ok") return p;
  }
  throw new CrtError(`ports ${port}–${port + PORT_STEPS} are all in use — run \`crt --port <n>\``);
}

/** The port the "Start this one on N" option names; `port+1` when nothing in range is free (stepPorts then fails). */
async function nextFreePort(port: number, deps: StartDeps): Promise<number> {
  for (let p = port + 1; p <= port + PORT_STEPS; p++) {
    if (await deps.isFree(p)) return p;
  }
  return port + 1;
}

/** Two project roots name the same directory (case-insensitive on Windows, trailing separators ignored). */
export function sameProject(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const norm = (p: string) => {
    const t = p.replace(/[\\/]+$/, "");
    return platform === "win32" ? t.toLowerCase().split("/").join("\\") : t;
  };
  return norm(a) === norm(b);
}

/** ` (since 09:12)` from health's `startedAt` in local time; "" when unknown. */
export function since(h: Pick<CrtHealth, "startedAt">, prefix = " (since ", suffix = prefix.startsWith(" (") ? ")" : ""): string {
  if (!h.startedAt) return "";
  const d = new Date(h.startedAt);
  if (Number.isNaN(d.getTime())) return "";
  return `${prefix}${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}${suffix}`;
}

/** `[Y/n]`: Enter, y, yes (any case) are yes. */
export function isYes(answer: string): boolean {
  return answer === "" || /^y(es)?$/i.test(answer.trim());
}
