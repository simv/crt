/**
 * The destination registry (PRD-destinations §5.3, F-140, F-143, F-146): what a name after `--to`
 * means. Built-in destinations first; then `destinations.<name>` in the config — options for a
 * built-in, or, with `use`, a module from outside CRT written against the contract (types.ts).
 *
 * N-39 — an outside module is code that runs with the developer's rights. It is imported here and
 * nowhere else, only by `resolveDestination`, which only `crt handoff` calls for the destination
 * of that run, after a line that names the file. `listDestinations` and `destinationFact` (the
 * `--list` and `crt doctor` views) never import one.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG_FILE, LOCAL_CONFIG_FILE, readJson } from "../config.js";
import { CrtError } from "../errors.js";
import { guestConfigPath } from "../home.js";
import { displayPath } from "../tasks.js";
import { bundle } from "./bundle.js";
import { github } from "./github.js";
import { json } from "./json.js";
import { markdown } from "./markdown.js";
import { branch, here, pr } from "./project.js";
import { API_VERSION, type Destination } from "./types.js";

/** Every destination CRT ships, in the order `--list` shows them. */
export const BUILTIN_DESTINATIONS: readonly Destination[] = [pr, branch, here, bundle, markdown, json, github];

export const DESTINATION_NAME_RE = /^[a-z][a-z0-9-]*$/;

export type ConfigSource = "guest" | "local" | "project";

export interface DestinationEntry {
  name: string;
  /** `use`: a path (relative to the project root) or a package specifier; null for a built-in's options. */
  use: string | null;
  /** The entry without `use`. */
  options: Record<string, unknown>;
  source: ConfigSource;
  /** The config file that names it. */
  file: string;
}

export interface DestinationsConfig {
  /** `handoff.to` (F-146): what plain `crt handoff` uses; null when no file sets it. */
  defaultTo: string | null;
  defaultFile: string | null;
  entries: Map<string, DestinationEntry>;
}

/**
 * `handoff.to` and `destinations` from the guest config under the CRT home, `.crt/config.local.json`
 * and `.crt/config.json` — the first that sets a key wins, per destination name (PRD-zero §5.3's
 * layering). Junk is ignored, as everywhere in the config.
 */
export function readDestinationsConfig(root: string, env: NodeJS.ProcessEnv = process.env): DestinationsConfig {
  const files: [ConfigSource, string][] = [
    ["guest", guestConfigPath(root, env)],
    ["local", join(root, ".crt", LOCAL_CONFIG_FILE)],
    ["project", join(root, ".crt", CONFIG_FILE)],
  ];
  const out: DestinationsConfig = { defaultTo: null, defaultFile: null, entries: new Map() };
  for (const [source, file] of files) {
    const raw = readJson(file);
    if (!raw) continue;
    const handoff = raw.handoff;
    if (out.defaultTo === null && handoff && typeof handoff === "object" && typeof (handoff as { to?: unknown }).to === "string" && (handoff as { to: string }).to.trim()) {
      out.defaultTo = (handoff as { to: string }).to.trim();
      out.defaultFile = file;
    }
    const destinations = raw.destinations;
    if (!destinations || typeof destinations !== "object" || Array.isArray(destinations)) continue;
    for (const [name, value] of Object.entries(destinations as Record<string, unknown>)) {
      if (out.entries.has(name) || !DESTINATION_NAME_RE.test(name) || !value || typeof value !== "object" || Array.isArray(value)) continue;
      const { use, ...options } = value as Record<string, unknown>;
      out.entries.set(name, { name, use: typeof use === "string" && use.trim() ? use.trim() : null, options, source, file });
    }
  }
  return out;
}

export interface ListedDestination {
  name: string;
  title: string;
  /** `built in`, or the module an outside destination is. */
  kind: "builtin" | "external";
  /** Where its options or its module are named; null for a built-in nobody configured. */
  file: string | null;
  use: string | null;
}

/** F-146: every destination — built in, then the configured outside ones by name. Imports nothing. */
export function listDestinations(config: DestinationsConfig): ListedDestination[] {
  const out: ListedDestination[] = BUILTIN_DESTINATIONS.map((d) => ({ name: d.id, title: d.title, kind: "builtin", file: config.entries.get(d.id)?.file ?? null, use: null }));
  const builtin = new Set(out.map((d) => d.name));
  for (const entry of [...config.entries.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.use && !builtin.has(entry.name)) out.push({ name: entry.name, title: entry.use, kind: "external", file: entry.file, use: entry.use });
  }
  return out;
}

