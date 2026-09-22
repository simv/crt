# Add CRT to your app

The one dev-only line in its four forms, where each starts capturing, what the loader does, the production guarantee in full, and proxy mode for an app you cannot touch. The snippets are also on the front page: [README › Add CRT to your app](../README.md#add-crt-to-your-app).

Embedded mode (the default since v0.4) needs one dev-only line in the app, so the CRT button appears on the app's own URL: the line loads a small **loader** from the running CRT server, and the loader puts the overlay on the page. `crt init` prints the form for your framework (`crt init --snippet` prints only that; `/crt:init` in Claude Code applies it); these are the four:

```tsx
// Next.js (App Router) — app/layout.tsx
import { CrtDevTools } from "claude-review-tool/react";
…
<body>{children}<CrtDevTools /></body>
```

```ts
// Vite — vite.config.ts
import { crt } from "claude-review-tool/vite";
export default defineConfig({ plugins: [react(), crt()] });
```

```ts
// any bundled app — the client entry (src/main.tsx, src/index.ts, …)
import { mountCrt } from "claude-review-tool/loader";
if (process.env.NODE_ENV !== "production") mountCrt();   // the guard is optional (F-98); it lets the bundler drop the import
```

```html
<!-- no bundler — the development page only -->
<script src="http://localhost:4400/__crt/loader.js"></script>
```

## Where each form starts capturing

Where each one starts capturing console errors and failed requests:

- **Vite / `crt()`** — before the app's first module: the plugin prepends the loader module to `<head>` (under `vite` only, never in `vite build`).
- **React / Next.js / `<CrtDevTools />`** — after hydration: the component renders nothing and mounts the loader from its first effect, so a `console.error` logged before the React tree hydrated is missed.
- **`mountCrt()`** — from wherever you call it: put it as early in the client entry as you can.
- **The script tag** — from the tag onward: put it first in `<head>` of your development page. With this form the script itself is missing when the server is down, so there is no pill — the pill needs the bundled forms above.

## The loader

Each takes `{ port }` (or `{ origin }`) when `port` in `.crt/config.json` is not 4400 (`data-crt-port="4401"` on the script tag); the Vite plugin reads the config files itself. The loader installs the console/network hooks at once, appends `<script src="http://localhost:4400/__crt/overlay.js" defer>` so the overlay always comes from the running server (its version always equals the server's), and — in the bundled forms — shows a pill when that script fails to load (`CRT server not running on :4400 — run \`crt\` in the project, then click here`) that retries on click or when the tab regains focus, so starting `crt` after the page is open needs no reload. It does nothing at all on a page whose hostname is not `localhost`, `*.localhost`, `127.0.0.1` or `[::1]`, and it loads the overlay only from a CRT origin on one of those hosts — a non-loopback `origin` option or script source is ignored and `http://localhost:4400` is used instead. `react` (≥ 18) and `vite` (≥ 5) are optional peer dependencies. The plain overlay tag, `<script src="http://localhost:4400/__crt/overlay.js" defer></script>`, still works too (no early hooks, no pill).

## Production

Nothing from CRT ships in a production build of an app that uses any of the entries, in four layers, each sufficient on its own: (1) the package's `production` export condition maps `claude-review-tool/loader` and `claude-review-tool/react` to no-op modules with the same exports — Vite, webpack 5 / Next, Rspack, Turbopack and esbuild (`--conditions=production`) honour it; (2) every entry's body sits behind `process.env.NODE_ENV !== "production"`, which those bundlers define statically, so the loader code is dropped even where the condition is not; (3) `mountCrt` does nothing unless the page is on `localhost`, `*.localhost`, `127.0.0.1` or `[::1]`; (4) the Vite plugin is `apply: "serve"`, and the script tag lives in the development page only. Verify any build with `grep -r "__crt" dist/` (or `.next/static`) after a production build — it finds nothing — and by checking in the browser's network panel that the production page never requests the CRT port. Verified so far: esbuild 0.25 and Vite 8.3 by the package's own test, which builds fixture apps for production and asserts the outputs contain none of `__crt`, `/loader.js`, `overlay.js`, `mountCrt`, `4400` (and that the development builds do carry the loader); Next.js 16.3 (Turbopack) by hand on a real app — `next build` output clean, with the no-op module's `CrtDevTools` export name the only trace, and a scratch `npm create vite@latest` app's `vite build` clean.

## Proxy mode

For an app you cannot or should not touch — no JS entry, a layout owned by someone else, a quick look at a site you did not set up — `crt proxy` is the v0.1–v0.3 experience: CRT proxies your app and you browse the proxied copy instead of the app's own URL.

```bash
npm run dev                  # your dev server, e.g. http://localhost:3000
crt proxy                    # finds it (or asks for its URL once) → http://localhost:4400 opens; browse, annotate, send
```

`crt proxy [target]` ≡ `crt serve --mode proxy [target]`; `"mode": "proxy"` in `.crt/config.json` makes it a project's default so `crt` alone proxies there (the ready line then reads `(proxy; …)`), and `/crt:serve --proxy` does it from Claude Code. Everything proxy mode did in v0.3 still applies, unchanged and still tested: the guided target step (a terminal asks `Dev server URL or port:` and waits when nothing answers; `Which one? [1]` when several do), HTML injection of the early hook and the overlay tag into every `text/html` response (gzip and brotli decompressed first), WebSocket/HMR passthrough, absolute redirects to the target rewritten to the CRT origin, a CSP that would block the script relaxed for `'self'`, the `crt: injected the overlay into GET / but the browser never fetched /__crt/overlay.js …` diagnosis when the page never asks for the overlay, and the welcome card's `Proxying http://localhost:3000 for C:\my-app.` line. Nothing is added to the app; the overlay is injected on the way through. The flip side is that everything the app does with its own origin — absolute links and redirects, cookies scoped to a port, OAuth callbacks and `postMessage` targets registered for `:3000`, service workers, strict CSP — behaves differently on the proxied one, which is why embedded mode is the default. `crt doctor` shows `ok    mode      proxy (.crt/config.json)` and `--    integration proxy mode` for such a project.
