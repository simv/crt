import { describe, expect, it } from "vitest";
import { type DoctorFacts, doctorRows, hasDevScript, installedPluginVersion, integrationFact, renderDoctor, renderRow } from "../src/doctor.js";
import { CLAUDE_NOT_LOGGED_IN } from "../src/providers/claude.js";
import { CODEX_NOT_FOUND, CODEX_NOT_LOGGED_IN, codexTooOld } from "../src/providers/codex.js";
import { preflightState } from "../src/providers/types.js";
import type { ProviderStatus, Resolution } from "../src/session.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// PRD-setup F-76: doctor rows and exit code over facts, with the wordings verbatim. `FAIL` (exit 1)
// only for node too old, target down/unset (proxy mode), port held, the resolved provider unusable;
// `warn` (exit 0) for another provider's problem and the plugin row. PRD-embedded F-103 adds the
// `mode`, `integration` and `instructions` rows, the soft `target` in embedded mode and the
// `.crt` variants — none of which can FAIL.

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
    crt: { readme: true, tasks: 4, config: true, localConfig: true, ignore: true },
    mode: { mode: "embedded", source: null },
    target: { origin: "http://localhost:3100", source: "local", up: true },
    integration: { kind: "embedded", framework: "next", file: "app/layout.tsx", found: "react" },
    instructions: [{ file: "CLAUDE.md", hasBlock: true }],
    port: { port: 4400, state: "free" },
    providers: [status("claude", { loggedIn: true }), status("codex", { loggedIn: false, problem: CODEX_NOT_LOGGED_IN })],
    resolution: detected("claude", "codex not logged in"),
    version: "0.3.0",
    plugin: { claudeOnPath: true, installed: "0.3.0" },
    ...over,
  };
}

const lines = (f: DoctorFacts) => renderDoctor(doctorRows(f)).split("\n");
/** Proxy mode facts: `mode` from config.json, no integration to check. */
const PROXY: Partial<DoctorFacts> = { mode: { mode: "proxy", source: "project" }, integration: { kind: "proxy" } };
const row = (f: DoctorFacts, name: string) => renderRow(doctorRows(f).rows.find((r) => r.name === name)!);

