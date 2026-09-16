/**
 * Auto-detection (PRD-providers F-44, §5.5): which provider should a session use when nobody
 * chose one? "What is usable here, disambiguated by the project":
 *
 *   1. launch context — CRT was started from inside an agent (`launchEnv`) that passes preflight;
 *   2. candidates — built-in profiles whose preflight passes; only the default one → default;
 *   3. project markers in the root only (names, never contents): private markers are worth 2,
 *      the shared AGENTS.md 2 for non-default candidates when no default marker is present, else
 *      1 for every candidate that reads it; a strict maximum wins, ties and all-zero → default —
 *      or, when the default itself is unusable (a logged-out Claude, PRD-setup F-74), the first
 *      usable candidate, with the default's problem as the reason;
 *   4. an unusable agent the project points at is named in the reason.
 *
 * The decision always carries its reason (Goal 3); `formatDecision` renders it the way the
 * `CRT ready` line and `crt providers` print it (`claude (default)` / `claude — <reason>`).
 * Pure: everything it consults is passed in, so F-60 covers every table row without a machine.
 */
import { readdirSync } from "node:fs";
import { type PreflightResult, preflightPasses, preflightState, type ProviderProfile } from "./types.js";

/** The provider auto-detection falls back to: Claude Code (Goal 2). */
export const DEFAULT_PROVIDER = "claude";

export interface Decision {
  provider: string;
  /** Why; null means "by default" (nothing pointed elsewhere). */
  reason: string | null;
}

export interface DetectInput {
  /** Project root; only its top-level entries are scanned. */
  root: string;
  env: NodeJS.ProcessEnv;
  /** Built-in profiles in registry order (`stub` is never detected). */
  profiles: ProviderProfile[];
  /** Cached preflight per profile id. A missing entry counts as failing. */
  preflights: Record<string, PreflightResult | undefined>;
}

/** F-44 step 3: marker names found in the root, per profile, in the profile's own order. */
export function scanMarkers(root: string, profiles: ProviderProfile[]): Record<string, string[]> {
  const dirs = new Set<string>();
  const files = new Set<string>();
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      (entry.isDirectory() ? dirs : files).add(entry.name);
    }
  } catch {
    // unreadable root: no markers
  }
  const has = (marker: string) => (marker.endsWith("/") ? dirs.has(marker.slice(0, -1)) : files.has(marker));
  const out: Record<string, string[]> = {};
  for (const p of profiles) out[p.id] = [...p.markers.private, ...p.markers.shared].filter(has);
  return out;
}

export function detectProvider(input: DetectInput): Decision {
  const { profiles, env } = input;
  const preflight = (id: string): PreflightResult => input.preflights[id] ?? { installed: false, loggedIn: "unknown", version: null, problem: "no preflight" };
  const passes = (p: ProviderProfile) => preflightPasses(preflight(p.id));
  const markers = scanMarkers(input.root, profiles);
  const found = (p: ProviderProfile, names: string[]) => names.filter((m) => markers[p.id]?.includes(m));
  const notes = unusableNotes(profiles.filter((p) => !passes(p)), preflight, found);
  const decide = (provider: string, ...parts: Array<string | null>): Decision => {
    const reason = [...parts, ...notes].filter((s): s is string => Boolean(s)).join("; ");
    return { provider, reason: reason || null };
  };

  // 1. Launch context.
  for (const p of profiles) {
    const set = p.launchEnv.find((v) => env[v] !== undefined && env[v] !== "");
    if (set !== undefined && passes(p)) return decide(p.id, `started inside ${p.displayName} (${set})`);
  }

  // 2. Candidates.
  const candidates = profiles.filter(passes);
  const defaultProfile = profiles.find((p) => p.id === DEFAULT_PROVIDER);
  const defaultMarked = defaultProfile ? found(defaultProfile, defaultProfile.markers.private).length > 0 : false;
  const markerPart = (p: ProviderProfile): string | null => {
    const names = markers[p.id] ?? [];
    if (!names.length) return null;
    return p.id === DEFAULT_PROVIDER || defaultMarked ? names.join(", ") : `${names.join(", ")}, no Claude markers`;
  };
  if (candidates.every((p) => p.id === DEFAULT_PROVIDER)) return decide(DEFAULT_PROVIDER, defaultProfile ? markerPart(defaultProfile) : null);
  // F-74: the default is demoted only when it cannot be used and something else can.
  const fallback = candidates.some((p) => p.id === DEFAULT_PROVIDER) ? DEFAULT_PROVIDER : candidates[0]!.id;

  // 3. Project markers, scored for candidates only.
  const scores = candidates.map((p) => {
    let score = 2 * found(p, p.markers.private).length;
    if (found(p, p.markers.shared).length) score += defaultMarked ? 1 : p.id === DEFAULT_PROVIDER ? 0 : 2;
    return { p, score };
  });
  const top = Math.max(...scores.map((s) => s.score));
  const leaders = scores.filter((s) => s.score === top);
  if (top === 0) return decide(fallback);
  if (leaders.length > 1) {
    return decide(fallback, `tie between ${leaders.map((s) => `${s.p.id} (${(markers[s.p.id] ?? []).join(", ")})`).join(" and ")}`);
  }
  const winner = leaders[0]!.p;
  if (winner.id === DEFAULT_PROVIDER) return decide(winner.id, markerPart(winner));
  const pf = preflight(winner.id);
  const winnerNote = [winner.id, pf.version, pf.loggedIn === true ? "logged in" : null].filter(Boolean).join(" ");
  return decide(winner.id, markerPart(winner), winnerNote);
}

/** F-44 step 4 and the F-45 decision line: every unusable built-in, pointed at or not. */
function unusableNotes(
  unusable: ProviderProfile[],
  preflight: (id: string) => PreflightResult,
  found: (p: ProviderProfile, names: string[]) => string[],
): string[] {
  return unusable.map((p) => {
    const state = statePhrase(preflight(p.id));
    const pointedAt = found(p, p.markers.private);
    return pointedAt.length ? `project looks like ${p.id} (${pointedAt.join(", ")}) but ${p.id} is ${state}` : `${p.id} ${state}`;
  });
}

function statePhrase(p: PreflightResult): string {
  switch (preflightState(p)) {
    case "not on PATH":
      return "not on PATH";
    case "not logged in":
      return "not logged in";
    case "too old":
      return `too old (${p.version ?? "?"})`;
    default:
      return "unusable";
  }
}

/** `claude (default)` or `claude — <reason>`, as printed after `provider:` and `→`. */
export function formatDecision(d: Decision): string {
  return d.reason === null ? `${d.provider} (default)` : `${d.provider} — ${d.reason}`;
}
