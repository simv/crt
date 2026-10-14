import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { PERMISSION_TIMEOUT_MS, ruleAllows, suggestRule } from "../../src/permissions.js";
import { createEmitter, createPermissionBroker, createTurnQueue, describeTimeout, initEvent, type PermissionCard } from "../../src/providers/driver-core.js";
import { makeStubProfile, stubProfile } from "../../src/providers/stub.js";
import type { AllowList, SessionEvent, UserInput } from "../../src/session-events.js";

// The session kit every driver is built on (PRD-providers §5, F-46, F-59; CRT-0041): the emitter,
// the turn queue, the permission broker and the `init` event. The drivers' own suites (and the F-59
// conformance scenario) cover them in place; these pin the contract each piece keeps on its own.

afterEach(() => {
  vi.useRealTimers();
});

/** An emitter with a recording listener and a log. */
function recorded() {
  const logs: string[] = [];
  const em = createEmitter((line) => logs.push(line));
  const events: SessionEvent[] = [];
  em.onEvent((e) => events.push(e));
  return { em, events, logs };
}

describe("createEmitter (CRT-0041)", () => {
  it("delivers every event to every listener; one that throws is logged and skipped, the rest still hear it (F-42, F-59)", () => {
    const logs: string[] = [];
    const em = createEmitter((line) => logs.push(line));
    const heard: string[] = [];
    em.onEvent(() => {
      throw new Error("first listener broke");
    });
    const off = em.onEvent((e) => heard.push(`b:${e.type}`));
    em.onEvent((e) => heard.push(`c:${e.type}`));
    em.emit({ type: "error", message: "x" });
    expect(heard).toEqual(["b:error", "c:error"]);
    expect(logs).toEqual(["crt: a session listener failed on error: first listener broke"]);
    off();
    em.emit({ type: "state", state: "idle" });
    expect(heard).toEqual(["b:error", "c:error", "c:state"]);
    // No log function: the failure is still contained.
    const quiet = createEmitter();
    quiet.onEvent(() => {
      throw new Error("x");
    });
    expect(() => quiet.emit({ type: "state", state: "idle" })).not.toThrow();
  });

  it("setState emits and tracks the state until the session is over; ended and error are final (F-42)", () => {
    const { em, events } = recorded();
    expect(em.getState()).toBe("starting");
    em.setState("running");
    em.setState("waiting", "why");
    expect(events).toEqual([
      { type: "state", state: "running" },
      { type: "state", state: "waiting", detail: "why" },
    ]);
    expect(em.isClosed()).toBe(false);
    em.setState("ended");
    expect(em.isClosed()).toBe(true);
    em.setState("running");
    expect(em.getState()).toBe("ended");
    expect(events.at(-1)).toEqual({ type: "state", state: "ended" });
    expect(events).toHaveLength(3);
  });

  it("fail emits the one line as an error and as the error state, once (N-6, N-7)", () => {
    const { em, events } = recorded();
    expect(em.fail("agent not found")).toBe(true);
    expect(em.fail("second problem")).toBe(false);
    expect(events).toEqual([
      { type: "error", message: "agent not found" },
      { type: "state", state: "error", detail: "agent not found" },
    ]);
    expect(em.getState()).toBe("error");
    expect(em.isClosed()).toBe(true);
    // Events that are not state changes still go out after the end (a late permission_resolved, say).
    em.emit({ type: "error", message: "late" });
    expect(events.at(-1)).toEqual({ type: "error", message: "late" });
  });
});

