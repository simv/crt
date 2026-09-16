/**
 * Provider registry (PRD-providers §5, F-42…F-45): which coding agent an intake session runs on.
 *
 * The drivers live under `providers/` (`claude.ts` on the Agent SDK, `stub.ts` scripted,
 * `codex.ts` over `codex exec --json`); this module knows them only as `ProviderProfile`s:
 *
 *   • `listProviders()` — the built-in profiles; `stub` only with `CRT_SESSION_STUB=1` (F-42).
 *   • `ProviderRegistry.resolve()` — the F-43 order: stub env → request body → the server's
 *     active provider (`--provider`, `CRT_PROVIDER`, replaced by `PUT /__crt/config`) →
 *     `.crt/config.local.json` → `.crt/config.json` → auto-detection (F-44) → `claude`. An
 *     explicit choice that fails preflight is never replaced: the caller fails the session with
 *     the profile's one-line problem (N-7).
 *   • `renderProviders()` — the `crt providers` table (F-45) and its `--json` payload (F-57).
 *
 * Preflight results are cached per registry (`refresh()` re-runs them: server start, `--refresh`).
 */
import { type CrtConfig, DEFAULT_CONFIG, LOCAL_CONFIG_FILE, CONFIG_FILE } from "./init.js";
import { claudeProfile } from "./providers/claude.js";
import { codexProfile } from "./providers/codex.js";
import { type Decision, DEFAULT_PROVIDER, detectProvider, formatDecision, scanMarkers } from "./providers/detect.js";
import { stubProfile } from "./providers/stub.js";
import { type LoggedIn, type PreflightResult, preflightPasses, preflightState, type ProviderProfile, type ProviderState } from "./providers/types.js";
import type { ProviderCapabilities, ProvidersPayload } from "./session-events.js";

export { DEFAULT_PROVIDER, formatDecision } from "./providers/detect.js";
export type { Decision } from "./providers/detect.js";
export type { ProviderProfile } from "./providers/types.js";

/** Registry order; `crt providers` prints rows in this order. `stub` is appended only when enabled. */
export const BUILT_IN_PROFILES: readonly ProviderProfile[] = [claudeProfile, codexProfile];

/** `CRT_SESSION_STUB=1` (any non-empty value, as v0.1 read it) enables the scripted provider. */
export function stubEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CRT_SESSION_STUB);
}

/**
 * F-42: the profiles a developer may pick from — never `stub` unless `CRT_SESSION_STUB` is set.
 * A `stub` in `profiles` (a test's variant, `makeStubProfile`) replaces the module's own.
 */
export function listProviders(env: NodeJS.ProcessEnv = process.env, profiles: readonly ProviderProfile[] = BUILT_IN_PROFILES): ProviderProfile[] {
  const visible = profiles.filter((p) => p.id !== stubProfile.id);
  return stubEnabled(env) ? [...visible, profiles.find((p) => p.id === stubProfile.id) ?? stubProfile] : visible;
}

export type ResolutionLayer = "stub" | "request" | "active" | "local" | "project" | "detected" | "default";

export interface Resolution {
  /** Profile id; when `problem` is set the id is what was asked for, not something usable. */
  provider: string;
  layer: ResolutionLayer;
  /** What chose it: `CRT_SESSION_STUB`, `request`, `--provider`, `CRT_PROVIDER`, `PUT /__crt/config`, a config file, or the F-44 reason. */
  source: string;
  /** F-44 decision when `layer` is `detected`/`default`. */
  decision: Decision | null;
  /** N-7 line when an explicit choice cannot be used; the session must fail with it. */
  problem: string | null;
}

/** One row of `crt providers` / `GET /__crt/providers` (F-45, F-57). */
export interface ProviderStatus {
  id: string;
  displayName: string;
  agentName: string;
  installed: boolean;
  loggedIn: LoggedIn;
  version: string | null;
  problem: string | null;
  /** F-44 markers found in the project root. */
  markers: string[];
  capabilities: ProviderCapabilities;
  state: ProviderState;
  hints: ProviderProfile["hints"];
}

export interface ProviderRegistryOptions {
  /** Project root (marker scan). */
  root: string;
  env?: NodeJS.ProcessEnv;
  /** Merged config (`readConfig`); layers 3–4 and `providers.<id>.command`. */
  config?: CrtConfig;
  /** `--provider` from the command line (F-43 step 2, first source). */
  flag?: string | null;
  /** Profiles to use instead of the built-ins (tests). `stub` is still gated by the env. */
  profiles?: readonly ProviderProfile[];
  log?: (line: string) => void;
}