/**
 * Where `use` points: a path is taken from the project root (or as given when absolute); anything
 * else is a package specifier, resolved from the project and then from CRT's own package — so
 * `claude-review-tool/destination-command` works in a project that has nothing of CRT installed.
 * Null when it cannot be found.
 */
export function resolveUse(root: string, use: string): string | null {
  if (use.startsWith(".") || isAbsolute(use)) {
    const file = resolve(root, use);
    return existsSync(file) ? file : null;
  }
  for (const from of [join(resolve(root), "package.json"), import.meta.url]) {
    try {
      return createRequire(from).resolve(use);
    } catch {
      /* next */
    }
  }
  return null;
}

/** A config file as a line names it: relative to the project when it is inside it. */
function fileLabel(root: string, file: string): string {
  const rel = displayPath(root, file);
  return rel.startsWith("..") || isAbsolute(rel) ? file : rel;
}

/** F-143: what an outside module must be. One reason, or null. */
export function destinationProblem(value: unknown): string | null {
  if (!value || typeof value !== "object") return "it does not export `destination` (or a default export)";
  const d = value as Partial<Destination>;
  if (d.apiVersion !== API_VERSION) return `it was written for destination contract version ${JSON.stringify(d.apiVersion ?? null)}, and this CRT speaks version ${API_VERSION}`;
  if (typeof d.title !== "string" || !d.title) return "its `title` is missing";
  if (typeof d.final !== "boolean") return "its `final` is missing (true when publishing hands the review over, false for an export)";
  if (typeof d.plan !== "function") return "its `plan` function is missing";
  if (typeof d.publish !== "function") return "its `publish` function is missing";
  return null;
}

export interface ResolvedDestination {
  destination: Destination;
  options: Record<string, unknown>;
}

/**
 * The destination a name means, or one `crt:` line saying why not. For a module from outside, the
 * line naming its file is logged before it is imported (N-39).
 */
export async function resolveDestination(name: string, config: DestinationsConfig, opts: { root: string; log: (line: string) => void }): Promise<ResolvedDestination> {
  const entry = config.entries.get(name);
  const builtin = BUILTIN_DESTINATIONS.find((d) => d.id === name);
  if (builtin) {
    if (entry?.use) throw new CrtError(`destinations.${name} in ${fileLabel(opts.root, entry.file)} names a module, but ${name} is built in and cannot be replaced — give yours another name`, 2);
    return { destination: builtin, options: entry?.options ?? {} };
  }
  if (!entry?.use) throw new CrtError(`no destination "${name}" — \`crt handoff --list\` shows them`, 2);
  const from = fileLabel(opts.root, entry.file);
  const file = resolveUse(opts.root, entry.use);
  if (!file) throw new CrtError(`--to ${name} is ${entry.use} (from ${from}), which was not found — a path is taken from ${resolve(opts.root)}, a package must be installed there`);
  opts.log(`crt: --to ${name} is ${fileLabel(opts.root, file)}, from ${from}`);
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch (err) {
    throw new CrtError(`could not load ${fileLabel(opts.root, file)} (${(err as Error).message.split("\n")[0]})`);
  }
  const value = mod.destination ?? mod.default;
  const problem = destinationProblem(value);
  if (problem) throw new CrtError(`${fileLabel(opts.root, file)} is not a destination: ${problem}`);
  const d = value as Destination;
  // The name after `--to` is the config key, whatever the module calls itself.
  return { destination: { apiVersion: API_VERSION, id: name, title: d.title, final: d.final, plan: d.plan.bind(d), publish: d.publish.bind(d) }, options: entry.options };
}

/** F-149: what `crt doctor` can say about a destination without importing or running anything. */
export function destinationFact(name: string, config: DestinationsConfig, root: string): { ok: boolean; title: string; detail: string } {
  const builtin = BUILTIN_DESTINATIONS.find((d) => d.id === name);
  const entry = config.entries.get(name);
  if (builtin) return { ok: true, title: builtin.title, detail: "built in" };
  if (!entry?.use) return { ok: false, title: name, detail: "no destination of that name — `crt handoff --list` shows them" };
  const file = resolveUse(root, entry.use);
  return file ? { ok: true, title: name, detail: fileLabel(root, file) } : { ok: false, title: name, detail: `${entry.use} not found` };
}
