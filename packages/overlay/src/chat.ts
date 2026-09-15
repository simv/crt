/**
 * Chat panel (PRD F-14, F-25, F-26, F-28, F-29, F-30): streams an intake session's events over
 * SSE, renders assistant text as it arrives (markdown-ish), shows tool calls as collapsed lines,
 * permission requests as Allow / Deny cards, and takes multi-turn input. The current session id
 * is kept in sessionStorage so a reload re-opens the panel and replays the transcript from the
 * server. A quick-note session (F-14) is followed with the panel hidden; it opens itself only
 * when Claude needs the developer. Framework-free; renders inside the overlay's Shadow DOM.
 */
import type { SessionEvent, SessionInfo, SessionState } from "../../server/src/session-events.js";
import { crtUrl } from "./base.js";
import { ACCENT } from "./screenshot.js";

export const SESSIONS_ENDPOINT = "/__crt/sessions";
const STORAGE_KEY = "crt.session.v1";

export const CHAT_CSS = `
  .chat { display: flex; flex-direction: column; width: 100%; height: min(72vh, 680px); border-radius: 12px; background: #fff;
          box-shadow: 0 8px 28px rgba(0,0,0,.22); border: 1px solid rgba(0,0,0,.08); overflow: hidden; }
  .chat[hidden] { display: none; }
  .chat-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid rgba(0,0,0,.08); background: #fafafa; }
  .chat-head .title { font-weight: 600; }
  .chat-head .state { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #eee; color: #555; }
  .chat-head .state[data-state="running"], .chat-head .state[data-state="starting"] { background: #fff3cd; color: #7a5a00; }
  .chat-head .state[data-state="waiting"] { background: ${ACCENT}; color: #fff; }
  .chat-head .state[data-state="idle"] { background: #d9f5e3; color: #0a5b2b; }
  .chat-head .state[data-state="error"] { background: #fde2e2; color: #8b0000; }
  .chat-head .spacer { flex: 1; }
  .chat-head button { padding: 4px 8px; border-radius: 6px; font-size: 12px; }
  .chat-head button:hover { background: #eee; }
  .chat-head button:disabled { opacity: .4; cursor: default; }
  .chat-log { flex: 1; overflow: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; scroll-behavior: smooth; }
  .msg { max-width: 92%; padding: 8px 10px; border-radius: 10px; line-height: 1.45; word-wrap: break-word; overflow-wrap: anywhere; }
  .msg.user { align-self: flex-end; background: #111; color: #fff; white-space: pre-wrap; }
  .msg.user .imgs { display: block; margin-top: 4px; font-size: 11px; opacity: .75; }
  .msg.assistant { align-self: flex-start; background: #f3f3f5; }
  .msg.assistant p { margin: 0 0 6px; } .msg.assistant p:last-child { margin-bottom: 0; }
  .msg.assistant ul, .msg.assistant ol { margin: 4px 0 6px; padding-left: 20px; }
  .msg.assistant li { margin: 2px 0; }
  .msg.assistant li.task { list-style: none; margin-left: -18px; }
  .msg.assistant code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; background: rgba(0,0,0,.06); padding: 0 4px; border-radius: 4px; }
  .msg.assistant pre { margin: 6px 0; padding: 8px; border-radius: 8px; background: #1e1e24; color: #eee; overflow: auto; }
  .msg.assistant pre code { background: none; padding: 0; color: inherit; }
  .msg.assistant h1, .msg.assistant h2, .msg.assistant h3 { font-size: 13px; margin: 8px 0 4px; }
  .msg.assistant.streaming::after { content: "▍"; color: ${ACCENT}; animation: crt-blink 1s steps(2) infinite; }
  @keyframes crt-blink { to { opacity: 0; } }
  .tool { align-self: stretch; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; color: #555; }
  .tool summary { cursor: pointer; list-style: none; display: flex; gap: 6px; align-items: center; padding: 2px 4px; border-radius: 6px; }
  .tool summary::before { content: "▸"; color: #999; } .tool[open] summary::before { content: "▾"; }
  .tool summary:hover { background: #f3f3f5; }
  .tool .dot { width: 6px; height: 6px; border-radius: 3px; background: #ccc; flex: none; }
  .tool.done .dot { background: #2e9e5b; } .tool.error .dot { background: #c00; }
  .tool .out { padding: 4px 4px 4px 18px; white-space: pre-wrap; color: #777; }
  .perm { align-self: stretch; border: 1px solid ${ACCENT}; border-radius: 10px; padding: 8px 10px; background: #fff5f8; }
  .perm .t { font-weight: 600; margin-bottom: 4px; }
  .perm pre { margin: 0 0 8px; padding: 6px 8px; border-radius: 6px; background: #fff; border: 1px solid rgba(0,0,0,.08);
              font-size: 12px; white-space: pre-wrap; max-height: 120px; overflow: auto; }
  .perm .btns { display: flex; gap: 6px; }
  .perm button { padding: 5px 12px; border-radius: 8px; font-weight: 600; }
  .perm button.allow { background: #111; color: #fff; }
  .perm button.deny { background: #eee; }
  .perm .done { font-size: 12px; color: #555; }
  .perm.resolved { border-color: rgba(0,0,0,.12); background: #fafafa; }
  .sys { align-self: center; font-size: 11px; color: #888; text-align: center; }
  .thinking { align-self: flex-start; font-size: 12px; color: #888; padding: 2px 10px; }
  .thinking::after { content: "…"; animation: crt-blink 1s steps(2) infinite; }
  .sys.error { color: #b00020; font-weight: 600; align-self: stretch; text-align: left; padding: 6px 10px; background: #fde2e2; border-radius: 8px; }
  .chat-task { padding: 8px 10px; background: #d9f5e3; color: #0a5b2b; font-size: 12px; border-top: 1px solid rgba(0,0,0,.06); }
  .chat-task[hidden] { display: none; }
  .chat-task code { font-family: ui-monospace, Menlo, Consolas, monospace; user-select: all; }
  .chat-input { display: flex; gap: 6px; padding: 8px; border-top: 1px solid rgba(0,0,0,.08); }
  .chat-input textarea { flex: 1; min-height: 38px; max-height: 120px; resize: vertical; font: inherit; padding: 8px; border-radius: 8px;
                         border: 1px solid rgba(0,0,0,.15); background: #fafafa; }
  .chat-input textarea:focus { outline: 2px solid ${ACCENT}; outline-offset: -1px; background: #fff; }
  .chat-input button { padding: 0 14px; border-radius: 8px; background: ${ACCENT}; color: #fff; font-weight: 600; }
  .chat-input button:disabled { opacity: .5; cursor: default; }
  .chat-foot { padding: 6px 10px; font-size: 11px; color: #777; border-top: 1px solid rgba(0,0,0,.06); background: #fafafa;
               white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chat-foot code { font-family: ui-monospace, Menlo, Consolas, monospace; user-select: all; color: #333; }
`;

