/**
 * Welcome card (PRD-setup F-82). On a project's first visit the overlay shows a dismissable card
 * above the launcher that says what is proxied, where tasks go, which agent will answer and
 * whether it is logged in, and the three steps of the loop. Remembered per project in
 * localStorage (`crt.welcome.v1:<projectRoot>`), so one port serving two projects shows it once
 * each. Never shown under the `stub` provider (how e2e runs), inside an iframe, after a mid-work
 * reload (threads or annotations restored), or when health failed (the launcher dot owns that,
 * F-81). It is shown in embedded mode (PRD-embedded F-95 dropped the v0.3 "never in script-tag
 * mode" rule) with its second line from health's `mode`. `window.__crt.welcome()` opens it on demand.
 *
 * The copy and the suppression rule are pure functions, unit-tested from packages/server/test;
 * ui.ts mounts the element and positions it.
 */
import type { HealthPayload } from "./health.js";

export const WELCOME_KEY_PREFIX = "crt.welcome.v1:";

export function welcomeKey(projectRoot: string): string {
  return WELCOME_KEY_PREFIX + projectRoot;
}

export function welcomeSeen(projectRoot: string): boolean {
  try {
    return localStorage.getItem(welcomeKey(projectRoot)) !== null;
  } catch {
    return true; // no localStorage: never nag on every load
  }
}

export function markWelcomeSeen(projectRoot: string): void {
  try {
    localStorage.setItem(welcomeKey(projectRoot), new Date().toISOString());
  } catch {
    // localStorage unavailable: the card comes back next load
  }
}

export interface WelcomeCopy {
  title: string;
  /**
   * Where CRT is (F-82, F-95): "Proxying <target> for <project>. Tasks are written to <dir> (<n> there now)." in
   * proxy mode; "Talking to CRT at <origin> for <project>. Tasks are written to <dir> (<n> there now)." embedded.
   */
  where: string;
  /** "Agent: <name> — …" */
  agent: string;
  steps: [string, string, string];
}

export interface WelcomeAgent {
  /** F-56 display name; falls back to the provider id. */
  name: string | null;
  /** The provider's N-7 line when it is unusable (used for agents other than Claude). */
  problem: string | null;
}

/** The tasks directory the way the ready line prints it: relative to the project when it is inside it. */
export function tasksLabel(h: Pick<HealthPayload, "projectRoot" | "tasksDir">): string {
  const dir = h.tasksDir ?? ".crt/tasks";
  const root = h.projectRoot;
  if (dir.startsWith(root) && /[\\/]/.test(dir.charAt(root.length))) return dir.slice(root.length + 1);
  return dir;
}

/** F-82/F-95 copy, exactly, with live values from health and the provider list; `crtOrigin` is where this overlay came from (embedded mode). */
export function welcomeCopy(h: HealthPayload, agent: WelcomeAgent, crtOrigin = ""): WelcomeCopy {
  const name = agent.name ?? h.provider ?? "the agent";
  const n = h.tasks;
  const tasks = `Tasks are written to ${tasksLabel(h)} (${n} there now).`;
  const where = h.mode === "embedded" ? `Talking to CRT at ${crtOrigin || "this origin"} for ${h.projectRoot}. ${tasks}` : `Proxying ${h.target} for ${h.projectRoot}. ${tasks}`;
  let line: string;
  if (h.login === "ok") line = `Agent: ${name} — ready, logged in`;
  else if (h.login === "missing" && (h.provider === "claude" || !agent.problem)) {
    line = `Agent: ${name} — not logged in: run \`claude\` in a terminal, complete /login, then send (no restart needed)`;
  } else if (agent.problem) line = `Agent: ${name} — ${agent.problem}`;
  else line = `Agent: ${name} — login not checked yet; the first Send will tell you`;
  return {
    title: "CRT is on this page",
    where,
    agent: line,
    steps: ["Open the toolbar: the CRT button, or Ctrl/Cmd+Shift+.", "Select, Box or Pin the thing.", "Type a note and Send."],
  };
}

export interface WelcomeGate {
  health: HealthPayload | "failed" | null;
  inIframe: boolean;
  /** Threads or annotations came back from sessionStorage: a mid-work reload. */
  restored: boolean;
  seen: (projectRoot: string) => boolean;
}

/** F-82/F-95: whether the card shows by itself on this load (embedded mode included). */
export function shouldShowWelcome(g: WelcomeGate): boolean {
  if (g.health === null || g.health === "failed" || !g.health.ok) return false;
  if (g.health.provider === "stub") return false;
  if (g.inIframe || g.restored) return false;
  return !g.seen(g.health.projectRoot);
}

export const WELCOME_CSS = `
  .welcome { position: fixed; pointer-events: auto; width: min(360px, calc(100vw - 32px)); padding: 14px 16px;
             border-radius: 12px; background: #fff; color: #111; box-shadow: 0 8px 28px rgba(0,0,0,.22);
             border: 1px solid rgba(0,0,0,.08); font-size: 13px; line-height: 1.45; }
  .welcome[hidden] { display: none; }
  .welcome h2 { margin: 0 0 6px; font-size: 14px; font-weight: 700; }
  .welcome p { margin: 0 0 6px; overflow-wrap: anywhere; }
  .welcome p.agent code { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .welcome ol { margin: 6px 0 10px; padding-left: 20px; }
  .welcome ol li { margin: 2px 0; }
  .welcome .actions { display: flex; gap: 8px; justify-content: flex-end; }
  .welcome .actions button { padding: 6px 12px; border-radius: 8px; font-weight: 600; }
  .welcome .actions button.secondary { background: #f0f0f0; }
  .welcome .actions button.secondary:hover { background: #e4e4e6; }
`;

/** Build the card; the caller positions it, hides it, and wires nothing else. */
export function buildWelcome(copy: WelcomeCopy, on: { gotIt: () => void; showMe: () => void }): HTMLElement {
  const el = document.createElement("section");
  el.className = "welcome";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", copy.title);
  const h2 = document.createElement("h2");
  h2.textContent = copy.title;
  const proxying = document.createElement("p");
  proxying.className = "where";
  proxying.textContent = copy.where;
  const agent = document.createElement("p");
  agent.className = "agent";
  agent.textContent = copy.agent;
  const ol = document.createElement("ol");
  for (const step of copy.steps) {
    const li = document.createElement("li");
    li.textContent = step;
    ol.appendChild(li);
  }
  const actions = document.createElement("div");
  actions.className = "actions";
  const showMe = document.createElement("button");
  showMe.type = "button";
  showMe.className = "secondary";
  showMe.dataset.welcome = "show";
  showMe.textContent = "Show me";
  showMe.addEventListener("click", on.showMe);
  const gotIt = document.createElement("button");
  gotIt.type = "button";
  gotIt.className = "primary";
  gotIt.dataset.welcome = "got-it";
  gotIt.textContent = "Got it";
  gotIt.addEventListener("click", on.gotIt);
  actions.append(showMe, gotIt);
  el.append(h2, proxying, agent, ol, actions);
  return el;
}
