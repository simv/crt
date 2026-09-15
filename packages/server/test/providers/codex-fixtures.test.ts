// Recorded Codex CLI runs (PRD-providers F-53, milestone M6 / CRT-0009).
// Fixtures live in fixtures/codex/*.jsonl: `#` header lines (command, version, exit code),
// then one JSON event per line exactly as `codex exec --json` printed it. M9's conformance
// test (F-59) replays the same files, so the parsing rules here are the contract.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FIXTURES = fileURLToPath(new URL("./fixtures/codex/", import.meta.url));

// The three runs the M6 DoD asks for, recorded with a valid login. Until Simon records them
// the happy-path assertions are skipped (never faked); the auth-failed recordings below are
// real runs and are always checked.
const HAPPY_PATH = ["first-turn.jsonl", "resume.jsonl", "resume-after-kill.jsonl"];
const happyPathRecorded = HAPPY_PATH.every((f) => existsSync(join(FIXTURES, f)));

type CodexEvent = { type: string; thread_id?: string; [k: string]: unknown };

/** Splits a fixture into its `#` header lines and parsed events; throws on a bad line. */
export function parseFixture(name: string): { header: string[]; events: CodexEvent[] } {
  const lines = readFileSync(join(FIXTURES, name), "utf8").split("\n");
  const header: string[] = [];
  const events: CodexEvent[] = [];
  lines.forEach((line, i) => {
    if (line === "") return;
    if (line.startsWith("#")) {
      header.push(line.slice(1).trim());
      return;
    }
    try {
      events.push(JSON.parse(line) as CodexEvent);
    } catch (err) {
      throw new Error(`${name}:${i + 1}: not JSON — ${(err as Error).message}`);
    }
  });
  return { header, events };
}

const types = (events: CodexEvent[]) => events.map((e) => e.type);
const threadId = (events: CodexEvent[]) => events.find((e) => e.type === "thread.started")?.thread_id;

describe("codex fixtures (F-53, M6)", () => {
  const all = readdirSync(FIXTURES).filter((f) => f.endsWith(".jsonl"));

  it("every fixture has a header naming the tested version and command", () => {
    expect(all.length).toBeGreaterThan(0);
    for (const name of all) {
      const { header, events } = parseFixture(name);
      expect(header[0], name).toMatch(/^codex-cli \d+\.\d+\.\d+ /);
      expect(header.some((h) => /^command:/.test(h)), `${name} names its command`).toBe(true);
      expect(events.length, name).toBeGreaterThan(0);
      for (const e of events) expect(typeof e.type, `${name} event type`).toBe("string");
    }
  });

  it("every run starts with thread.started carrying a UUID thread_id, then turn.started", () => {
    for (const name of all) {
      const { events } = parseFixture(name);
      expect(types(events).slice(0, 2), name).toEqual(["thread.started", "turn.started"]);
      expect(threadId(events), name).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it("stale login surfaces as error + turn.failed, not in `login status` (N-7)", () => {
    const { events } = parseFixture("first-turn-auth-failed.jsonl");
    expect(types(events)).toEqual(["thread.started", "turn.started", "error", "turn.failed"]);
    const failed = events.find((e) => e.type === "turn.failed") as { error: { message: string } };
    expect(failed.error.message).toMatch(/log out and sign in again/);
  });

  it("exec resume re-emits thread.started with the same thread_id (F-53 resume assertion)", () => {
    expect(threadId(parseFixture("resume-auth-failed.jsonl").events)).toBe(
      threadId(parseFixture("first-turn-auth-failed.jsonl").events),
    );
    expect(threadId(parseFixture("resume-after-kill-auth-failed.jsonl").events)).toBe(
      threadId(parseFixture("first-turn-killed.jsonl").events),
    );
  });

  it("a turn killed with taskkill /T /F leaves only thread.started + turn.started", () => {
    expect(types(parseFixture("first-turn-killed.jsonl").events)).toEqual(["thread.started", "turn.started"]);
  });

  it.skipIf(!happyPathRecorded)(
    "fixtures parse and contain thread.started, item.completed, turn.completed (F-53)",
    () => {
      for (const name of HAPPY_PATH) {
        const t = types(parseFixture(name).events);
        expect(t, name).toContain("thread.started");
        expect(t, name).toContain("item.completed");
        expect(t, name).toContain("turn.completed");
        expect(t.at(-1), `${name} ends with turn.completed`).toBe("turn.completed");
      }
      // resume runs continue the first turn's thread
      const first = threadId(parseFixture("first-turn.jsonl").events);
      expect(threadId(parseFixture("resume.jsonl").events)).toBe(first);
      expect(threadId(parseFixture("resume-after-kill.jsonl").events)).toBe(
        threadId(parseFixture("first-turn-killed-live.jsonl").events),
      );
    },
  );

  type Item = { type: string; status?: string; tool?: string; server?: string; text?: string };
  const items = (events: CodexEvent[], type: string) =>
    events.filter((e) => e.type === type).map((e) => e.item as Item);

  it.skipIf(!happyPathRecorded)("write_task-shaped MCP calls complete under approval_policy=never only with default_tools_approval_mode=approve (F-53)", () => {
    const ok = items(parseFixture("first-turn.jsonl").events, "item.completed").find((i) => i.type === "mcp_tool_call");
    expect(ok).toMatchObject({ server: "crt", tool: "crt_ping", status: "completed" });
    const denied = items(parseFixture("first-turn-mcp-approval-denied.jsonl").events, "item.completed").find((i) => i.type === "mcp_tool_call");
    expect(denied).toMatchObject({ status: "failed" });
    expect(JSON.stringify(denied)).toMatch(/requires approval, but approval policy is never/);
  });

  it.skipIf(!happyPathRecorded)("agent text arrives whole in item.completed agent_message — no delta events (F-53)", () => {
    const events = parseFixture("first-turn.jsonl").events;
    const messages = items(events, "item.completed").filter((i) => i.type === "agent_message");
    expect(messages.length).toBeGreaterThan(0);
    expect(typeof messages[0].text).toBe("string");
    expect(types(events).filter((t) => /delta|item\.updated/.test(t))).toEqual([]);
    // command_execution and mcp_tool_call get item.started first; agent_message does not
    expect(items(events, "item.started").map((i) => i.type)).toEqual(["mcp_tool_call", "command_execution"]);
  });
});
