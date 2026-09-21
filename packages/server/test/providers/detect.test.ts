import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CrtConfig, DEFAULT_CONFIG } from "../../src/init.js";
import { CLAUDE_NOT_LOGGED_IN, claudeProfile } from "../../src/providers/claude.js";
import { acpNotFound } from "../../src/providers/acp.js";
import { CODEX_NOT_FOUND, CODEX_NOT_LOGGED_IN, codexProfile, codexTooOld } from "../../src/providers/codex.js";
import { detectProvider, formatDecision, scanMarkers } from "../../src/providers/detect.js";
import { stubProfile } from "../../src/providers/stub.js";
import type { PreflightResult, ProviderProfile } from "../../src/providers/types.js";
import { describeResolution, listProviders, ProviderRegistry, renderProviders } from "../../src/session.js";

// F-60: resolution (F-43) and auto-detection (F-44) over fixture roots × preflight stubs ×
// launch-env stubs × config layers, asserting the order, the F-44 table and the exact reasons.

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

// Preflight stubs.
const ok = (version: string | null, loggedIn: PreflightResult["loggedIn"] = "unknown"): PreflightResult => ({ installed: true, loggedIn, version, problem: null });
const CLAUDE_OK = ok("0.3.270");
const CODEX_OK = ok("0.154.0", true);
const CODEX_NOT_ON_PATH: PreflightResult = { installed: false, loggedIn: "unknown", version: null, problem: CODEX_NOT_FOUND };
const CODEX_LOGGED_OUT: PreflightResult = { installed: true, loggedIn: false, version: "0.154.0", problem: CODEX_NOT_LOGGED_IN };
const CODEX_TOO_OLD: PreflightResult = { installed: true, loggedIn: "unknown", version: "0.100.0", problem: codexTooOld("0.100.0") };

