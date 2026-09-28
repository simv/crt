/**
 * The session core every `SessionDriver` is built on (PRD-providers §5, F-46, F-47, F-59; CRT-0041).
 * What a driver does with its agent — the SDK, `codex exec`, `agy`, ACP, the stub's script — is
 * its own; the bookkeeping around it is the same everywhere and lives here once:
 *
 *   • `createEmitter` — the listener set, a safe `emit` (a listener that throws is logged and
 *     skipped, never the session's problem), `setState` and `fail`. The session is over once its
 *     state is `ended` or `error`: from then on `setState` and `fail` do nothing and `isClosed()`
 *     is true. That one fact replaces the drivers' own `closed` flags, which were set in the same
 *     breath as the final state anyway.
 *   • `createTurnQueue` — one turn at a time, in order: the developer's message is echoed as a
 *     `user` event when it is queued, and the next turn starts when the last one has finished.
 *   • `createPermissionBroker` — the F-26 card: `permission` + `waiting`, the timeout, the answer,
 *     `permission_resolved`, and back to `running` when no card is left. `denyAll` is for tearing
 *     down (interrupt, close, failure): it settles every card and leaves the next state to the
 *     driver. The reason a denied agent reads names the configured timeout.
 *   • `initEvent` — the F-47 `init` event from the profile, so every driver reports its identity,
 *     resume command, capabilities and experimental flag the same way.
 *
 * `task_written` is not here: the registry records it when its write succeeds (`sessions.ts`
 * `Entry.writeTask`), whichever route the agent took (§5.3).
 */
import { randomUUID } from "node:crypto";
import { PERMISSION_TIMEOUT_MS } from "../permissions.js";
import type { ProviderCapabilities, SessionEvent, SessionState, StartSessionOptions, UserInput } from "../session-events.js";
import type { ProviderProfile } from "./types.js";

export type SessionListener = (event: SessionEvent) => void;

export interface SessionEmitter {
  /** Deliver an event to every listener, in the order they subscribed; a throwing listener is logged and skipped. */
  emit: (event: SessionEvent) => void;
  onEvent: (fn: SessionListener) => () => void;
  /** Move to `next` and emit it; a no-op once the session is over. `ended` and `error` end it. */
  setState: (next: SessionState, detail?: string) => void;
  getState: () => SessionState;
  /** The state is `ended` or `error`. */
  isClosed: () => boolean;
  /** N-6/N-7: emit the one line as `error` and end in the `error` state; false when the session was already over. */
  fail: (problem: string) => boolean;
}

