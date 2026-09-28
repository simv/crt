/**
 * The popovers' DOM (PRD F-65, F-66, F-68): the compose box an annotation opens beside its element
 * (note, "include the other unsent annotations", Delete, Quick note, the F-56 split Send), the
 * page-level one the toolbar's Chat button docks above the toolbar, and the bare docked popover a
 * session opened from the list lives in. Each has a `.thread` slot where the chat mounts after Send.
 * One set of delegated listeners serves them all; ui.ts says what the actions do and places them.
 *
 * Popovers are patched in place and never re-created while their annotation lives: every keystroke
 * in a note re-renders, and detaching a focused textarea — even to re-insert the same node — blurs it.
 */
import { type Annotation, describeAnnotation } from "./annotations.js";
import { canQuickNote, type SendOptions } from "./send-plan.js";

/** F-56: the split Send button (its main half is labelled by the provider menu). */
function splitSend(title: string): string {
  return `<span class="split">
            <button type="button" class="primary" data-action="send" title="${title}">Send</button>
            <button type="button" class="primary caret" data-action="agent" title="Choose the agent for this send (F-56)" aria-label="Choose the agent for this send">▾</button>
          </span>`;
}

function pop(className: string, html: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.hidden = true;
  el.innerHTML = html;
  return el;
}

/** F-68: the docked compose box for a page-level chat. */
export function buildPagePop(): HTMLElement {
  const el = pop(
    "pop page",
    `
      <div class="pop-head"><span class="title">Chat about this page</span><button type="button" class="close" data-pop="close" title="Close">×</button></div>
      <div class="compose">
        <textarea rows="3" placeholder="Ask the agent about this page…"></textarea>
        <div class="pop-foot">
          <span class="spacer"></span>
          <button type="button" data-action="quick" title="Quick note: the agent writes the task from your message without a chat (F-14)">Quick note</button>
          ${splitSend("Capture the page and send (F-68)")}
        </div>
        <div class="providers" hidden></div>
      </div>
      <div class="thread"></div>`,
  );
  el.dataset.page = "new";
  return el;
}

/** A docked popover that only hosts a chat (a page-level thread, or a session opened from the list). */
export function buildDockedPop(): HTMLElement {
  return pop("pop page", `<div class="thread"></div>`);
}

/** F-65: an annotation's compose box, beside its element. */
export function buildAnnotationPop(a: Annotation): HTMLElement {
  const el = pop(
    "pop",
    `
      <div class="pop-head"><span class="num"></span><span class="label"></span><button type="button" class="close" data-pop="close" title="Close (the annotation stays)">×</button></div>
      <div class="compose">
        <textarea rows="3" placeholder="What's wrong or wanted here?"></textarea>
        <label class="include" hidden><input type="checkbox"> <span></span></label>
        <div class="pop-foot">
          <button type="button" class="del" data-action="delete" title="Delete this annotation">Delete</button>
          <span class="spacer"></span>
          <button type="button" data-action="quick" title="Quick note: the agent writes the task from your note without a chat (F-14)">Quick note</button>
          ${splitSend("Capture and send (F-13)")}
        </div>
        <div class="providers" hidden></div>
      </div>
      <div class="thread"></div>`,
  );
  el.dataset.id = a.id;
  return el;
}

/** What patching a compose box needs to know about the rest of the overlay. */
export interface ComposeState {
  /** Every annotation, for the F-14 rule (`canQuickNote`). */
  all: readonly Annotation[];
  unsent: readonly Annotation[];
  /** A send is running: every button waits. */
  busy: boolean;
  /** The annotation whose note has focus: its textarea is never overwritten. */
  focusedId: string | undefined;
  /** F-56: label a Send button with the agent this send will use. */
  labelSend(btn: HTMLButtonElement): void;
}

const q = <T extends HTMLElement>(root: HTMLElement, sel: string) => root.querySelector(sel) as T;

