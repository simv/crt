import { describe, expect, it } from "vitest";
import { CHECKING_TOOLTIP, deriveHealth, type HealthPayload, UNREACHABLE_TOOLTIP } from "../../overlay/src/health.js";
import { shouldShowWelcome, tasksLabel, welcomeCopy, welcomeKey } from "../../overlay/src/welcome.js";

// PRD-setup F-81 (launcher dot states and copy) and F-82 (welcome card copy and suppression):
// the pure halves of the overlay's arrival, tested here the way owner-stack.test.ts tests component.ts.

const health = (over: Partial<HealthPayload> = {}): HealthPayload => ({
  ok: true,
  version: "0.3.0",
  startedAt: "2026-09-16T01:12:00.000Z",
  target: "http://localhost:3000",
  projectRoot: "C:\\my-app",
  tasksDir: "C:\\my-app\\.crt\\tasks",
  tasks: 3,
  provider: "claude",
  login: "ok",
  sessions: 0,
  overlay: { injected: 1, fetched: 1, lastContentType: "text/html", cspWarning: null },
  ...over,
});
const base = { agentName: "Claude", problem: null, firstProjectRoot: null, port: "4400" };

describe("launcher health states (F-81)", () => {
  it("is `checking` before the first answer and `unreachable` when health failed (F-81)", () => {
    expect(deriveHealth({ ...base, health: null })).toEqual({ state: "checking", tooltip: CHECKING_TOOLTIP });
    expect(deriveHealth({ ...base, health: "failed" })).toEqual({ state: "unreachable", tooltip: UNREACHABLE_TOOLTIP });
    expect(UNREACHABLE_TOOLTIP).toBe("CRT server not answering — is crt serve still running? (Send will fail)");
  });

  it("is `connected` with the agent's display name and the project, plus the suffix when login is unchecked (F-81)", () => {
    expect(deriveHealth({ ...base, health: health() })).toEqual({ state: "connected", tooltip: "CRT · Claude ready · C:\\my-app" });
    expect(deriveHealth({ ...base, health: health({ login: "unchecked" }) }).tooltip).toBe("CRT · Claude ready · C:\\my-app · login not checked yet");
    // The stub (e2e) and any provider whose login cannot be read stay green.
    expect(deriveHealth({ ...base, agentName: null, health: health({ provider: "stub", login: "unchecked" }) })).toEqual({
      state: "connected",
      tooltip: "CRT · stub ready · C:\\my-app · login not checked yet",
    });
  });

  it("is `agent not ready` with the provider's N-7 line verbatim, `not logged in` included (F-81)", () => {
    const problem = "not logged in to Claude Code — run `claude` in a terminal and complete /login (or set CLAUDE_CODE_OAUTH_TOKEN), then send again";
    expect(deriveHealth({ ...base, problem, health: health({ login: "missing" }) })).toEqual({ state: "agent not ready", tooltip: problem });
    expect(deriveHealth({ ...base, agentName: "Codex CLI", problem: "codex not on PATH — install: npm i -g @openai/codex", health: health({ provider: "codex" }) }).state).toBe("agent not ready");
  });

  it("is `different project` when health names another project than the one this tab first saw (F-81 Should)", () => {
    const v = deriveHealth({ ...base, firstProjectRoot: "C:\\my-app", health: health({ projectRoot: "C:\\other-app" }) });
    expect(v).toEqual({ state: "different project", tooltip: "This :4400 is serving C:\\other-app — a crt serve from another session is still running" });
    // A restart of the same project (new startedAt) is still this project.
    expect(deriveHealth({ ...base, firstProjectRoot: "C:\\my-app", health: health({ startedAt: "2026-09-16T02:00:00.000Z" }) }).state).toBe("connected");
  });
});

describe("welcome card (F-82)", () => {
  it("has the copy with live values from health, and the agent line per login state (F-82)", () => {
    const copy = welcomeCopy(health(), { name: "Claude", problem: null });
    expect(copy.title).toBe("CRT is on this page");
    expect(copy.proxying).toBe("Proxying http://localhost:3000 for C:\\my-app. Tasks are written to .crt\\tasks (3 there now).");
    expect(copy.agent).toBe("Agent: Claude — ready, logged in");
    expect(copy.steps).toEqual(["Open the toolbar: the CRT button, or Ctrl/Cmd+Shift+.", "Select, Box or Pin the thing.", "Type a note and Send."]);
    expect(welcomeCopy(health({ login: "missing" }), { name: "Claude", problem: "not logged in …" }).agent).toBe(
      "Agent: Claude — not logged in: run `claude` in a terminal, complete /login, then send (no restart needed)",
    );
    expect(welcomeCopy(health({ login: "unchecked" }), { name: "Claude", problem: null }).agent).toBe("Agent: Claude — login not checked yet; the first Send will tell you");
    // Another agent's display name replaces "Claude", and its own N-7 line is the fix (F-56).
    expect(welcomeCopy(health({ provider: "codex", login: "missing" }), { name: "Codex CLI", problem: "codex not logged in — run `codex login`" }).agent).toBe(
      "Agent: Codex CLI — codex not logged in — run `codex login`",
    );
    expect(welcomeCopy(health({ tasks: 1 }), { name: null, problem: null }).proxying).toContain("(1 there now)");
  });

  it("prints the tasks directory relative to the project, on either separator (F-82)", () => {
    expect(tasksLabel({ projectRoot: "C:\\my-app", tasksDir: "C:\\my-app\\.crt\\tasks" })).toBe(".crt\\tasks");
    expect(tasksLabel({ projectRoot: "/home/me/app", tasksDir: "/home/me/app/.crt/tasks" })).toBe(".crt/tasks");
    expect(tasksLabel({ projectRoot: "/home/me/app", tasksDir: "/srv/tasks" })).toBe("/srv/tasks");
    expect(tasksLabel({ projectRoot: "/home/me/app", tasksDir: null })).toBe(".crt/tasks");
  });

  it("is suppressed for the stub, script-tag mode, iframes, restored work, failed health, and once seen; keyed per project (F-82)", () => {
    const seen = () => false;
    const ok = { health: health(), scriptTagMode: false, inIframe: false, restored: false, seen };
    expect(shouldShowWelcome(ok)).toBe(true);
    expect(shouldShowWelcome({ ...ok, health: health({ provider: "stub" }) })).toBe(false);
    expect(shouldShowWelcome({ ...ok, scriptTagMode: true })).toBe(false);
    expect(shouldShowWelcome({ ...ok, inIframe: true })).toBe(false);
    expect(shouldShowWelcome({ ...ok, restored: true })).toBe(false);
    expect(shouldShowWelcome({ ...ok, health: "failed" })).toBe(false);
    expect(shouldShowWelcome({ ...ok, health: null })).toBe(false);
    expect(shouldShowWelcome({ ...ok, seen: (root) => root === "C:\\my-app" })).toBe(false);
    expect(shouldShowWelcome({ ...ok, health: health({ projectRoot: "C:\\other" }), seen: (root) => root === "C:\\my-app" })).toBe(true);
    expect(welcomeKey("C:\\my-app")).toBe("crt.welcome.v1:C:\\my-app");
  });
});
