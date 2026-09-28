/**
 * The overlay's stylesheet (PRD §5.1): the launcher, the dock, the tools, the markers, the popovers,
 * the welcome card (welcome.ts) and the chat panel (chat.ts), in one string for the Shadow DOM's
 * <style>. Every colour is a tokens.ts value (F-112); test/brand.test.ts pins each token site, the
 * hex counts and the length, so a move that changes a byte fails there. ui.ts re-exports it.
 */
import { CHAT_CSS } from "./chat.js";
import { ACCENT, ACCENT_HOVER, DANGER, ERROR, EXPERIMENTAL, FAIL, IDLE, INK, OK, PILL, tint, WARN } from "./tokens.js";
import { WELCOME_CSS } from "./welcome.js";

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
  .provider .dot[data-state="not on PATH"], .provider .dot[data-state="not logged in"], .provider .dot[data-state="too old"] { background: ${FAIL}; }
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
  .hover { position: fixed; pointer-events: none; border: 2px solid ${ACCENT}; background: ${tint(ACCENT, 0.08)};
           border-radius: 2px; display: none; }
  .hover-label { position: fixed; pointer-events: none; display: none; padding: 3px 7px; border-radius: 6px;
                 background: ${INK}; color: #fff; font-size: 11px; font-family: ui-monospace, Menlo, Consolas, monospace;
                 max-width: 60vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hover-label b { color: #ffd166; font-weight: 600; }
  .drag { position: fixed; pointer-events: none; border: 2px dashed ${ACCENT}; background: ${tint(ACCENT, 0.08)}; display: none; }
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
          border-radius: 999px; background: ${tint(INK, 0.9)}; color: #fff; font-size: 12px; }
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
  .pop-foot button.del:hover { background: #fee; color: ${FAIL}; }
  .pop .providers { width: auto; margin: 0 10px 10px; box-shadow: none; border: 1px solid rgba(0,0,0,.1); }
  .pop.threaded .pop-head, .pop.threaded .compose { display: none; }
  .pop .thread:empty { display: none; }
  .pop.sending .compose { opacity: .6; pointer-events: none; }
${CHAT_CSS}
`;
