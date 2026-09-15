import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { SessionEvent } from "../src/session-events.js";
import { describeInput, describeSessionError, loginProblem, startSession, toolLabel } from "../src/session.js";

// Pure helpers always run. The real Agent SDK session (PRD §12 smoke test) runs only when a
// Claude login is available: CLAUDE_CODE_OAUTH_TOKEN, a CLI credentials file, or CRT_SESSION_SMOKE=1.
// CI has none of those, so it is skipped there.

const loggedIn =
  !!process.env.CLAUDE_CODE_OAUTH_TOKEN ||
  !!process.env.CRT_SESSION_SMOKE ||
  existsSync(join(homedir(), ".claude", ".credentials.json"));

describe("tool labels and permission text (F-25, F-26)", () => {
  const cwd = process.platform === "win32" ? "C:\\proj" : "/proj";
  const abs = (p: string) => join(cwd, p);

  it("renders collapsed one-liners with project-relative paths", () => {
    expect(toolLabel("Read", { file_path: abs("src/a.ts") }, cwd)).toBe("Read src/a.ts");
    expect(toolLabel("Edit", { file_path: "/elsewhere/b.ts" }, cwd)).toBe("Edit /elsewhere/b.ts");
    expect(toolLabel("Glob", { pattern: "**/*.tsx", path: abs("src") }, cwd)).toBe("Glob **/*.tsx in src");
    expect(toolLabel("Grep", { pattern: "cart-total" }, cwd)).toBe('Grep "cart-total"');
    expect(toolLabel("Bash", { command: "git status" }, cwd)).toBe("Bash git status");
    expect(toolLabel("mcp__crt__write_task", { title: "Fix it" }, cwd)).toBe('Write task "Fix it"');
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

describe.skipIf(!loggedIn)("Agent SDK session smoke test (F-24, F-25, F-28)", () => {
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
        permissionTimeoutMs: 1000,
      });
      driver.onEvent((e) => events.push(e));

      const idle = await waitFor(events, (e) => (e.type === "state" && (e.state === "idle" || e.state === "error")) || e.type === "error", 120_000);
      expect(idle, JSON.stringify(events.slice(-5))).toMatchObject({ type: "state", state: "idle" });

      const init = events.find((e) => e.type === "init") as Extract<SessionEvent, { type: "init" }>;
      expect(init.sessionId).toBe(id);
      expect(init.cwd.toLowerCase()).toBe(tmp.toLowerCase());
      expect(init.claudeCodeVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({ title: "Smoke test task", definitionOfDone: ["works"] });
      expect(events).toContainEqual({ type: "task_written", id: "CRT-9999", path: ".crt/tasks/CRT-9999-smoke-test-task.md" });
      const text = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");
      expect(text).toContain("DONE");
      expect(events.find((e) => e.type === "result")).toMatchObject({ ok: true });

      driver.close();
      await waitFor(events, (e) => e.type === "state" && e.state === "ended", 10_000);
    },
    150_000,
  );
});

function waitFor(events: SessionEvent[], pred: (e: SessionEvent) => boolean, timeoutMs: number): Promise<SessionEvent> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = events.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > timeoutMs) return reject(new Error(`timed out; last events: ${JSON.stringify(events.slice(-3))}`));
      setTimeout(tick, 50);
    };
    tick();
  });
}