describe("createTurnQueue (CRT-0041)", () => {
  /** A runTurn whose turns finish only when the test says so. */
  function turns() {
    const started: string[] = [];
    const finish: Array<() => void> = [];
    const runTurn = (input: UserInput) =>
      new Promise<void>((resolve) => {
        started.push(input.text);
        finish.push(resolve);
      });
    const done = async () => {
      finish.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    };
    return { started, runTurn, done };
  }

  it("echoes each message as it is queued and runs the turns one at a time, in order (F-25)", async () => {
    const { em, events } = recorded();
    const t = turns();
    const queue = createTurnQueue(t.runTurn, em);
    queue.enqueue({ text: "one", images: [{ mediaType: "image/png", path: "/a.png", label: "viewport" }] });
    queue.enqueue({ text: "two" });
    expect(events).toEqual([
      { type: "user", text: "one", images: ["viewport"] },
      { type: "user", text: "two", images: [] },
    ]);
    expect(t.started).toEqual(["one"]);
    expect(queue.length).toBe(1);
    await t.done();
    expect(t.started).toEqual(["one", "two"]);
    expect(queue.length).toBe(0);
    await t.done();
    queue.enqueue({ text: "three" });
    expect(t.started).toEqual(["one", "two", "three"]);
  });

  it("clear drops what is queued; once the session is over nothing is echoed or started (F-25, F-29)", async () => {
    const { em, events } = recorded();
    const t = turns();
    const queue = createTurnQueue(t.runTurn, em);
    queue.enqueue({ text: "one" });
    queue.enqueue({ text: "two" });
    queue.clear();
    await t.done();
    expect(t.started).toEqual(["one"]);
    em.setState("ended");
    queue.enqueue({ text: "late" });
    expect(events.filter((e) => e.type === "user")).toHaveLength(2);
    expect(t.started).toEqual(["one"]);
  });

  it("holds turns until the driver is ready, then pump() runs them — ACP waits for session/new (F-25, F-54)", async () => {
    const { em } = recorded();
    const t = turns();
    let ready = false;
    const queue = createTurnQueue(t.runTurn, em, { ready: () => ready });
    queue.enqueue({ text: "early" });
    expect(t.started).toEqual([]);
    ready = true;
    queue.pump();
    expect(t.started).toEqual(["early"]);
    await t.done();
  });
});

