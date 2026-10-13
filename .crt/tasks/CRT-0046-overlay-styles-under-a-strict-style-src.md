---
id: CRT-0046
title: The panel and the pill render unstyled under a strict app's style-src
status: review
priority: high
created: 2026-10-13T11:15:00+08:00
updated: 2026-10-13T11:40:00+08:00
url: http://localhost:4400/
route: /
session: null
tags: [bug, overlay, loader, csp, f-2, f-96, f-16]
files: [packages/overlay/src/sheet.ts, packages/overlay/src/ui.ts, packages/overlay/src/loader.ts, packages/overlay/src/screenshot.ts, packages/server/e2e/proxy.spec.ts, packages/server/e2e/embedded.spec.ts, packages/server/e2e/fixture/server.mjs, packages/server/e2e/fixture/server.d.mts, docs/troubleshooting.md]
---

## Summary
On Jack of Clubs (a Next.js app whose policy is `style-src 'self' 'nonce-…'`) the CRT panel appears with no styling and its buttons have no size, in proxy mode and embedded mode alike. The overlay (`ui.ts`) and the loader's pill (`loader.ts`) put their CSS in an inline `<style>` inside their shadow roots, and a policy without `'unsafe-inline'` refuses it. Build the styles as constructed stylesheets instead, which such a policy does not govern, so no app has to loosen its policy. Screenshots stay best-effort (F-16) under that policy; the capture's error should say the page's CSP blocked them.

## Context
- `packages/overlay/src/ui.ts` — `this.root.innerHTML` began with `<style>${OVERLAY_CSS}</style>`.
- `packages/overlay/src/loader.ts` `mountPill` — `document.createElement("style")` with `PILL_CSS`.
- `packages/server/src/inject.ts` `relaxCsp` adds `'self'` to the script directive only (F-2); a policy whose `script-src` already has `'self'` passes through unchanged, so in proxy mode the overlay script runs and its styles are refused.
- `packages/overlay/src/screenshot.ts` — modern-screenshot builds a `<style>` in a scratch document (null `sheet` under the policy → `Cannot read properties of null (reading 'cssRules')`) and loads the SVG it draws as a `data:` image, which `img-src 'self'` refuses.

## Evidence
Reported from Simon's machine, 2026-10-13: `crt proxy` in front of the Jack of Clubs demo, the panel present in the DOM with no styling. Jack of Clubs' policy (`apps/web/app/security-headers.ts`): `default-src 'self'; script-src 'self' 'nonce-…'; style-src 'self' 'nonce-…'; img-src 'self'; font-src 'self'; connect-src 'self'; …`.

## Ask
1. A small shared helper attaches CSS to a shadow root as a constructed stylesheet (`adoptedStyleSheets`), falling back to a `<style>` element where constructable stylesheets do not exist; the overlay and the pill use it. No page policy is loosened.
2. When rasterising fails and the page's policy refused something, `screenshots.error` names the directives instead of the bare script error.
3. Troubleshooting says a strict `style-src` needs nothing, and what happens to screenshots.

## Definition of Done
- [x] e2e (proxy): under the fixture's new `/csp-styles` (a strict app's policy) the header passes through unchanged, the launcher is `position: fixed` and full size, the toolbar opens styled, and the console has no style-src refusal. Fails on the unfixed overlay.
- [x] e2e (embedded): the bundled ESM loader's pill under the same policy is `position: fixed` with its rounded shape. Fails on the unfixed loader.
- [x] e2e: a capture under that policy is sent, with `screenshots.error` naming `style-src` and the page's CSP, and the annotation's selector intact.
- [x] `npm run check` green; `npm run e2e` green.

## Notes
Screenshots under a policy without `'unsafe-inline'` styles and `data:` images remain off; making them work needs either a rasteriser that avoids both or proxy mode relaxing `img-src`/`style-src` on the proxied copy, which loosens the app's policy and is a separate decision (CRT-0047).

## Log
- 2026-10-13T11:15+08:00 — filed and claimed by hand (Simon's request from the Jack of Clubs review: "Fix CRT so its feedback panel shows on Jack of Clubs?" → Both), branch crt/CRT-0046-overlay-styles-strict-csp off origin/main 6139544.
- 2026-10-13T11:40+08:00 — decision: constructed stylesheets (`adoptedStyleSheets`) over a `<link>` to `/__crt/overlay.css`: a link works only same-origin under `style-src 'self'` (proxy mode), not for the cross-origin overlay in embedded mode, and not under a nonce-only policy. The helper is `packages/overlay/src/sheet.ts`, shared by `ui.ts` and `loader.ts`; it falls back to the `<style>` element where `new CSSStyleSheet()` or `replaceSync` throws. `OVERLAY_CSS` is unchanged (the brand.test.ts length pin holds).
- 2026-10-13T11:40+08:00 — finding: screenshots under that policy fail in modern-screenshot's web-font step first (a `<style>` in a scratch document whose `sheet` is null), and its SVG is a `data:` image `img-src 'self'` refuses next. Neither is fixable without loosening the app's policy or replacing the rasteriser, so screenshots stay best-effort (F-16) and `screenshots.error` now names the refused directives (`securitypolicyviolation` events during the pass). Filed as CRT-0047 (backlog).
- 2026-10-13T11:40+08:00 — verified: `e2e/proxy.spec.ts` "under a strict app's style-src the overlay still renders styled, and the page's policy is passed through unchanged (F-2, CRT-0046)" passes; on the unfixed overlay it fails with `position` "static" for the launcher. `e2e/embedded.spec.ts` "under a strict app's style-src the loader's pill still renders styled (F-96, CRT-0046)" passes; on the unfixed loader it fails the same way. The capture under the policy is sent with `screenshots.error` "rasterisation failed: the page's Content-Security-Policy blocked the screenshot (style-src…)" and the annotation's selector `#heading`.
- 2026-10-13T11:40+08:00 — verified: typecheck, lint and build green; `npm test` 815 passed, 3 skipped, 1 failed: `test/providers/exec.test.ts` "kills a process and its children …", which fails the same way on origin/main in this Linux cloud container (the process-group kill), so it is environmental. `npx playwright test` (Chromium at /opt/pw-browsers through a throwaway config, not committed) 75/76; the one failure, `embedded.spec.ts` "health says embedded … the ready and reuse lines …", passed on its own straight after and touches no changed code. The CI run is the clean one.
- 2026-10-13T11:40+08:00 — ready for review: changed packages/overlay/src/{sheet (new),ui,loader,screenshot}.ts, packages/server/e2e/{proxy,embedded}.spec.ts, packages/server/e2e/fixture/server.{mjs,d.mts} (new `/csp-styles`), docs/troubleshooting.md; CRT-0047 filed.
