/**
 * Overlay UI (PRD F-7…F-14, F-30): launcher, toolbar, Select / Box / Pin tools, numbered markers,
 * the notes panel, the Send / Quick note flows, the session list, and the chat panel (chat.ts).
 * Everything renders inside the Shadow DOM host; the host itself is a fixed, pointer-transparent
 * full-viewport layer, and only the widgets opt back in to pointer events, so the page underneath
 * keeps working while CRT is idle.
 */
import type { SessionInfo } from "../../server/src/session-events.js";
import { type Annotation, AnnotationStore, toViewportRect } from "./annotations.js";
import { capture, send, type SendResult } from "./capture.js";
import { CHAT_CSS, ChatPanel, type QuietOutcome } from "./chat.js";
import { nearestComponentName } from "./component.js";
import { labelOf } from "./element.js";
import { ACCENT } from "./screenshot.js";
import { isOverlayNode } from "./selector.js";

export type Tool = "select" | "box" | "pin";

const LAUNCHER_KEY = "crt.launcher.v1";
const EDGE = 16;

const CSS = `
  :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
          font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; display: block; }
  *, *::before, *::after { box-sizing: border-box; }
  button { font: inherit; cursor: pointer; border: 0; background: none; color: inherit; padding: 0; }
  .launcher { position: fixed; pointer-events: auto; user-select: none; touch-action: none;
              display: inline-flex; align-items: center; gap: 6px; padding: 10px 14px; border-radius: 999px;
              background: #111; color: #fff; font-weight: 600; box-shadow: 0 4px 16px rgba(0,0,0,.25); cursor: grab; }
  .launcher:active { cursor: grabbing; }
  .launcher .count { display: none; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
                     background: ${ACCENT}; color: #fff; font-size: 11px; line-height: 18px; text-align: center; }
  .launcher .count.on { display: inline-block; }
  .dock { position: fixed; pointer-events: auto; display: flex; flex-direction: column; gap: 8px; align-items: flex-end;
          width: min(360px, calc(100vw - 32px)); }
  .dock[hidden] { display: none; }
  .dock.chat-open { width: min(520px, calc(100vw - 32px)); }
  .toolbar { display: flex; gap: 4px; align-items: center; padding: 6px; border-radius: 12px; background: #fff;
             box-shadow: 0 8px 28px rgba(0,0,0,.22); border: 1px solid rgba(0,0,0,.08); }
  .toolbar button { padding: 6px 10px; border-radius: 8px; font-weight: 500; }
  .toolbar button:hover { background: #f0f0f0; }
  .toolbar button.active { background: #111; color: #fff; }
  .toolbar button.primary { background: ${ACCENT}; color: #fff; font-weight: 600; }
  .toolbar button.primary:hover { background: #e62e63; }
  .toolbar button:disabled { opacity: .5; cursor: default; }
  .toolbar .sep { width: 1px; height: 20px; background: rgba(0,0,0,.1); margin: 0 2px; }
  .toolbar .badge { min-width: 20px; padding: 0 6px; border-radius: 10px; background: #eee; text-align: center;
                    font-size: 11px; font-weight: 600; line-height: 20px; }
  .panel { width: 100%; max-height: 50vh; overflow: auto; border-radius: 12px; background: #fff;
           box-shadow: 0 8px 28px rgba(0,0,0,.22); border: 1px solid rgba(0,0,0,.08); padding: 6px; }
  .panel[hidden] { display: none; }
  .item { display: grid; grid-template-columns: 22px 1fr 22px; gap: 6px 8px; padding: 6px; border-radius: 8px; }
  .item + .item { border-top: 1px solid rgba(0,0,0,.06); }
  .item .num { width: 22px; height: 22px; border-radius: 11px; background: ${ACCENT}; color: #fff; font-weight: 700;
               font-size: 12px; line-height: 22px; text-align: center; }
  .item .label { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; color: #555;
                 overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 22px; }
  .item .del { width: 22px; height: 22px; border-radius: 11px; color: #888; font-size: 16px; line-height: 22px; }
  .item .del:hover { background: #fee; color: #c00; }
  .item textarea { grid-column: 2 / 4; width: 100%; min-height: 40px; resize: vertical; font: inherit; padding: 6px 8px;
                   border: 1px solid rgba(0,0,0,.15); border-radius: 8px; background: #fafafa; }
  .item textarea:focus { outline: 2px solid ${ACCENT}; outline-offset: -1px; background: #fff; }
  .empty { padding: 10px; color: #777; text-align: center; }
  .status { width: 100%; padding: 8px 10px; border-radius: 10px; background: #111; color: #fff; font-size: 12px;
            word-break: break-all; }
  .status[hidden] { display: none; }
  .status.error { background: #b00020; }
  .status code { font-family: ui-monospace, Menlo, Consolas, monospace; user-select: all; }
  .status button { color: #ffd166; text-decoration: underline; margin-left: 6px; }
  .sessions { width: 100%; max-height: 40vh; overflow: auto; border-radius: 12px; background: #fff;
              box-shadow: 0 8px 28px rgba(0,0,0,.22); border: 1px solid rgba(0,0,0,.08); padding: 6px; }
  .sessions[hidden] { display: none; }
  .sessions .head { display: flex; align-items: center; gap: 8px; padding: 4px 6px 6px; font-weight: 600; }
  .sessions .head .spacer { flex: 1; }
  .sessions .head button { padding: 2px 8px; border-radius: 6px; font-size: 12px; color: #555; }
  .sessions .head button:hover { background: #f0f0f0; }
  .session { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; width: 100%; text-align: left; padding: 6px 8px;
             border-radius: 8px; }
  .session:hover { background: #f3f3f5; }
  .session.current { background: #fff5f8; }
  .session .sum { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session .meta { grid-column: 1 / 3; font-size: 11px; color: #777; font-family: ui-monospace, Menlo, Consolas, monospace;
                   overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session .pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #eee; color: #555; white-space: nowrap; }
  .session .pill[data-state="running"], .session .pill[data-state="starting"] { background: #fff3cd; color: #7a5a00; }
  .session .pill[data-state="waiting"] { background: ${ACCENT}; color: #fff; }
  .session .pill[data-state="idle"] { background: #d9f5e3; color: #0a5b2b; }
  .session .pill[data-state="error"] { background: #fde2e2; color: #8b0000; }
  .layer { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; touch-action: none; }
  .layer[hidden] { display: none; }
  .hover { position: fixed; pointer-events: none; border: 2px solid ${ACCENT}; background: rgba(255,61,113,.08);
           border-radius: 2px; display: none; }
  .hover-label { position: fixed; pointer-events: none; display: none; padding: 3px 7px; border-radius: 6px;
                 background: #111; color: #fff; font-size: 11px; font-family: ui-monospace, Menlo, Consolas, monospace;
                 max-width: 60vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hover-label b { color: #ffd166; font-weight: 600; }
  .drag { position: fixed; pointer-events: none; border: 2px dashed ${ACCENT}; background: rgba(255,61,113,.08); display: none; }
  .markers { position: fixed; inset: 0; pointer-events: none; }
  .mark { position: fixed; border: 2px solid ${ACCENT}; border-radius: 2px; }
  .mark.box { border-style: dashed; }
  .mark.pin { width: 14px; height: 14px; border-radius: 7px; background: ${ACCENT}; border: 2px solid #fff;
              box-shadow: 0 0 0 2px ${ACCENT}; }
  .mark.detached { opacity: .4; }
  .num-badge { position: fixed; pointer-events: auto; cursor: pointer; width: 22px; height: 22px; border-radius: 11px;
               background: ${ACCENT}; color: #fff; font-weight: 700; font-size: 12px; line-height: 22px; text-align: center;
               box-shadow: 0 2px 6px rgba(0,0,0,.3); transform: translate(-50%, -50%); }
  .hint { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); pointer-events: none; padding: 6px 12px;
          border-radius: 999px; background: rgba(17,17,17,.9); color: #fff; font-size: 12px; }
  .hint[hidden] { display: none; }
${CHAT_CSS}
`;