describe("createPermissionBroker (CRT-0041, F-26)", () => {
  const card = { toolName: "Bash", title: "Claude wants to use Bash", detail: "npm test" };

  function broker(timeoutMs?: number) {
    const r = recorded();
    r.em.setState("running");
    return { ...r, broker: createPermissionBroker({ emit: r.em.emit, setState: r.em.setState, getState: r.em.getState, timeoutMs }) };
  }

  it("ask shows a card and waits; respond settles it once, by the user, and the turn runs on (F-26)", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const { broker: b, events } = broker(30_000);
    const answer = b.ask(card);
    const perm = events.find((e) => e.type === "permission") as Extract<SessionEvent, { type: "permission" }>;
    expect(perm).toMatchObject({ ...card, expiresAt: 1_030_000 });
    expect(events.at(-1)).toEqual({ type: "state", state: "waiting" });
    expect(b.size).toBe(1);
    expect(b.respond("nope", "allow")).toBe(false);
    expect(b.respond(perm.id, "allow")).toBe(true);
    expect(b.respond(perm.id, "deny")).toBe(false);
    expect(await answer).toMatchObject({ behavior: "allow", by: "user" });
    expect(events.slice(-2)).toEqual([
      { type: "permission_resolved", id: perm.id, behavior: "allow", by: "user" },
      { type: "state", state: "running" },
    ]);
    expect(b.size).toBe(0);
  });

  it("a denied card tells the agent why (F-26)", async () => {
    const { broker: b, events } = broker();
    const answer = b.ask(card);
    const perm = events.find((e) => e.type === "permission") as Extract<SessionEvent, { type: "permission" }>;
    b.respond(perm.id, "deny");
    expect(await answer).toEqual({ behavior: "deny", by: "user", reason: "Denied in the CRT panel" });
  });

  it("an unanswered card is denied after the timeout, and the reason names the configured timeout (F-26)", async () => {
    vi.useFakeTimers();
    const { broker: b, events } = broker(90_000);
    const answer = b.ask(card);
    await vi.advanceTimersByTimeAsync(89_999);
    expect(b.size).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toEqual({ behavior: "deny", by: "timeout", reason: "No answer in the CRT panel within 90 seconds" });
    expect(events.at(-2)).toMatchObject({ type: "permission_resolved", behavior: "deny", by: "timeout" });
    expect(events.at(-1)).toEqual({ type: "state", state: "running" });
    // The default is the F-26 five minutes, and says so.
    const d = broker();
    const pending = d.broker.ask(card);
    await vi.advanceTimersByTimeAsync(PERMISSION_TIMEOUT_MS);
    expect((await pending).reason).toBe("No answer in the CRT panel within 5 minutes");
  });

  it("denyAll settles every open card for the session and leaves the next state to the driver (F-26, F-29)", async () => {
    const { broker: b, events, em } = broker();
    const one = b.ask(card);
    const two = b.ask({ ...card, detail: "npm run build" });
    em.setState("waiting");
    b.denyAll("session");
    expect(await one).toEqual({ behavior: "deny", by: "session", reason: "The CRT session ended before this was answered" });
    expect((await two).by).toBe("session");
    expect(events.filter((e) => e.type === "permission_resolved")).toHaveLength(2);
    expect(em.getState()).toBe("waiting");
    expect(b.size).toBe(0);
    b.denyAll("session");
    expect(events.filter((e) => e.type === "permission_resolved")).toHaveLength(2);
  });

  it("an aborted signal settles its card for the session; the turn runs on when no card is left (F-26)", async () => {
    const { broker: b, events } = broker();
    const abort = new AbortController();
    const answer = b.ask(card, { signal: abort.signal });
    abort.abort();
    expect(await answer).toMatchObject({ behavior: "deny", by: "session" });
    expect(events.slice(-2)).toEqual([expect.objectContaining({ type: "permission_resolved", by: "session" }), { type: "state", state: "running" }]);
    // Already aborted: settled at once.
    expect(await b.ask(card, { signal: abort.signal })).toMatchObject({ behavior: "deny", by: "session" });
  });

  it("describes a timeout the way the reason reads it (F-26)", () => {
    expect(describeTimeout(5 * 60 * 1000)).toBe("5 minutes");
    expect(describeTimeout(60_000)).toBe("1 minute");
    expect(describeTimeout(90_000)).toBe("90 seconds");
    expect(describeTimeout(1_000)).toBe("1 second");
    expect(describeTimeout(400)).toBe("400 ms");
  });
});