/** F-65: bring an annotation's popover up to date — its number, label, note, the include line and the buttons. */
export function patchAnnotationPop(el: HTMLElement, a: Annotation, s: ComposeState, threaded: boolean): void {
  el.dataset.n = String(a.n);
  q(el, ".pop-head .num").textContent = String(a.n);
  q(el, ".pop-head .label").textContent = describeAnnotation(a);
  const ta = q<HTMLTextAreaElement>(el, "textarea");
  if (ta.value !== a.note && s.focusedId !== a.id) ta.value = a.note;
  const others = s.unsent.filter((u) => u.id !== a.id).length;
  const include = q(el, ".include");
  include.hidden = others === 0 || a.sessionId !== null;
  q(include, "span").textContent = `include the ${others} other unsent annotation${others === 1 ? "" : "s"}`;
  const included = q<HTMLInputElement>(include, "input").checked && !include.hidden;
  const send = q<HTMLButtonElement>(el, "[data-action=send]");
  s.labelSend(send);
  send.disabled = s.busy;
  q<HTMLButtonElement>(el, "[data-action=quick]").disabled = s.busy || !canQuickNote(s.all, { n: a.n, include: included });
  q<HTMLButtonElement>(el, "[data-action=delete]").disabled = s.busy;
  el.classList.toggle("threaded", a.sessionId !== null && threaded);
}

/** What the popovers' buttons, notes and keys do. */
export interface PopActions {
  /** The number of the annotation a popover belongs to, while it exists. */
  numberOf(annotationId: string): number | undefined;
  close(pop: HTMLElement): void;
  /** A click inside a popover's provider list (F-56). */
  pickProvider(btn: HTMLButtonElement): void;
  /** The caret: toggle this popover's provider list (F-56). */
  toggleProviders(list: HTMLElement): void;
  remove(n: number): void;
  send(opts: SendOptions): void;
  setNote(n: number, note: string): void;
  /** The include checkbox or the page message changed: the buttons follow. */
  changed(): void;
}

/** One set of delegated listeners for every popover in `container`. */
export function wirePops(container: HTMLElement, act: PopActions): void {
  container.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>("button");
    const pop = btn?.closest<HTMLElement>(".pop");
    if (!btn || !pop) return;
    if (btn.dataset.pop === "close") return act.close(pop);
    if (btn.closest(".providers")) return act.pickProvider(btn);
    const isPage = pop.dataset.page === "new";
    const n = isPage ? undefined : act.numberOf(pop.dataset.id ?? "");
    const include = pop.querySelector<HTMLInputElement>(".include input")?.checked === true;
    const message = isPage ? q<HTMLTextAreaElement>(pop, "textarea").value : undefined;
    switch (btn.dataset.action) {
      case "delete":
        if (n) act.remove(n);
        break;
      case "send":
        act.send(isPage ? { message } : { n, include });
        break;
      case "quick":
        act.send(isPage ? { message, quick: true } : { n, include, quick: true });
        break;
      case "agent":
        act.toggleProviders(q(pop, ".providers"));
        break;
    }
  });
  container.addEventListener("input", (e) => {
    const el = e.target as HTMLElement;
    const pop = el.closest<HTMLElement>(".pop");
    if (!pop) return;
    if (el.tagName === "TEXTAREA" && pop.dataset.id) {
      const n = act.numberOf(pop.dataset.id);
      if (n) act.setNote(n, (el as HTMLTextAreaElement).value);
    } else {
      act.changed();
    }
  });
  // Keys typed into notes and chats must not reach the host page's shortcuts; Ctrl/Cmd+Enter sends.
  for (const type of ["keydown", "keyup", "keypress"] as const) {
    container.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type !== "keydown") return;
      const ke = e as KeyboardEvent;
      const ta = ke.target as HTMLElement;
      if (ke.key === "Enter" && (ke.ctrlKey || ke.metaKey) && ta.tagName === "TEXTAREA" && ta.closest(".compose")) {
        ke.preventDefault();
        ta.closest(".pop")?.querySelector<HTMLButtonElement>("[data-action=send]")?.click();
      }
    });
  }
}

/** F-68: the page-level compose box — Send and Quick note need a message; the placeholder names the agent. */
export function patchPagePop(el: HTMLElement, s: ComposeState, agentName: string): void {
  const send = q<HTMLButtonElement>(el, "[data-action=send]");
  s.labelSend(send);
  const ta = q<HTMLTextAreaElement>(el, "textarea");
  send.disabled = s.busy || ta.value.trim() === "";
  q<HTMLButtonElement>(el, "[data-action=quick]").disabled = s.busy || !canQuickNote(s.all, { message: ta.value });
  ta.placeholder = `Ask ${agentName} about this page…`;
}