describe("crt doctor (PRD-setup F-76)", () => {
  it("renders the F-76 sample (with the F-103 rows) verbatim and exits 0 on a healthy Claude-only machine with Codex logged out (F-76, F-103)", () => {
    const report = doctorRows(facts());
    expect(renderDoctor(report)).toBe(
      [
        "ok    node      v22.4.0 (needs 20 or newer)",
        "ok    project   C:\\my-app (.git)",
        "ok    .crt      README.md, tasks/ (4 tasks), config.json, config.local.json, .gitignore entries",
        "ok    mode      embedded",
        "ok    target    http://localhost:3100 (remembered) — responding",
        "ok    integration next — app/layout.tsx imports claude-review-tool/react",
        "ok    instructions CLAUDE.md carries the CRT section",
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
    ["no target and nothing probed (proxy mode)", facts({ ...PROXY, target: null }), "FAIL  target    none set and nothing on the probed ports — crt <port>"],
    ["remembered target down (proxy mode)", facts({ ...PROXY, target: { origin: "http://localhost:3100", source: "local", up: false } }), "FAIL  target    http://localhost:3100 (remembered) — not responding"],
    ["config.json target down (proxy mode)", facts({ ...PROXY, target: { origin: "http://localhost:3000", source: "project", up: false } }), "FAIL  target    http://localhost:3000 (.crt/config.json) — not responding"],
    [
      "port held by CRT for this project",
      facts({ port: { port: 4400, state: "crt", thisProject: true, health: { version: "0.3.0", startedAt: null, target: "http://localhost:3000", projectRoot: "C:\\my-app", sessions: 0, mode: null } } }),
      "FAIL  port      4400 held by CRT 0.3.0 → http://localhost:3000 (this project) — crt --replace",
    ],
    [
      "port held by CRT for another project",
      facts({ port: { port: 4400, state: "crt", thisProject: false, health: { version: "0.2.0", startedAt: null, target: "http://localhost:3000", projectRoot: "C:\\other", sessions: 0, mode: null } } }),
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

  it("`--` rows: .crt not initialised (run crt init), claude not on PATH (exit 0) (F-76, F-99, F-103)", () => {
    const f = facts({ crt: null, plugin: { claudeOnPath: false } });
    expect(row(f, ".crt")).toBe("--    .crt      not initialised — run crt init");
    expect(row(f, "plugin")).toBe("--    plugin    claude not on PATH — skipped");
    expect(doctorRows(f).exitCode).toBe(0);
  });

  it.each([
    ["no README (a pre-v0.4 folder)", facts({ crt: { readme: false, tasks: 4, config: true, localConfig: false, ignore: true } }), "warn  .crt      tasks/ (4 tasks), config.json, .gitignore entries — no README.md — run crt init"],
    ["embedded target remembered but down", facts({ target: { origin: "http://localhost:3100", source: "local", up: false } }), "warn  target    http://localhost:3100 (remembered) — not responding"],
    ["integration not found (next)", facts({ integration: { kind: "embedded", framework: "next", file: "app/layout.tsx", found: null } }), "warn  integration not found (next) — run crt init for the snippet, or crt proxy"],
    ["integration not found, no candidate file (bundled)", facts({ integration: { kind: "embedded", framework: "bundled", file: null, found: null } }), "warn  integration not found (bundled) — run crt init for the snippet, or crt proxy"],
    ["CLAUDE.md without the section", facts({ instructions: [{ file: "CLAUDE.md", hasBlock: false }] }), "warn  instructions CLAUDE.md has no CRT section — crt init adds it"],
    ["both files without the section", facts({ instructions: [{ file: "CLAUDE.md", hasBlock: false }, { file: "AGENTS.md", hasBlock: false }] }), "warn  instructions CLAUDE.md and AGENTS.md have no CRT section — crt init adds it"],
    ["one of two files without the section", facts({ instructions: [{ file: "CLAUDE.md", hasBlock: true }, { file: "AGENTS.md", hasBlock: false }] }), "warn  instructions AGENTS.md has no CRT section — crt init adds it"],
  ])("%s → warn row, exit 0 (F-103)", (_name, f, expected) => {
    const report = doctorRows(f);
    expect(renderDoctor(report).split("\n")).toContain(expected);
    expect(report.exitCode).toBe(0);
  });

  it.each([
    ["mode proxy from config.json", facts(PROXY), "ok    mode      proxy (.crt/config.json)"],
    ["mode embedded from config.local.json", facts({ mode: { mode: "embedded", source: "local" } }), "ok    mode      embedded (.crt/config.local.json)"],
    ["embedded, no target set and nothing found", facts({ target: null }), "--    target    none set; crt opens nothing (crt <port> to remember one)"],
    ["integration in proxy mode", facts(PROXY), "--    integration proxy mode"],
    ["integration vite", facts({ integration: { kind: "embedded", framework: "vite", file: "vite.config.ts", found: "vite" } }), "ok    integration vite — vite.config.ts uses claude-review-tool/vite"],
    ["integration loader (react app)", facts({ integration: { kind: "embedded", framework: "react", file: "src/main.tsx", found: "loader" } }), "ok    integration loader — src/main.tsx imports claude-review-tool/loader"],
    ["integration loader (bundled app, script tag)", facts({ integration: { kind: "embedded", framework: "bundled", file: "src/index.ts", found: "script" } }), "ok    integration loader — src/index.ts loads /__crt/loader.js"],
    ["integration static", facts({ integration: { kind: "embedded", framework: "static", file: null, found: null } }), "--    integration static page — add the <script> tag (crt init --snippet)"],
    ["instructions in both files", facts({ instructions: [{ file: "CLAUDE.md", hasBlock: true }, { file: "AGENTS.md", hasBlock: true }] }), "ok    instructions CLAUDE.md and AGENTS.md carry the CRT section"],
    ["instructions, neither file", facts({ instructions: [] }), "--    instructions no CLAUDE.md or AGENTS.md — crt init creates one"],
  ])("%s → row, exit 0 (F-103)", (_name, f, expected) => {
    const report = doctorRows(f);
    expect(renderDoctor(report).split("\n")).toContain(expected);
    expect(report.exitCode).toBe(0);
  });

  it("an un-initialised embedded project with nothing else wrong exits 0 (F-103)", () => {
    const f = facts({ crt: null, target: null, integration: { kind: "embedded", framework: "bundled", file: null, found: null }, instructions: [], plugin: { claudeOnPath: false } });
    const report = doctorRows(f);
    expect(report.rows.map((r) => r.status)).not.toContain("FAIL");
    expect(report.exitCode).toBe(0);
  });

  it("other rows: a found target, a partial .crt, login unknown, an explicit provider on the decision line (F-76, F-74)", () => {
    const f = facts({
      target: { origin: "http://localhost:3000", source: "probe", up: true },
      crt: { readme: true, tasks: 0, config: false, localConfig: false, ignore: false },
      providers: [status("claude"), status("codex", { loggedIn: true })],
      resolution: { provider: "codex", layer: "local", source: ".crt/config.local.json", decision: null, problem: null },
    });
    expect(row(f, "target")).toBe("ok    target    http://localhost:3000 (found) — responding");
    expect(row(f, ".crt")).toBe("ok    .crt      README.md, tasks/ (0 tasks), no config.json, no .gitignore entries");
    expect(row(f, "claude")).toBe("ok    claude    Claude Code (Agent SDK 0.3.270) — login unknown");
    expect(row(f, "codex")).toBe("ok    codex     Codex CLI 0.154.0 — logged in");
    expect(lines(f).at(-1)).toBe("→ codex (.crt/config.local.json)");
    expect(row(facts({ crt: { readme: true, tasks: 1, config: true, localConfig: false, ignore: true } }), ".crt")).toBe("ok    .crt      README.md, tasks/ (1 task), config.json, .gitignore entries");
  });

  it("the `self` port fact renders `ok    port      <port> — this server` — the F-113 route inside the running server (PRD-polish F-113)", () => {
    const f = facts({ port: { port: 4400, state: "self" } });
    expect(row(f, "port")).toBe("ok    port      4400 — this server");
    expect(doctorRows(f).exitCode).toBe(0);
    expect(row(facts({ port: { port: 4401, state: "self" } }), "port")).toBe("ok    port      4401 — this server");
  });

  it("the start path omits the target and plugin rows (they are undefined, not null) (F-76, §13 decision 5)", () => {
    const { target: _t, plugin: _p, ...rest } = facts();
    const names = doctorRows(rest).rows.map((r) => r.name);
    expect(names).toEqual(["node", "project", ".crt", "mode", "integration", "instructions", "port", "claude", "codex"]);
  });

  it("reads the crt@crt version out of `claude plugin list --json`, defensively (F-76, §12 rule 2)", () => {
    const list = JSON.stringify([{ id: "other@x", version: "1.0.0" }, { id: "crt@crt", version: "0.1.0", scope: "user", enabled: true }]);
    expect(installedPluginVersion(list)).toBe("0.1.0");
    expect(installedPluginVersion(JSON.stringify({ plugins: [{ id: "crt@crt", version: "0.2.0" }] }))).toBe("0.2.0");
    expect(installedPluginVersion(JSON.stringify([{ id: "crt@crt" }]))).toBe("?");
    expect(installedPluginVersion("[]")).toBeNull();
    expect(installedPluginVersion("not json")).toBeNull();
  });

  it("integrationFact reads only the F-102 candidate files of the detected framework (F-103)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "crt-doctor-"));
    try {
      writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: { next: "16" } }));
      mkdirSync(join(tmp, "app"));
      writeFileSync(join(tmp, "app", "layout.tsx"), "export default function Layout() {}\n");
      // An import elsewhere does not count: only the candidates are read.
      mkdirSync(join(tmp, "src"));
      writeFileSync(join(tmp, "src", "main.tsx"), 'import { mountCrt } from "claude-review-tool/loader";\n');
      expect(integrationFact(tmp)).toEqual({ kind: "embedded", framework: "next", file: "app/layout.tsx", found: null });
      writeFileSync(join(tmp, "app", "layout.tsx"), 'import { CrtDevTools } from "claude-review-tool/react";\n');
      expect(integrationFact(tmp)).toEqual({ kind: "embedded", framework: "next", file: "app/layout.tsx", found: "react" });
      writeFileSync(join(tmp, "app", "layout.tsx"), '<script src="http://localhost:4400/__crt/loader.js"></script>\n');
      expect(integrationFact(tmp)).toEqual({ kind: "embedded", framework: "next", file: "app/layout.tsx", found: "script" });
      writeFileSync(join(tmp, "package.json"), JSON.stringify({ devDependencies: { vite: "8" } }));
      expect(integrationFact(tmp)).toEqual({ kind: "embedded", framework: "vite", file: null, found: null });
      writeFileSync(join(tmp, "vite.config.ts"), 'import { crt } from "claude-review-tool/vite";\n');
      expect(integrationFact(tmp)).toEqual({ kind: "embedded", framework: "vite", file: "vite.config.ts", found: "vite" });
      rmSync(join(tmp, "package.json"));
      expect(integrationFact(tmp)).toEqual({ kind: "embedded", framework: "static", file: null, found: null });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
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
