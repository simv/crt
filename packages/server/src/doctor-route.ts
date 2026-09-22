/**
 * `GET /__crt/doctor` (PRD-polish F-113, N-24): the `crt doctor` rows computed inside the running
 * server, for the landing page (landing.ts, F-114). `{ checkedAt, rows, decision, exitCode }` from
 * `doctorRows()` over facts built in-process:
 *
 *   • node, project, .crt, integration, instructions — as `collectDoctorFacts` builds them;
 *   • mode — the running mode, not the config files;
 *   • target — the server's own app URL, probed once (1.5 s; `null` is the embedded `--` row, down is
 *     `warn` in embedded mode — the F-103 rules); the label comes from the config when the URL matches it;
 *   • port — `{ port, state: "self" }`: `ok    port      4400 — this server` (the CLI's probe would
 *     find this very server and call it held);
 *   • one row per provider from the registry's last refresh (`503` without a registry, as /__crt/providers);
 *   • plugin — only with `?plugin=1`: its fact spawns `claude plugin list --json` (up to 10 s), so it is
 *     cached for 30 s per server and one spawn is shared by concurrent callers.
 *
 * Bounded (N-24): the default response is computed at most once per 5 s — a later call inside the
 * window gets the same promise, so concurrent requests share one computation and a second call
 * returns the cached `checkedAt` — nothing runs at server start, and `/` never waits on any of it.
 * Any request carrying an `Origin` header is refused with 403 before anything else (the
 * /__crt/internal/* rule, N-8): the route spawns a CLI and a page on another port must not be able
 * to trigger it; the landing page's own same-origin fetch carries none. `HEAD` is allowed; any other
 * method is 405. `crt doctor` on the terminal is unchanged and never calls this.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { collectDoctorFacts, type DoctorFacts, type DoctorReport, type DoctorRow, doctorRows, pluginFact } from "./doctor.js";
import { json } from "./http.js";
import { type CrtMode, readConfig } from "./init.js";
import type { ProviderRegistry } from "./session.js";
import { isReachable, normalizeTarget } from "./target.js";

export const DOCTOR_PATH = "/__crt/doctor";
/** N-24: the default response is computed at most once per this. */
export const DOCTOR_TTL_MS = 5_000;
/** N-24: the plugin fact (a spawn) at most once per this. */
export const PLUGIN_TTL_MS = 30_000;

/** The F-113 payload. */
export interface DoctorPayload {
  /** ISO-8601: when the facts behind `rows` were gathered (the plugin row may be older or newer — it has its own cache). */
  checkedAt: string;
  rows: DoctorRow[];
  decision: string;
  exitCode: 0 | 1;
}

export interface DoctorRouteOptions {
  projectRoot: string;
  mode: CrtMode;
  /** The app URL (embedded: what CRT opens; proxy: the target); null when none is known. */
  target: string | null;
  version: string;
  providers?: ProviderRegistry;
  env?: NodeJS.ProcessEnv;
  /** Test seams: the clock, the target probe and the plugin spawn. */
  now?: () => number;
  isReachable?: (origin: string) => Promise<boolean>;
  plugin?: (env: NodeJS.ProcessEnv) => Promise<NonNullable<DoctorFacts["plugin"]>>;
}

type PluginFact = NonNullable<DoctorFacts["plugin"]>;

/** One per server: the two caches and the handler. */
export class DoctorRoute {
  private base: { at: number; result: Promise<{ facts: DoctorFacts; checkedAt: string }> } | null = null;
  private plugin: { at: number; result: Promise<PluginFact> } | null = null;
  /** The last report served (with the plugin row when it was asked for), for the landing page to render without waiting (never computed for it). */
  private last: DoctorPayload | null = null;
  private readonly now: () => number;
  private readonly probe: (origin: string) => Promise<boolean>;
  private readonly spawnPlugin: (env: NodeJS.ProcessEnv) => Promise<PluginFact>;

  constructor(private readonly opts: DoctorRouteOptions) {
    this.now = opts.now ?? Date.now;
    this.probe = opts.isReachable ?? ((origin) => isReachable(origin));
    this.spawnPlugin = opts.plugin ?? pluginFact;
  }

  /** The last report this server served, or null before the first request — the page's server-rendered rows. */
  cached(): DoctorPayload | null {
    return this.last;
  }

  /** The F-113 payload; `withPlugin` adds the plugin row from its own 30 s cache. */
  async report(port: number, withPlugin: boolean): Promise<DoctorPayload> {
    const now = this.now();
    if (!this.base || now - this.base.at >= DOCTOR_TTL_MS) {
      const result = this.collect(port, new Date(now).toISOString());
      const entry = { at: now, result };
      this.base = entry;
      result.catch(() => {
        // a failed collection is not cached: the next call tries again
        if (this.base === entry) this.base = null;
      });
    }
    const { facts, checkedAt } = await this.base.result;
    let plugin: PluginFact | undefined;
    if (withPlugin) {
      if (!this.plugin || now - this.plugin.at >= PLUGIN_TTL_MS) {
        const result = this.spawnPlugin(this.opts.env ?? process.env);
        const entry = { at: now, result };
        this.plugin = entry;
        result.catch(() => {
          if (this.plugin === entry) this.plugin = null;
        });
      }
      plugin = await this.plugin.result;
    }
    const report: DoctorReport = doctorRows(plugin ? { ...facts, plugin } : facts);
    const payload: DoctorPayload = { checkedAt, rows: report.rows, decision: report.decision, exitCode: report.exitCode };
    this.last = payload;
    return payload;
  }

  private async collect(port: number, checkedAt: string): Promise<{ facts: DoctorFacts; checkedAt: string }> {
    const o = this.opts;
    if (!o.providers) throw new Error("providers are not enabled on this server");
    const facts = await collectDoctorFacts({
      cwd: o.projectRoot,
      version: o.version,
      target: false,
      plugin: false,
      providers: o.providers,
      mode: o.mode,
      port: { port, state: "self" },
      env: o.env,
    });
    facts.target = o.target === null ? null : { origin: o.target, source: targetSource(o.projectRoot, o.target), up: await this.probe(o.target) };
    return { facts, checkedAt };
  }

  /** The route: 403 on any Origin, 405 off GET/HEAD, 503 without a registry, else the payload. */
  async handle(req: IncomingMessage, res: ServerResponse, query: URLSearchParams): Promise<void> {
    if (req.headers.origin !== undefined) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("allow", "GET, HEAD");
      json(res, 405, { ok: false, error: `GET ${DOCTOR_PATH}[?plugin=1]` });
      return;
    }
    if (!this.opts.providers) {
      json(res, 503, { ok: false, error: "providers are not enabled on this server — no doctor rows" });
      return;
    }
    let payload: DoctorPayload;
    try {
      payload = await this.report(req.socket.localPort ?? 0, query.get("plugin") === "1");
    } catch (err) {
      json(res, 500, { ok: false, error: `doctor failed: ${(err as Error).message}` });
      return;
    }
    const text = JSON.stringify(payload);
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": String(Buffer.byteLength(text)), "cache-control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : text);
  }
}

/** The F-76 label for the server's app URL: the config's source when it set this very origin, else `probe` (`(found)`). */
function targetSource(root: string, target: string): "local" | "project" | "probe" {
  const config = readConfig(root);
  if (config.target && config.targetSource) {
    try {
      if (normalizeTarget(config.target) === target) return config.targetSource;
    } catch {
      // an unparseable config value never matches
    }
  }
  return "probe";
}