const HINTS: Record<Tool, string> = {
  select: "Select: click an element · ↑ parent · ↓ child · Esc cancel",
  box: "Box: drag a rectangle · Esc cancel",
  pin: "Pin: click a point · Esc cancel",
};

export class OverlayUI {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly store: AnnotationStore;
  private tool: Tool | null = null;
  private busy = false;
  private open = false;
  private candidate: Element | null = null;
  private candidateLocked = false;
  private dragStart: { x: number; y: number } | null = null;
  private raf = 0;
  private launcherPos = { right: EDGE, bottom: EDGE };

  private readonly launcher: HTMLElement;
  private readonly count: HTMLElement;
  private readonly dock: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly sessions: HTMLElement;
  private readonly status: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly hover: HTMLElement;
  private readonly hoverLabel: HTMLElement;
  private readonly drag: HTMLElement;
  private readonly markers: HTMLElement;
  private readonly hint: HTMLElement;
  readonly chat: ChatPanel;

  constructor(store: AnnotationStore) {
    this.store = store;
    this.host = document.createElement("div");
    this.host.id = "crt-host";
    this.host.setAttribute("data-crt", "");
    this.root = this.host.attachShadow({ mode: "open" });
    this.root.innerHTML = `
      <style>${CSS}</style>
      <div class="markers" part="markers"></div>
      <div class="layer" hidden>
        <div class="hover"></div><div class="hover-label"></div><div class="drag"></div>
      </div>
      <div class="hint" hidden></div>
      <div class="dock" hidden>
        <div class="status" hidden></div>
        <div class="sessions" hidden></div>
        <div class="panel" hidden></div>
        <div class="toolbar" role="toolbar" aria-label="CRT tools">
          <button type="button" data-tool="select" title="Select an element (F-8)">Select</button>
          <button type="button" data-tool="box" title="Draw a box (F-9)">Box</button>
          <button type="button" data-tool="pin" title="Drop a pin (F-10)">Pin</button>
          <span class="sep"></span>
          <span class="badge" data-count>0</span>
          <button type="button" data-action="clear" title="Remove all annotations">Clear</button>
          <button type="button" data-action="sessions" title="Recent intake sessions (F-30)">Sessions</button>
          <span class="sep"></span>
          <button type="button" data-action="quick" title="Quick note: Claude writes the task from your notes without a chat (F-14). Needs a note on every annotation.">Quick note</button>
          <button type="button" class="primary" data-action="send" title="Capture and send to Claude (F-13)">Send to Claude</button>
        </div>
      </div>
      <button type="button" class="launcher" aria-label="Toggle Claude Review Tool (Ctrl/Cmd+Shift+.)">
        CRT <span class="count">0</span>
      </button>
    `;
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.launcher = q(".launcher");
    this.count = q(".launcher .count");
    this.dock = q(".dock");
    this.toolbar = q(".toolbar");
    this.panel = q(".panel");
    this.sessions = q(".sessions");
    this.status = q(".status");
    this.layer = q(".layer");
    this.hover = q(".hover");
    this.hoverLabel = q(".hover-label");
    this.drag = q(".drag");
    this.markers = q(".markers");
    this.hint = q(".hint");
    this.chat = new ChatPanel(this.dock, {
      onVisibility: (open) => {
        this.dock.classList.toggle("chat-open", open);
        if (open) {
          this.sessions.hidden = true;
          if (!this.open) this.toggle(true);
        }
        this.render();
      },
      onQuiet: (outcome) => this.onQuiet(outcome),
    });

    this.restoreLauncher();
    this.wireLauncher();
    this.wireToolbar();
    this.wireLayer();
    this.wireKeyboard();
    this.store.subscribe(() => this.render());
    document.documentElement.appendChild(this.host);
    this.placeLauncher(); // needs the launcher's real height, so after mount
    this.render();
    void this.chat.restore(); // a reload mid-conversation re-opens the chat (F-25)
  }

