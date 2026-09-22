/**
 * The `stub` provider: a scripted intake session for tests (task CRT-0003 Ask 7; PRD-providers
 * F-42). `CRT_SESSION_STUB=1` selects it ahead of every other resolution step (F-43 step 0) and
 * is the only way to reach it: `listProviders()` hides it otherwise. It produces the same
 * `SessionEvent`s the Claude driver would, without the SDK, and shares Claude's profile values
 * (F-46 "stub = as claude") so the panel and the e2e specs see no difference:
 *
 *   init → streamed text → a pre-allowed tool (Read) → a tool that needs permission (Bash npm test,
 *   through the real F-26 policy) → text depending on Allow/Deny → result.
 *   Next developer message containing "accept" or "write" → `writeTask` → task_written → result.
 *   Any other message → echoed back → result. `interrupt()` cuts the current turn short.
 *   A first message carrying the F-14 quick-note instructions skips the permission prompt and the
 *   DoD wait: Read, then `writeTask` straight away (unless the note says "ask me", which makes
 *   the stub ask a question instead, so the panel-opens-itself path can be tested too).
 *   A first message whose note says "take your time" keeps the stub `running` after its first
 *   sentence until an interrupt or close (PRD-polish F-116, §12 rule 4: the `thinking…` marker
 *   for `npm run screenshots`); no e2e note carries the phrase, so the specs never see it.
 *
 * Variants (F-46 "the stub also runs the conformance scenario with `first-message` and
 * `sandboxed`"): `CRT_SESSION_STUB=first-message` moves the intake instructions into the first
 * message (F-51) and `CRT_SESSION_STUB=sandboxed` additionally runs without permission cards and
 * takes images by path (F-50), the way a Codex session does. A variant checks what the registry
 * sent it — instructions heading, no base64 — and reports a mismatch as an `error` event, so the
 * F-50/F-51 plumbing is exercised end to end without a real agent.
 */
import { randomUUID } from "node:crypto";
import { FIRST_MESSAGE_HEADING } from "../intake-message.js";
import type { ProviderCapabilities, SessionDriver, SessionEvent, SessionState, StartSessionOptions, UserInput } from "../session-events.js";
import type { ProviderProfile } from "./types.js";

const TICK_MS = 15;

export type StubVariant = "default" | "first-message" | "sandboxed";
export const STUB_VARIANTS: readonly StubVariant[] = ["default", "first-message", "sandboxed"];

/** F-46: as Claude by default; the other variants flip the channels a sandboxed CLI agent uses. */
export function stubCapabilities(variant: StubVariant = "default"): ProviderCapabilities {
  return {
    streaming: true,
    toolEvents: true,
    permissions: variant === "sandboxed" ? "sandboxed" : "interactive",
    images: variant === "sandboxed" ? "path" : "inline",
    resume: true,
    interrupt: true,
    instructions: variant === "default" ? "system" : "first-message",
  };
}

export const STUB_CAPABILITIES: ProviderCapabilities = stubCapabilities("default");

/** `CRT_SESSION_STUB=1` → default; a variant name selects that variant (anything else is the default). */
export function stubVariantFromEnv(value: string | undefined): StubVariant {
  return (STUB_VARIANTS as readonly string[]).includes(value ?? "") ? (value as StubVariant) : "default";
}

export function makeStubProfile(variant: StubVariant = "default"): ProviderProfile {
  return {
    id: "stub",
    displayName: "Claude",
    agentName: "Scripted stub",
    markers: { private: [], shared: [] },
    launchEnv: [],
    hints: { install: "set CRT_SESSION_STUB=1", login: "nothing to do — the stub never logs in" },
    capabilities: stubCapabilities(variant),
    telemetryOptOut: [],
    skillsDirs: () => ({ project: null, user: null }),
    preflight: async () => ({ installed: true, loggedIn: "unknown", version: variant === "default" ? "stub" : `stub-${variant}`, problem: null }),
    // Mirrors Claude so the footer and the e2e resume assertion read the same string (F-63).
    resumeCommand: (id) => `claude --resume ${id}`,
    start: (opts) => startStubSession(opts, variant),
  };
}