export interface ChatSnapshot {
  sessionId: string | null;
  state: SessionState | null;
  taskId: string | null;
  /** F-14: following a quick-note session with the panel hidden. */
  quiet: boolean;
  events: SessionEvent[];
}

/** F-14: what a quietly followed session did. */
export type QuietOutcome =
  | { kind: "task"; id: string; path: string }
  /** The panel opened itself: Claude asked a question, needs a permission, or failed. */
  | { kind: "attention"; reason: string };

export interface ChatCallbacks {
  onVisibility(open: boolean): void;
  onQuiet(outcome: QuietOutcome): void;
}

export class ChatPanel {
  readonly el: HTMLElement;
  private readonly log: HTMLElement;
  private readonly stateEl: HTMLElement;
  private readonly taskEl: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly foot: HTMLElement;
  private source: EventSource | null = null;
  private sessionId: string | null = null;
  private state: SessionState | null = null;
  private taskId: string | null = null;
  private events: SessionEvent[] = [];
  private texts = new Map<string, string>();
  /** Placeholder shown between assistant_start and the first visible output (model thinking). */
  private thinking: HTMLElement | null = null;
  private lastSeq = 0;
  private quiet = false;
  private readonly callbacks: ChatCallbacks;

  constructor(parent: HTMLElement, callbacks: ChatCallbacks) {
    this.callbacks = callbacks;
    this.el = document.createElement("div");
    this.el.className = "chat";
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="chat-head">
        <span class="title">Claude</span>
        <span class="state" data-state="starting">starting</span>
        <span class="spacer"></span>
        <button type="button" data-chat="interrupt" title="Interrupt the current turn (F-29)">Stop</button>
        <button type="button" data-chat="new" title="Discard this session and go back to annotating (F-29)">New session</button>
        <button type="button" data-chat="hide" title="Hide the chat (the session keeps running)">×</button>
      </div>
      <div class="chat-log" role="log" aria-live="polite"></div>
      <div class="chat-task" hidden></div>
      <div class="chat-input">
        <textarea rows="1" placeholder="Reply to Claude… (Enter to send, Shift+Enter for a new line)"></textarea>
        <button type="button" data-chat="send">Send</button>
      </div>
      <div class="chat-foot"></div>
    `;
    parent.prepend(this.el);
    const q = <T extends HTMLElement>(sel: string) => this.el.querySelector(sel) as T;
    this.log = q(".chat-log");
    this.stateEl = q(".chat-head .state");
    this.taskEl = q(".chat-task");
    this.input = q("textarea");
    this.sendBtn = q("[data-chat=send]");
    this.stopBtn = q("[data-chat=interrupt]");
    this.foot = q(".chat-foot");
    this.wire();
  }

  // ---- public ---------------------------------------------------------------------------------

  snapshot(): ChatSnapshot {
    return { sessionId: this.sessionId, state: this.state, taskId: this.taskId, quiet: this.quiet, events: this.events.slice() };
  }

  isOpen(): boolean {
    return !this.el.hidden;
  }

  /** F-13/F-24: start an intake session for a saved capture and open the panel on it (or follow it quietly, F-14). */
  async startFromCapture(captureId: string, opts: { quick?: boolean } = {}): Promise<string> {
    const id = await this.createSession(captureId, opts.quick === true);
    if (opts.quick) this.follow(id);
    else this.open(id);
    return id;
  }

  /**
   * N-2 warm start: boot the session while the capture is still being rasterised, then
   * `attachCapture` once it is saved (or `abandon` if the capture failed).
   */
  warmStart(opts: { quick?: boolean } = {}): Promise<string> {
    return this.createSession(null, opts.quick === true);
  }

  async attachCapture(sessionId: string, captureId: string, opts: { quick?: boolean } = {}): Promise<void> {
    const res = await fetch(crtUrl(`${SESSIONS_ENDPOINT}/${sessionId}/capture`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captureId }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) throw new Error(data.error ?? `CRT server answered ${res.status}`);
    if (opts.quick) this.follow(sessionId);
    else this.open(sessionId);
  }

  async abandon(sessionId: string): Promise<void> {
    await fetch(crtUrl(`${SESSIONS_ENDPOINT}/${sessionId}`), { method: "DELETE" }).catch(() => undefined);
  }

  /** F-30: the server's recent intake sessions, newest first. */
  async listSessions(): Promise<SessionInfo[]> {
    const res = await fetch(crtUrl(SESSIONS_ENDPOINT));
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; sessions?: SessionInfo[]; error?: string };
    if (!res.ok || !data.ok || !data.sessions) throw new Error(data.error ?? `CRT server answered ${res.status}`);
    return data.sessions;
  }

  private async createSession(captureId: string | null, quick: boolean): Promise<string> {
    const res = await fetch(crtUrl(SESSIONS_ENDPOINT), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(captureId ? { captureId } : {}), ...(quick ? { quick } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
    if (!res.ok || !data.ok || !data.id) throw new Error(data.error ?? `CRT server answered ${res.status}`);
    return data.id;
  }

  /** Attach to an existing session (replays its transcript) and show the panel. */
  open(sessionId: string): void {
    this.attach(sessionId);
    this.quiet = false;
    this.show(true);
  }

  /**
   * F-14: attach to a quick-note session without showing the panel. It stays hidden until the
   * task is written (`onQuiet` reports it) or Claude needs the developer, when it opens itself.
   */
  follow(sessionId: string): void {
    this.attach(sessionId);
    this.quiet = true;
    this.show(false);
  }

  private attach(sessionId: string): void {
    if (this.sessionId !== sessionId) {
      this.detach();
      this.sessionId = sessionId;
      this.state = "starting";
      this.taskId = null;
      this.events = [];
      this.texts.clear();
      this.lastSeq = 0;
      this.log.replaceChildren();
      this.thinking = null;
      this.taskEl.hidden = true;
      this.renderFoot();
      this.renderState();
      this.connect();
      try {
        sessionStorage.setItem(STORAGE_KEY, sessionId);
      } catch {
        // ignore
      }
    }
  }

  /** Re-open the session a previous page load was chatting with, if the server still has it. */
  async restore(): Promise<boolean> {
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return false;
    }
    if (!id) return false;
    const alive = await fetch(crtUrl(`${SESSIONS_ENDPOINT}/${id}`))
      .then((r) => r.ok)
      .catch(() => false);
    if (!alive) {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      return false;
    }
    this.open(id);
    return true;
  }

  show(open: boolean): void {
    this.el.hidden = !open;
    this.callbacks.onVisibility(open);
    if (open) {
      this.scrollToEnd();
      if (this.state === "idle") this.input.focus();
    }
  }

  async send(text: string): Promise<void> {
    if (!this.sessionId || !text.trim()) return;
    const res = await fetch(crtUrl(`${SESSIONS_ENDPOINT}/${this.sessionId}/messages`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) this.system(`Could not send (${res.status})`, true);
  }

  async interrupt(): Promise<void> {
    if (!this.sessionId) return;
    await fetch(crtUrl(`${SESSIONS_ENDPOINT}/${this.sessionId}/interrupt`), { method: "POST" });
  }

  async respond(permissionId: string, behavior: "allow" | "deny"): Promise<void> {
    if (!this.sessionId) return;
    await fetch(crtUrl(`${SESSIONS_ENDPOINT}/${this.sessionId}/permission`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: permissionId, behavior }),
    });
  }

  /** F-29 "New session": close the server-side session, forget it, hide the panel. */
  async discard(): Promise<void> {
    const id = this.sessionId;
    this.detach();
    this.sessionId = null;
    this.state = null;
    this.taskId = null;
    this.quiet = false;
    this.events = [];
    this.texts.clear();
    this.log.replaceChildren();
    this.thinking = null;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    this.show(false);
    if (id) await fetch(crtUrl(`${SESSIONS_ENDPOINT}/${id}`), { method: "DELETE" }).catch(() => undefined);
  }

  // ---- transport --------------------------------------------------------------------------------

  private connect(): void {
    if (!this.sessionId) return;
    const source = new EventSource(crtUrl(`${SESSIONS_ENDPOINT}/${this.sessionId}/events?after=${this.lastSeq}`));
    this.source = source;
    source.onmessage = (e: MessageEvent<string>) => {
      const seq = Number(e.lastEventId);
      if (seq && seq <= this.lastSeq) return; // replay overlap after a reconnect
      if (seq) this.lastSeq = seq;
      let event: SessionEvent;
      try {
        event = JSON.parse(e.data) as SessionEvent;
      } catch {
        return;
      }
      this.handle(event);
    };
    source.onerror = () => {
      // EventSource reconnects by itself (with Last-Event-ID); only report a dead session.
      if (source.readyState === EventSource.CLOSED && this.state !== "ended" && this.state !== "error") {
        this.system("Lost the connection to the CRT server", true);
      }
    };
  }

  private detach(): void {
    this.source?.close();
    this.source = null;
  }

  // ---- events → DOM -------------------------------------------------------------------------------

  private handle(event: SessionEvent): void {
    this.events.push(event);
    switch (event.type) {
      case "state":
        this.state = event.state;
        this.renderState();
        if (event.state === "ended" || event.state === "error") this.detach();
        if (event.state === "ended") this.system("Session ended");
        if (event.state === "idle" && this.isOpen()) this.input.focus();
        // F-14: a quiet session that stops without a task has a question; one that fails needs eyes.
        if (this.quiet && event.state === "idle" && !this.taskId) this.attention("Claude has a question");
        else if (this.quiet && event.state === "error") this.attention(event.detail ?? "the session failed");
        else if (this.quiet && event.state === "ended" && !this.taskId) this.attention("the session ended without writing a task");
        break;
      case "init":
        this.renderFoot(event.model, event.claudeCodeVersion);
        break;
      case "user":
        this.append(userBubble(event.text, event.images));
        break;
      case "assistant_start":
        // The bubble is created on the first text delta: a message that only carries tool_use
        // blocks would otherwise leave an empty bubble above its tool lines.
        this.texts.set(event.messageId, "");
        this.showThinking();
        break;
      case "text": {
        this.hideThinking();
        const text = (this.texts.get(event.messageId) ?? "") + event.text;
        this.texts.set(event.messageId, text);
        let el = this.log.querySelector<HTMLElement>(`.msg.assistant[data-mid="${cssEscape(event.messageId)}"]`);
        if (!el) el = this.append(assistantBubble(event.messageId));
        el.innerHTML = renderMarkdown(text);
        this.scrollToEnd();
        break;
      }
      case "assistant_end":
        this.log.querySelector(`.msg.assistant[data-mid="${cssEscape(event.messageId)}"]`)?.classList.remove("streaming");
        break;
      case "tool_use":
        this.hideThinking();
        this.append(toolLine(event.id, event.label));
        break;
      case "tool_result": {
        const el = this.log.querySelector<HTMLElement>(`.tool[data-tid="${cssEscape(event.id)}"]`);
        if (el) {
          el.classList.add(event.isError ? "error" : "done");
          (el.querySelector(".out") as HTMLElement).textContent = event.summary || (event.isError ? "error" : "done");
        }
        break;
      }
      case "permission":
        this.append(permissionCard(event.id, event.title, event.detail));
        if (this.quiet) this.attention("Claude needs a permission");
        else this.show(true);
        break;
      case "permission_resolved": {
        const el = this.log.querySelector<HTMLElement>(`.perm[data-pid="${cssEscape(event.id)}"]`);
        if (el) {
          el.classList.add("resolved");
          const why = event.by === "timeout" ? " (no answer within 5 minutes)" : event.by === "session" ? " (session ended)" : "";
          (el.querySelector(".btns") as HTMLElement).innerHTML = `<span class="done">${event.behavior === "allow" ? "Allowed" : "Denied"}${why}</span>`;
        }
        break;
      }
      case "result":
        this.hideThinking();
        if (!event.ok) this.system(event.errors.join("; ") || "The turn failed", !/interrupt/i.test(event.errors.join(" ")));
        for (const el of Array.from(this.log.querySelectorAll(".msg.assistant.streaming"))) el.classList.remove("streaming");
        break;
      case "task_written":
        this.taskId = event.id;
        this.taskEl.innerHTML = `Task <b>${escapeHtml(event.id)}</b> written to <code>${escapeHtml(event.path)}</code>`;
        this.taskEl.hidden = false;
        if (this.quiet) {
          this.quiet = false;
          this.callbacks.onQuiet({ kind: "task", id: event.id, path: event.path });
        }
        break;
      case "error":
        this.system(event.message, true);
        break;
    }
  }

  /** F-14: stop following quietly and bring the developer in. */
  private attention(reason: string): void {
    this.quiet = false;
    this.show(true);
    this.callbacks.onQuiet({ kind: "attention", reason });
  }

  private showThinking(): void {
    if (this.thinking) return;
    const el = document.createElement("div");
    el.className = "thinking";
    el.textContent = "thinking";
    this.thinking = this.append(el);
  }

  private hideThinking(): void {
    this.thinking?.remove();
    this.thinking = null;
  }

  private append<T extends HTMLElement>(el: T): T {
    this.log.appendChild(el);
    this.scrollToEnd();
    return el;
  }

  private system(text: string, error = false): void {
    const el = document.createElement("div");
    el.className = error ? "sys error" : "sys";
    el.textContent = text;
    this.append(el);
  }

  private renderState(): void {
    const s = this.state ?? "starting";
    this.stateEl.dataset.state = s;
    this.stateEl.textContent = { starting: "starting", running: "thinking…", waiting: "needs permission", idle: "your turn", ended: "ended", error: "error" }[s];
    const over = s === "ended" || s === "error";
    this.input.disabled = over;
    this.sendBtn.disabled = over;
    this.stopBtn.disabled = s !== "running" && s !== "waiting";
  }

  /** F-28: session id and the resume hint. */
  private renderFoot(model?: string, version?: string): void {
    const id = this.sessionId ?? "";
    this.foot.innerHTML = `session <code>${escapeHtml(id)}</code>${model ? ` · ${escapeHtml(model)}` : ""}${version ? ` · Claude Code ${escapeHtml(version)}` : ""} · continue in a terminal: <code>claude --resume ${escapeHtml(id)}</code>`;
    this.foot.title = `claude --resume ${id}`;
  }

  private scrollToEnd(): void {
    this.log.scrollTop = this.log.scrollHeight;
  }

  private wire(): void {
    this.el.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>("button");
      if (!btn) return;
      const perm = btn.closest<HTMLElement>(".perm");
      if (perm && btn.dataset.behavior) {
        void this.respond(perm.dataset.pid!, btn.dataset.behavior as "allow" | "deny");
        return;
      }
      switch (btn.dataset.chat) {
        case "send":
          this.submit();
          break;
        case "interrupt":
          void this.interrupt();
          break;
        case "new":
          void this.discard();
          break;
        case "hide":
          this.show(false);
          break;
      }
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (!text || this.input.disabled) return;
    this.input.value = "";
    void this.send(text);
  }
}

// ---- DOM builders --------------------------------------------------------------------------------

function userBubble(text: string, images: string[]): HTMLElement {
  const el = document.createElement("div");
  el.className = "msg user";
  el.textContent = text;
  if (images.length) {
    const imgs = document.createElement("span");
    imgs.className = "imgs";
    imgs.textContent = `📎 ${images.join(", ")}`;
    el.appendChild(imgs);
  }
  return el;
}

function assistantBubble(messageId: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "msg assistant streaming";
  el.dataset.mid = messageId;
  return el;
}

function toolLine(id: string, label: string): HTMLElement {
  const el = document.createElement("details");
  el.className = "tool";
  el.dataset.tid = id;
  el.innerHTML = `<summary><span class="dot"></span><span class="label"></span></summary><div class="out">…</div>`;
  (el.querySelector(".label") as HTMLElement).textContent = label;
  return el;
}

function permissionCard(id: string, title: string, detail: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "perm";
  el.dataset.pid = id;
  el.innerHTML = `<div class="t"></div><pre></pre><div class="btns"><button type="button" class="allow" data-behavior="allow">Allow</button><button type="button" class="deny" data-behavior="deny">Deny</button></div>`;
  (el.querySelector(".t") as HTMLElement).textContent = title;
  (el.querySelector("pre") as HTMLElement).textContent = detail;
  return el;
}

// ---- markdown-ish -------------------------------------------------------------------------------

/** Enough Markdown for chat: fences, inline code, bold/italic, headings, lists, checkboxes, paragraphs. */
export function renderMarkdown(src: string): string {
  const out: string[] = [];
  const lines = src.split("\n");
  let i = 0;
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`);
    list = null;
  };
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^\s*```/.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i++]!);
      i++;
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      out.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`);
      i++;
      continue;
    }
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const tag = item[1] ? "ul" : "ol";
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      const check = /^\[([ xX])\]\s+(.*)$/.exec(item[3]!);
      list.items.push(
        check
          ? `<li class="task"><input type="checkbox" disabled${check[1] !== " " ? " checked" : ""}> ${inline(check[2]!)}</li>`
          : `<li>${inline(item[3]!)}</li>`,
      );
      i++;
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      i++;
      continue;
    }
    flushList();
    para.push(line);
    i++;
  }
  flushPara();
  flushList();
  return out.join("");
}

function inline(text: string): string {
  const parts = text.split(/(`[^`]*`)/);
  return parts
    .map((p, idx) => {
      if (idx % 2 === 1) return `<code>${escapeHtml(p.slice(1, -1))}</code>`;
      return escapeHtml(p)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
        .replace(/(^|[\s(])\*([^*]+)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
    })
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function cssEscape(s: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
}
