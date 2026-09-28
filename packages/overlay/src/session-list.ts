/**
 * The session list (PRD F-30, F-47): the toolbar's Sessions button lists the server's recent intake
 * sessions, newest first — summary, state pill (or task id), time · provider · page · short id —
 * and a row opens its session, in its annotation's popover when it has one (F-66).
 */
import type { SessionInfo } from "../../server/src/session-events.js";
import { listSessions } from "./api.js";
import { messageOf, STATE_LABEL } from "./dom-util.js";

export interface SessionListHost {
  /** The list is opening: the provider menu and the popovers close, the toolbar follows. */
  opening(): void;
  /** The session shown now, marked in the list. */
  current(): string | null;
  open(sessionId: string): void;
}

export class SessionList {
  constructor(
    readonly el: HTMLElement,
    private readonly host: SessionListHost,
  ) {
    el.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>("button");
      if (!btn) return;
      if (btn.dataset.sessions === "close") this.hide();
      else if (btn.dataset.session) {
        this.hide();
        this.host.open(btn.dataset.session);
      }
    });
  }

  isOpen(): boolean {
    return !this.el.hidden;
  }

  hide(): void {
    this.el.hidden = true;
  }

  async toggle(force?: boolean): Promise<void> {
    if (!(force ?? this.el.hidden)) {
      this.hide();
      return;
    }
    this.el.innerHTML = `<div class="head"><span>Sessions</span><span class="spacer"></span><button type="button" data-sessions="close">×</button></div><div class="empty">Loading…</div>`;
    this.el.hidden = false;
    this.host.opening();
    let list: SessionInfo[];
    try {
      list = await listSessions();
    } catch (err) {
      this.el.querySelector(".empty")!.textContent = `Could not list sessions: ${messageOf(err)}`;
      return;
    }
    const current = this.host.current();
    const rows = list.map((s) => sessionRow(s, s.id === current));
    this.el.replaceChildren(this.el.querySelector(".head")!, ...rows);
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No sessions yet — annotate something and Send.";
      this.el.appendChild(empty);
    }
  }
}

function sessionRow(s: SessionInfo, current: boolean): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `session${current ? " current" : ""}`;
  btn.dataset.session = s.id;
  const when = new Date(s.startedAt);
  const time = Number.isNaN(when.getTime()) ? s.startedAt : when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  btn.innerHTML = `<span class="sum"></span><span class="pill"></span><span class="meta"></span>`;
  (btn.querySelector(".sum") as HTMLElement).textContent = s.summary ?? (s.captureId ? `capture ${s.captureId}` : "warming up");
  const pill = btn.querySelector(".pill") as HTMLElement;
  pill.dataset.state = s.taskId ? "task" : s.state;
  pill.textContent = s.taskId ?? STATE_LABEL[s.state];
  // F-47: the provider per row, so a Codex session is recognisable in the list.
  (btn.querySelector(".meta") as HTMLElement).textContent = `${time} · ${s.provider}${s.quick ? " · quick note" : ""}${s.url ? ` · ${pathOf(s.url)}` : ""} · ${s.id.slice(0, 8)}`;
  return btn;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