  // ---- public surface (also exposed on window.__crt for tests) ------------------------------

  isOpen(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.dock.hidden = !this.open;
    if (!this.open) this.setTool(null);
    this.render();
  }

  currentTool(): Tool | null {
    return this.tool;
  }

  setTool(tool: Tool | null): void {
    if (this.busy) return;
    this.tool = tool;
    this.candidate = null;
    this.candidateLocked = false;
    this.dragStart = null;
    this.layer.hidden = tool === null;
    this.hover.style.display = "none";
    this.hoverLabel.style.display = "none";
    this.drag.style.display = "none";
    this.hint.hidden = tool === null;
    if (tool) {
      this.hint.textContent = HINTS[tool];
      if (!this.open) this.toggle(true);
    }
    for (const b of Array.from(this.toolbar.querySelectorAll<HTMLButtonElement>("[data-tool]"))) {
      b.classList.toggle("active", b.dataset.tool === tool);
    }
  }

  /** Programmatic hover for the Select tool (tests): highlight the element at a viewport point. */
  hoverAt(x: number, y: number): Element | null {
    const el = this.elementAt(x, y);
    this.setCandidate(el);
    return el;
  }

  /**
   * F-13: freeze, capture, POST, clear the annotations, then open the chat on a new intake
   * session (F-24). The session is warm-started in parallel with the capture so the Claude
   * Code process boots while the page is being rasterised (N-2). A capture that saved but
   * whose session failed to start is still reported as sent — the files are on disk and the
   * status line says what went wrong.
   *
   * F-14 `quick`: every annotation must carry a note; the chat stays hidden and the status line
   * reports the task id when Claude writes it (or the panel opens itself if Claude needs you).
   */
  async sendToClaude(opts: { quick?: boolean } = {}): Promise<SendResult> {
    const quick = opts.quick === true;
    if (this.busy) throw new Error("already sending");
    if (!this.store.count()) throw new Error("nothing to send: add an annotation first");
    if (quick && !this.canQuickNote()) throw new Error("quick note needs a note on every annotation");
    this.busy = true;
    this.setTool(null);
    this.sessions.hidden = true;
    this.showStatus("Capturing page…");
    this.render();
    const warm = this.chat.warmStart({ quick }).catch(() => null);
    try {
      const result = await capture(this.store);
      this.showStatus("Sending to Claude…");
      const sent = await send(result);
      this.store.clear();
      this.showStatus(`Capture saved: <code>${escapeHtml(sent.dir)}</code>`, false, !quick);
      try {
        const sessionId = await warm;
        if (sessionId) await this.chat.attachCapture(sessionId, sent.id, { quick });
        else await this.chat.startFromCapture(sent.id, { quick });
        if (quick) this.showStatus(`Quick note sent — Claude is writing the task…${openChatLink()}`);
      } catch (err) {
        this.showStatus(
          `Capture saved: <code>${escapeHtml(sent.dir)}</code> — but Claude did not start: ${escapeHtml(err instanceof Error ? err.message : String(err))}`,
          true,
        );
      }
      return sent;
    } catch (err) {
      void warm.then((id) => (id ? this.chat.abandon(id) : undefined));
      this.showStatus(`Send failed: ${escapeHtml(err instanceof Error ? err.message : String(err))}`, true);
      throw err;
    } finally {
      this.busy = false;
      this.render();
    }
  }

