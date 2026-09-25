/**
 * Overlay UI (PRD F-7…F-14, F-30; PRD-providers F-56; F-65…F-68): launcher, toolbar, Select /
 * Box / Pin tools, numbered markers, the per-annotation popover (note → chat), the page-level
 * Chat, the session list and the provider menu. Everything renders inside the Shadow DOM host;
 * the host itself is a fixed, pointer-transparent full-viewport layer, and only the widgets opt
 * back in to pointer events, so the page underneath keeps working while CRT is idle.
 *
 * Threads (F-65…F-67): every annotation owns a popover anchored beside its element. It starts as
 * a compose box (note, Quick note, the F-56 split **Send to <agent>**), and after Send the same
 * popover hosts that thread's `ChatPanel`. The annotation keeps its marker; the number badge is
 * coloured by the session state and a pill next to it says `thinking…` / `your turn` / the task
 * id. Several threads run at once, one popover is open at a time, and a reload re-attaches every
 * thread from the annotation store (annotation → session id) and `PAGE_THREADS_KEY` (page-level
 * chats, F-68, which dock above the toolbar because they have no element).
 *
 * F-56: **Send** is a split button. Its main half reads `Send to <agent>` — the server's active
 * provider (`GET /__crt/providers`), or the one picked from the caret's list for this send only
 * (kept in sessionStorage for the tab until that send happens). The same list opens from the
 * toolbar's Agent button; opening it re-runs the server's preflight (`?refresh=1`) with a
 * spinner per row, unusable rows are disabled with the problem as tooltip, and "Remember for
 * this project on this machine" writes `.crt/config.local.json` through `PUT /__crt/config`.
 * Quick note uses the same choice. Product chrome (launcher, toolbar) stays "CRT" (F-64).
 *
 * Arrival (PRD-setup F-81, F-82): the launcher carries a health dot with a tooltip (health.ts —
 * one fetch at mount, on `visibilitychange` and after any failed CRT request, never a timer) and
 * on a project's first visit a welcome card sits above the launcher (welcome.ts).
 */
import type { ProviderRow, ProvidersPayload, SessionInfo, SessionState } from "../../server/src/session-events.js";
import { type Annotation, AnnotationStore, toViewportRect } from "./annotations.js";
import { CRT_ORIGIN, crtUrl } from "./base.js";
import { capture, send, type SendResult } from "./capture.js";
import { CHAT_CSS, ChatPanel, type QuietOutcome, type StartOptions } from "./chat.js";
import { nearestComponentName } from "./component.js";
import { labelOf } from "./element.js";
import { CHECKING_TOOLTIP, crtPort, deriveHealth, fetchHealth, type HealthPayload, type HealthState, rememberServer } from "./health.js";
import { placePopover } from "./popover.js";
import { ACCENT, ACCENT_HOVER, DANGER, ERROR, EXPERIMENTAL, IDLE, INK, OK, PILL, WARN } from "./tokens.js";
import { isOverlayNode } from "./selector.js";
import { buildWelcome, markWelcomeSeen, shouldShowWelcome, WELCOME_CSS, welcomeCopy, welcomeSeen } from "./welcome.js";

export type Tool = "select" | "box" | "pin";

const LAUNCHER_KEY = "crt.launcher.v1";
/** F-56: the per-send provider choice, per tab. */
const PROVIDER_KEY = "crt.provider.v1";
/** F-68: session ids of page-level chats, per tab, so a reload re-attaches them. */
const PAGE_THREADS_KEY = "crt.pagechats.v1";
/** F-66: the session whose popover was open, per tab, so a reload re-opens it. */
const OPEN_KEY = "crt.open.v1";
export const PROVIDERS_ENDPOINT = "/__crt/providers";
export const CONFIG_ENDPOINT = "/__crt/config";
const EDGE = 16;
/** What the toolbar calls the agent before the server has said which one it is. */
const UNKNOWN_AGENT = "the agent";

/** F-67: what a marker shows for a thread; `task` once the task file exists, else the session state. */
export type ThreadState = SessionState | "task";

