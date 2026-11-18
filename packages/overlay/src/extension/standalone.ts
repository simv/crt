/**
 * The extension with no CRT server (PRD-connect §5.1, §5.2; F-165, F-166, N-48): the routes the
 * overlay calls, answered inside the service worker. The overlay does not know the difference —
 * it posts its capture and opens a session through the same transport (PRD-extension F-151) — and
 * what it gets back is a session with no agent in it: the capture is kept as a review item in this
 * browser, the panel says so and where the item goes next, and anything typed afterwards is added
 * to the item.
 *
 * Pure over a key-value store (`Kv`): IndexedDB in the worker and the review page (idb.ts), a Map
 * in the unit tests. Nothing here makes a request (N-48): a review leaves the browser only from
 * the review page, when the developer sends it (destinations.ts).
 */
import { type CapturePost, validateCapturePost } from "../../../server/src/capture-schema.js";
import { CAPTURES_PATH, CONFIG_PATH, HEALTH_PATH, PROVIDERS_PATH, SESSIONS_PATH } from "../../../server/src/routes.js";
import type { ProviderCapabilities, ProvidersPayload, SessionEvent, SessionInfo } from "../../../server/src/session-events.js";
import type { HealthPayload } from "../health.js";
import type { CrtAnswer, CrtRequest, StreamEvent } from "../transport.js";
import { intakeSummary, itemId, itemTitle, renderItem, type ReviewItem } from "./review-items.js";

/** The store both extension contexts share. Values are structured-cloneable. */
export interface Kv {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /** Every key that starts with `prefix`, sorted. */
  keys(prefix: string): Promise<string[]>;
}

export const ITEM_PREFIX = "item:";
export const IMAGE_PREFIX = "image:";
const SESSION_PREFIX = "session:";
const NEXT_KEY = "meta:next";

export const imageKey = (id: string, name: string) => `${IMAGE_PREFIX}${id}/${name}`;

/** The provider id and name the panel shows where an agent's would be. */
export const STANDALONE_PROVIDER = "review";
const DISPLAY_NAME = "Review";
/** Where the panel says an item was written. */
export const REVIEW_PLACE = "the review in this browser";
/** How the developer gets to the review page, said wherever an item is saved (F-167). */
export const OPEN_REVIEW_HINT = 'right-click the CRT toolbar button and choose "Open review"';

const CAPABILITIES: ProviderCapabilities = { streaming: false, toolEvents: false, permissions: "none", images: "none", resume: false, interrupt: false, instructions: "system" };

interface StoredSession {
  id: string;
  origin: string;
  itemId: string | null;
  startedAt: string;
  ended: boolean;
  events: SessionEvent[];
}

export interface StandaloneEnv {
  kv: Kv;
  /** The extension's version: what health reports, so PRD-extension N-45 holds by construction. */
  version: string;
  now(): Date;
  uuid(): string;
  /** Where this site's feedback goes, in words (destinations.ts `targetLine`). */
  targetLine(origin: string): Promise<string>;
}

