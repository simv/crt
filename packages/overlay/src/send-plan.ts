/**
 * What one Send or Quick note carries (PRD F-13, F-14, F-65, F-68), decided from the annotations
 * alone so the popover's buttons and `sendToAgent` apply one rule (CRT-0043). Pure: no DOM, no
 * store, unit-tested from `packages/server/test/send-plan.test.ts`.
 *
 * The rule: a send is about one annotation — `n`, else the most recent unsent one — which must not
 * have been sent yet. With `include` it also carries every other unsent annotation (F-65, the F-11
 * grouping). A quick note (F-14) needs a note on every annotation it carries, the included ones
 * too: there is no conversation to add the words later. A page-level chat (F-68) carries no
 * annotations, only its message, which must not be blank.
 */
import type { Annotation } from "./annotations.js";

export interface SendOptions {
  /** F-65: the annotation to send; the most recent unsent one when omitted. */
  n?: number;
  /** F-14 quick note. */
  quick?: boolean;
  /** F-65: also send every other unsent annotation in the same capture (F-11 grouping). */
  include?: boolean;
  /** F-68: a page-level chat — no annotations, this message as the bundle's note. */
  message?: string;
}

export interface SendPlan {
  /** The annotations to capture, the one the send is about first; empty for a page-level chat. */
  ids: string[];
  /** F-68: the page-level message, trimmed. */
  note?: string;
}

/** The annotations and message one send carries; throws with the reason it cannot go. */
export function planSend(items: readonly Annotation[], opts: SendOptions = {}): SendPlan {
  if (opts.message !== undefined) {
    const note = opts.message.trim();
    if (!note) throw new Error("nothing to send: type a message first");
    return { ids: [], note };
  }
  const unsent = items.filter((a) => a.sessionId === null);
  const primary = opts.n !== undefined ? items.find((a) => a.n === opts.n) : unsent.at(-1);
  if (!primary) throw new Error(opts.n !== undefined ? `no annotation ${opts.n}` : "nothing to send: add an annotation first");
  if (primary.sessionId) throw new Error(`annotation ${primary.n} was already sent`);
  const sent = [primary, ...(opts.include ? unsent.filter((a) => a.id !== primary.id) : [])];
  if (opts.quick && !sent.every((a) => a.note.trim())) throw new Error("quick note needs a note on every annotation");
  return { ids: sent.map((a) => a.id) };
}

/** F-14: whether a quick note with these options would go — `planSend`'s rule, so the button never offers a send that fails. */
export function canQuickNote(items: readonly Annotation[], opts: Omit<SendOptions, "quick"> = {}): boolean {
  try {
    planSend(items, { ...opts, quick: true });
    return true;
  } catch {
    return false;
  }
}