/** The overlay's stylesheet (one string; test/brand.test.ts pins the token sites in it, F-112). */
export const OVERLAY_CSS = `${WELCOME_CSS}
  :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
          font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: ${INK}; display: block; }
  *, *::before, *::after { box-sizing: border-box; }
  button { font: inherit; cursor: pointer; border: 0; background: none; color: inherit; padding: 0; }
  .launcher { position: fixed; pointer-events: auto; user-select: none; touch-action: none;
              display: inline-flex; align-items: center; gap: 6px; padding: 10px 14px; border-radius: 999px;
              background: ${INK}; color: #fff; font-weight: 600; box-shadow: 0 4px 16px rgba(0,0,0,.25); cursor: grab; }
  .launcher:active { cursor: grabbing; }
  .launcher .count { display: none; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
                     background: ${ACCENT}; color: #fff; font-size: 11px; line-height: 18px; text-align: center; }
  .launcher .count.on { display: inline-block; }
  .launcher .health { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #9a9a9a;
                      box-shadow: 0 0 0 2px rgba(255,255,255,.25); }
  .launcher[data-health="checking"] .health { animation: crt-pulse 1.2s ease-in-out infinite; }
  .launcher[data-health="connected"] .health { background: ${OK}; }
  .launcher[data-health="agent not ready"] .health, .launcher[data-health="different project"] .health { background: ${WARN}; }
  .launcher[data-health="unreachable"] .health { background: ${DANGER}; }
  @keyframes crt-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
  .dock { position: fixed; pointer-events: auto; display: flex; flex-direction: column; gap: 8px; align-items: flex-end;
          width: min(440px, calc(100vw - 32px)); }
  .dock[hidden] { display: none; }
  .toolbar { display: flex; gap: 4px; align-items: center; padding: 6px; border-radius: 12px; background: #fff;
             box-shadow: 0 8px 28px rgba(0,0,0,.22); border: 1px solid rgba(0,0,0,.08);
             width: max-content; max-width: calc(100vw - 32px); overflow-x: auto; }
  .toolbar button { padding: 6px 10px; border-radius: 8px; font-weight: 500; white-space: nowrap; }
  .toolbar button:hover { background: #f0f0f0; }
  .toolbar button.active { background: ${INK}; color: #fff; }
  .toolbar button:disabled { opacity: .5; cursor: default; }
  .toolbar .sep { width: 1px; height: 20px; background: rgba(0,0,0,.1); margin: 0 2px; }
  .toolbar .badge { min-width: 20px; padding: 0 6px; border-radius: 10px; background: #eee; text-align: center;
                    font-size: 11px; font-weight: 600; line-height: 20px; }
  .toolbar .dot { display: inline-block; width: 8px; height: 8px; border-radius: 4px; margin-left: 5px; vertical-align: middle;
                  background: var(--st, #ccc); }
  .toolbar .dot[hidden] { display: none; }
  button.primary { background: ${ACCENT}; color: #fff; font-weight: 600; }
  button.primary:hover { background: ${ACCENT_HOVER}; }
  .split { display: inline-flex; }
  .split button.primary { border-radius: 8px 0 0 8px; }
  .split button.caret { border-radius: 0 8px 8px 0; padding: 6px 7px; border-left: 1px solid rgba(255,255,255,.4); }
  .providers { width: 100%; border-radius: 12px; background: #fff; box-shadow: 0 8px 28px rgba(0,0,0,.22);
               border: 1px solid rgba(0,0,0,.08); padding: 6px; }
  .providers[hidden] { display: none; }
  .providers .head { display: flex; align-items: center; gap: 8px; padding: 4px 6px 6px; font-weight: 600; }
  .providers .head .spacer { flex: 1; }
  .providers .head button { padding: 2px 8px; border-radius: 6px; font-size: 12px; color: #555; }
  .providers .head button:hover { background: #f0f0f0; }
  .provider { display: grid; grid-template-columns: 10px 1fr auto auto; gap: 8px; align-items: center; width: 100%;
              text-align: left; padding: 6px 8px; border-radius: 8px; }
  .provider:hover { background: #f3f3f5; }
  .provider:disabled { opacity: .5; cursor: default; }
  .provider:disabled:hover { background: none; }
  .provider .dot { width: 8px; height: 8px; border-radius: 4px; background: #ccc; }
  .provider .dot[data-state="ready"] { background: ${OK}; }
  .provider .dot[data-state="not on PATH"], .provider .dot[data-state="not logged in"], .provider .dot[data-state="too old"] { background: #c00; }
  .provider .dot[data-state="unknown"] { background: ${WARN}; }
  .provider .name small { color: #777; margin-left: 6px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; }
  .provider .name .badge { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; background: ${EXPERIMENTAL[0]}; color: ${EXPERIMENTAL[1]}; font-size: 10px; font-weight: 600; vertical-align: 1px; }
  .provider .tick { color: ${OK}; font-weight: 700; visibility: hidden; }
  .provider.active .tick { visibility: visible; }
  .provider .spin { width: 10px; height: 10px; border: 2px solid #ddd; border-top-color: #333; border-radius: 50%;
                    animation: crt-spin .8s linear infinite; visibility: hidden; }
  .providers.refreshing .provider .spin { visibility: visible; }
  @keyframes crt-spin { to { transform: rotate(360deg); } }
  .providers .why { padding: 4px 8px 2px; font-size: 11px; color: #777; }
  .providers .remember { display: flex; gap: 6px; align-items: center; padding: 8px 8px 4px; font-size: 12px; color: #555;
                         border-top: 1px solid rgba(0,0,0,.06); margin-top: 4px; cursor: pointer; }
  .status { width: 100%; padding: 8px 10px; border-radius: 10px; background: ${INK}; color: #fff; font-size: 12px;
            word-break: break-all; }
  .status[hidden] { display: none; }
  .status.error { background: ${ERROR}; }
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
  .pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #eee; color: #555; white-space: nowrap; }
  .pill[data-state="running"], .pill[data-state="starting"] { background: ${PILL.running[0]}; color: ${PILL.running[1]}; }
  .pill[data-state="waiting"] { background: ${ACCENT}; color: #fff; }
  .pill[data-state="idle"] { background: ${PILL.idle[0]}; color: ${PILL.idle[1]}; }
  .pill[data-state="task"] { background: ${PILL.task[0]}; color: ${PILL.task[1]}; }
  .pill[data-state="error"] { background: ${PILL.error[0]}; color: ${PILL.error[1]}; }
  .layer { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; touch-action: none; }
  .layer[hidden] { display: none; }
  .hover { position: fixed; pointer-events: none; border: 2px solid ${ACCENT}; background: rgba(255,61,113,.08);
           border-radius: 2px; display: none; }
  .hover-label { position: fixed; pointer-events: none; display: none; padding: 3px 7px; border-radius: 6px;
                 background: ${INK}; color: #fff; font-size: 11px; font-family: ui-monospace, Menlo, Consolas, monospace;
                 max-width: 60vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hover-label b { color: #ffd166; font-weight: 600; }
  .drag { position: fixed; pointer-events: none; border: 2px dashed ${ACCENT}; background: rgba(255,61,113,.08); display: none; }
  /* Markers sit below popovers: an open popover is the topmost thing on the page (F-65); close it to reach a badge under it. */
  .markers { position: fixed; inset: 0; pointer-events: none; }
  .mark { position: fixed; border: 2px solid ${ACCENT}; border-radius: 2px; }
  .mark.box { border-style: dashed; }
  .mark.pin { width: 14px; height: 14px; border-radius: 7px; background: ${ACCENT}; border: 2px solid #fff;
              box-shadow: 0 0 0 2px ${ACCENT}; }
  .mark.detached { opacity: .4; }
  /* F-67: one colour per thread state, shared by the badge, the marker outline and the toolbar dot. */
  [data-state="starting"], [data-state="running"] { --st: ${WARN}; }
  [data-state="waiting"] { --st: ${ACCENT}; }
  [data-state="idle"] { --st: ${IDLE}; }
  [data-state="task"] { --st: ${OK}; }
  [data-state="error"] { --st: ${ERROR}; }
  [data-state="ended"] { --st: #888; }
  .mark[data-state] { border-color: var(--st); }
  .num-badge { position: fixed; pointer-events: auto; cursor: pointer; width: 22px; height: 22px; border-radius: 11px;
               background: var(--st, ${ACCENT}); color: #fff; font-weight: 700; font-size: 12px; line-height: 22px; text-align: center;
               box-shadow: 0 2px 6px rgba(0,0,0,.3); transform: translate(-50%, -50%); }
  .num-badge[data-state="starting"], .num-badge[data-state="running"], .num-badge[data-state="waiting"] { animation: crt-badge-pulse 1.2s ease-in-out infinite; }
  @keyframes crt-badge-pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--st) 30%, transparent); } }
  .mark-state { position: fixed; pointer-events: auto; cursor: pointer; transform: translateY(-50%); box-shadow: 0 2px 6px rgba(0,0,0,.2);
                max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
  .hint { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); pointer-events: none; padding: 6px 12px;
          border-radius: 999px; background: rgba(17,17,17,.9); color: #fff; font-size: 12px; }
  .hint[hidden] { display: none; }
  /* F-65/F-66: popovers — one per annotation beside its element, page-level ones docked above the toolbar. */
  .pops { position: fixed; inset: 0; pointer-events: none; }
  .pops[hidden] { display: none; }
  .pop { position: fixed; pointer-events: auto; width: min(380px, calc(100vw - 16px)); border-radius: 12px; background: #fff;
         box-shadow: 0 8px 28px rgba(0,0,0,.22); border: 1px solid rgba(0,0,0,.08); display: flex; flex-direction: column; }
  .pop[hidden] { display: none; }
  .pop.threaded { width: min(460px, calc(100vw - 16px)); }
  .pop-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid rgba(0,0,0,.06); }
  .pop-head .num { width: 22px; height: 22px; border-radius: 11px; background: ${ACCENT}; color: #fff; font-weight: 700;
                   font-size: 12px; line-height: 22px; text-align: center; flex: none; }
  .pop-head .label { flex: 1; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; color: #555;
                     overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pop-head .title { flex: 1; font-weight: 600; }
  .pop-head .close { width: 22px; height: 22px; border-radius: 11px; color: #888; font-size: 16px; line-height: 22px; text-align: center; }
  .pop-head .close:hover { background: #eee; color: ${INK}; }
  .compose { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 8px; }
  .compose textarea { width: 100%; min-height: 64px; resize: vertical; font: inherit; padding: 8px; border-radius: 8px;
                      border: 1px solid rgba(0,0,0,.15); background: #fafafa; }
  .compose textarea:focus { outline: 2px solid ${ACCENT}; outline-offset: -1px; background: #fff; }
  .compose .include { display: flex; gap: 6px; align-items: center; font-size: 12px; color: #555; cursor: pointer; }
  .compose .include[hidden] { display: none; }
  .pop-foot { display: flex; gap: 4px; align-items: center; }
  .pop-foot .spacer { flex: 1; }
  .pop-foot button { padding: 6px 10px; border-radius: 8px; font-weight: 500; white-space: nowrap; }
  .pop-foot button:hover { background: #f0f0f0; }
  .pop-foot button.primary:hover { background: ${ACCENT_HOVER}; }
  .pop-foot button:disabled { opacity: .5; cursor: default; }
  .pop-foot button.del { color: #888; }
  .pop-foot button.del:hover { background: #fee; color: #c00; }
  .pop .providers { width: auto; margin: 0 10px 10px; box-shadow: none; border: 1px solid rgba(0,0,0,.1); }
  .pop.threaded .pop-head, .pop.threaded .compose { display: none; }
  .pop .thread:empty { display: none; }
  .pop.sending .compose { opacity: .6; pointer-events: none; }
${CHAT_CSS}
`;

