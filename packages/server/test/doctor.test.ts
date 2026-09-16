import { describe, expect, it } from "vitest";
import { type DoctorFacts, doctorRows, hasDevScript, installedPluginVersion, renderDoctor, renderRow } from "../src/doctor.js";
import { CLAUDE_NOT_LOGGED_IN } from "../src/providers/claude.js";
import { CODEX_NOT_FOUND, CODEX_NOT_LOGGED_IN, codexTooOld } from "../src/providers/codex.js";
import { preflightState } from "../src/providers/types.js";
import type { ProviderStatus, Resolution } from "../src/session.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// PRD-setup F-76: doctor rows and exit code over facts, with the wordings verbatim. `FAIL` (exit 1)
// only for node too old, target down/unset, port held, the resolved provider unusable; `warn`
// (exit 0) for another provider's problem and the plugin row.

const CLAUDE_HINTS = { install: "reinstall claude-review-tool (npm install)", login: "run `claude` in a terminal and complete /login" };
const CODEX_HINTS = { install: "npm i -g @openai/codex", login: "codex login" };

function status(id: "claude" | "codex", over: Partial<ProviderStatus> = {}): ProviderStatus {
  const base = {
    installed: true,
    loggedIn: "unknown" as const,
    version: id === "claude" ? "0.3.270" : "0.154.0",
    problem: null,
    markers: [],
    capabilities: { streaming: true, toolEvents: true, permissions: "interactive" as const, images: "inline" as const, resume: true, interrupt: true, instructions: "system" as const },
    ...over,
  };
  const pf = { installed: base.installed, loggedIn: base.loggedIn, version: base.version, problem: base.problem };
  return {
    id,
    displayName: id === "claude" ? "Claude" : "Codex",
    agentName: id === "claude" ? "Claude Code (Agent SDK)" : "Codex CLI",
    hints: id === "claude" ? CLAUDE_HINTS : CODEX_HINTS,
    ...base,
    state: preflightState(pf),
  };
}

const detected = (provider: string, reason: string | null): Resolution => ({
  provider,
  layer: reason === null ? "default" : "detected",
  source: reason === null ? `${provider} (default)` : `${provider} — ${reason}`,
  decision: { provider, reason },
  problem: null,
});

function facts(over: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    node: "v22.4.0",
    project: { root: "C:\\my-app", git: true },
    crt: { tasks: 4, config: true, localConfig: true, ignore: true },
    target: { origin: "http://localhost:3100", source: "local", up: true },
    port: { port: 4400, state: "free" },
    providers: [status("claude", { loggedIn: true }), status("codex", { loggedIn: false, problem: CODEX_NOT_LOGGED_IN })],
    resolution: detected("claude", "codex not logged in"),
    version: "0.3.0",
    plugin: { claudeOnPath: true, installed: "0.3.0" },
    ...over,
  };
}

const lines = (f: DoctorFacts) => renderDoctor(doctorRows(f)).split("\n");
const row = (f: DoctorFacts, name: string) => renderRow(doctorRows(f).rows.find((r) => r.name === name)!);