/** Every item of the review, oldest first. */
export async function listItems(kv: Kv): Promise<ReviewItem[]> {
  const items = (await Promise.all((await kv.keys(ITEM_PREFIX)).map((k) => kv.get(k)))) as Array<ReviewItem | undefined>;
  return items.filter((i): i is ReviewItem => !!i).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export async function saveItem(kv: Kv, item: ReviewItem): Promise<void> {
  await kv.set(ITEM_PREFIX + item.id, item);
}

/** Remove an item and its pictures for good (the review page's Delete). */
export async function deleteItem(kv: Kv, id: string): Promise<void> {
  for (const key of await kv.keys(`${IMAGE_PREFIX}${id}/`)) await kv.delete(key);
  await kv.delete(ITEM_PREFIX + id);
}

const ok = (data: Record<string, unknown> = {}): CrtAnswer => ({ ok: true, status: 200, data: { ok: true, ...data } });
const fail = (status: number, error: string): CrtAnswer => ({ ok: false, status, data: { ok: false, error } });

function body(init: CrtRequest | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(init?.body ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface Standalone {
  /** One JSON call of the overlay's, for the page at `origin`. */
  json(origin: string, path: string, init?: CrtRequest): Promise<CrtAnswer>;
  /** A session's event stream path → the events after the one last seen, then `live`; null when the session is gone. */
  replay(origin: string, path: string, lastEventId: string): Promise<StreamEvent[] | null>;
  /** Events recorded from now on for one session, as they are appended. */
  subscribe(sessionId: string, listener: (event: StreamEvent) => void): () => void;
  /** The session id in an events path, or null. */
  sessionOf(path: string): string | null;
}

export function standalone(env: StandaloneEnv): Standalone {
  const { kv } = env;
  const listeners = new Map<string, Set<(event: StreamEvent) => void>>();
  // One mutation at a time: a warm session, its capture and the attach arrive close together.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  const frame = (seq: number, event: SessionEvent): StreamEvent => ({ type: "message", id: String(seq), data: JSON.stringify(event) });
  const session = async (id: string, origin: string) => {
    const s = (await kv.get(SESSION_PREFIX + id)) as StoredSession | undefined;
    return s && s.origin === origin ? s : null;
  };
  const record = async (s: StoredSession, events: SessionEvent[]) => {
    const from = s.events.length;
    s.events.push(...events);
    await kv.set(SESSION_PREFIX + s.id, s);
    events.forEach((e, i) => listeners.get(s.id)?.forEach((l) => l(frame(from + i + 1, e))));
  };
  const say = (text: string): SessionEvent[] => {
    const messageId = env.uuid();
    return [{ type: "assistant_start", messageId }, { type: "text", messageId, text }, { type: "assistant_end", messageId }, { type: "result", ok: true, durationMs: 0, costUsd: 0, errors: [] }, { type: "state", state: "idle" }];
  };

  /** The capture became an item: the panel shows the developer's words, where the item is and where it goes. */
  const intake = async (s: StoredSession, item: ReviewItem) => {
    s.itemId = item.id;
    const where = await env.targetLine(s.origin);
    const next = where.includes("Claude") ? `It goes to ${where.replace(/^this browser, then /, "")} when you send the review` : "It is kept in this browser until you copy it or choose where it goes";
    await record(s, [
      { type: "state", state: "running" },
      { type: "user", text: renderItem(item), images: item.images, intake: intakeSummary(item.id, item.bundle) },
      { type: "task_written", id: item.id, path: REVIEW_PLACE },
      ...say(`Saved as ${item.id}. ${next}: ${OPEN_REVIEW_HINT}. Anything you type here is added to ${item.id}.`),
    ]);
  };

  const info = (s: StoredSession, item: ReviewItem | undefined): SessionInfo => ({
    id: s.id,
    provider: STANDALONE_PROVIDER,
    nativeSessionId: s.id,
    captureId: s.itemId,
    startedAt: s.startedAt,
    state: s.ended ? "ended" : "idle",
    taskId: s.itemId,
    quick: false,
    summary: item ? itemTitle(item) : null,
    url: item?.bundle.page.url ?? null,
  });

  const routes = async (origin: string, path: string, init: CrtRequest | undefined): Promise<CrtAnswer> => {
    const method = (init?.method ?? "GET").toUpperCase();
    const [route] = path.split("?");

    if (route === HEALTH_PATH && method === "GET") {
      const items = (await listItems(kv)).filter((i) => i.origin === origin);
      const health: HealthPayload = {
        ok: true,
        version: env.version,
        startedAt: null,
        target: null,
        app: null,
        projectRoot: await env.targetLine(origin),
        tasksDir: null,
        tasks: items.length,
        store: "review",
        review: "browser",
        guest: true,
        provider: STANDALONE_PROVIDER,
        login: "ok",
        sessions: 0,
        overlay: { injected: 0, fetched: 0, lastContentType: null, cspWarning: null },
      };
      return { ok: true, status: 200, data: health };
    }

    if (route === PROVIDERS_PATH && method === "GET") {
      const payload: ProvidersPayload = {
        ok: true,
        active: STANDALONE_PROVIDER,
        decision: { provider: STANDALONE_PROVIDER, reason: "no CRT server: feedback is kept as a review in this browser" },
        providers: [{ id: STANDALONE_PROVIDER, displayName: DISPLAY_NAME, installed: true, loggedIn: true, version: env.version, problem: null, markers: [], capabilities: CAPABILITIES }],
      };
      return { ok: true, status: 200, data: payload };
    }
    if (route === CONFIG_PATH && method === "PUT") return ok({ active: STANDALONE_PROVIDER });

    if (route === CAPTURES_PATH && method === "POST") {
      const post = body(init);
      const errors = validateCapturePost(post);
      if (errors.length) return fail(400, `invalid capture: ${errors.slice(0, 3).join("; ")}`);
      const { bundle, images } = post as unknown as CapturePost;
      const n = Number((await kv.get(NEXT_KEY)) ?? 1) || 1;
      const id = itemId(n);
      await kv.set(NEXT_KEY, n + 1);
      const names = Object.keys(images).sort();
      for (const name of names) await kv.set(imageKey(id, name), images[name]);
      const item: ReviewItem = { id, origin, createdAt: env.now().toISOString(), bundle: { ...bundle, id }, images: names, keep: true, followups: [], sent: null };
      await saveItem(kv, item);
      return ok({ id, dir: REVIEW_PLACE, files: ["capture.json", ...names] });
    }

    if (route === SESSIONS_PATH && method === "GET") {
      const all = ((await Promise.all((await kv.keys(SESSION_PREFIX)).map((k) => kv.get(k)))) as StoredSession[]).filter((s) => s && s.origin === origin && s.itemId);
      const items = new Map((await listItems(kv)).map((i) => [i.id, i]));
      return ok({ sessions: all.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 20).map((s) => info(s, items.get(s.itemId ?? ""))) });
    }

    if (route === SESSIONS_PATH && method === "POST") {
      const b = body(init);
      const s: StoredSession = { id: env.uuid(), origin, itemId: null, startedAt: env.now().toISOString(), ended: false, events: [] };
      await record(s, [
        { type: "init", sessionId: s.id, nativeSessionId: s.id, provider: STANDALONE_PROVIDER, displayName: DISPLAY_NAME, model: null, agentVersion: env.version, resumeCommand: null, capabilities: CAPABILITIES },
        { type: "state", state: "starting" },
      ]);
      if (typeof b.captureId === "string") {
        const item = (await kv.get(ITEM_PREFIX + b.captureId)) as ReviewItem | undefined;
        if (!item || item.origin !== origin) return fail(404, `no capture ${b.captureId}`);
        await intake(s, item);
      }
      return ok({ id: s.id });
    }

    const m = /^\/([0-9a-zA-Z-]{1,64})(?:\/(capture|messages|interrupt|permission))?$/.exec(route!.startsWith(`${SESSIONS_PATH}/`) ? route!.slice(SESSIONS_PATH.length) : "");
    if (!m) return fail(404, "not a route of the review in this browser");
    const s = await session(m[1]!, origin);
    if (!s) return fail(404, "no such session");
    const action = m[2];

    if (!action && method === "GET") return s.ended ? fail(404, "the session has ended") : ok({ session: info(s, undefined) });
    if (!action && method === "DELETE") {
      // The item stays: Discard closes the conversation, the review page drops or deletes items.
      if (!s.ended) {
        s.ended = true;
        await record(s, [{ type: "state", state: "ended" }]);
      }
      return ok();
    }
    if (s.ended) return fail(409, "the session has ended");
    if (action === "capture" && method === "POST") {
      const captureId = body(init).captureId;
      const item = typeof captureId === "string" ? ((await kv.get(ITEM_PREFIX + captureId)) as ReviewItem | undefined) : undefined;
      if (!item || item.origin !== origin) return fail(404, "no such capture");
      if (s.itemId) return fail(409, "the session already has its capture");
      await intake(s, item);
      return ok();
    }
    if (action === "messages" && method === "POST") {
      const text = typeof body(init).text === "string" ? (body(init).text as string).trim().slice(0, 4000) : "";
      if (!text) return fail(400, "an empty message");
      const item = s.itemId ? ((await kv.get(ITEM_PREFIX + s.itemId)) as ReviewItem | undefined) : undefined;
      const echo: SessionEvent[] = [{ type: "state", state: "running" }, { type: "user", text, images: [] }];
      if (!item) {
        await record(s, [...echo, ...say("Nothing is saved from this conversation — the item was deleted from the review, or nothing was captured. Annotate the page and press Send.")]);
        return ok();
      }
      item.followups.push(text);
      await saveItem(kv, item);
      await record(s, [...echo, ...say(`Added to ${item.id}.`)]);
      return ok();
    }
    if (action === "interrupt" && method === "POST") return ok();
    return fail(404, "not a route of the review in this browser");
  };

  const sessionOf = (path: string): string | null => {
    const m = new RegExp(`^${SESSIONS_PATH}/([0-9a-zA-Z-]{1,64})/events(?:\\?|$)`).exec(path);
    return m ? m[1]! : null;
  };

  return {
    json: (origin, path, init) => serial(() => routes(origin, path, init)),
    sessionOf,
    replay: (origin, path, lastEventId) =>
      serial(async () => {
        const id = sessionOf(path);
        const s = id ? await session(id, origin) : null;
        if (!s) return null;
        const after = Math.max(Number(lastEventId) || 0, Number(new URLSearchParams(path.split("?")[1] ?? "").get("after")) || 0);
        return [...s.events.map((e, i) => frame(i + 1, e)).slice(after), { type: "live", id: "", data: "{}" }];
      }),
    subscribe(sessionId, listener) {
      const set = listeners.get(sessionId) ?? new Set();
      listeners.set(sessionId, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(sessionId);
      };
    },
  };
}

/** A `Kv` in memory (the unit tests; a page with no IndexedDB). */
export function memoryKv(): Kv {
  const map = new Map<string, unknown>();
  return {
    get: async (key) => structuredClone(map.get(key)),
    set: async (key, value) => void map.set(key, structuredClone(value)),
    delete: async (key) => void map.delete(key),
    keys: async (prefix) => [...map.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}
