/**
 * Threads (PRD F-65…F-68): every intake session the page is following, each shown in one popover —
 * its host annotation's, or a docked one for a page-level chat (F-68) or a session opened from the
 * list (F-30). Several run at once and one popover is open at a time. A reload re-attaches every
 * thread from the annotation store (annotation → session id) and this tab's sessionStorage:
 * the page-level chats' session ids, and the session whose popover was open (F-66).
 */
import type { SessionState } from "../../server/src/session-events.js";
import { type Annotation, type AnnotationStore, describeAnnotation } from "./annotations.js";
import { isSessionAlive } from "./api.js";
import { ChatPanel, type QuietOutcome } from "./chat.js";
import type { ThreadState } from "./dom-util.js";
import { buildDockedPop } from "./popovers.js";
import { safeGet, safeGetJson, safeRemove, safeSet } from "./storage.js";

/** F-68: session ids of page-level chats, per tab, so a reload re-attaches them. */
const PAGE_THREADS_KEY = "crt.pagechats.v1";
/** F-66: the session whose popover was open, per tab, so a reload re-opens it. */
const OPEN_KEY = "crt.open.v1";

/** F-66/F-67: one intake session shown in one popover. */
export interface Thread {
  sessionId: string;
  /** The annotations sent in this thread (F-65 grouping); the first hosts the popover. Empty for a page-level chat (F-68). */
  annotationIds: string[];
  chat: ChatPanel;
  /** The popover the chat is mounted in: the host annotation's, or a docked one. */
  pop: HTMLElement;
}

/** What `window.__crt.threads()` reports (tests). */
export interface ThreadSummary {
  sessionId: string;
  annotationIds: string[];
  /** Badge numbers of the annotations, in order. */
  ns: number[];
  state: ThreadState | null;
  taskId: string | null;
  open: boolean;
}

/** F-67: `task` once the file exists, else the session state (`starting` before the first event). */
export function threadState(state: SessionState | null, taskId: string | null): ThreadState {
  return taskId ? "task" : (state ?? "starting");
}

/** F-66: the threads a reload re-attaches — one per session the annotations were sent to (their ids in order), then each page-level chat. */
export function groupThreads(items: readonly Annotation[], pageThreads: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const a of items) if (a.sessionId) groups.set(a.sessionId, [...(groups.get(a.sessionId) ?? []), a.id]);
  for (const id of pageThreads) if (!groups.has(id)) groups.set(id, []);
  return groups;
}

