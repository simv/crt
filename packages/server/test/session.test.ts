import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claudePreflight, claudeProfile, describeInput, describeSessionError, loginProblem, startSession, toolLabel } from "../src/providers/claude.js";
import type { SessionEvent } from "../src/session-events.js";
import { waitForEvent } from "./helpers/fake-cli.js";

// Pure helpers always run. The real Agent SDK session (PRD §12 smoke test) calls the model, so it
// runs only when asked for: CRT_SESSION_SMOKE=1, or CLAUDE_CODE_OAUTH_TOKEN set. A CLI credentials
// file alone does not opt in (CRT-0034): a plain local `npm test` spends no tokens and needs no network.

const loggedIn = !!process.env.CLAUDE_CODE_OAUTH_TOKEN || !!process.env.CRT_SESSION_SMOKE;

describe("tool labels and permission text (F-25, F-26)", () => {
  const cwd = process.platform === "win32" ? "C:\\proj" : "/proj";
  const abs = (p: string) => join(cwd, p);

  it("renders collapsed one-liners with project-relative paths", () => {
    expect(toolLabel("Read", { file_path: abs("src/a.ts") }, cwd)).toBe("Read src/a.ts");
    // Outside the project (sibling of cwd, so the same drive on Windows): shown verbatim.
    const outside = join(cwd, "..", "elsewhere", "b.ts");
    expect(toolLabel("Edit", { file_path: outside }, cwd)).toBe(`Edit ${outside}`);
    expect(toolLabel("Glob", { pattern: "**/*.tsx", path: abs("src") }, cwd)).toBe("Glob **/*.tsx in src");
    expect(toolLabel("Grep", { pattern: "cart-total" }, cwd)).toBe('Grep "cart-total"');
    expect(toolLabel("Bash", { command: "git status" }, cwd)).toBe("Bash git status");
    expect(toolLabel("mcp__crt__write_task", { title: "Fix it" }, cwd)).toBe("Write task: Fix it");
    expect(toolLabel("Weird", {}, cwd)).toBe("Weird");
  });

  it("describes the input of a permission card", () => {
    expect(describeInput("Bash", { command: "npm test" }, cwd)).toBe("npm test");
    expect(describeInput("Write", { file_path: abs(".crt/x.md") }, cwd)).toBe(".crt/x.md");
    expect(describeInput("Other", { a: 1 }, cwd)).toBe('{"a":1}');
  });
});

describe("failure messages (N-6)", () => {
  it("maps login problems and a missing binary to one actionable line", () => {
    expect(loginProblem("Invalid API key · Please run /login")).toContain("not logged in to Claude Code");
    expect(loginProblem("Not logged in")).toContain("/login");
    expect(loginProblem("some other failure")).toBeNull();
    expect(describeSessionError(new Error("Claude Code native binary not found at /x"))).toContain("Claude Code binary not found");
    expect(describeSessionError(new Error("spawn ENOENT"))).toContain("reinstall claude-review-tool");
    expect(describeSessionError(new Error("exit 1"), ["authentication_error: OAuth token expired"])).toContain("not logged in");
    expect(describeSessionError(new Error("exit 1"), ["a", "b"])).toBe("Claude Code session failed: exit 1 (a | b)");
  });
});