const HINTS: Record<Tool, string> = {
  select: "Select: click an element · ↑ parent · ↓ child · Esc cancel",
  box: "Box: drag a rectangle · Esc cancel",
  pin: "Pin: click a point · Esc cancel",
};

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

  /** F-56: the last `GET /__crt/providers` payload; null until the server has answered once. */
  private providers: ProvidersPayload | null = null;
  /** F-56: the provider picked from the caret for the next send only; null = the server's active one. */
  private pendingProvider: string | null = null;
  /** F-56: the provider list currently showing (the dock's or a popover's), if any. */
  private providersOpen: HTMLElement | null = null;

  /** F-66: every live thread, oldest first. */
  private threads: Thread[] = [];
  /** F-65: the one popover showing right now. */
  private openPop: HTMLElement | null = null;

  /** F-81: the last health answer; null until the first one lands. */
  private health: HealthPayload | "failed" | null = null;
  /** F-81 Should: the project this tab first saw, from sessionStorage; null on the first load. */
  private firstProjectRoot: string | null = null;
  /** F-82: the card, once built. */
  private welcomeEl: HTMLElement | null = null;
  /** The mount-time provider load, so the welcome card can name the agent (F-56). */
  private providersReady: Promise<unknown> = Promise.resolve();
  /** F-82: threads or annotations came back from sessionStorage on this load (a mid-work reload). */
  private readonly restored: boolean;

  private readonly launcher: HTMLElement;
  private readonly count: HTMLElement;
  private readonly dock: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly sessions: HTMLElement;
  private readonly providersEl: HTMLElement;
  private readonly status: HTMLElement;
  /** The pending auto-hide of the current status message, if it has one. */
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly layer: HTMLElement;
  private readonly hover: HTMLElement;
  private readonly hoverLabel: HTMLElement;
  private readonly drag: HTMLElement;
  private readonly markers: HTMLElement;
  private readonly pops: HTMLElement;
  /** F-68: the docked compose box the toolbar's Chat button opens. */
  private readonly pagePop: HTMLElement;
  private readonly hint: HTMLElement;

  constructor(store: AnnotationStore) {
    this.store = store;
    this.host = document.createElement("div");
    this.host.id = "crt-host";
    this.host.setAttribute("data-crt", "");
    this.root = this.host.attachShadow({ mode: "open" });
    this.root.innerHTML = `
      <style>${OVERLAY_CSS}</style>
      <div class="layer" hidden>
        <div class="hover"></div><div class="hover-label"></div><div class="drag"></div>
      </div>
      <div class="hint" hidden></div>
      <div class="markers" part="markers"></div>
      <div class="pops" hidden></div>
      <div class="dock" hidden>
        <div class="status" hidden></div>
        <div class="sessions" hidden></div>
        <div class="providers" hidden></div>
        <div class="toolbar" role="toolbar" aria-label="CRT tools">
          <button type="button" data-tool="select" title="Select an element (F-8)">Select</button>
          <button type="button" data-tool="box" title="Draw a box (F-9)">Box</button>
          <button type="button" data-tool="pin" title="Drop a pin (F-10)">Pin</button>
          <span class="sep"></span>
          <span class="badge" data-count>0</span>
          <button type="button" data-action="clear" title="Remove all annotations and their popovers (sessions keep running, F-67)">Clear</button>
          <button type="button" data-action="sessions" title="Recent intake sessions (F-30)">Sessions</button>
          <button type="button" data-action="agent" title="Choose the agent that runs intake (F-56)">Agent</button>
          <span class="sep"></span>
          <button type="button" data-action="chat" title="Chat with the agent about this page (F-68)">Chat<span class="dot" hidden></span></button>
        </div>
      </div>
      <button type="button" class="launcher" aria-label="Toggle CRT (Ctrl/Cmd+Shift+.)" data-health="checking" title="${CHECKING_TOOLTIP}">
        <span class="health"></span> CRT <span class="count">0</span>
      </button>
    `;
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.launcher = q(".launcher");
    this.count = q(".launcher .count");
    this.dock = q(".dock");
    this.toolbar = q(".toolbar");
    this.sessions = q(".sessions");
    this.providersEl = q(".providers");
    this.status = q(".status");
    this.layer = q(".layer");
    this.hover = q(".hover");
    this.hoverLabel = q(".hover-label");
    this.drag = q(".drag");
    this.markers = q(".markers");
    this.pops = q(".pops");
    this.hint = q(".hint");
    this.pagePop = this.buildPagePop();
    this.pops.appendChild(this.pagePop);

    this.restored = this.store.all().length > 0 || this.readPageThreads().length > 0;
    this.restoreLauncher();
    this.restorePendingProvider();
    this.wireLauncher();
    this.wireToolbar();
    this.wirePops();
    this.wireLayer();
    this.wireKeyboard();
    this.store.subscribe(() => this.render());
    document.documentElement.appendChild(this.host);
    this.placeLauncher(); // needs the launcher's real height, so after mount
    this.render();
    void this.restoreThreads(); // a reload re-attaches every thread (F-66)
    this.providersReady = this.loadProviders(false).catch(() => this.noteFailure()); // F-56: label the Send buttons with the active agent
    this.wireHealth();
  }

  // ---- public surface (also exposed on window.__crt for tests) ------------------------------

  isOpen(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.dock.hidden = !this.open;
    this.pops.hidden = !this.open;
    if (!this.open) this.setTool(null);
    this.render();
    this.positionDocked();
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
      this.closePops(); // a popover over the page would swallow the click (F-65)
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
   * F-13/F-65: capture one annotation (plus, with `include`, the other unsent ones), POST it, and
   * turn its popover into the chat of a new intake session (F-24, F-66). The session is
   * warm-started in parallel with the capture so the agent process boots while the page is being
   * rasterised (N-2). A capture that saved but whose session failed to start is still reported
   * as sent — the files are on disk and the status line says what went wrong.
   *
   * F-68 `message`: a page-level chat — the capture has no annotations and carries the message as
   * its `note`; the thread docks above the toolbar.
   *
   * F-14 `quick`: every sent annotation must carry a note; the popover stays closed and the
   * status line reports the task id when the agent writes it (or the popover opens itself if the
   * agent needs you).
   *
   * F-56: the session runs on the provider picked for this send (the caret's list), else the
   * server's active one; the per-send choice is spent the moment the session is requested.
   */
  async sendToAgent(opts: SendOptions = {}): Promise<SendResult> {
    const quick = opts.quick === true;
    if (this.busy) throw new Error("already sending");
    const page = opts.message !== undefined;
    let ids: string[] = [];
    let note: string | undefined;
    if (page) {
      note = opts.message!.trim();
      if (!note) throw new Error("nothing to send: type a message first");
    } else {
      const primary = opts.n !== undefined ? this.store.get(opts.n) : this.store.unsent().at(-1);
      if (!primary) throw new Error(opts.n !== undefined ? `no annotation ${opts.n}` : "nothing to send: add an annotation first");
      if (primary.sessionId) throw new Error(`annotation ${primary.n} was already sent`);
      ids = [primary.id, ...(opts.include ? this.store.unsent().filter((a) => a.id !== primary.id).map((a) => a.id) : [])];
      if (quick && !ids.every((id) => this.store.byId(id)?.note.trim())) throw new Error("quick note needs a note on every annotation");
    }
    this.busy = true;
    this.setTool(null);
    this.sessions.hidden = true;
    this.closeProviders();
    const start: StartOptions = { quick, provider: this.pendingProvider };
    const name = this.providerName(this.sendProvider());
    this.setPendingProvider(null);
    const hostPop = page ? this.pagePop : this.popFor(ids[0]!);
    hostPop?.classList.add("sending");
    this.showStatus("Capturing page…");
    this.render();
    const warm = ChatPanel.warmStart(start).catch(() => null);
    try {
      const result = await capture(this.store, { ids, ...(note ? { note } : {}) });
      this.showStatus(`Sending to ${escapeHtml(name)}…`);
      const sent = await send(result);
      this.showStatus(`Capture saved: <code>${escapeHtml(sent.dir)}</code>`, false, !quick);
      try {
        const sessionId = (await warm) ?? (await ChatPanel.createSession(sent.id, start));
        const thread = this.addThread(sessionId, ids);
        if (thread.annotationIds.length) this.store.setSession(thread.annotationIds, sessionId);
        else this.persistPageThreads();
        if (page) this.resetPagePop();
        // The warm session still needs its first message; a cold one already has it.
        if ((await warm) === sessionId) await thread.chat.attachCapture(sessionId, sent.id, { quick });
        else if (quick) thread.chat.follow(sessionId);
        else thread.chat.open(sessionId);
        if (quick) this.showStatus(`Quick note sent — ${escapeHtml(name)} is writing the task…${openChatLink(sessionId)}`);
      } catch (err) {
        this.showStatus(
          `Capture saved: <code>${escapeHtml(sent.dir)}</code> — but ${escapeHtml(name)} did not start: ${escapeHtml(err instanceof Error ? err.message : String(err))}`,
          true,
        );
      }
      return sent;
    } catch (err) {
      void warm.then((id) => (id ? ChatPanel.abandon(id) : undefined));
      this.showStatus(`Send failed: ${escapeHtml(err instanceof Error ? err.message : String(err))}`, true);
      this.noteFailure();
      throw err;
    } finally {
      this.busy = false;
      hostPop?.classList.remove("sending");
      this.render();
    }
  }

  /** F-14: a quick note needs words, since there is no conversation to add them; `n` defaults to the most recent unsent annotation. */
  canQuickNote(n?: number): boolean {
    const a = n !== undefined ? this.store.get(n) : this.store.unsent().at(-1);
    return !!a && a.sessionId === null && a.note.trim() !== "";
  }

  private onQuiet(outcome: QuietOutcome, sessionId: string): void {
    if (outcome.kind === "task") {
      this.showStatus(`Task <b>${escapeHtml(outcome.id)}</b> written to <code>${escapeHtml(outcome.path)}</code>${openChatLink(sessionId)}`);
    } else {
      const name = this.threads.find((t) => t.sessionId === sessionId)?.chat.agentName() ?? UNKNOWN_AGENT;
      this.showStatus(`${escapeHtml(name)} needs you: ${escapeHtml(outcome.reason)}`, false, true);
    }
  }

  /**
   * F-26/F-66: a live permission request opens its thread unless the developer is busy in another
   * popover, in which case the marker pulses and the status line says who needs them.
   */
  private onAttention(thread: Thread, reason: string): void {
    if (!this.openPop || this.openPop === thread.pop) {
      thread.chat.show(true);
      return;
    }
    this.showStatus(`${escapeHtml(reason)}${openChatLink(thread.sessionId)}`, false, true);
    this.render();
  }

  // ---- threads (F-66, F-67, F-68) --------------------------------------------------------------

  /** Every live thread, oldest first (tests). */
  threadSummaries(): ThreadSummary[] {
    return this.threads.map((t) => {
      const snap = t.chat.snapshot();
      return {
        sessionId: t.sessionId,
        annotationIds: t.annotationIds.slice(),
        ns: t.annotationIds.map((id) => this.store.byId(id)?.n ?? 0),
        state: threadState(snap.state, snap.taskId),
        taskId: snap.taskId,
        open: t.chat.isOpen(),
      };
    });
  }

  /** The thread whose popover is open, else the most recent one (what `window.__crt.chat` drives). */
  currentThread(): Thread | null {
    return this.threads.find((t) => t.pop === this.openPop) ?? this.threads.at(-1) ?? null;
  }

  threadFor(sessionId: string): Thread | null {
    return this.threads.find((t) => t.sessionId === sessionId) ?? null;
  }

  /** F-30/F-66: open a session — its own popover when it has one, else a docked page-level popover. */
  openSession(sessionId: string): void {
    if (!sessionId) return;
    const existing = this.threadFor(sessionId);
    if (existing) {
      existing.chat.show(true);
      return;
    }
    const ids = this.store.all().filter((a) => a.sessionId === sessionId).map((a) => a.id);
    const thread = this.addThread(sessionId, ids);
    if (!ids.length) this.persistPageThreads();
    thread.chat.open(sessionId);
  }

  /** Mount a ChatPanel for `sessionId` in the host annotation's popover, or in a new docked one. */
  private addThread(sessionId: string, annotationIds: string[]): Thread {
    const host = annotationIds.length ? this.popFor(annotationIds[0]!) : null;
    const pop = host ?? this.buildDockedPop();
    if (!host) this.pops.appendChild(pop);
    const mount = pop.querySelector(".thread") as HTMLElement;
    const thread: Thread = { sessionId, annotationIds, pop, chat: undefined as unknown as ChatPanel };
    thread.chat = new ChatPanel(
      mount,
      {
        onVisibility: (open) => {
          if (open) this.showPop(pop);
          else if (this.openPop === pop) this.hidePop(pop);
          this.render();
        },
        onQuiet: (outcome) => this.onQuiet(outcome, sessionId),
        onAttention: (reason) => this.onAttention(thread, reason),
        onChange: () => this.render(),
        onDiscard: () => this.dropThread(thread, true),
      },
      { title: this.threadTitle(annotationIds) },
    );
    this.threads.push(thread);
    pop.classList.add("threaded");
    return thread;
  }

  /**
   * Forget a thread: close its event stream and remove its panel. With `removeAnnotations` (the
   * chat's Discard, F-66) its annotations go too; otherwise (Clear, delete) only the local view
   * goes and the session stays in the F-30 list.
   */
  private dropThread(thread: Thread, removeAnnotations: boolean): void {
    thread.chat.dispose();
    this.threads = this.threads.filter((t) => t !== thread);
    thread.pop.classList.remove("threaded");
    if (!thread.annotationIds.length) {
      if (this.openPop === thread.pop) this.openPop = null;
      thread.pop.remove();
      this.persistPageThreads();
    } else if (removeAnnotations) {
      for (const id of thread.annotationIds) {
        const a = this.store.byId(id);
        if (a) this.store.remove(a.n);
      }
    } else {
      this.store.setSession(thread.annotationIds, null);
    }
    this.render();
  }

  /** Threads whose annotations were all deleted (or whose popover was cleared) are dropped without closing the session. */
  private pruneThreads(items: Annotation[]): void {
    const live = new Set(items.map((a) => a.id));
    for (const t of this.threads.slice()) {
      if (t.annotationIds.length && !t.annotationIds.some((id) => live.has(id))) {
        t.chat.dispose();
        this.threads = this.threads.filter((x) => x !== t);
      }
    }
  }

  private threadTitle(annotationIds: string[]): string {
    const a = annotationIds[0] ? this.store.byId(annotationIds[0]) : undefined;
    if (!a) return "Chat about this page";
    const more = annotationIds.length > 1 ? ` +${annotationIds.length - 1}` : "";
    return `#${a.n}${more} · ${describeAnnotation(a)}`;
  }

  /** F-66: after a reload, re-attach every thread the server still has; forget the rest. */
  private async restoreThreads(): Promise<void> {
    const groups = new Map<string, string[]>();
    for (const a of this.store.all()) {
      if (a.sessionId) groups.set(a.sessionId, [...(groups.get(a.sessionId) ?? []), a.id]);
    }
    for (const id of this.readPageThreads()) if (!groups.has(id)) groups.set(id, []);
    let wanted: string | null = null;
    try {
      wanted = sessionStorage.getItem(OPEN_KEY);
    } catch {
      // ignore
    }
    await Promise.all(
      [...groups].map(async ([sessionId, ids]) => {
        if (this.threadFor(sessionId)) return;
        if (await ChatPanel.alive(sessionId)) {
          const thread = this.addThread(sessionId, ids);
          if (sessionId === wanted) thread.chat.open(sessionId);
          else thread.chat.watch(sessionId);
        } else if (ids.length) {
          this.store.setSession(ids, null);
        }
      }),
    );
    this.persistPageThreads();
    this.render();
  }

  private readPageThreads(): string[] {
    try {
      const raw = sessionStorage.getItem(PAGE_THREADS_KEY);
      const list: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  private persistPageThreads(): void {
    try {
      const ids = this.threads.filter((t) => !t.annotationIds.length).map((t) => t.sessionId);
      if (ids.length) sessionStorage.setItem(PAGE_THREADS_KEY, JSON.stringify(ids));
      else sessionStorage.removeItem(PAGE_THREADS_KEY);
    } catch {
      // sessionStorage unavailable: page threads live for this page load only
    }
  }

  // ---- popovers (F-65, F-68) -------------------------------------------------------------------

  /** The annotation's popover element, if it has been rendered. */
  private popFor(annotationId: string): HTMLElement | null {
    return this.pops.querySelector<HTMLElement>(`.pop[data-id="${cssEscape(annotationId)}"]`);
  }

  /** F-65: show one popover (closing any other), bring the overlay up, and place it. */
  private showPop(pop: HTMLElement): void {
    const prev = this.openPop;
    if (prev && prev !== pop) {
      const t = this.threads.find((x) => x.pop === prev);
      if (t) t.chat.show(false); // keeps the panel's own open state truthful
      else this.hidePop(prev);
    }
    this.openPop = pop;
    pop.hidden = false;
    if (!this.open) this.toggle(true);
    this.positionAll();
    this.ensureTick();
    this.rememberOpen(this.threads.find((t) => t.pop === pop)?.sessionId ?? null);
  }

  private hidePop(pop: HTMLElement): void {
    pop.hidden = true;
    if (this.openPop === pop) {
      this.openPop = null;
      this.rememberOpen(null);
    }
    if (this.providersOpen && pop.contains(this.providersOpen)) this.closeProviders();
  }

  private rememberOpen(sessionId: string | null): void {
    try {
      if (sessionId) sessionStorage.setItem(OPEN_KEY, sessionId);
      else sessionStorage.removeItem(OPEN_KEY);
    } catch {
      // ignore
    }
  }

  closePops(): void {
    if (this.openPop) this.hidePop(this.openPop);
    this.pagePop.hidden = true;
  }

  /** F-65: toggle the popover of annotation `n` — a grouped annotation opens the thread that holds it. */
  togglePop(n: number, force?: boolean): void {
    const a = this.store.get(n);
    if (!a) return;
    const thread = this.threads.find((t) => t.annotationIds.includes(a.id));
    const pop = thread?.pop ?? this.popFor(a.id);
    if (!pop) return;
    const show = force ?? pop.hidden;
    if (!show) {
      if (thread) thread.chat.show(false);
      else this.hidePop(pop);
      return;
    }
    if (thread) {
      thread.chat.show(true);
    } else {
      this.showPop(pop);
      pop.querySelector("textarea")?.focus();
    }
  }

  /** F-68: the docked compose box for a page-level chat. */
  togglePageChat(force?: boolean): void {
    const show = force ?? this.pagePop.hidden;
    if (!show) {
      this.hidePop(this.pagePop);
      this.render();
      return;
    }
    this.sessions.hidden = true;
    this.closeProviders();
    this.showPop(this.pagePop);
    this.pagePop.querySelector("textarea")?.focus();
    this.render();
  }

  private buildPagePop(): HTMLElement {
    const pop = document.createElement("div");
    pop.className = "pop page";
    pop.dataset.page = "new";
    pop.hidden = true;
    pop.innerHTML = `
      <div class="pop-head"><span class="title">Chat about this page</span><button type="button" class="close" data-pop="close" title="Close">×</button></div>
      <div class="compose">
        <textarea rows="3" placeholder="Ask the agent about this page…"></textarea>
        <div class="pop-foot">
          <span class="spacer"></span>
          <button type="button" data-action="quick" title="Quick note: the agent writes the task from your message without a chat (F-14)">Quick note</button>
          <span class="split">
            <button type="button" class="primary" data-action="send" title="Capture the page and send (F-68)">Send</button>
            <button type="button" class="primary caret" data-action="agent" title="Choose the agent for this send (F-56)" aria-label="Choose the agent for this send">▾</button>
          </span>
        </div>
        <div class="providers" hidden></div>
      </div>
      <div class="thread"></div>`;
    return pop;
  }

  /** A docked popover that only hosts a chat (a page-level thread, or a session opened from the list). */
  private buildDockedPop(): HTMLElement {
    const pop = document.createElement("div");
    pop.className = "pop page";
    pop.hidden = true;
    pop.innerHTML = `<div class="thread"></div>`;
    return pop;
  }

  private resetPagePop(): void {
    (this.pagePop.querySelector("textarea") as HTMLTextAreaElement).value = "";
    this.hidePop(this.pagePop);
  }

  private buildAnnotationPop(a: Annotation): HTMLElement {
    const pop = document.createElement("div");
    pop.className = "pop";
    pop.dataset.id = a.id;
    pop.hidden = true;
    pop.innerHTML = `
      <div class="pop-head"><span class="num"></span><span class="label"></span><button type="button" class="close" data-pop="close" title="Close (the annotation stays)">×</button></div>
      <div class="compose">
        <textarea rows="3" placeholder="What's wrong or wanted here?"></textarea>
        <label class="include" hidden><input type="checkbox"> <span></span></label>
        <div class="pop-foot">
          <button type="button" class="del" data-action="delete" title="Delete this annotation">Delete</button>
          <span class="spacer"></span>
          <button type="button" data-action="quick" title="Quick note: the agent writes the task from your note without a chat (F-14)">Quick note</button>
          <span class="split">
            <button type="button" class="primary" data-action="send" title="Capture and send (F-13)">Send</button>
            <button type="button" class="primary caret" data-action="agent" title="Choose the agent for this send (F-56)" aria-label="Choose the agent for this send">▾</button>
          </span>
        </div>
        <div class="providers" hidden></div>
      </div>
      <div class="thread"></div>`;
    return pop;
  }

  private wirePops(): void {
    this.pops.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>("button");
      if (!btn) return;
      const pop = btn.closest<HTMLElement>(".pop");
      if (!pop) return;
      if (btn.dataset.pop === "close") {
        this.hidePop(pop);
        this.render();
        return;
      }
      if (btn.closest(".providers")) {
        this.onProvidersClick(btn);
        return;
      }
      const isPage = pop.dataset.page === "new";
      const n = isPage ? undefined : this.store.byId(pop.dataset.id ?? "")?.n;
      const include = pop.querySelector<HTMLInputElement>(".include input")?.checked === true;
      const message = isPage ? (pop.querySelector("textarea") as HTMLTextAreaElement).value : undefined;
      switch (btn.dataset.action) {
        case "delete":
          if (n) this.store.remove(n);
          break;
        case "send":
          void this.sendToAgent(isPage ? { message } : { n, include }).catch(() => undefined);
          break;
        case "quick":
          void this.sendToAgent(isPage ? { message, quick: true } : { n, include, quick: true }).catch(() => undefined);
          break;
        case "agent":
          void this.toggleProviders(undefined, pop.querySelector(".providers") as HTMLElement);
          break;
      }
    });
    this.pops.addEventListener("input", (e) => {
      const el = e.target as HTMLElement;
      const pop = el.closest<HTMLElement>(".pop");
      if (!pop) return;
      if (el.tagName === "TEXTAREA" && pop.dataset.id) {
        const n = this.store.byId(pop.dataset.id)?.n;
        if (n) this.store.setNote(n, (el as HTMLTextAreaElement).value);
      } else {
        this.render(); // the include checkbox or the page message: refresh the button states
      }
    });
    // Keys typed into notes and chats must not reach the host page's shortcuts; Ctrl/Cmd+Enter sends.
    for (const type of ["keydown", "keyup", "keypress"] as const) {
      this.pops.addEventListener(type, (e) => {
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

  /**
   * Reconcile the annotation popovers in place. Every keystroke in a note re-renders (the store
   * notifies on `setNote`), and detaching a focused textarea — even to re-insert the same node —
   * blurs it, so popovers are patched where they stand and never re-created for a live annotation.
   */
  private renderPops(items: Annotation[]): void {
    const keep = new Set(items.map((a) => a.id));
    for (const el of Array.from(this.pops.querySelectorAll<HTMLElement>(".pop[data-id]"))) {
      if (!keep.has(el.dataset.id!)) {
        if (this.openPop === el) this.openPop = null;
        el.remove();
      }
    }
    const active = this.root.activeElement as HTMLElement | null;
    const activeId = active?.closest<HTMLElement>(".pop")?.dataset.id;
    const unsent = this.store.unsent();
    const provider = this.sendProvider();
    const name = this.providerName(provider);
    for (const a of items) {
      let pop = this.popFor(a.id);
      if (!pop) {
        pop = this.buildAnnotationPop(a);
        this.pops.appendChild(pop);
      }
      pop.dataset.n = String(a.n);
      (pop.querySelector(".pop-head .num") as HTMLElement).textContent = String(a.n);
      (pop.querySelector(".pop-head .label") as HTMLElement).textContent = describeAnnotation(a);
      const ta = pop.querySelector("textarea") as HTMLTextAreaElement;
      if (ta.value !== a.note && activeId !== a.id) ta.value = a.note;
      const others = unsent.filter((u) => u.id !== a.id);
      const include = pop.querySelector(".include") as HTMLElement;
      include.hidden = others.length === 0 || a.sessionId !== null;
      (include.querySelector("span") as HTMLElement).textContent = `include the ${others.length} other unsent annotation${others.length === 1 ? "" : "s"}`;
      const included = (include.querySelector("input") as HTMLInputElement).checked && !include.hidden;
      const sendBtn = pop.querySelector("[data-action=send]") as HTMLButtonElement;
      this.labelSend(sendBtn, provider, name);
      sendBtn.disabled = this.busy;
      const quickable = a.note.trim() !== "" && (!included || others.every((o) => o.note.trim() !== ""));
      (pop.querySelector("[data-action=quick]") as HTMLButtonElement).disabled = this.busy || !quickable;
      (pop.querySelector("[data-action=delete]") as HTMLButtonElement).disabled = this.busy;
      pop.classList.toggle("threaded", a.sessionId !== null && this.threads.some((t) => t.pop === pop));
    }
    // F-68: the page-level compose box.
    const pageSend = this.pagePop.querySelector("[data-action=send]") as HTMLButtonElement;
    this.labelSend(pageSend, provider, name);
    const message = (this.pagePop.querySelector("textarea") as HTMLTextAreaElement).value.trim();
    pageSend.disabled = this.busy || message === "";
    (this.pagePop.querySelector("[data-action=quick]") as HTMLButtonElement).disabled = this.busy || message === "";
    (this.pagePop.querySelector("textarea") as HTMLTextAreaElement).placeholder = `Ask ${name} about this page…`;
    for (const t of this.threads) t.chat.setTitle(this.threadTitle(t.annotationIds));
  }

  /** F-56: the main half names the agent this send will use; `data-provider` is the id it will ask for. */
  private labelSend(btn: HTMLButtonElement, provider: string | null, name: string): void {
    btn.textContent = provider ? `Send to ${name}` : "Send";
    if (provider) btn.dataset.provider = provider;
    else delete btn.dataset.provider;
    btn.title = `Capture and send to ${name} (F-13)${this.pendingProvider ? " — for this send only" : ""}`;
  }

  // ---- provider menu (F-56) --------------------------------------------------------------------

  /** The provider id the next Send (or Quick note) will ask for: the per-send pick, else the server's active one. */
  sendProvider(): string | null {
    return this.pendingProvider ?? this.providers?.active ?? null;
  }

  /** F-56: the display name the menu knows for an id; the id itself when the list has not loaded. */
  providerName(id: string | null): string {
    if (!id) return UNKNOWN_AGENT;
    return this.providers?.providers.find((p) => p.id === id)?.displayName ?? id;
  }

  /** Pick a provider for the next send only (F-56); null clears the pick. Persists per tab. */
  setPendingProvider(id: string | null): void {
    this.pendingProvider = id;
    try {
      if (id) sessionStorage.setItem(PROVIDER_KEY, id);
      else sessionStorage.removeItem(PROVIDER_KEY);
    } catch {
      // sessionStorage unavailable: the pick lives for this page load only
    }
    this.render();
  }

  private restorePendingProvider(): void {
    try {
      this.pendingProvider = sessionStorage.getItem(PROVIDER_KEY);
    } catch {
      this.pendingProvider = null;
    }
  }

  /** `GET /__crt/providers`, with `?refresh=1` to re-run the server's preflight (F-56, F-57). */
  async loadProviders(refresh: boolean): Promise<ProvidersPayload> {
    const res = await fetch(crtUrl(`${PROVIDERS_ENDPOINT}${refresh ? "?refresh=1" : ""}`));
    const data = (await res.json().catch(() => ({}))) as Partial<ProvidersPayload> & { error?: string };
    if (!res.ok || !data.ok || !data.providers || !data.active) throw new Error(data.error ?? `CRT server answered ${res.status}`);
    this.providers = data as ProvidersPayload;
    this.render();
    this.renderHealth(); // the tooltip names the agent and carries its N-7 line (F-81)
    return this.providers;
  }

  /**
   * Toggle a provider list — the dock's (toolbar Agent button) or a popover's (its caret);
   * opening it shows the last known rows at once and refreshes them.
   */
  async toggleProviders(force?: boolean, into: HTMLElement = this.providersEl): Promise<void> {
    const show = force ?? this.providersOpen !== into;
    this.closeProviders();
    if (!show) {
      this.render();
      return;
    }
    this.sessions.hidden = true;
    this.providersOpen = into;
    into.hidden = false;
    this.renderProviders(true);
    this.render();
    try {
      await this.loadProviders(true);
      this.renderProviders(false);
    } catch (err) {
      const why = into.querySelector(".why");
      if (why) why.textContent = `Could not list agents: ${err instanceof Error ? err.message : String(err)}`;
      into.classList.remove("refreshing");
      this.noteFailure();
    }
  }

  private closeProviders(): void {
    if (this.providersOpen) this.providersOpen.hidden = true;
    this.providersOpen = null;
  }

  private renderProviders(refreshing: boolean): void {
    const into = this.providersOpen;
    if (!into) return;
    const remember = into.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked === true;
    into.classList.toggle("refreshing", refreshing);
    const head = document.createElement("div");
    head.className = "head";
    head.innerHTML = `<span>Send to…</span><span class="spacer"></span><button type="button" data-providers="close">×</button>`;
    const rows = (this.providers?.providers ?? []).map((p) => providerRow(p, p.id === this.sendProvider()));
    const why = document.createElement("div");
    why.className = "why";
    if (this.providers) {
      const d = this.providers.decision;
      why.textContent = `Auto-detected: ${this.providerName(d.provider)}${d.reason ? ` — ${d.reason}` : " (default)"}`;
    } else why.textContent = "Loading…";
    const label = document.createElement("label");
    label.className = "remember";
    label.innerHTML = `<input type="checkbox"> Remember for this project on this machine`;
    (label.querySelector("input") as HTMLInputElement).checked = remember;
    into.replaceChildren(head, ...rows, why, label);
  }

  private onProvidersClick(btn: HTMLButtonElement): void {
    if (btn.dataset.providers === "close") {
      this.closeProviders();
      this.render();
    } else if (btn.dataset.provider && !btn.disabled) {
      const remember = this.providersOpen?.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked === true;
      void this.chooseProvider(btn.dataset.provider, remember);
    }
  }

  /** A row was clicked: for this send only, or — with the checkbox — remembered via PUT /__crt/config. */
  async chooseProvider(id: string, remember: boolean): Promise<void> {
    const name = this.providerName(id);
    if (remember) {
      try {
        await this.rememberProvider(id);
        this.setPendingProvider(null);
        this.showStatus(`Remembered: new sessions run on ${escapeHtml(name)} for this project on this machine (<code>.crt/config.local.json</code>)`, false, true);
      } catch (err) {
        this.showStatus(`Could not remember ${escapeHtml(name)}: ${escapeHtml(err instanceof Error ? err.message : String(err))}`, true);
      }
    } else {
      this.setPendingProvider(id);
    }
    this.closeProviders();
    this.render();
  }

  /** F-57 `PUT /__crt/config { provider }`: the server writes the local file and replaces its active provider. */
  async rememberProvider(id: string): Promise<void> {
    const res = await fetch(crtUrl(CONFIG_ENDPOINT), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: id }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; active?: string; error?: string };
    if (!res.ok || !data.ok) throw new Error(data.error ?? `CRT server answered ${res.status}`);
    if (this.providers && data.active) this.providers = { ...this.providers, active: data.active };
  }

  // ---- session list (F-30) ---------------------------------------------------------------------

  /** Toggle the list of recent intake sessions; each row opens its session (F-66: in its popover). */
  async toggleSessions(force?: boolean): Promise<void> {
    const show = force ?? this.sessions.hidden;
    if (!show) {
      this.sessions.hidden = true;
      return;
    }
    this.sessions.innerHTML = `<div class="head"><span>Sessions</span><span class="spacer"></span><button type="button" data-sessions="close">×</button></div><div class="empty">Loading…</div>`;
    this.sessions.hidden = false;
    this.closeProviders();
    this.closePops();
    this.render();
    let list: SessionInfo[];
    try {
      list = await ChatPanel.listSessions();
    } catch (err) {
      this.sessions.querySelector(".empty")!.textContent = `Could not list sessions: ${err instanceof Error ? err.message : String(err)}`;
      this.noteFailure();
      return;
    }
    this.renderSessions(list);
  }

  private renderSessions(list: SessionInfo[]): void {
    const current = this.currentThread()?.sessionId ?? null;
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
      pill.dataset.state = s.taskId ? "task" : s.state;
      pill.textContent = s.taskId ?? STATE_LABEL[s.state];
      // F-47: the provider per row, so a Codex session is recognisable in the list.
      (btn.querySelector(".meta") as HTMLElement).textContent = `${time} · ${s.provider}${s.quick ? " · quick note" : ""}${s.url ? ` · ${pathOf(s.url)}` : ""} · ${s.id.slice(0, 8)}`;
      return btn;
    });
    const head = this.sessions.querySelector(".head")!;
    this.sessions.replaceChildren(head, ...rows);
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No sessions yet — annotate something and Send.";
      this.sessions.appendChild(empty);
    }
  }

  // ---- launcher health (F-81) and the welcome card (F-82) ---------------------------------------

  /** F-81: the three triggers — mount, the tab becoming visible again, and a CRT request that failed. */
  private wireHealth(): void {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.checkHealth();
    });
    void Promise.all([this.checkHealth(), this.providersReady]).then(() => {
      if (this.welcomeEl) return;
      const gate = { health: this.health, inIframe: window.top !== window, restored: this.restored, seen: welcomeSeen };
      if (shouldShowWelcome(gate)) this.showWelcome();
    });
  }

  /** A CRT request just failed: re-read health so the dot says whether the server is gone (F-81). */
  private noteFailure(): void {
    void this.checkHealth();
  }

  /** One `GET /__crt/health`; paints the dot from the answer and the last provider list. */
  async checkHealth(): Promise<HealthPayload | "failed"> {
    const h = await fetchHealth();
    this.health = h;
    if (h !== "failed" && this.firstProjectRoot === null) this.firstProjectRoot = rememberServer(h) ?? h.projectRoot;
    this.renderHealth();
    return h;
  }

  /** The dot's state as painted (tests). */
  healthState(): HealthState {
    return (this.launcher.dataset.health as HealthState | undefined) ?? "checking";
  }

  private renderHealth(): void {
    const h = this.health;
    const provider = h && h !== "failed" ? h.provider : null;
    const row = provider ? this.providers?.providers.find((p) => p.id === provider) : undefined;
    const view = deriveHealth({
      health: h,
      agentName: row?.displayName ?? null,
      problem: row?.problem ?? null,
      firstProjectRoot: this.firstProjectRoot,
      port: crtPort(),
    });
    this.launcher.dataset.health = view.state;
    this.launcher.title = view.tooltip;
  }

  /** F-82: show the card now, whatever the suppression rules say (`window.__crt.welcome()`). */
  async welcome(): Promise<void> {
    if (this.health === null || this.health === "failed") await this.checkHealth();
    if (this.health === null || this.health === "failed") return;
    if (!this.providers) await this.loadProviders(false).catch(() => undefined);
    this.showWelcome();
  }

  private showWelcome(): void {
    const h = this.health;
    if (!h || h === "failed") return;
    const row = h.provider ? this.providers?.providers.find((p) => p.id === h.provider) : undefined;
    const copy = welcomeCopy(h, { name: row?.displayName ?? null, problem: row?.problem ?? null }, CRT_ORIGIN || location.origin);
    this.welcomeEl?.remove();
    const el = buildWelcome(copy, {
      gotIt: () => this.dismissWelcome(),
      showMe: () => {
        // Should: open the toolbar, arm Select, dismiss.
        this.dismissWelcome();
        this.toggle(true);
        this.setTool("select");
      },
    });
    this.welcomeEl = el;
    this.root.appendChild(el);
    this.positionDocked();
  }

  private dismissWelcome(): void {
    if (this.health && this.health !== "failed") markWelcomeSeen(this.health.projectRoot);
    this.welcomeEl?.remove();
    this.welcomeEl = null;
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
    window.addEventListener("resize", () => {
      this.placeLauncher();
      this.positionAll();
    });
  }

  private placeLauncher(): void {
    const right = clamp(this.launcherPos.right, 0, Math.max(0, window.innerWidth - 60));
    const bottom = clamp(this.launcherPos.bottom, 0, Math.max(0, window.innerHeight - 40));
    this.launcherPos = { right, bottom };
    this.launcher.style.right = `${right}px`;
    this.launcher.style.bottom = `${bottom}px`;
    this.dock.style.right = `${right}px`;
    this.dock.style.bottom = `${bottom + this.launcher.offsetHeight + 8}px`;
    this.positionDocked();
  }

  /** F-68: page-level popovers sit above the dock, in the launcher's corner. */
  private positionDocked(): void {
    const bottom = this.launcherPos.bottom + this.launcher.offsetHeight + 8 + (this.dock.hidden ? 0 : this.dock.offsetHeight + 8);
    for (const pop of Array.from(this.pops.querySelectorAll<HTMLElement>(".pop.page"))) {
      pop.style.right = `${this.launcherPos.right}px`;
      pop.style.bottom = `${bottom}px`;
      pop.style.maxHeight = `${Math.max(120, window.innerHeight - bottom - 8)}px`;
    }
    if (this.welcomeEl) {
      // F-82: the card sits where a page-level popover would, so it never covers the launcher or the dock.
      this.welcomeEl.style.right = `${this.launcherPos.right}px`;
      this.welcomeEl.style.bottom = `${bottom}px`;
    }
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

  // ---- toolbar ---------------------------------------------------------------------------------

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
        this.hideStatus();
      } else if (btn.dataset.action === "chat") {
        this.togglePageChat();
      } else if (btn.dataset.action === "sessions") {
        void this.toggleSessions();
      } else if (btn.dataset.action === "agent") {
        void this.toggleProviders();
      }
    });
    this.sessions.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>("button");
      if (!btn) return;
      if (btn.dataset.sessions === "close") this.sessions.hidden = true;
      else if (btn.dataset.session) {
        this.sessions.hidden = true;
        this.openSession(btn.dataset.session);
      }
    });
    this.providersEl.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>("button");
      if (btn) this.onProvidersClick(btn);
    });
    this.status.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>("button");
      if (btn?.dataset.status === "chat") this.openSession(btn.dataset.session ?? this.currentThread()?.sessionId ?? "");
    });
    // Keys typed into the dock must not reach the host page's shortcuts.
    for (const type of ["keydown", "keyup", "keypress"] as const) {
      this.dock.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  private render(): void {
    const items = this.store.all();
    this.pruneThreads(items);
    const n = items.length;
    this.count.textContent = String(n);
    this.count.classList.toggle("on", n > 0);
    (this.toolbar.querySelector("[data-count]") as HTMLElement).textContent = String(n);
    for (const b of Array.from(this.toolbar.querySelectorAll("button"))) b.disabled = this.busy;
    (this.toolbar.querySelector("[data-action=clear]") as HTMLButtonElement).disabled = this.busy || n === 0;
    (this.toolbar.querySelector("[data-action=sessions]") as HTMLButtonElement).classList.toggle("active", !this.sessions.hidden);
    (this.toolbar.querySelector("[data-action=agent]") as HTMLButtonElement).classList.toggle("active", this.providersOpen === this.providersEl);
    const chatBtn = this.toolbar.querySelector("[data-action=chat]") as HTMLButtonElement;
    chatBtn.classList.toggle("active", !this.pagePop.hidden);
    // F-68: the latest page-level thread's state as a dot on the Chat button.
    const latestPage = this.threads.filter((t) => !t.annotationIds.length).at(-1);
    const dot = chatBtn.querySelector(".dot") as HTMLElement;
    const pageState = latestPage ? threadState(latestPage.chat.snapshot().state, latestPage.chat.snapshot().taskId) : null;
    dot.hidden = !pageState;
    if (pageState) dot.dataset.state = pageState;
    else delete dot.dataset.state;
    dot.title = pageState ? `page chat: ${STATE_LABEL[pageState]}` : "";

    this.renderPops(items);
    this.renderMarkers(items);
    this.ensureTick();
  }

  private renderMarkers(items: Annotation[]): void {
    const frag = document.createDocumentFragment();
    for (const a of items) {
      const thread = a.sessionId ? this.threads.find((t) => t.sessionId === a.sessionId) : undefined;
      const snap = thread?.chat.snapshot();
      const state = snap ? threadState(snap.state, snap.taskId) : null;
      const mark = document.createElement("div");
      mark.className = `mark ${a.kind}`;
      mark.dataset.n = String(a.n);
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "num-badge";
      badge.dataset.n = String(a.n);
      badge.textContent = String(a.n);
      badge.title = a.note || `Annotation ${a.n}`;
      badge.addEventListener("click", () => this.togglePop(a.n));
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "pill mark-state";
      pill.dataset.n = String(a.n);
      pill.hidden = !state;
      if (state) {
        mark.dataset.state = state;
        badge.dataset.state = state;
        pill.dataset.state = state;
        pill.textContent = snap?.taskId ?? STATE_LABEL[state];
        pill.title = `Annotation ${a.n}: ${STATE_LABEL[state]} — click to open the chat`;
        pill.addEventListener("click", () => this.togglePop(a.n));
      }
      frag.append(mark, badge, pill);
    }
    this.markers.replaceChildren(frag);
    this.positionAll();
  }

  /** Keep markers and the open popover glued to their elements while the page scrolls or reflows. */
  private tick = (): void => {
    this.positionAll();
    this.raf = requestAnimationFrame(this.tick);
  };

  private ensureTick(): void {
    const needed = this.store.count() > 0 || this.openPop !== null;
    if (needed && !this.raf) this.tick();
    if (!needed && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  /** The viewport rectangle a marker (and its popover) anchors to. */
  private anchorRect(a: Annotation): { rect: { x: number; y: number; width: number; height: number }; detached: boolean } {
    let rect = toViewportRect(a.pageRect);
    let detached = false;
    if (a.kind === "select") {
      if (a.element?.isConnected) {
        const r = a.element.getBoundingClientRect();
        rect = { x: r.left, y: r.top, width: r.width, height: r.height };
      } else detached = true;
    }
    return { rect, detached };
  }

  private positionAll(): void {
    const items = this.store.all();
    const marks = this.markers.querySelectorAll<HTMLElement>(".mark");
    const badges = this.markers.querySelectorAll<HTMLElement>(".num-badge");
    const pills = this.markers.querySelectorAll<HTMLElement>(".mark-state");
    items.forEach((a, i) => {
      const mark = marks[i];
      const badge = badges[i];
      const pill = pills[i];
      if (!mark || !badge || !pill) return;
      const { rect, detached } = this.anchorRect(a);
      mark.classList.toggle("detached", detached);
      let bx: number;
      let by: number;
      if (a.kind === "pin") {
        mark.style.left = `${rect.x - 7}px`;
        mark.style.top = `${rect.y - 7}px`;
        bx = rect.x + 16;
        by = rect.y - 14;
      } else {
        mark.style.left = `${rect.x}px`;
        mark.style.top = `${rect.y}px`;
        mark.style.width = `${rect.width}px`;
        mark.style.height = `${rect.height}px`;
        bx = rect.x;
        by = rect.y;
      }
      badge.style.left = `${bx}px`;
      badge.style.top = `${by}px`;
      pill.style.left = `${bx + 14}px`;
      pill.style.top = `${by}px`;
      // F-65: the open popover follows its annotation.
      const pop = this.openPop;
      if (pop && !pop.hidden && !pop.classList.contains("page") && pop.dataset.id && this.threadOrOwnId(pop) === a.id) {
        const size = { width: pop.offsetWidth, height: pop.offsetHeight };
        const anchor = a.kind === "pin" ? { x: rect.x, y: rect.y, width: 1, height: 1 } : rect;
        const p = placePopover(anchor, size, this.popoverViewport());
        pop.style.left = `${p.x}px`;
        pop.style.top = `${p.y}px`;
        pop.dataset.side = p.side;
      }
    });
    this.positionDocked();
  }

  /**
   * F-65's "inside the viewport", minus the dock: when the toolbar is open in the lower half of the
   * window, a popover is clamped above it rather than under it (at 600 px a chat popover would
   * otherwise end over the toolbar, reply box first — CRT-0029). A dock dragged into the upper half
   * leaves the whole viewport to the popover.
   */
  private popoverViewport(): { width: number; height: number } {
    const width = window.innerWidth;
    if (this.dock.hidden) return { width, height: window.innerHeight };
    const top = this.dock.getBoundingClientRect().top;
    return { width, height: top > window.innerHeight / 2 ? top : window.innerHeight };
  }

  /** The annotation a popover is anchored to (the host of a grouped thread, or its own). */
  private threadOrOwnId(pop: HTMLElement): string | undefined {
    return this.threads.find((t) => t.pop === pop)?.annotationIds[0] ?? pop.dataset.id;
  }

  /** Open an annotation's popover and put the caret in its note (or its chat input). */
  private focusNote(n: number): void {
    this.togglePop(n, true);
  }

  private showStatus(html: string, error = false, autoHide = false): void {
    // An earlier message's auto-hide timer must not hide this one.
    clearTimeout(this.statusTimer);
    this.status.innerHTML = html;
    this.status.classList.toggle("error", error);
    this.status.hidden = false;
    if (!this.open) this.toggle(true);
    this.statusTimer = autoHide ? setTimeout(() => this.hideStatus(), 15_000) : undefined;
  }

  private hideStatus(): void {
    clearTimeout(this.statusTimer);
    this.statusTimer = undefined;
    this.status.hidden = true;
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
        if (!this.tool) {
          // F-65: Esc inside an open popover closes it.
          if (e.key === "Escape" && this.openPop && e.composedPath().includes(this.openPop)) {
            e.preventDefault();
            e.stopPropagation();
            const thread = this.threads.find((t) => t.pop === this.openPop);
            if (thread) thread.chat.show(false);
            else this.hidePop(this.openPop);
            this.render();
          }
          return;
        }
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

const STATE_LABEL: Record<ThreadState, string> = {
  starting: "starting",
  running: "thinking…",
  waiting: "needs permission",
  idle: "your turn",
  task: "task written",
  ended: "ended",
  error: "error",
};

/** F-67: `task` once the file exists, else the session state (`starting` before the first event). */
export function threadState(state: SessionState | null, taskId: string | null): ThreadState {
  return taskId ? "task" : (state ?? "starting");
}

function openChatLink(sessionId: string): string {
  return `<button type="button" data-status="chat" data-session="${escapeHtml(sessionId)}">open chat</button>`;
}

/** F-45's state column, derived from the F-57 row the way `preflightState` does on the server. */
export function providerState(p: ProviderRow): "ready" | "not on PATH" | "not logged in" | "too old" | "unknown" {
  if (!p.installed) return "not on PATH";
  if (p.loggedIn === false) return "not logged in";
  if (p.problem === null) return "ready";
  return /too old/i.test(p.problem) ? "too old" : "unknown";
}

/** One row of the provider menu (F-56): state dot, name and id, tick on the active one, spinner while refreshing. */
function providerRow(p: ProviderRow, active: boolean): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `provider${active ? " active" : ""}`;
  btn.dataset.provider = p.id;
  const state = providerState(p);
  btn.disabled = p.problem !== null;
  btn.title = p.problem ?? `${state}${p.version ? ` · ${p.version}` : ""}`;
  btn.innerHTML = `<span class="dot"></span><span class="name"><b></b><small></small></span><span class="tick">✓</span><span class="spin"></span>`;
  (btn.querySelector(".dot") as HTMLElement).dataset.state = state;
  (btn.querySelector(".name b") as HTMLElement).textContent = p.displayName;
  (btn.querySelector(".name small") as HTMLElement).textContent = p.id;
  if (p.experimental) {
    // F-54 (M10): a profile shipped untested against a real agent wears a badge; the reason is its tooltip.
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "experimental";
    badge.title = p.experimental;
    (btn.querySelector(".name") as HTMLElement).appendChild(badge);
  }
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

export function describeAnnotation(a: Annotation): string {
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

function cssEscape(s: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
}