/** F-68: the stored page-level chat ids — only the strings of a stored array. */
export function parsePageThreads(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

/** F-66: a popover head's title — the first annotation's number, how many more, and what it is. */
export function threadTitle(first: Annotation | undefined, count: number): string {
  if (!first) return "Chat about this page";
  return `#${first.n}${count > 1 ? ` +${count - 1}` : ""} · ${describeAnnotation(first)}`;
}

/** What a thread needs from the overlay around it. */
export interface ThreadHost {
  readonly store: AnnotationStore;
  /** An annotation's popover, where its thread's chat mounts. */
  popFor(annotationId: string): HTMLElement | null;
  /** Add a docked popover (a page-level chat, a session opened from the list) to the overlay. */
  dock(pop: HTMLElement): void;
  /** A thread's chat opened or closed: its popover follows. */
  visibility(pop: HTMLElement, open: boolean): void;
  /** A docked popover is being removed: it cannot stay the open one. */
  removing(pop: HTMLElement): void;
  quiet(outcome: QuietOutcome, sessionId: string): void;
  attention(thread: Thread, reason: string): void;
  /** A thread's state, task or title changed, or a thread came or went: markers and buttons follow (F-67). */
  changed(): void;
}

export class Threads {
  /** Oldest first. */
  private list: Thread[] = [];

  constructor(private readonly host: ThreadHost) {}

  all(): readonly Thread[] {
    return this.list;
  }

  /** Mount a ChatPanel for `sessionId` in its host annotation's popover, or in a new docked one. */
  start(sessionId: string, annotationIds: string[]): Thread {
    const host = annotationIds.length ? this.host.popFor(annotationIds[0]!) : null;
    const pop = host ?? buildDockedPop();
    if (!host) this.host.dock(pop);
    const thread: Thread = { sessionId, annotationIds, pop, chat: undefined as unknown as ChatPanel };
    thread.chat = new ChatPanel(
      pop.querySelector(".thread") as HTMLElement,
      {
        onVisibility: (open) => this.host.visibility(pop, open),
        onQuiet: (outcome) => this.host.quiet(outcome, sessionId),
        onAttention: (reason) => this.host.attention(thread, reason),
        onChange: () => this.host.changed(),
        onDiscard: () => this.drop(thread),
      },
      { title: this.title(annotationIds) },
    );
    this.list.push(thread);
    pop.classList.add("threaded");
    return thread;
  }

  /** F-30/F-66: open a session — its own popover when it has one, else a docked page-level popover. */
  open(sessionId: string): void {
    if (!sessionId) return;
    const existing = this.bySession(sessionId);
    if (existing) {
      existing.chat.show(true);
      return;
    }
    const ids = this.host.store.all().filter((a) => a.sessionId === sessionId).map((a) => a.id);
    const thread = this.start(sessionId, ids);
    if (!ids.length) this.savePage();
    thread.chat.open(sessionId);
  }

  /** F-66: after a reload, re-attach every thread the server still has; forget the rest. */
  async restore(): Promise<void> {
    const { store } = this.host;
    const wanted = readOpenThread();
    await Promise.all(
      [...groupThreads(store.all(), readPageThreads())].map(async ([sessionId, ids]) => {
        if (this.bySession(sessionId)) return;
        if (await isSessionAlive(sessionId)) {
          const thread = this.start(sessionId, ids);
          if (sessionId === wanted) thread.chat.open(sessionId);
          else thread.chat.watch(sessionId);
        } else if (ids.length) {
          store.setSession(ids, null);
        }
      }),
    );
    this.savePage();
    this.host.changed();
  }

  /** F-66: the chat's Discard closed the session — the thread goes, and its annotations with it. */
  private drop(thread: Thread): void {
    thread.chat.dispose();
    this.remove(thread);
    thread.pop.classList.remove("threaded");
    if (thread.annotationIds.length) {
      for (const id of thread.annotationIds) {
        const a = this.host.store.byId(id);
        if (a) this.host.store.remove(a.n);
      }
    } else {
      this.host.removing(thread.pop);
      thread.pop.remove();
      this.savePage();
    }
    this.host.changed();
  }

  private remove(thread: Thread): void {
    this.list = this.list.filter((t) => t !== thread);
  }

  private title(annotationIds: string[]): string {
    return threadTitle(annotationIds[0] ? this.host.store.byId(annotationIds[0]) : undefined, annotationIds.length);
  }

  /** The popover heads follow renumbering and note edits (F-66). */
  retitle(): void {
    for (const t of this.list) t.chat.setTitle(this.title(t.annotationIds));
  }

  bySession(sessionId: string | null): Thread | undefined {
    return this.list.find((t) => t.sessionId === sessionId);
  }

  byPop(pop: HTMLElement | null): Thread | undefined {
    return this.list.find((t) => t.pop === pop);
  }

  byAnnotation(annotationId: string): Thread | undefined {
    return this.list.find((t) => t.annotationIds.includes(annotationId));
  }

  /** The thread whose popover is open, else the most recent one (what `window.__crt.chat` drives). */
  current(openPop: HTMLElement | null): Thread | null {
    return this.byPop(openPop) ?? this.list.at(-1) ?? null;
  }

  /** Threads whose annotations were all deleted (or cleared) go, without closing their sessions (F-67). */
  prune(items: readonly Annotation[]): void {
    const live = new Set(items.map((a) => a.id));
    for (const t of this.list.slice()) {
      if (t.annotationIds.length && !t.annotationIds.some((id) => live.has(id))) {
        t.chat.dispose();
        this.remove(t);
      }
    }
  }

  summaries(): ThreadSummary[] {
    return this.list.map((t) => {
      const snap = t.chat.status();
      return {
        sessionId: t.sessionId,
        annotationIds: t.annotationIds.slice(),
        ns: t.annotationIds.map((id) => this.host.store.byId(id)?.n ?? 0),
        state: threadState(snap.state, snap.taskId),
        taskId: snap.taskId,
        open: t.chat.isOpen(),
      };
    });
  }

  /** F-68: store the page-level chats' session ids for a reload. */
  savePage(): void {
    const ids = this.list.filter((t) => !t.annotationIds.length).map((t) => t.sessionId);
    if (ids.length) safeSet("session", PAGE_THREADS_KEY, JSON.stringify(ids));
    else safeRemove("session", PAGE_THREADS_KEY);
  }
}

export function readPageThreads(): string[] {
  return parsePageThreads(safeGetJson("session", PAGE_THREADS_KEY));
}

/** F-66: the session whose popover was open before a reload. */
function readOpenThread(): string | null {
  return safeGet("session", OPEN_KEY);
}

export function rememberOpenThread(sessionId: string | null): void {
  if (sessionId) safeSet("session", OPEN_KEY, sessionId);
  else safeRemove("session", OPEN_KEY);
}