/** The profile the registry lists: the variant named by `CRT_SESSION_STUB` at load time (e2e), else the default. */
export const stubProfile: ProviderProfile = makeStubProfile(stubVariantFromEnv(process.env.CRT_SESSION_STUB));

/** F-14 as the intake instructions define it: the message ends with a paragraph starting `Quick note (F-14)`. */
export function isQuickNote(text: string): boolean {
  return /^Quick note \(F-14\)/.test(text.trim().split(/\n{2,}/).at(-1) ?? "");
}

/** PRD-polish F-116: the note that keeps the stub thinking (the screenshot script's `thinking…` marker). */
export const HOLD_PHRASE = "take your time";
const HOLD_RE = new RegExp(`\\b${HOLD_PHRASE}\\b`, "i");

export function startStubSession(opts: StartSessionOptions, variant: StubVariant = "default"): SessionDriver {
  const caps = stubCapabilities(variant);
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
    // F-46 `sandboxed`: the agent's own sandbox is the boundary; CRT is never asked (no cards).
    const decision = caps.permissions === "interactive" ? opts.decide(name, input) : { kind: "allow" as const };
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
      provider: "stub",
      displayName: "Claude",
      model: opts.model ?? "stub-model",
      agentVersion: variant === "default" ? "stub" : `stub-${variant}`,
      resumeCommand: `claude --resume ${opts.id}`,
      capabilities: caps,
    });

  /** The variant's checks on what the registry sent (F-50, F-51); a mismatch is an `error` event. */
  const checkFirst = (first: UserInput) => {
    if (caps.instructions === "first-message" && !first.text.startsWith(`${FIRST_MESSAGE_HEADING}\n`)) {
      emit({ type: "error", message: `stub (${variant}) expected the first message to start with "${FIRST_MESSAGE_HEADING}"` });
    }
    if (caps.instructions === "first-message" && opts.systemPromptAppend.trim()) {
      emit({ type: "error", message: `stub (${variant}) expected no system prompt text when instructions travel in the first message` });
    }
    for (const img of first.images ?? []) {
      if (!img.path) emit({ type: "error", message: `stub (${variant}) received an image without a path (F-50)` });
      if (caps.images === "path" && img.data !== undefined) emit({ type: "error", message: `stub (${variant}) received base64 image data it did not ask for (F-50)` });
      if (caps.images === "inline" && !img.data) emit({ type: "error", message: `stub (${variant}) expected inline image data (F-50)` });
    }
  };

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
    if (HOLD_RE.test(first.text)) {
      // F-116: stay `running` — no tool, no result — until the session is interrupted or closed.
      while (!cancelled(t)) await sleep(TICK_MS * 10);
      return;
    }
    if (!(await useTool(t, "Read", { file_path: "src/components/Cart.tsx" }, "Read src/components/Cart.tsx", "88 lines"))) return;
    const ran = await useTool(t, "Bash", { command: "npm test" }, "Bash npm test", "12 passing");
    if (cancelled(t)) return;
    await say(
      t,
      ran
        ? "Tests pass today, so the fix needs a new one.\n\nProposed definition of done:\n- [ ] Cart total applies the promo discount\n- [ ] Unit test covers the discounted total\n\nAccept as-is, or tell me what to change, and I'll write the task."
        : "Understood, I won't run tests.\n\nProposed definition of done:\n- [ ] Cart total applies the promo discount\n\nAccept as-is, or tell me what to change, and I'll write the task.",
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
    // F-27 step 5: the panel's Accept button replies "Accept"; a typed "write" still works.
    if (/\b(accept|write)\b/i.test(text)) {
      await writeStubTask(t);
    } else if (/\btests?\b/i.test(text)) {
      // A second permission round for the F-59 scenario (Allow on the first turn, Deny here).
      const ran = await useTool(t, "Bash", { command: "npm test" }, "Bash npm test", "12 passing");
      if (cancelled(t)) return;
      await say(t, ran ? "Tests pass." : "Understood, I won't run tests.");
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
  const begin = (first: UserInput) => {
    started = true;
    busy = true;
    checkFirst(first);
    // F-14/F-51: quick-note mode is the sentinel as the *last* paragraph — the intake instructions
    // themselves mention it, and in the first-message channel they are part of this text.
    const script = isQuickNote(first.text) ? quickTurn(turn, first) : firstTurn(first);
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
