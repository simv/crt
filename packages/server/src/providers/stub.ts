/**
 * The `stub` provider: a scripted intake session for tests (task CRT-0003 Ask 7; PRD-providers
 * F-42). `CRT_SESSION_STUB=1` selects it ahead of every other resolution step (F-43 step 0) and
 * is the only way to reach it: `listProviders()` hides it otherwise. It produces the same
 * `SessionEvent`s the Claude driver would, without the SDK, and shares Claude's profile values
 * (F-46 "stub = as claude") so the panel and the e2e specs see no difference:
 *
 *   init → streamed text → a pre-allowed tool (Read) → a tool that needs permission (Bash npm test,
 *   through the real F-26 policy) → text depending on Allow/Deny → result.
 *   Next developer message containing "write" → `writeTask` → task_written → result.
 *   Any other message → echoed back → result. `interrupt()` cuts the current turn short.
 *   A first message carrying the F-14 quick-note instructions skips the permission prompt and the
 *   DoD wait: Read, then `writeTask` straight away (unless the note says "ask me", which makes
 *   the stub ask a question instead, so the panel-opens-itself path can be tested too).
 */
import { randomUUID } from "node:crypto";
import type { ProviderCapabilities, SessionDriver, SessionEvent, SessionState, StartSessionOptions } from "../session-events.js";
import type { ProviderProfile } from "./types.js";

const TICK_MS = 15;

/** F-46: as Claude. (M8 runs the conformance scenario with `first-message`/`sandboxed` variants too.) */
export const STUB_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  toolEvents: true,
  permissions: "interactive",
  images: "inline",
  resume: true,
  interrupt: true,
  instructions: "system",
};

export const stubProfile: ProviderProfile = {
  id: "stub",
  displayName: "Claude",
  agentName: "Scripted stub",
  markers: { private: [], shared: [] },
  launchEnv: [],
  hints: { install: "set CRT_SESSION_STUB=1", login: "nothing to do — the stub never logs in" },
  capabilities: STUB_CAPABILITIES,
  telemetryOptOut: [],
  preflight: async () => ({ installed: true, loggedIn: "unknown", version: "stub", problem: null }),
  // Mirrors Claude so the footer and the e2e resume assertion read the same string (F-63).
  resumeCommand: (id) => `claude --resume ${id}`,
  start: startStubSession,
};