const FAILED: PreflightResult = { installed: false, loggedIn: "unknown", version: null, problem: "preflight has not run" };

export class ProviderRegistry {
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;
  readonly config: CrtConfig;
  private readonly profiles: readonly ProviderProfile[];
  private readonly preflights = new Map<string, PreflightResult>();
  private active: { id: string; source: string } | null;
  private detected: Decision | null = null;
  private readonly log: (line: string) => void;

  constructor(opts: ProviderRegistryOptions) {
    this.root = opts.root;
    this.env = opts.env ?? process.env;
    // Own copy of the model map: `setModels()` (PUT /__crt/config) must never touch DEFAULT_CONFIG.
    const config = opts.config ?? DEFAULT_CONFIG;
    this.config = { ...config, models: { ...config.models } };
    this.profiles = opts.profiles ?? BUILT_IN_PROFILES;
    this.log = opts.log ?? (() => undefined);
    const fromEnv = this.env.CRT_PROVIDER?.trim();
    this.active = opts.flag ? { id: opts.flag, source: "--provider" } : fromEnv ? { id: fromEnv, source: "CRT_PROVIDER" } : null;
  }

  /** F-42: profiles a session may run on (stub only when enabled). */
  list(): ProviderProfile[] {
    return listProviders(this.env, this.profiles);
  }

  get(id: string): ProviderProfile | null {
    return this.list().find((p) => p.id === id) ?? null;
  }

  /** Ids `--provider`, `CRT_PROVIDER`, the config files and the routes may name. */
  ids(): string[] {
    return this.list().map((p) => p.id);
  }

  /** F-44/F-45: run every listed profile's preflight (in parallel) and recompute the detection. */
  async refresh(): Promise<void> {
    await Promise.all(
      this.list().map(async (p) => {
        const command = this.config.providers[p.id]?.command ?? null;
        let result: PreflightResult;
        try {
          result = await p.preflight({ command, env: this.env });
        } catch (err) {
          result = { installed: false, loggedIn: "unknown", version: null, problem: `${p.id} preflight failed: ${(err as Error).message}` };
        }
        this.preflights.set(p.id, result);
      }),
    );
    this.detected = detectProvider({
      root: this.root,
      env: this.env,
      profiles: this.list().filter((p) => p.id !== stubProfile.id),
      preflights: Object.fromEntries(this.preflights),
    });
  }

  /** Cached preflight; failing until `refresh()` has run. */
  preflight(id: string): PreflightResult {
    return this.preflights.get(id) ?? FAILED;
  }

  /** The F-44 decision from the last `refresh()`; computed on demand if none ran (every preflight then fails). */
  detection(): Decision {
    if (!this.detected) {
      this.detected = detectProvider({ root: this.root, env: this.env, profiles: this.list().filter((p) => p.id !== stubProfile.id), preflights: Object.fromEntries(this.preflights) });
    }
    return this.detected;
  }

  /**
   * F-43 step 2 / F-57: `PUT /__crt/config { provider }` replaces the active provider for the
   * life of the process, so "Remember" is never silently outranked by a flag. Only a listed
   * string id whose preflight passes is accepted.
   */
  setActive(id: unknown, source = "PUT /__crt/config"): { ok: true } | { ok: false; error: string } {
    const check = this.usable(id);
    if (check.problem) return { ok: false, error: check.problem };
    this.active = { id: check.id, source };
    this.log(`crt: active provider is now ${check.id} (${source})`);
    return { ok: true };
  }

  /**
   * F-57 `PUT /__crt/config { models }`: the per-provider model map for new sessions, layered over
   * what the config files said (the route has already written the local file).
   */
  setModels(models: Record<string, string>): void {
    Object.assign(this.config.models, models);
  }

  /** The model the developer chose for a provider (`models.<id>` in config, F-57), or null. */
  modelFor(id: string): string | null {
    return this.config.models[id] ?? null;
  }

  /** F-57: is `id` a listed string id whose preflight passes? The error is the N-7 line to answer with. */
  check(id: unknown): { ok: true; id: string } | { ok: false; error: string } {
    const r = this.usable(id);
    return r.problem === null ? { ok: true, id: r.id } : { ok: false, error: r.problem };
  }