describe("createPermissionBroker: Always allow (PRD-chat F-124)", () => {
  const root = resolve("/proj");
  const npmTest = { toolName: "Bash", title: "Claude wants to use Bash", detail: "npm test", subject: { kind: "command" as const, command: "npm test" } };

  /** An in-memory rule list over the real matcher, so the broker is tested without a config file. */
  function memoryList(rules: string[] = []): AllowList & { rules: string[] } {
    return {
      rules,
      allows: (subject) => rules.some((r) => ruleAllows(r, subject, root)),
      suggest: (subject) => suggestRule(subject, root),
      add: (rule) => void rules.push(rule),
    };
  }

  function broker(allowList?: AllowList) {
    const r = recorded();
    r.em.setState("running");
    return { ...r, broker: createPermissionBroker({ emit: r.em.emit, setState: r.em.setState, getState: r.em.getState, timeoutMs: 30_000, allowList }) };
  }

  it("a card whose subject has a rule offers it; Always allow saves it, allows the call and says so (F-124)", async () => {
    const list = memoryList();
    const { broker: b, events } = broker(list);
    const answer = b.ask(npmTest);
    const perm = events.find((e) => e.type === "permission") as Extract<SessionEvent, { type: "permission" }>;
    expect(perm.always).toEqual({ rule: "Bash(npm test:*)", label: 'commands starting with "npm test"' });
    expect(perm).not.toHaveProperty("subject");
    expect(b.respond(perm.id, "always")).toBe(true);
    expect(await answer).toMatchObject({ behavior: "allow", by: "user" });
    expect(list.rules).toEqual(["Bash(npm test:*)"]);
    expect(events.find((e) => e.type === "permission_resolved")).toEqual({ type: "permission_resolved", id: perm.id, behavior: "allow", by: "user", always: true });
  });

  it("a call a saved rule covers is allowed with no card; one it does not cover still asks (F-124)", async () => {
    const { broker: b, events } = broker(memoryList(["Bash(npm test:*)"]));
    expect(await b.ask({ ...npmTest, subject: { kind: "command", command: "npm test -- --watch=false" } })).toEqual({ behavior: "allow", by: "rule", reason: "Always allowed in the CRT panel" });
    expect(events.some((e) => e.type === "permission")).toBe(false);
    void b.ask({ ...npmTest, subject: { kind: "command", command: "npm test && rm -rf ." } });
    expect(events.filter((e) => e.type === "permission")).toHaveLength(1);
    b.denyAll("session");
  });

  it("Always allow settles every other open card the new rule covers (F-124)", async () => {
    const { broker: b, events } = broker(memoryList());
    const first = b.ask(npmTest);
    const second = b.ask({ ...npmTest, subject: { kind: "command", command: "npm test -- cart" } });
    const other = b.ask({ ...npmTest, detail: "npm run build", subject: { kind: "command", command: "npm run build" } });
    const cards = events.filter((e) => e.type === "permission") as Array<Extract<SessionEvent, { type: "permission" }>>;
    b.respond(cards[0]!.id, "always");
    expect(await first).toMatchObject({ behavior: "allow" });
    expect(await second).toMatchObject({ behavior: "allow", by: "rule" });
    expect(events).toContainEqual({ type: "permission_resolved", id: cards[1]!.id, behavior: "allow", by: "user", always: true });
    expect(b.size).toBe(1);
    b.respond(cards[2]!.id, "deny");
    expect(await other).toMatchObject({ behavior: "deny" });
  });

  it("no rule list, no subject or no rule for the subject: Allow / Deny only, and Always is refused (F-124)", () => {
    const rows: Array<[AllowList | undefined, PermissionCard]> = [
      [undefined, npmTest],
      [memoryList(), { toolName: "Bash", title: "t", detail: "d" }],
      [memoryList(), { ...npmTest, subject: { kind: "edit", paths: [resolve("/elsewhere/a.ts")] } }],
    ];
    for (const [list, card] of rows) {
      const { broker: b, events } = broker(list);
      void b.ask(card);
      const perm = events.find((e) => e.type === "permission") as Extract<SessionEvent, { type: "permission" }>;
      expect(perm).not.toHaveProperty("always");
      expect(b.respond(perm.id, "always")).toBe(false);
      expect(b.size).toBe(1);
      b.denyAll("session");
    }
  });
});

describe("initEvent (F-46, F-47, F-54)", () => {
  it("builds the event from the profile: identity, resume command, capabilities (F-46, F-47)", () => {
    expect(initEvent(stubProfile, { id: "crt-1" }, { nativeSessionId: "n-1", model: "m", agentVersion: "v" })).toEqual({
      type: "init",
      sessionId: "crt-1",
      nativeSessionId: "n-1",
      provider: "stub",
      displayName: stubProfile.displayName,
      model: "m",
      agentVersion: "v",
      resumeCommand: stubProfile.resumeCommand("n-1"),
      capabilities: stubProfile.capabilities,
    });
  });

  it("carries negotiated capabilities, no resume command without resume, and the experimental reason when the profile has one (F-46, F-47, F-54)", () => {
    const profile = { ...makeStubProfile("sandboxed"), experimental: "experimental: untested" };
    const caps = { ...profile.capabilities, resume: false, images: "none" as const };
    expect(initEvent(profile, { id: "crt-2" }, { nativeSessionId: "n-2", model: null, agentVersion: null, capabilities: caps })).toMatchObject({
      resumeCommand: null,
      capabilities: caps,
      experimental: "experimental: untested",
    });
  });
});