export function startStubSession(opts: StartSessionOptions): SessionDriver {
  const listeners = new Set<(e: SessionEvent) => void>();
  const pending = new Map<string, { settle: (behavior: "allow" | "deny", by: "user" | "timeout" | "session") => void }>();
  let state: SessionState = "starting";
  let closed = false;
  let turn = 0; // increments on interrupt/close so a running script notices and stops
  let busy = false;
  const queue: string[] = [];
  let n = 0;

  const emit = (e: SessionEvent) => {
    for (const fn of listeners) fn(e);
  };
  const setState = (next: SessionState, detail?: string) => {
    if (closed) return;
    state = next;
    emit(detail === undefined ? { type: "state", state: next } : { type: "state", state: next, detail });
  };
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const cancelled = (t: number) => closed || t !== turn;

  const say = async (t: number, text: string) => {
    const messageId = `stub-msg-${++n}`;
    emit({ type: "assistant_start", messageId });
    for (const piece of text.split(/(?<=\s)/)) {
      if (cancelled(t)) return;
      emit({ type: "text", messageId, text: piece });
      await sleep(TICK_MS);
    }
    emit({ type: "assistant_end", messageId });
  };

  const useTool = async (t: number, name: string, input: Record<string, unknown>, label: string, result: string): Promise<boolean> => {
    const id = `stub-tool-${++n}`;
    const decision = opts.decide(name, input);
    let allowed = decision.kind === "allow";
    if (decision.kind === "ask") {
      allowed = await askPermission(t, name, label, input);
      if (cancelled(t)) return false;
    }
    if (!allowed) return false;
    emit({ type: "tool_use", id, name, label });
    await sleep(TICK_MS);
    emit({ type: "tool_result", id, isError: false, summary: result });
    return true;
  };

  const askPermission = (t: number, toolName: string, title: string, input: Record<string, unknown>): Promise<boolean> =>
    new Promise((resolve) => {
      const id = randomUUID();
      const timeoutMs = opts.permissionTimeoutMs ?? 5 * 60 * 1000;
      const timer = setTimeout(() => settle("deny", "timeout"), timeoutMs);
      const settle = (behavior: "allow" | "deny", by: "user" | "timeout" | "session") => {
        if (!pending.delete(id)) return;
        clearTimeout(timer);
        emit({ type: "permission_resolved", id, behavior, by });
        if (!cancelled(t) && pending.size === 0) setState("running");
        resolve(behavior === "allow");
      };
      pending.set(id, { settle });
      emit({ type: "permission", id, toolName, title, detail: String(input.command ?? input.file_path ?? JSON.stringify(input)), expiresAt: Date.now() + timeoutMs });
      setState("waiting");
    });

  /** F-47: the stub is its own agent, so the native id is CRT's. */
  const emitInit = () =>
    emit({
      type: "init",
      sessionId: opts.id,
      nativeSessionId: opts.id,
      provider: stubProfile.id,
      displayName: stubProfile.displayName,
      model: "stub-model",
      agentVersion: "stub",
      resumeCommand: stubProfile.resumeCommand(opts.id),
      capabilities: STUB_CAPABILITIES,
    });

  const finish = (t: number, ok: boolean, errors: string[] = []) => {
    if (cancelled(t)) return; // an interrupt already produced this turn's result
    emit({ type: "result", ok, durationMs: 100, costUsd: 0.001, errors });
    setState("idle");
  };

  const firstTurn = async (first: { text: string; images?: Array<{ label: string }> }) => {
    const t = turn;
    emit({ type: "user", text: first.text, images: (first.images ?? []).map((i) => i.label) });
    await sleep(TICK_MS);
    if (cancelled(t)) return;
    emitInit();
    setState("running");
    await say(t, "I read the capture. The annotated element is rendered by **CartSummary**; let me look at the source.\n");
    if (cancelled(t)) return;
    if (!(await useTool(t, "Read", { file_path: "src/components/Cart.tsx" }, "Read src/components/Cart.tsx", "88 lines"))) return;
    const ran = await useTool(t, "Bash", { command: "npm test" }, "Bash npm test", "12 passing");
    if (cancelled(t)) return;
    await say(
      t,
      ran
        ? "Tests pass today, so the fix needs a new one.\n\nProposed definition of done:\n- [ ] Cart total applies the promo discount\n- [ ] Unit test covers the discounted total\n\nReply **write** to save the task, or tell me what to change."
        : "Understood, I won't run tests.\n\nProposed definition of done:\n- [ ] Cart total applies the promo discount\n\nReply **write** to save the task, or tell me what to change.",
    );
    finish(t, true);
  };

  /** F-14: the quick-note script. Note text decides whether the stub writes or asks. */
  const quickTurn = async (t: number, first: { text: string; images?: Array<{ label: string }> }) => {
    emit({ type: "user", text: first.text, images: (first.images ?? []).map((i) => i.label) });
    await sleep(TICK_MS);
    if (cancelled(t)) return;
    emitInit();
    setState("running");
    if (!(await useTool(t, "Read", { file_path: "src/components/Cart.tsx" }, "Read src/components/Cart.tsx", "88 lines"))) return;
    if (/ask me/i.test(first.text)) {
      await say(t, "Quick question before I write this: should the discount apply before or after tax?");
      finish(t, true);
      return;
    }
    await writeStubTask(t);
    finish(t, true);
  };

  const writeStubTask = async (t: number) => {
    const id = `stub-tool-${++n}`;
    emit({ type: "tool_use", id, name: "mcp__crt__write_task", label: "Write task: Cart total excludes applied discount" });
    try {
      const written = await opts.writeTask({
        title: "Cart total excludes applied discount",
        summary: "The cart total ignores the SAVE10 promo that the page shows as applied.",
        context: "Reproduce: open /cart?promo=SAVE10. `CartSummary` (src/components/Cart.tsx:88) renders `subtotal` instead of `total`.",
        ask: "Render the discounted total and cover it with a unit test.",
        definitionOfDone: ["Cart total applies the promo discount", "Unit test covers the discounted total"],
        notes: "Stub intake; nothing was read from disk.",
        tags: ["cart", "pricing"],
        files: ["src/components/Cart.tsx"],
      });
      emit({ type: "tool_result", id, isError: false, summary: `Task ${written.id} written to ${written.path}` });
      emit({ type: "task_written", id: written.id, path: written.path });
      await say(t, `Written **${written.id}** at \`${written.path}\`.`);
    } catch (err) {
      emit({ type: "tool_result", id, isError: true, summary: (err as Error).message });
      await say(t, `Could not write the task: ${(err as Error).message}`);
    }
  };

  const laterTurn = async (text: string) => {
    const t = turn;
    setState("running");
    await sleep(TICK_MS);
    if (cancelled(t)) return;
    if (/\bwrite\b/i.test(text)) {
      await writeStubTask(t);
    } else {
      await say(t, `You said: ${text}`);
    }
    finish(t, true);
  };

  const pump = async () => {
    if (busy) return;
    busy = true;
    try {
      while (queue.length && !closed) await laterTurn(queue.shift()!);
    } finally {
      busy = false;
    }
  };

  let started = false;
  const begin = (first: { text: string; images?: Array<{ label: string }> }) => {
    started = true;
    busy = true;
    const script = /Quick note \(F-14\)/.test(first.text) ? quickTurn(turn, first) : firstTurn(first);
    void script.finally(() => {
      busy = false;
      void pump();
    });
  };
  if (opts.first) {
    const first = opts.first;
    queueMicrotask(() => begin(first));
  }

  return {
    id: opts.id,
    send(u) {
      if (closed) return;
      if (!started) {
        begin(u); // warm start: this is the capture message
        return;
      }
      emit({ type: "user", text: u.text, images: (u.images ?? []).map((i) => i.label) });
      queue.push(u.text);
      void pump();
    },
    async interrupt() {
      if (closed || state === "idle") return;
      turn++;
      for (const p of [...pending.values()]) p.settle("deny", "session");
      emit({ type: "result", ok: false, durationMs: 0, costUsd: 0, errors: ["interrupted"] });
      setState("idle");
    },
    respondPermission(id, behavior) {
      const p = pending.get(id);
      if (!p) return false;
      p.settle(behavior, "user");
      return true;
    },
    close() {
      if (closed) return;
      turn++;
      for (const p of [...pending.values()]) p.settle("deny", "session");
      setState("ended");
      closed = true;
    },
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