  /** F-43: the provider a new session runs on. `requested` is the `POST /__crt/sessions` body value. */
  resolve(requested: unknown = null): Resolution {
    const explicit = (id: unknown, layer: ResolutionLayer, source: string): Resolution => {
      const check = this.usable(id);
      return { provider: check.id, layer, source, decision: null, problem: check.problem };
    };
    if (stubEnabled(this.env)) return { provider: stubProfile.id, layer: "stub", source: "CRT_SESSION_STUB", decision: null, problem: null };
    if (requested !== null && requested !== undefined) return explicit(requested, "request", "request");
    if (this.active) return explicit(this.active.id, "active", this.active.source);
    const { provider, providerSource } = this.config;
    if (provider !== null && providerSource !== null) {
      const layer = providerSource;
      const file = `.crt/${providerSource === "local" ? LOCAL_CONFIG_FILE : CONFIG_FILE}`;
      if (typeof provider !== "string") {
        return { provider: "acp", layer, source: file, decision: null, problem: `${file} sets provider { kind: "acp" }, which this version of CRT does not support yet — remove it or set a built-in id (${this.ids().join(", ")})` };
      }
      return explicit(provider, layer, file);
    }
    const decision = this.detection();
    return { provider: decision.provider, layer: decision.reason === null ? "default" : "detected", source: formatDecision(decision), decision, problem: null };
  }

  /** Validate an explicitly named provider: a listed string id whose cached preflight passes. */
  private usable(id: unknown): { id: string; problem: string | null } {
    if (typeof id !== "string" || !id.trim()) return { id: String(id), problem: `provider must be one of ${this.ids().join(", ")}` };
    const profile = this.get(id.trim());
    if (!profile) return { id: id.trim(), problem: `provider "${id.trim()}" is not a built-in provider (${this.ids().join(", ")})` };
    const p = this.preflight(profile.id);
    return { id: profile.id, problem: preflightPasses(p) ? null : (p.problem ?? `${profile.id} is not usable`) };
  }

  /** F-45/F-57 rows, in registry order. */
  status(): ProviderStatus[] {
    const listed = this.list();
    const markers = scanMarkers(this.root, listed);
    return listed.map((p) => {
      const pf = this.preflight(p.id);
      return {
        id: p.id,
        displayName: p.displayName,
        agentName: p.agentName,
        installed: pf.installed,
        loggedIn: pf.loggedIn,
        version: pf.version,
        problem: pf.problem,
        markers: markers[p.id] ?? [],
        capabilities: p.capabilities,
        state: preflightState(pf),
        hints: p.hints,
      };
    });
  }

  /** F-57 payload: what `GET /__crt/providers` returns and `crt providers --json` prints. */
  payload(): ProvidersPayload {
    const decision = this.detection();
    return {
      ok: true,
      active: this.resolve(null).provider,
      decision,
      providers: this.status().map(({ state: _state, agentName: _agentName, hints: _hints, ...row }) => row),
    };
  }
}

/** The `provider: …` phrase on the `CRT ready` line (F-44, N-7) and in the session log. */
export function describeResolution(r: Resolution): string {
  const head = r.layer === "detected" || r.layer === "default" ? r.source : `${r.provider} (${r.source})`;
  return r.problem ? `${head} — ${r.problem}` : head;
}

/**
 * F-45 human layout, exactly:
 *
 *   claude   ready        Claude Code (Agent SDK)    login: unknown until a session starts    markers: .claude/, CLAUDE.md
 *   codex    not on PATH  Codex CLI                  install: npm i -g @openai/codex          markers: AGENTS.md
 *   → claude — .claude/, CLAUDE.md; codex not on PATH
 */
export function renderProviders(rows: ProviderStatus[], decision: Decision): string {
  const cells = rows.map((r) => {
    const name = r.version ? `${r.agentName} ${r.version}` : r.agentName;
    const hint =
      r.state === "ready"
        ? `login: ${r.loggedIn === true ? "ok" : "unknown until a session starts"}`
        : r.state === "not on PATH"
          ? `install: ${r.hints.install}`
          : r.state === "not logged in"
            ? `login: ${r.hints.login}`
            : (r.problem ?? r.state);
    return [r.id, r.state, name, hint, `markers: ${r.markers.length ? r.markers.join(", ") : "none"}`];
  });
  // The sample's widths, widened only when a value (a version, a long problem) would not fit.
  const widths = [9, 13, 27, 41].map((w, i) => Math.max(w, ...cells.map((c) => c[i]!.length + 2)));
  const lines = cells.map((c) => c.map((cell, i) => (i < widths.length ? cell.padEnd(widths[i]!) : cell)).join(""));
  lines.push(`→ ${formatDecision(decision)}`);
  return lines.join("\n");
}