  /** F-14: quick notes need words on every annotation, since there is no conversation to add them. */
  canQuickNote(): boolean {
    const items = this.store.all();
    return items.length > 0 && items.every((a) => a.note.trim() !== "");
  }

  private onQuiet(outcome: QuietOutcome): void {
    if (outcome.kind === "task") {
      this.showStatus(`Task <b>${escapeHtml(outcome.id)}</b> written to <code>${escapeHtml(outcome.path)}</code>${openChatLink()}`);
    } else {
      this.showStatus(`Claude needs you: ${escapeHtml(outcome.reason)}`, false, true);
    }
  }

  // ---- session list (F-30) ---------------------------------------------------------------------

  /** Toggle the list of recent intake sessions; each row re-opens its session in the chat. */
  async toggleSessions(force?: boolean): Promise<void> {
    const show = force ?? this.sessions.hidden;
    if (!show) {
      this.sessions.hidden = true;
      return;
    }
    this.sessions.innerHTML = `<div class="head"><span>Sessions</span><span class="spacer"></span><button type="button" data-sessions="close">×</button></div><div class="empty">Loading…</div>`;
    this.sessions.hidden = false;
    if (this.chat.isOpen()) this.chat.show(false);
    this.render();
    let list: SessionInfo[];
    try {
      list = await this.chat.listSessions();
    } catch (err) {
      this.sessions.querySelector(".empty")!.textContent = `Could not list sessions: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    this.renderSessions(list);
  }

  private renderSessions(list: SessionInfo[]): void {
    const current = this.chat.snapshot().sessionId;
    const rows = list.map((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `session${s.id === current ? " current" : ""}`;
      btn.dataset.session = s.id;
      const when = new Date(s.startedAt);
      const time = Number.isNaN(when.getTime()) ? s.startedAt : when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      btn.innerHTML = `<span class="sum"></span><span class="pill"></span><span class="meta"></span>`;
      (btn.querySelector(".sum") as HTMLElement).textContent = s.summary ?? (s.captureId ? `capture ${s.captureId}` : "warming up");
      const pill = btn.querySelector(".pill") as HTMLElement;
      pill.dataset.state = s.state;
      pill.textContent = s.taskId ?? STATE_LABEL[s.state];
      (btn.querySelector(".meta") as HTMLElement).textContent = `${time}${s.quick ? " · quick note" : ""}${s.url ? ` · ${pathOf(s.url)}` : ""} · ${s.id.slice(0, 8)}`;
      return btn;
    });
    const head = this.sessions.querySelector(".head")!;
    this.sessions.replaceChildren(head, ...rows);
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No sessions yet — annotate something and Send to Claude.";
      this.sessions.appendChild(empty);
    }
  }

  // ---- launcher --------------------------------------------------------------------------------

  private restoreLauncher(): void {
    try {
      const raw = localStorage.getItem(LAUNCHER_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { right: number; bottom: number };
        if (Number.isFinite(p.right) && Number.isFinite(p.bottom)) this.launcherPos = p;
      }
    } catch {
      // localStorage unavailable: default corner
    }
    this.placeLauncher();
    window.addEventListener("resize", () => this.placeLauncher());
  }

  private placeLauncher(): void {
    const right = clamp(this.launcherPos.right, 0, Math.max(0, window.innerWidth - 60));
    const bottom = clamp(this.launcherPos.bottom, 0, Math.max(0, window.innerHeight - 40));
    this.launcherPos = { right, bottom };
    this.launcher.style.right = `${right}px`;
    this.launcher.style.bottom = `${bottom}px`;
    this.dock.style.right = `${right}px`;
    this.dock.style.bottom = `${bottom + this.launcher.offsetHeight + 8}px`;
  }

  private wireLauncher(): void {
    let start: { x: number; y: number; right: number; bottom: number } | null = null;
    let dragged = false;
    this.launcher.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, ...this.launcherPos };
      dragged = false;
      this.launcher.setPointerCapture(e.pointerId);
    });
    this.launcher.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) < 4) return;
      dragged = true;
      this.launcherPos = { right: start.right - dx, bottom: start.bottom - dy };
      this.placeLauncher();
    });
    const finish = (e: PointerEvent) => {
      if (!start) return;
      start = null;
      if (this.launcher.hasPointerCapture(e.pointerId)) this.launcher.releasePointerCapture(e.pointerId);
      if (dragged) {
        try {
          localStorage.setItem(LAUNCHER_KEY, JSON.stringify(this.launcherPos));
        } catch {
          // ignore
        }
      } else {
        this.toggle();
      }
    };
    this.launcher.addEventListener("pointerup", finish);
    this.launcher.addEventListener("pointercancel", finish);
    // The launcher is a <button>; keyboard activation toggles without a pointer sequence.
    this.launcher.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  // ---- toolbar and panel ---------------------------------------------------------------------

  private wireToolbar(): void {
    this.toolbar.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest("button");
      if (!btn) return;
      const tool = btn.dataset.tool as Tool | undefined;
      if (tool) {
        this.setTool(this.tool === tool ? null : tool);
        return;
      }
      if (btn.dataset.action === "clear") {
        this.store.clear();
        this.status.hidden = true;
      } else if (btn.dataset.action === "send") {
        void this.sendToClaude().catch(() => undefined);
      } else if (btn.dataset.action === "quick") {
        void this.sendToClaude({ quick: true }).catch(() => undefined);
      } else if (btn.dataset.action === "sessions") {
        void this.toggleSessions();
      }
    });
    this.sessions.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>("button");
      if (!btn) return;
      if (btn.dataset.sessions === "close") this.sessions.hidden = true;
      else if (btn.dataset.session) this.chat.open(btn.dataset.session);
    });
    this.status.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>("button");
      if (btn?.dataset.status === "chat") this.chat.show(true);
    });
    this.panel.addEventListener("input", (e) => {
      const ta = e.target as HTMLTextAreaElement;
      const n = Number(ta.closest<HTMLElement>(".item")?.dataset.n);
      if (ta.tagName === "TEXTAREA" && n) this.store.setNote(n, ta.value);
    });
    this.panel.addEventListener("click", (e) => {
      const del = (e.target as Element).closest<HTMLButtonElement>("button.del");
      if (!del) return;
      const n = Number(del.closest<HTMLElement>(".item")?.dataset.n);
      if (n) this.store.remove(n);
    });
    // Keys typed into notes must not reach the host page's shortcuts.
    for (const type of ["keydown", "keyup", "keypress"] as const) {
      this.dock.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  private render(): void {
    const items = this.store.all();
    const n = items.length;
    this.count.textContent = String(n);
    this.count.classList.toggle("on", n > 0);
    (this.toolbar.querySelector("[data-count]") as HTMLElement).textContent = String(n);
    for (const b of Array.from(this.toolbar.querySelectorAll("button"))) b.disabled = this.busy;
    (this.toolbar.querySelector("[data-action=send]") as HTMLButtonElement).disabled = this.busy || n === 0;
    (this.toolbar.querySelector("[data-action=quick]") as HTMLButtonElement).disabled = this.busy || !this.canQuickNote();
    (this.toolbar.querySelector("[data-action=clear]") as HTMLButtonElement).disabled = this.busy || n === 0;
    (this.toolbar.querySelector("[data-action=sessions]") as HTMLButtonElement).classList.toggle("active", !this.sessions.hidden);

    this.renderPanel(items);
    this.renderMarkers(items);
    if (n > 0 && !this.raf) this.tick();
    if (n === 0 && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  /**
   * Reconcile the note rows in place. Every keystroke in a note re-renders (the store notifies
   * on `setNote`), and detaching a focused textarea — even to re-insert the same node — blurs
   * it, so rows are patched where they stand and only moved when their position changed.
   */
  private renderPanel(items: Annotation[]): void {
    this.panel.hidden = !this.open || items.length === 0 || this.chat.isOpen() || !this.sessions.hidden;
    const active = this.root.activeElement as HTMLTextAreaElement | null;
    const activeId = active?.closest<HTMLElement>(".item")?.dataset.id;
    const keep = new Set(items.map((a) => a.id));
    const existing = new Map<string, HTMLElement>();
    for (const el of Array.from(this.panel.querySelectorAll<HTMLElement>(".item"))) {
      if (keep.has(el.dataset.id!)) existing.set(el.dataset.id!, el);
      else el.remove();
    }
    items.forEach((a, i) => {
      let el = existing.get(a.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "item";
        el.dataset.id = a.id;
        el.innerHTML = `<span class="num"></span><span class="label"></span><button type="button" class="del" title="Delete">×</button><textarea rows="2" placeholder="What's wrong or wanted here?"></textarea>`;
      }
      el.dataset.n = String(a.n);
      (el.querySelector(".num") as HTMLElement).textContent = String(a.n);
      (el.querySelector(".label") as HTMLElement).textContent = describeAnnotation(a);
      const ta = el.querySelector("textarea") as HTMLTextAreaElement;
      if (ta.value !== a.note && activeId !== a.id) ta.value = a.note;
      if (this.panel.children[i] !== el) this.panel.insertBefore(el, this.panel.children[i] ?? null);
    });
  }

  private renderMarkers(items: Annotation[]): void {
    const frag = document.createDocumentFragment();
    for (const a of items) {
      const mark = document.createElement("div");
      mark.className = `mark ${a.kind}`;
      mark.dataset.n = String(a.n);
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "num-badge";
      badge.dataset.n = String(a.n);
      badge.textContent = String(a.n);
      badge.title = a.note || `Annotation ${a.n}`;
      badge.addEventListener("click", () => this.focusNote(a.n));
      frag.append(mark, badge);
    }
    this.markers.replaceChildren(frag);
    this.positionMarkers();
  }

  /** Keep markers glued to their elements while the page scrolls or reflows. */
  private tick = (): void => {
    this.positionMarkers();
    this.raf = requestAnimationFrame(this.tick);
  };

  private positionMarkers(): void {
    const items = this.store.all();
    const marks = this.markers.querySelectorAll<HTMLElement>(".mark");
    const badges = this.markers.querySelectorAll<HTMLElement>(".num-badge");
    items.forEach((a, i) => {
      const mark = marks[i];
      const badge = badges[i];
      if (!mark || !badge) return;
      let rect = toViewportRect(a.pageRect);
      let detached = false;
      if (a.kind === "select") {
        if (a.element?.isConnected) {
          const r = a.element.getBoundingClientRect();
          rect = { x: r.left, y: r.top, width: r.width, height: r.height };
        } else detached = true;
      }
      mark.classList.toggle("detached", detached);
      if (a.kind === "pin") {
        mark.style.left = `${rect.x - 7}px`;
        mark.style.top = `${rect.y - 7}px`;
        badge.style.left = `${rect.x + 16}px`;
        badge.style.top = `${rect.y - 14}px`;
      } else {
        mark.style.left = `${rect.x}px`;
        mark.style.top = `${rect.y}px`;
        mark.style.width = `${rect.width}px`;
        mark.style.height = `${rect.height}px`;
        badge.style.left = `${rect.x}px`;
        badge.style.top = `${rect.y}px`;
      }
    });
  }

  private focusNote(n: number): void {
    if (!this.open) this.toggle(true);
    this.render();
    const ta = this.panel.querySelector<HTMLTextAreaElement>(`.item[data-n="${n}"] textarea`);
    ta?.focus();
  }

  private showStatus(html: string, error = false, autoHide = false): void {
    this.status.innerHTML = html;
    this.status.classList.toggle("error", error);
    this.status.hidden = false;
    if (!this.open) this.toggle(true);
    if (autoHide) setTimeout(() => (this.status.hidden = true), 15_000);
  }

  // ---- tools ----------------------------------------------------------------------------------

  private elementAt(x: number, y: number): Element | null {
    const el = document.elementsFromPoint(x, y).find((e) => !isOverlayNode(e) && !e.closest("#crt-host"));
    return el && el !== document.documentElement ? el : null;
  }

  private setCandidate(el: Element | null): void {
    this.candidate = el;
    if (!el) {
      this.hover.style.display = "none";
      this.hoverLabel.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(this.hover.style, {
      display: "block",
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    const comp = nearestComponentName(el);
    this.hoverLabel.innerHTML = comp ? `<b>${escapeHtml(comp)}</b> ${escapeHtml(labelOf(el))}` : escapeHtml(labelOf(el));
    const top = r.top > 28 ? r.top - 26 : r.bottom + 4;
    Object.assign(this.hoverLabel.style, {
      display: "block",
      left: `${Math.max(4, Math.min(r.left, window.innerWidth - 200))}px`,
      top: `${Math.min(top, window.innerHeight - 24)}px`,
    });
  }

  private wireLayer(): void {
    this.layer.addEventListener("pointermove", (e) => {
      if (this.tool === "select") {
        if (this.candidateLocked) {
          if (Math.hypot(e.movementX, e.movementY) < 3) return;
          this.candidateLocked = false;
        }
        this.setCandidate(this.elementAt(e.clientX, e.clientY));
      } else if (this.tool === "box" && this.dragStart) {
        const r = normalise(this.dragStart, { x: e.clientX, y: e.clientY });
        Object.assign(this.drag.style, {
          display: "block",
          left: `${r.x}px`,
          top: `${r.y}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
        });
      }
    });
    this.layer.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (this.tool === "box") {
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.layer.setPointerCapture(e.pointerId);
      }
    });
    this.layer.addEventListener("pointerup", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (this.tool === "select") {
        const el = this.candidate ?? this.elementAt(e.clientX, e.clientY);
        if (el) this.commitSelect(el);
      } else if (this.tool === "pin") {
        this.commitPin(e.clientX, e.clientY);
      } else if (this.tool === "box" && this.dragStart) {
        const r = normalise(this.dragStart, { x: e.clientX, y: e.clientY });
        this.dragStart = null;
        this.drag.style.display = "none";
        if (r.width >= 4 && r.height >= 4) this.commitBox(r);
      }
    });
    this.layer.addEventListener("pointerleave", () => {
      if (this.tool === "select" && !this.candidateLocked) this.setCandidate(null);
    });
    this.layer.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private wireKeyboard(): void {
    document.addEventListener(
      "keydown",
      (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === "Period" || e.key === "." || e.key === ">")) {
          e.preventDefault();
          e.stopPropagation();
          this.toggle();
          return;
        }
        if (!this.tool) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this.setTool(null);
          return;
        }
        if (this.tool !== "select") return;
        if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "Enter") {
            if (this.candidate) this.commitSelect(this.candidate);
            return;
          }
          const cur = this.candidate;
          if (!cur) return;
          const next =
            e.key === "ArrowUp"
              ? cur.parentElement && cur.parentElement !== document.documentElement
                ? cur.parentElement
                : null
              : Array.from(cur.children).find((c) => !isOverlayNode(c)) ?? null;
          if (next) {
            this.candidateLocked = true;
            this.setCandidate(next);
          }
        }
      },
      true,
    );
  }

  private commitSelect(el: Element): void {
    const a = this.store.addSelect(el);
    this.setTool(null);
    this.focusNote(a.n);
  }

  private commitBox(rect: { x: number; y: number; width: number; height: number }): void {
    const a = this.store.addBox(rect);
    this.setTool(null);
    this.focusNote(a.n);
  }

  private commitPin(x: number, y: number): void {
    const a = this.store.addPin(x, y);
    this.setTool(null);
    this.focusNote(a.n);
  }
}

const STATE_LABEL: Record<SessionInfo["state"], string> = {
  starting: "starting",
  running: "thinking…",
  waiting: "needs permission",
  idle: "your turn",
  ended: "ended",
  error: "error",
};

function openChatLink(): string {
  return `<button type="button" data-status="chat">open chat</button>`;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function describeAnnotation(a: Annotation): string {
  if (a.kind === "select") {
    const info = a.elementInfo;
    const comp = info?.components[0]?.name;
    const label = a.element ? labelOf(a.element) : (info?.selector ?? "element");
    return comp ? `${comp} · ${label}` : label;
  }
  if (a.kind === "box") {
    const first = a.elements[0]?.info;
    const what = first ? `${first.tag}${first.id ? "#" + first.id : ""}` : "region";
    return `Box ${Math.round(a.pageRect.width)}×${Math.round(a.pageRect.height)} · ${a.elements.length} element${a.elements.length === 1 ? "" : "s"} (${what})`;
  }
  return `Pin at ${Math.round(a.pageRect.x)}, ${Math.round(a.pageRect.y)}`;
}

function normalise(a: { x: number; y: number }, b: { x: number; y: number }) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