describe("crt doctor (PRD-setup F-76)", () => {
  it("renders the F-76 sample verbatim and exits 0 on a healthy Claude-only machine with Codex logged out", () => {
    const report = doctorRows(facts());
    expect(renderDoctor(report)).toBe(
      [
        "ok    node      v22.4.0 (needs 20 or newer)",
        "ok    project   C:\\my-app (.git)",
        "ok    .crt      tasks/ (4 tasks), config.json, config.local.json, .gitignore entries",
        "ok    target    http://localhost:3100 (remembered) — responding",
        "ok    port      4400 free",
        "ok    claude    Claude Code (Agent SDK 0.3.270) — logged in",
        "warn  codex     Codex CLI 0.154.0 — not logged in — codex login",
        "ok    plugin    crt@crt 0.3.0 installed (claude on PATH)",
        "→ claude — codex not logged in",
      ].join("\n"),
    );
    expect(report.exitCode).toBe(0);
  });

  it.each([
    ["node too old", facts({ node: "v18.20.0" }), "FAIL  node      v18.20.0 — CRT needs Node 20 or newer"],
    ["no target and nothing probed", facts({ target: null }), "FAIL  target    none set and nothing on the probed ports — crt <port>"],
    ["remembered target down", facts({ target: { origin: "http://localhost:3100", source: "local", up: false } }), "FAIL  target    http://localhost:3100 (remembered) — not responding"],
    ["config.json target down", facts({ target: { origin: "http://localhost:3000", source: "project", up: false } }), "FAIL  target    http://localhost:3000 (.crt/config.json) — not responding"],
    [
      "port held by CRT for this project",
      facts({ port: { port: 4400, state: "crt", thisProject: true, health: { version: "0.3.0", startedAt: null, target: "http://localhost:3000", projectRoot: "C:\\my-app", sessions: 0 } } }),
      "FAIL  port      4400 held by CRT 0.3.0 → http://localhost:3000 (this project) — crt --replace",
    ],
    [
      "port held by CRT for another project",
      facts({ port: { port: 4400, state: "crt", thisProject: false, health: { version: "0.2.0", startedAt: null, target: "http://localhost:3000", projectRoot: "C:\\other", sessions: 0 } } }),
      "FAIL  port      4400 held by CRT 0.2.0 → http://localhost:3000 (project C:\\other) — crt starts on 4401, or crt --replace",
    ],
    ["port held by a non-CRT process", facts({ port: { port: 4400, state: "busy" } }), "FAIL  port      4400 in use by a non-CRT process — crt --port 4401"],
    [
      "resolved provider not logged in",
      facts({ providers: [status("claude", { loggedIn: false, problem: CLAUDE_NOT_LOGGED_IN }), status("codex", { installed: false, version: null, problem: CODEX_NOT_FOUND })], resolution: detected("claude", "claude not logged in; codex not on PATH") }),
      "FAIL  claude    Claude Code (Agent SDK 0.3.270) — not logged in — run `claude` in a terminal and complete /login",
    ],
    [
      "resolved provider chosen by config but too old",
      facts({ providers: [status("claude", { loggedIn: true }), status("codex", { version: "0.100.0", problem: codexTooOld("0.100.0") })], resolution: { provider: "codex", layer: "project", source: ".crt/config.json", decision: null, problem: codexTooOld("0.100.0") } }),
      `FAIL  codex     Codex CLI 0.100.0 — ${codexTooOld("0.100.0")}`,
    ],
  ])("%s → FAIL row, exit 1", (_name, f, expected) => {
    const report = doctorRows(f);
    expect(renderDoctor(report).split("\n")).toContain(expected);
    expect(report.exitCode).toBe(1);
  });

  it.each([
    ["no .git above", facts({ project: { root: "C:\\my-app\\src", git: false } }), "warn  project   C:\\my-app\\src — no .git above; .crt/ will be created here (run from the repo root, or git init)"],
    ["another provider not on PATH", facts({ providers: [status("claude", { loggedIn: true }), status("codex", { installed: false, version: null, problem: CODEX_NOT_FOUND })], resolution: detected("claude", "codex not on PATH") }), `warn  codex     Codex CLI — ${CODEX_NOT_FOUND}`],
    ["another provider too old", facts({ providers: [status("claude", { loggedIn: true }), status("codex", { version: "0.100.0", problem: codexTooOld("0.100.0") })], resolution: detected("claude", "codex too old (0.100.0)") }), `warn  codex     Codex CLI 0.100.0 — ${codexTooOld("0.100.0")}`],
    ["a logged-out Claude demoted to Codex", facts({ providers: [status("claude", { loggedIn: false, problem: CLAUDE_NOT_LOGGED_IN }), status("codex", { loggedIn: true })], resolution: detected("codex", "claude not logged in") }), "warn  claude    Claude Code (Agent SDK 0.3.270) — not logged in — run `claude` in a terminal and complete /login"],
    ["plugin not installed", facts({ plugin: { claudeOnPath: true, installed: null } }), "warn  plugin    crt@crt not installed — run crt setup"],
    ["plugin older than this package", facts({ plugin: { claudeOnPath: true, installed: "0.2.0" } }), "warn  plugin    crt@crt 0.2.0 installed, this is 0.3.0 — run crt setup"],
    ["plugin list unreadable", facts({ plugin: { claudeOnPath: true, installed: null, error: "timed out" } }), "warn  plugin    could not read `claude plugin list --json` (timed out) — run crt setup"],
  ])("%s → warn row, exit 0", (_name, f, expected) => {
    const report = doctorRows(f);
    expect(renderDoctor(report).split("\n")).toContain(expected);
    expect(report.exitCode).toBe(0);
  });

  it("`--` rows: .crt not initialised, claude not on PATH (exit 0) (F-76)", () => {
    const f = facts({ crt: null, plugin: { claudeOnPath: false } });
    expect(row(f, ".crt")).toBe("--    .crt      not initialised — crt creates it");
    expect(row(f, "plugin")).toBe("--    plugin    claude not on PATH — skipped");
    expect(doctorRows(f).exitCode).toBe(0);
  });

  it("other rows: a found target, a partial .crt, login unknown, an explicit provider on the decision line (F-76, F-74)", () => {
    const f = facts({
      target: { origin: "http://localhost:3000", source: "probe", up: true },
      crt: { tasks: null, config: false, localConfig: false, ignore: false },
      providers: [status("claude"), status("codex", { loggedIn: true })],
      resolution: { provider: "codex", layer: "local", source: ".crt/config.local.json", decision: null, problem: null },
    });
    expect(row(f, "target")).toBe("ok    target    http://localhost:3000 (found) — responding");
    expect(row(f, ".crt")).toBe("ok    .crt      no tasks/, no config.json, no .gitignore entries");
    expect(row(f, "claude")).toBe("ok    claude    Claude Code (Agent SDK 0.3.270) — login unknown");
    expect(row(f, "codex")).toBe("ok    codex     Codex CLI 0.154.0 — logged in");
    expect(lines(f).at(-1)).toBe("→ codex (.crt/config.local.json)");
    expect(row(facts({ crt: { tasks: 1, config: true, localConfig: false, ignore: true } }), ".crt")).toBe("ok    .crt      tasks/ (1 task), config.json, .gitignore entries");
  });

  it("the start path omits the target and plugin rows (they are undefined, not null) (F-76, §13 decision 5)", () => {
    const { target: _t, plugin: _p, ...rest } = facts();
    const names = doctorRows(rest).rows.map((r) => r.name);
    expect(names).toEqual(["node", "project", ".crt", "port", "claude", "codex"]);
  });

  it("reads the crt@crt version out of `claude plugin list --json`, defensively (F-76, §12 rule 2)", () => {
    const list = JSON.stringify([{ id: "other@x", version: "1.0.0" }, { id: "crt@crt", version: "0.1.0", scope: "user", enabled: true }]);
    expect(installedPluginVersion(list)).toBe("0.1.0");
    expect(installedPluginVersion(JSON.stringify({ plugins: [{ id: "crt@crt", version: "0.2.0" }] }))).toBe("0.2.0");
    expect(installedPluginVersion(JSON.stringify([{ id: "crt@crt" }]))).toBe("?");
    expect(installedPluginVersion("[]")).toBeNull();
    expect(installedPluginVersion("not json")).toBeNull();
  });

  it("hasDevScript reads scripts.dev from the root package.json (F-71 hint)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "crt-doctor-"));
    try {
      expect(hasDevScript(tmp)).toBe(false);
      writeFileSync(join(tmp, "package.json"), '{"scripts":{"dev":"next dev -p 3100"}}');
      expect(hasDevScript(tmp)).toBe(true);
      writeFileSync(join(tmp, "package.json"), '{"scripts":{"build":"x"}}');
      expect(hasDevScript(tmp)).toBe(false);
      writeFileSync(join(tmp, "package.json"), "{ not json");
      expect(hasDevScript(tmp)).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