describe("claude profile (F-42, F-52)", () => {
  it("declares the F-44 markers, the launch signal, the F-46 reference capabilities and the resume command (F-42, F-52)", () => {
    expect(claudeProfile.id).toBe("claude");
    expect(claudeProfile.markers).toEqual({ private: [".claude/", "CLAUDE.md"], shared: ["AGENTS.md"] });
    expect(claudeProfile.launchEnv).toEqual(["CLAUDECODE"]);
    expect(claudeProfile.capabilities).toEqual({ streaming: true, toolEvents: true, permissions: "interactive", images: "inline", resume: true, interrupt: true, instructions: "system" });
    expect(claudeProfile.resumeCommand("abc")).toBe("claude --resume abc");
    expect(claudeProfile.telemetryOptOut).toEqual([]);
  });

  it("preflight finds the SDK's bundled binary, reports the SDK version and reads login from auth status (F-52, F-74)", async () => {
    // The real binary: whatever it says, the shape holds and the profile's preflight agrees.
    const p = await claudePreflight();
    expect(p).toMatchObject({ installed: true });
    expect([true, false, "unknown"]).toContain(p.loggedIn);
    expect(p.problem === null || p.loggedIn === false).toBe(true);
    expect(p.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(await claudeProfile.preflight()).toEqual(p);
    // A platform the SDK has no binary package for: the N-6 reinstall line, and no spawn.
    const missing = await claudePreflight({ platform: "sunos", arch: "mips", run: () => Promise.reject(new Error("must not run")) });
    expect(missing).toMatchObject({ installed: false, loggedIn: "unknown" });
    expect(missing.problem).toContain("@anthropic-ai/claude-agent-sdk-sunos-mips");
  });
});

describe.skipIf(!loggedIn)("Agent SDK session smoke test (F-24, F-25, F-28, F-47)", () => {
  let tmp: string;
  afterAll(() => {
    // The CLI process may still hold its cwd for a moment after close(); retry, then let it go.
    try {
      if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // temp dir; the OS cleans it up
    }
  });

  it(
    "starts a session with the given id in cwd, streams a reply, calls the CRT tool, and ends when closed",
    async () => {
      tmp = mkdtempSync(join(tmpdir(), "crt-sdk-"));
      mkdirSync(join(tmp, ".git"));
      const id = randomUUID();
      const events: SessionEvent[] = [];
      const writes: unknown[] = [];
      const driver = startSession({
        id,
        cwd: tmp,
        systemPromptAppend:
          "TEST MODE. Do exactly what the user says, nothing else. Do not read or list files. Keep replies under 20 words.",
        first: {
          text: 'Call the write_task tool once with title "Smoke test task", summary "smoke", context "smoke", ask "smoke", definitionOfDone ["works"]. Then reply with exactly: DONE',
        },
        decide: () => ({ kind: "allow" }),
        writeTask: async (req) => {
          writes.push(req);
          return { id: "CRT-9999", path: ".crt/tasks/CRT-9999-smoke-test-task.md" };
        },
        // The Claude driver serves write_task in-process (F-52): the F-49 launch is never spawned.
        mcp: { command: process.execPath, args: [], env: {} },
        model: null,
        permissionTimeoutMs: 1000,
      });
      driver.onEvent((e) => events.push(e));

      const idle = events[await waitForEvent(events, (e) => (e.type === "state" && (e.state === "idle" || e.state === "error")) || e.type === "error", 0, 120_000)];
      expect(idle, JSON.stringify(events.slice(-5))).toMatchObject({ type: "state", state: "idle" });

      const init = events.find((e) => e.type === "init") as Extract<SessionEvent, { type: "init" }>;
      // F-47/F-52: Claude adopted CRT's UUID, so both ids are the same and the resume hint is the profile's.
      expect(init).toMatchObject({
        sessionId: id,
        nativeSessionId: id,
        provider: "claude",
        displayName: claudeProfile.displayName,
        resumeCommand: claudeProfile.resumeCommand(id),
        capabilities: claudeProfile.capabilities,
      });
      expect(init.agentVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(init.model).toBeTruthy();
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({ title: "Smoke test task", definitionOfDone: ["works"] });
      expect(events).toContainEqual({ type: "task_written", id: "CRT-9999", path: ".crt/tasks/CRT-9999-smoke-test-task.md" });
      const text = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");
      expect(text).toContain("DONE");
      expect(events.find((e) => e.type === "result")).toMatchObject({ ok: true });

      driver.close();
      await waitForEvent(events, (e) => e.type === "state" && e.state === "ended", 0, 10_000);
    },
    150_000,
  );
});