export function createEmitter(log: (line: string) => void = () => undefined): SessionEmitter {
  const listeners = new Set<SessionListener>();
  let state: SessionState = "starting";
  const isClosed = () => state === "ended" || state === "error";
  const emit = (event: SessionEvent) => {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch (err) {
        // A listener failing must not take the session (or, from a stdout handler, the server) down.
        log(`crt: a session listener failed on ${event.type}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  const setState = (next: SessionState, detail?: string) => {
    if (isClosed()) return;
    state = next;
    emit(detail === undefined ? { type: "state", state: next } : { type: "state", state: next, detail });
  };
  return {
    emit,
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setState,
    getState: () => state,
    isClosed,
    fail(problem) {
      if (isClosed()) return false;
      emit({ type: "error", message: problem });
      setState("error", problem);
      return true;
    },
  };
}

export interface TurnQueue {
  /** Echo the message as a `user` event and queue its turn; ignored once the session is over. */
  enqueue(input: UserInput): void;
  /** Start the queued turns if none is running (and the driver is ready). */
  pump(): void;
  /** Drop the queued turns (the running one finishes on its own). */
  clear(): void;
  /** Turns waiting behind the running one. */
  readonly length: number;
}

/**
 * One turn at a time, in order. `runTurn` resolves when its turn is over, however it ended.
 * `ready` holds the queue until the driver can take turns (ACP: after `session/new`); the driver
 * calls `pump()` then.
 */
export function createTurnQueue(
  runTurn: (input: UserInput) => Promise<void>,
  emitter: Pick<SessionEmitter, "emit" | "isClosed">,
  opts: { ready?: () => boolean } = {},
): TurnQueue {
  const queue: UserInput[] = [];
  let busy = false;
  const pump = async () => {
    if (busy || (opts.ready && !opts.ready())) return;
    busy = true;
    try {
      while (queue.length && !emitter.isClosed()) await runTurn(queue.shift()!);
    } finally {
      busy = false;
    }
  };
  return {
    enqueue(input) {
      if (emitter.isClosed()) return;
      emitter.emit({ type: "user", text: input.text, images: (input.images ?? []).map((i) => i.label) });
      queue.push(input);
      void pump();
    },
    pump() {
      void pump();
    },
    clear() {
      queue.length = 0;
    },
    get length() {
      return queue.length;
    },
  };
}

export type PermissionSettledBy = "user" | "timeout" | "session";

/** What the card shows (F-26): the tool, one line saying what the agent wants, the input for humans. */
export interface PermissionCard {
  toolName: string;
  title: string;
  detail: string;
}

export interface PermissionAnswer {
  behavior: "allow" | "deny";
  by: PermissionSettledBy;
  /** One line for the agent: why it was denied (or that it was allowed). */
  reason: string;
}

export interface PermissionBroker {
  /** Show a card and wait for its answer; an aborted `signal` settles it for the session. */
  ask(card: PermissionCard, opts?: { signal?: AbortSignal }): Promise<PermissionAnswer>;
  /** The developer's answer; false when the id is unknown or already settled. */
  respond(id: string, behavior: "allow" | "deny"): boolean;
  /** Deny every open card (interrupt, close, failure); the driver sets the state that follows. */
  denyAll(by: PermissionSettledBy): void;
  /** Cards still open. */
  readonly size: number;
}

/**
 * F-26 cards for a driver whose agent asks (`permissions: interactive`). `timeoutMs` defaults to
 * `PERMISSION_TIMEOUT_MS`; an unanswered card is then denied `by: "timeout"`.
 */
export function createPermissionBroker(opts: {
  emit: (event: SessionEvent) => void;
  setState: (next: SessionState) => void;
  getState: () => SessionState;
  timeoutMs?: number | undefined;
}): PermissionBroker {
  const timeoutMs = opts.timeoutMs ?? PERMISSION_TIMEOUT_MS;
  const pending = new Map<string, (behavior: "allow" | "deny", by: PermissionSettledBy, resume: boolean) => void>();
  const reason = (behavior: "allow" | "deny", by: PermissionSettledBy): string =>
    by === "timeout"
      ? `No answer in the CRT panel within ${describeTimeout(timeoutMs)}`
      : by === "session"
        ? "The CRT session ended before this was answered"
        : behavior === "allow"
          ? "Allowed in the CRT panel"
          : "Denied in the CRT panel";
  return {
    ask(card, { signal } = {}) {
      if (signal?.aborted) return Promise.resolve({ behavior: "deny", by: "session", reason: reason("deny", "session") });
      const id = randomUUID();
      return new Promise((resolve) => {
        const onAbort = () => settle("deny", "session", true);
        const timer = setTimeout(() => settle("deny", "timeout", true), timeoutMs);
        const settle = (behavior: "allow" | "deny", by: PermissionSettledBy, resume: boolean) => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          opts.emit({ type: "permission_resolved", id, behavior, by });
          if (resume && pending.size === 0 && opts.getState() === "waiting") opts.setState("running");
          resolve({ behavior, by, reason: reason(behavior, by) });
        };
        pending.set(id, settle);
        signal?.addEventListener("abort", onAbort, { once: true });
        opts.emit({ type: "permission", id, ...card, expiresAt: Date.now() + timeoutMs });
        opts.setState("waiting");
      });
    },
    respond(id, behavior) {
      const settle = pending.get(id);
      if (!settle) return false;
      settle(behavior, "user", true);
      return true;
    },
    denyAll(by) {
      for (const settle of [...pending.values()]) settle("deny", by, false);
    },
    get size() {
      return pending.size;
    },
  };
}

/** `5 minutes`, `90 seconds`, `400 ms`: a timeout the way the denial reason reads it. */
export function describeTimeout(ms: number): string {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (ms >= 60_000 && ms % 60_000 === 0) return unit(ms / 60_000, "minute");
  if (ms >= 1_000 && ms % 1_000 === 0) return unit(ms / 1_000, "second");
  return `${ms} ms`;
}

/**
 * F-47: the `init` event from the profile. `capabilities` are the profile's unless the agent
 * negotiated others (ACP, F-54); the resume command is the profile's when they include resume.
 */
export function initEvent(
  profile: ProviderProfile,
  opts: Pick<StartSessionOptions, "id">,
  native: { nativeSessionId: string; model: string | null; agentVersion: string | null; capabilities?: ProviderCapabilities },
): Extract<SessionEvent, { type: "init" }> {
  const capabilities = native.capabilities ?? profile.capabilities;
  return {
    type: "init",
    sessionId: opts.id,
    nativeSessionId: native.nativeSessionId,
    provider: profile.id,
    displayName: profile.displayName,
    model: native.model,
    agentVersion: native.agentVersion,
    resumeCommand: capabilities.resume ? profile.resumeCommand(native.nativeSessionId) : null,
    capabilities,
    ...(profile.experimental ? { experimental: profile.experimental } : {}),
  };
}
