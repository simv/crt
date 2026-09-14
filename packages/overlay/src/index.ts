/**
 * CRT overlay entry point. Injected by the CRT proxy as <script src="/__crt/overlay.js" defer>.
 * Everything renders inside a Shadow DOM host so host-page CSS cannot leak in or out (PRD §5.1).
 *
 * M1: launcher button only (F-7). M2 adds tools + capture, M3 adds the chat panel.
 */
(() => {
  if (document.getElementById("crt-host")) return;
  const host = document.createElement("div");
  host.id = "crt-host";
  host.setAttribute("data-crt", "");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; position: fixed; inset: auto 16px 16px auto; z-index: 2147483647; }
      button { font: 600 13px system-ui, sans-serif; padding: 10px 14px; border-radius: 999px;
               border: 0; background: #111; color: #fff; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
    </style>
    <button type="button" aria-label="Open Claude Review Tool">CRT</button>
  `;
  document.documentElement.appendChild(host);
})();
