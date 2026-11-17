/**
 * The overlay's one way to the CRT server (PRD-extension F-151). Every request to a `/__crt/*`
 * route — the JSON calls of api.ts, the health read, the session event stream, the rasteriser
 * frame's URL — goes through the transport set here. The default is what the overlay has always
 * done: `fetch` and `EventSource` on `crtUrl(path)`, same-origin behind the proxy and cross-origin
 * to the loopback CRT server in embedded mode (F-6). The extension replaces it with one that asks
 * its service worker (extension/content.ts), because there the page's own network context cannot
 * reach the server (docs/spikes/extension-2026-11.md rows 1 and 5).
 *
 * No other overlay module calls `fetch`, `EventSource` or `crtUrl` for a CRT route
 * (test/overlay-structure.test.ts).
 */
import { CRT_ORIGIN, crtUrl } from "./base.js";

/** The answer to one JSON call: the status and the body parsed as JSON (`{}` when it is not JSON). */
export interface CrtAnswer {
  ok: boolean;
  status: number;
  data: unknown;
}

/** What a JSON call may carry: the subset of `RequestInit` the overlay uses, all of it serialisable. */
export interface CrtRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  cache?: "no-store";
}

/** One server-sent event (F-25): `type` is `message` unless the server named it. */
export interface StreamEvent {
  type: string;
  id: string;
  data: string;
}

export interface StreamHandlers {
  onEvent(event: StreamEvent): void;
  /** The stream dropped. `closed` is true when it will not reconnect by itself. */
  onError(closed: boolean): void;
}

export interface EventStream {
  close(): void;
}

export interface Transport {
  /** Rejects when the request did not complete; a non-2xx answer resolves with `ok: false`. */
  json(path: string, init?: CrtRequest): Promise<CrtAnswer>;
  /** An event stream that reconnects by itself, as `EventSource` does. `types` are the named events to deliver besides `message`. */
  events(path: string, handlers: StreamHandlers, types?: readonly string[]): EventStream;
  /** An absolute or page-relative URL for a CRT page the overlay frames (the rasteriser, F-16). */
  url(path: string): string;
  /** The CRT origin when it is not the page's own; "" behind the proxy. */
  origin(): string;
}

/** F-151: today's behaviour. */
export const pageTransport: Transport = {
  async json(path, init) {
    const res = await fetch(crtUrl(path), init);
    const data: unknown = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  },
  events(path, handlers, types = []) {
    const source = new EventSource(crtUrl(path));
    const deliver = (type: string) => (e: Event) => {
      const m = e as MessageEvent<string>;
      handlers.onEvent({ type, id: m.lastEventId, data: typeof m.data === "string" ? m.data : "" });
    };
    for (const type of types) source.addEventListener(type, deliver(type));
    source.onmessage = deliver("message");
    // EventSource reconnects by itself (with Last-Event-ID) unless it has closed.
    source.onerror = () => handlers.onError(source.readyState === EventSource.CLOSED);
    return { close: () => source.close() };
  },
  url: (path) => crtUrl(path),
  origin: () => CRT_ORIGIN,
};

let current: Transport = pageTransport;

/** The transport in use. */
export function transport(): Transport {
  return current;
}

/** F-151: replace the transport (the extension's content script, before the overlay mounts; tests). */
export function setTransport(next: Transport): void {
  current = next;
}