/** The real profile with its preflight replaced by a stub. */
const withPreflight = (p: ProviderProfile, result: PreflightResult): ProviderProfile => ({ ...p, preflight: async () => result });
const profiles = (claude = CLAUDE_OK, codex = CODEX_OK) => [withPreflight(claudeProfile, claude), withPreflight(codexProfile, codex)];

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "crt-detect-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** A fixture root with the given entries (`name/` = directory). */
function root(...entries: string[]): string {
  const dir = join(tmp, `root-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  for (const e of entries) {
    if (e.endsWith("/")) mkdirSync(join(dir, ...e.slice(0, -1).split("/")), { recursive: true });
    else writeFileSync(join(dir, e), "");
  }
  return dir;
}

async function registry(opts: { root: string; env?: NodeJS.ProcessEnv; config?: Partial<CrtConfig>; flag?: string | null; profiles?: ProviderProfile[] }): Promise<ProviderRegistry> {
  const r = new ProviderRegistry({
    root: opts.root,
    env: opts.env ?? {},
    config: { ...DEFAULT_CONFIG, ...(opts.config ?? {}) },
    flag: opts.flag ?? null,
    profiles: opts.profiles ?? profiles(),
  });
  await r.refresh();
  return r;
}

const detect = (dir: string, preflights: Record<string, PreflightResult>, env: NodeJS.ProcessEnv = {}) => formatDecision(detectProvider({ root: dir, env, profiles: profiles(), preflights }));

describe("marker scan (F-44 step 3)", () => {
  it("finds directory and file markers in the root only, names only, in profile order (F-44)", () => {
    const dir = root(".claude/", "CLAUDE.md", "AGENTS.md", "packages/web/.codex/", "CLAUDE.md.bak");
    expect(scanMarkers(dir, profiles())).toEqual({ claude: [".claude/", "CLAUDE.md", "AGENTS.md"], codex: ["AGENTS.md"] });
    // A file named like a directory marker (and vice versa) does not count.
    const odd = root(".codex", "CLAUDE.md/");
    expect(scanMarkers(odd, profiles())).toEqual({ claude: [], codex: [] });
    expect(scanMarkers(join(tmp, "missing"), profiles())).toEqual({ claude: [], codex: [] });
  });
});

describe("auto-detection (F-44)", () => {
  const both = { claude: CLAUDE_OK, codex: CODEX_OK };

  it("worked examples with Claude and Codex installed and logged in (F-44)", () => {
    expect(detect(root("AGENTS.md"), both)).toBe("codex — AGENTS.md, no Claude markers; codex 0.154.0 logged in");
    expect(detect(root("CLAUDE.md", "AGENTS.md"), both)).toBe("claude — CLAUDE.md, AGENTS.md");
    expect(detect(root(".codex/", "CLAUDE.md"), both)).toBe("claude — tie between claude (CLAUDE.md) and codex (.codex/)");
    expect(detect(root(), both)).toBe("claude (default)");
    expect(detect(root(".claude/", "CLAUDE.md"), both)).toBe("claude — .claude/, CLAUDE.md");
    expect(detect(root(".codex/", "AGENTS.md"), both)).toBe("codex — .codex/, AGENTS.md, no Claude markers; codex 0.154.0 logged in");
    // A nested .codex/ is not a marker: root only, no recursion.
    expect(detect(root("packages/web/.codex/"), both)).toBe("claude (default)");
  });

  it("`.codex/` only with Codex not on PATH → claude with the \"looks like codex\" reason (F-44 step 4)", () => {
    const failing = { claude: CLAUDE_OK, codex: CODEX_NOT_ON_PATH };
    expect(detect(root(".codex/"), failing)).toBe("claude — project looks like codex (.codex/) but codex is not on PATH");
    expect(detect(root(".codex/"), { claude: CLAUDE_OK, codex: CODEX_LOGGED_OUT })).toBe("claude — project looks like codex (.codex/) but codex is not logged in");
    expect(detect(root(".codex/"), { claude: CLAUDE_OK, codex: CODEX_TOO_OLD })).toBe("claude — project looks like codex (.codex/) but codex is too old (0.100.0)");
    // AGENTS.md is shared, so it never makes a project "look like" codex.
    expect(detect(root("AGENTS.md"), failing)).toBe("claude — AGENTS.md; codex not on PATH");
  });

  it("only claude usable → claude, with its markers and the unusable agent named, as `crt providers` prints it (F-44 step 2, F-45)", () => {
    const failing = { claude: CLAUDE_OK, codex: CODEX_NOT_ON_PATH };
    expect(detect(root(".claude/", "CLAUDE.md"), failing)).toBe("claude — .claude/, CLAUDE.md; codex not on PATH");
    expect(detect(root(), failing)).toBe("claude — codex not on PATH");
    // Nothing usable at all still answers claude (Goal 2); the reason says why it will fail.
    expect(detect(root(), { claude: { ...CLAUDE_OK, installed: false, problem: "x" }, codex: CODEX_NOT_ON_PATH })).toBe("claude — claude not on PATH; codex not on PATH");
  });

  it("launch context wins over markers when that agent passes preflight (F-44 step 1)", () => {
    expect(detect(root("AGENTS.md"), both, { CLAUDECODE: "1" })).toBe("claude — started inside Claude (CLAUDECODE)");
    expect(detect(root("CLAUDE.md"), both, { CODEX_SESSION_ID: "01a0" })).toBe("codex — started inside Codex (CODEX_SESSION_ID)");
    // An empty variable is not a signal; a failing agent's signal is ignored.
    expect(detect(root("CLAUDE.md"), both, { CODEX_THREAD_ID: "" })).toBe("claude — CLAUDE.md");
    expect(detect(root("AGENTS.md"), { claude: CLAUDE_OK, codex: CODEX_NOT_ON_PATH }, { CODEX_THREAD_ID: "x" })).toBe("claude — AGENTS.md; codex not on PATH");
  });

  it("this repo → `→ claude — .claude/, CLAUDE.md`, the M7 DoD line (F-44, F-45)", () => {
    expect(detect(REPO_ROOT, both)).toBe("claude — .claude/, CLAUDE.md");
  });

  it("a logged-out Claude is demoted when another provider is usable, and stays the default otherwise (PRD-setup F-74, F-60 rows)", () => {
    const claudeOut: PreflightResult = { installed: true, loggedIn: false, version: "0.3.270", problem: CLAUDE_NOT_LOGGED_IN };
    expect(detect(root(), { claude: claudeOut, codex: CODEX_OK })).toBe("codex — claude not logged in");
    expect(detect(root("AGENTS.md"), { claude: claudeOut, codex: CODEX_OK })).toBe("codex — AGENTS.md, no Claude markers; codex 0.154.0 logged in; claude not logged in");
    // The project points at Claude, but Claude cannot be used: Codex, with the reason naming both.
    expect(detect(root(".claude/", "CLAUDE.md"), { claude: claudeOut, codex: CODEX_OK })).toBe("codex — project looks like claude (.claude/, CLAUDE.md) but claude is not logged in");
    // Nothing else usable: claude by default, with the reason.
    expect(detect(root(), { claude: claudeOut, codex: CODEX_NOT_ON_PATH })).toBe("claude — claude not logged in; codex not on PATH");
    expect(detect(root(), { claude: claudeOut, codex: CODEX_LOGGED_OUT })).toBe("claude — claude not logged in; codex not logged in");
  });
});

describe("resolution order (F-43)", () => {
  it("0: CRT_SESSION_STUB=1 wins over everything and is the only way to reach the stub (F-42, F-43)", async () => {
    const r = await registry({ root: root("AGENTS.md"), env: { CRT_SESSION_STUB: "1", CRT_PROVIDER: "codex" }, flag: "codex", config: { provider: "codex", providerSource: "project" } });
    expect(r.resolve("codex")).toMatchObject({ provider: "stub", layer: "stub", source: "CRT_SESSION_STUB", problem: null });
    expect(r.ids()).toEqual(["claude", "codex", "stub"]);
    expect(listProviders({}).map((p) => p.id)).toEqual(["claude", "codex", "gemini", "antigravity"]);
    expect(listProviders({ CRT_SESSION_STUB: "1" }).map((p) => p.id)).toEqual(["claude", "codex", "gemini", "antigravity", "stub"]);
    const without = await registry({ root: root(), env: {} });
    expect(without.resolve("stub").problem).toBe('provider "stub" is not a built-in provider (claude, codex)');
    expect(stubProfile.id).toBe("stub");
  });

  it("1: the request body beats the active provider, config and detection (F-43)", async () => {
    const r = await registry({ root: root("AGENTS.md"), env: { CRT_PROVIDER: "codex" }, flag: "codex", config: { provider: "codex", providerSource: "local" } });
    expect(r.resolve("claude")).toMatchObject({ provider: "claude", layer: "request", source: "request", problem: null });
    expect(r.resolve(null)).toMatchObject({ provider: "codex", layer: "active", source: "--provider" });
  });

  it("2: --provider beats CRT_PROVIDER, which beats the config files (F-43)", async () => {
    const dir = root("AGENTS.md");
    expect((await registry({ root: dir, env: { CRT_PROVIDER: "codex" }, flag: "claude", config: { provider: "codex", providerSource: "local" } })).resolve()).toMatchObject({ provider: "claude", layer: "active", source: "--provider" });
    expect((await registry({ root: dir, env: { CRT_PROVIDER: "claude" }, config: { provider: "codex", providerSource: "local" } })).resolve()).toMatchObject({ provider: "claude", layer: "active", source: "CRT_PROVIDER" });
  });

  it("2: PUT /__crt/config replaces the --provider flag for the life of the process (F-43, F-57)", async () => {
    const r = await registry({ root: root("AGENTS.md"), flag: "claude" });
    expect(r.resolve()).toMatchObject({ provider: "claude", source: "--provider" });
    expect(r.setActive("codex")).toEqual({ ok: true });
    expect(r.resolve()).toMatchObject({ provider: "codex", layer: "active", source: "PUT /__crt/config", problem: null });
    // Only a listed string id whose preflight passes is accepted (N-8).
    expect(r.setActive("gemini")).toEqual({ ok: false, error: 'provider "gemini" is not a built-in provider (claude, codex)' });
    expect(r.setActive({ kind: "acp", command: "x" })).toEqual({ ok: false, error: "provider must be one of claude, codex" });
    expect(r.setActive("stub")).toMatchObject({ ok: false });
    const down = await registry({ root: root(), flag: "claude", profiles: profiles(CLAUDE_OK, CODEX_NOT_ON_PATH) });
    expect(down.setActive("codex")).toEqual({ ok: false, error: CODEX_NOT_FOUND });
    expect(down.resolve()).toMatchObject({ provider: "claude", source: "--provider" });
  });

  it("3–4: .crt/config.local.json beats .crt/config.json; both beat detection (F-43)", async () => {
    const dir = root("AGENTS.md"); // detection alone would say codex
    expect((await registry({ root: dir, config: { provider: "claude", providerSource: "local" } })).resolve()).toMatchObject({ provider: "claude", layer: "local", source: ".crt/config.local.json", problem: null });
    expect((await registry({ root: dir, config: { provider: "claude", providerSource: "project" } })).resolve()).toMatchObject({ provider: "claude", layer: "project", source: ".crt/config.json", problem: null });
    // F-54: the ACP object form registers the ad-hoc `acp` profile and names it — explicit, so it fails rather than falls back when the command is missing.
    const adHoc = { kind: "acp" as const, command: process.execPath, args: ["fake-agent.mjs"], name: "My Agent" };
    const acp = await registry({ root: dir, config: { provider: adHoc, providerSource: "project", acp: adHoc } });
    expect(acp.ids()).toEqual(["claude", "codex", "acp"]);
    expect(acp.get("acp")).toMatchObject({ id: "acp", displayName: "My Agent", capabilities: { resume: false, permissions: "interactive" } });
    expect(acp.resolve()).toMatchObject({ provider: "acp", layer: "project", source: ".crt/config.json", problem: null });
    // A local `provider: "acp"` string still finds the project file's object (`config.acp`).
    const viaLocal = await registry({ root: dir, config: { provider: "acp", providerSource: "local", acp: adHoc } });
    expect(viaLocal.resolve()).toMatchObject({ provider: "acp", layer: "local", source: ".crt/config.local.json", problem: null });
    const missing = { ...adHoc, command: "no-such-agent" };
    const gone = await registry({ root: dir, config: { provider: missing, providerSource: "project", acp: missing } });
    expect(gone.resolve()).toMatchObject({ provider: "acp", layer: "project", problem: acpNotFound("no-such-agent") });
    // Never from a route (N-8): the object is refused, and the id is unknown without a config object.
    expect(acp.setActive({ kind: "acp", command: "x" })).toEqual({ ok: false, error: "provider must be one of claude, codex, acp" });
    expect((await registry({ root: dir })).resolve("acp").problem).toBe('provider "acp" is not a built-in provider (claude, codex)');
  });

  it("5–6: detection, then claude by default (F-43, F-44)", async () => {
    expect((await registry({ root: root("AGENTS.md") })).resolve()).toMatchObject({ provider: "codex", layer: "detected", source: "codex — AGENTS.md, no Claude markers; codex 0.154.0 logged in", problem: null });
    expect((await registry({ root: root() })).resolve()).toMatchObject({ provider: "claude", layer: "default", source: "claude (default)", decision: { provider: "claude", reason: null }, problem: null });
  });

  it("an explicitly chosen provider that fails preflight is not replaced: the N-7 problem comes back (F-43, N-7)", async () => {
    const dir = root("CLAUDE.md");
    const down = profiles(CLAUDE_OK, CODEX_LOGGED_OUT);
    for (const r of [
      await registry({ root: dir, flag: "codex", profiles: down }),
      await registry({ root: dir, env: { CRT_PROVIDER: "codex" }, profiles: down }),
      await registry({ root: dir, config: { provider: "codex", providerSource: "local" }, profiles: down }),
      await registry({ root: dir, config: { provider: "codex", providerSource: "project" }, profiles: down }),
    ]) {
      expect(r.resolve()).toMatchObject({ provider: "codex", problem: CODEX_NOT_LOGGED_IN });
    }
    expect((await registry({ root: dir, profiles: down })).resolve("codex")).toMatchObject({ provider: "codex", layer: "request", problem: CODEX_NOT_LOGGED_IN });
    expect((await registry({ root: dir, config: { provider: "gemini", providerSource: "project" } })).resolve()).toMatchObject({ provider: "gemini", layer: "project", problem: 'provider "gemini" is not a built-in provider (claude, codex)' });
    // Only detection falls back.
    expect((await registry({ root: root(".codex/"), profiles: down })).resolve()).toMatchObject({ provider: "claude", layer: "detected", source: "claude — project looks like codex (.codex/) but codex is not logged in" });
  });

  it("describeResolution renders the `provider:` phrase of the CRT ready line (F-44, N-7)", async () => {
    expect(describeResolution((await registry({ root: root(), flag: "codex" })).resolve())).toBe("codex (--provider)");
    expect(describeResolution((await registry({ root: root(), env: { CRT_SESSION_STUB: "1" } })).resolve())).toBe("stub (CRT_SESSION_STUB)");
    expect(describeResolution((await registry({ root: root("AGENTS.md") })).resolve())).toBe("codex — AGENTS.md, no Claude markers; codex 0.154.0 logged in");
    expect(describeResolution((await registry({ root: root() })).resolve())).toBe("claude (default)");
    expect(describeResolution((await registry({ root: root(), config: { provider: "codex", providerSource: "local" }, profiles: profiles(CLAUDE_OK, CODEX_NOT_ON_PATH) })).resolve())).toBe(`codex (.crt/config.local.json) — ${CODEX_NOT_FOUND}`);
  });

  it("a preflight that throws counts as failing, and refresh() re-runs it (F-44, F-45 --refresh)", async () => {
    let calls = 0;
    const flaky: ProviderProfile = {
      ...codexProfile,
      preflight: async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return CODEX_OK;
      },
    };
    const r = await registry({ root: root("AGENTS.md"), profiles: [withPreflight(claudeProfile, CLAUDE_OK), flaky] });
    expect(r.preflight("codex")).toMatchObject({ installed: false, problem: "codex preflight failed: boom" });
    expect(r.resolve()).toMatchObject({ provider: "claude", source: "claude — AGENTS.md; codex not on PATH" });
    await r.refresh();
    expect(r.resolve()).toMatchObject({ provider: "codex" });
    expect(calls).toBe(2);
  });
});

describe("crt providers (F-45, F-57)", () => {
  it("prints one row per built-in profile and the decision line, in the exact layout (F-45)", async () => {
    const r = await registry({ root: root(".claude/", "CLAUDE.md", "AGENTS.md"), profiles: profiles({ ...CLAUDE_OK, version: null }, CODEX_NOT_ON_PATH) });
    expect(renderProviders(r.status(), r.detection())).toBe(
      [
        "claude   ready        Claude Code (Agent SDK)    login unknown                            markers: .claude/, CLAUDE.md, AGENTS.md",
        "codex    not on PATH  Codex CLI                  install: npm i -g @openai/codex          markers: AGENTS.md",
        "→ claude — .claude/, CLAUDE.md, AGENTS.md; codex not on PATH",
      ].join("\n"),
    );
    // Longer values (a version, "not logged in", a problem line) widen only their own column; rows stay aligned.
    const states = await registry({ root: root(), profiles: profiles(CLAUDE_OK, CODEX_LOGGED_OUT) });
    expect(renderProviders(states.status(), states.detection())).toBe(
      [
        "claude   ready          Claude Code (Agent SDK) 0.3.270  login unknown                            markers: none",
        "codex    not logged in  Codex CLI 0.154.0                not logged in — codex login              markers: none",
        "→ claude — codex not logged in",
      ].join("\n"),
    );
    const old = await registry({ root: root(), profiles: profiles(ok("0.3.270", true), CODEX_TOO_OLD) });
    const lines = renderProviders(old.status(), old.detection()).split("\n");
    expect(lines[0]).toMatch(/^claude   ready        Claude Code \(Agent SDK\) 0\.3\.270  logged in\s+markers: none$/);
    expect(lines[1]).toMatch(new RegExp(`^codex    too old      Codex CLI 0\\.100\\.0                ${codexTooOld("0.100.0").replace(/[.()@]/g, "\\$&")}  markers: none$`));
    expect(lines[0]!.indexOf("markers:")).toBe(lines[1]!.indexOf("markers:"));
    expect(lines[2]).toBe("→ claude — codex too old (0.100.0)");
  });

  it("--json returns the payload without stub, hints or the human state (F-45, F-57)", async () => {
    const r = await registry({ root: root("AGENTS.md"), env: { CRT_PROVIDER: "claude" } });
    const payload = r.payload();
    expect(payload).toEqual({
      ok: true,
      active: "claude",
      decision: { provider: "codex", reason: "AGENTS.md, no Claude markers; codex 0.154.0 logged in" },
      providers: [
        { id: "claude", displayName: "Claude", installed: true, loggedIn: "unknown", version: "0.3.270", problem: null, markers: ["AGENTS.md"], capabilities: claudeProfile.capabilities },
        { id: "codex", displayName: "Codex", installed: true, loggedIn: true, version: "0.154.0", problem: null, markers: ["AGENTS.md"], capabilities: codexProfile.capabilities },
      ],
    });
    const withStub = await registry({ root: root(), env: { CRT_SESSION_STUB: "1" } });
    expect(withStub.payload().providers.map((p) => p.id)).toEqual(["claude", "codex", "stub"]);
    expect(withStub.payload().active).toBe("stub");
  });
});
