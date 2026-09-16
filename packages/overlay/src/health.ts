/**
 * Launcher health (PRD-setup F-81). One `GET /__crt/health` at mount, on `visibilitychange` and
 * after any failed CRT request — never on a timer (PRD-setup §3) — drives a dot on the launcher
 * with a tooltip that says which server, which project, which agent and whether it is logged in.
 * The state is a pure function of the last health payload, the provider list (F-56 display name,
 * N-7 problem line) and the project this tab first saw (sessionStorage, the "different project"
 * Should), so ui.ts only wires the triggers and paints the result.
 */
import { CRT_ORIGIN, crtUrl } from "./base.js";

export const HEALTH_ENDPOINT = "/__crt/health";
/** Per tab: the server this tab first loaded from, to spot a `crt serve` from another session (F-81 Should). */
export const SERVER_KEY = "crt.server.v1";

/** The F-78 payload, as the overlay reads it. */
export interface HealthPayload {
  ok: boolean;
  version: string | null;
  startedAt: string | null;
  target: string;
  projectRoot: string;
  tasksDir: string | null;
  tasks: number;
  provider: string | null;
  login: "ok" | "missing" | "unchecked";
  sessions: number;
  overlay: { injected: number; fetched: number; lastContentType: string | null; cspWarning: string | null };
}

export type HealthState = "checking" | "connected" | "agent not ready" | "unreachable" | "different project";

export interface HealthView {
  state: HealthState;
  tooltip: string;
}

export interface HealthInputs {
  /** The last payload; null before the first answer, "failed" when the request did not complete or was not ok. */
  health: HealthPayload | null | "failed";
  /** F-56 display name of health's provider ("Claude"), or null when the provider list has not loaded. */
  agentName: string | null;
  /** The N-7 line for health's provider from `/__crt/providers`, null when it is usable. */
  problem: string | null;
  /** `projectRoot` this tab saw on its first successful health, null on the first one. */
  firstProjectRoot: string | null;
  /** The CRT port, for the "different project" line. */
  port: string;
}

export const CHECKING_TOOLTIP = "Checking the CRT server…";
export const UNREACHABLE_TOOLTIP = "CRT server not answering — is crt serve still running? (Send will fail)";

/** F-81: the dot's state and tooltip for what is known right now. */
export function deriveHealth(i: HealthInputs): HealthView {
  if (i.health === null) return { state: "checking", tooltip: CHECKING_TOOLTIP };
  if (i.health === "failed" || !i.health.ok) return { state: "unreachable", tooltip: UNREACHABLE_TOOLTIP };
  const h = i.health;
  if (i.firstProjectRoot !== null && i.firstProjectRoot !== h.projectRoot) {
    return { state: "different project", tooltip: `This :${i.port} is serving ${h.projectRoot} — a crt serve from another session is still running` };
  }
  if (i.problem) return { state: "agent not ready", tooltip: i.problem };
  const agent = i.agentName ?? h.provider ?? "agent";
  const suffix = h.login === "unchecked" ? " · login not checked yet" : "";
  return { state: "connected", tooltip: `CRT · ${agent} ready · ${h.projectRoot}${suffix}` };
}

/** `GET /__crt/health`; "failed" for a network error or a non-2xx answer (F-81 `unreachable`). */
export async function fetchHealth(): Promise<HealthPayload | "failed"> {
  try {
    const res = await fetch(crtUrl(HEALTH_ENDPOINT), { cache: "no-store" });
    if (!res.ok) return "failed";
    const data = (await res.json()) as HealthPayload;
    return data && data.ok ? data : "failed";
  } catch {
    return "failed";
  }
}

/** The port the overlay talks to: the page's own behind the proxy, the script's origin otherwise (F-6). */
export function crtPort(): string {
  try {
    const origin = CRT_ORIGIN || location.origin;
    return new URL(origin).port || (origin.startsWith("https") ? "443" : "80");
  } catch {
    return "4400";
  }
}

/** F-81 Should: remember the first server this tab saw; returns the project root seen before this one. */
export function rememberServer(h: HealthPayload): string | null {
  try {
    const raw = sessionStorage.getItem(SERVER_KEY);
    const seen = raw ? (JSON.parse(raw) as { projectRoot?: string; startedAt?: string | null }) : null;
    if (seen && typeof seen.projectRoot === "string") return seen.projectRoot;
    sessionStorage.setItem(SERVER_KEY, JSON.stringify({ projectRoot: h.projectRoot, startedAt: h.startedAt }));
  } catch {
    // sessionStorage unavailable: every server looks like the first one
  }
  return null;
}
