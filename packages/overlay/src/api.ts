/**
 * The overlay's one client for the CRT server's `/__crt/*` routes (PRD F-13, F-24…F-30;
 * PRD-providers F-56, F-57; CRT-0043). Every call goes through `crtJson`, which reads the JSON
 * answer and throws the server's own `error` line — else "CRT server answered <status>" — when the
 * request did not complete, the status was not 2xx, the body did not say `ok: true` or a field the
 * caller needs is missing. Each failure is reported to the `onRequestFailure` listener, which the
 * overlay uses to re-read health (PRD-setup F-81: "after any failed CRT request").
 *
 * The paths are the server's own constants (`routes.ts` imports nothing, so the bundle gains a few
 * strings). `health.ts` keeps its fetch — it is what the listener runs — and `loader.ts` stays
 * self-contained (N-20).
 */
import type { CapturePost } from "../../server/src/capture-schema.js";
import { CAPTURES_PATH, CONFIG_PATH, PROVIDERS_PATH, SESSIONS_PATH } from "../../server/src/routes.js";
import type { ProvidersPayload, SessionInfo } from "../../server/src/session-events.js";
import { crtUrl } from "./base.js";

/** F-13: where the server wrote a capture. */
export interface SendResult {
  id: string;
  dir: string;
  files: string[];
}

/** F-56: which provider a new session should run on (the request-body value, F-43 step 1). */
export interface StartOptions {
  quick?: boolean;
  provider?: string | null;
}

let failureListener: (() => void) | null = null;

/** F-81: run `fn` after every CRT request that fails; null stops it. */
export function onRequestFailure(fn: (() => void) | null): void {
  failureListener = fn;
}

/** A JSON body for `method`. */
function withJson(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/**
 * One `/__crt/*` request: the answer's JSON when it is 2xx, says `ok: true` and has every
 * `required` field; otherwise the failure listener runs and the server's error line is thrown.
 */
export async function crtJson<T extends object>(path: string, init?: RequestInit, required: readonly (keyof T & string)[] = []): Promise<T> {
  try {
    const res = await fetch(crtUrl(path), init);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.ok !== true || !required.every((k) => data[k])) {
      throw new Error(typeof data.error === "string" && data.error ? data.error : `CRT server answered ${res.status}`);
    }
    return data as T;
  } catch (err) {
    failureListener?.();
    throw err;
  }
}

/** F-13 `POST /__crt/captures`: the server assigns the id and says where it wrote the files. */
export async function postCapture(post: CapturePost): Promise<SendResult> {
  const data = await crtJson<SendResult>(CAPTURES_PATH, withJson("POST", post), ["id", "dir"]);
  return { id: data.id, dir: data.dir, files: data.files ?? [] };
}

/** F-24 `POST /__crt/sessions`: start an intake session — for a saved capture, or warm (N-2) with `null`. */
export async function startSession(captureId: string | null, opts: StartOptions = {}): Promise<string> {
  // F-56/F-43 step 1: the per-send provider, only when the developer picked one for this send.
  const body = { ...(captureId ? { captureId } : {}), ...(opts.quick ? { quick: true } : {}), ...(opts.provider ? { provider: opts.provider } : {}) };
  return (await crtJson<{ id: string }>(SESSIONS_PATH, withJson("POST", body), ["id"])).id;
}

/** N-2: give a warm session its capture once it is saved. */
export async function attachSessionCapture(sessionId: string, captureId: string): Promise<void> {
  await crtJson(`${SESSIONS_PATH}/${sessionId}/capture`, withJson("POST", { captureId }));
}

/** F-29/F-66: close a session on the server (Discard, or a warm session whose capture failed). */
export async function closeSession(sessionId: string): Promise<void> {
  await crtJson(`${SESSIONS_PATH}/${sessionId}`, { method: "DELETE" });
}

/** F-66: whether the server still has a session (a reload re-attaches only live ones). A gone one is not a failure. */
export function isSessionAlive(sessionId: string): Promise<boolean> {
  return fetch(crtUrl(`${SESSIONS_PATH}/${sessionId}`)).then(
    (r) => r.ok,
    () => false,
  );
}

/** F-30: the server's recent intake sessions, newest first. */
export async function listSessions(): Promise<SessionInfo[]> {
  return (await crtJson<{ sessions: SessionInfo[] }>(SESSIONS_PATH, undefined, ["sessions"])).sessions;
}

/** F-25: the session's event stream, replayed after `after` (an EventSource URL, not a fetch). */
export function sessionEventsUrl(sessionId: string, after: number): string {
  return crtUrl(`${SESSIONS_PATH}/${sessionId}/events?after=${after}`);
}

/** F-25: the developer's reply. */
export async function sendSessionMessage(sessionId: string, text: string): Promise<void> {
  await crtJson(`${SESSIONS_PATH}/${sessionId}/messages`, withJson("POST", { text }));
}

/** F-29: stop the current turn. */
export async function interruptSession(sessionId: string): Promise<void> {
  await crtJson(`${SESSIONS_PATH}/${sessionId}/interrupt`, { method: "POST" });
}

/** F-26: Allow or Deny a permission request. */
export async function answerPermission(sessionId: string, permissionId: string, behavior: "allow" | "deny"): Promise<void> {
  await crtJson(`${SESSIONS_PATH}/${sessionId}/permission`, withJson("POST", { id: permissionId, behavior }));
}

/** F-56/F-57 `GET /__crt/providers`, with `?refresh=1` to re-run the server's preflight. */
export function fetchProviders(refresh: boolean): Promise<ProvidersPayload> {
  return crtJson<ProvidersPayload>(`${PROVIDERS_PATH}${refresh ? "?refresh=1" : ""}`, undefined, ["providers", "active"]);
}

/** F-57 `PUT /__crt/config { provider }`: the server writes `.crt/config.local.json` and answers with its new active provider. */
export async function saveProvider(provider: string): Promise<string | undefined> {
  return (await crtJson<{ active?: string }>(CONFIG_PATH, withJson("PUT", { provider }))).active;
}
