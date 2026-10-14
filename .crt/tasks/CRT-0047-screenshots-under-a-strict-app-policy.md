---
id: CRT-0047
title: Screenshots under a strict app policy (no inline styles, no data: images)
status: done
priority: normal
created: 2026-10-13T11:15:00+08:00
updated: 2026-10-14T10:45:00+08:00
url: null
route: null
session: null
tags: [overlay, screenshot, csp, f-16, f-2]
files: [packages/overlay/src/screenshot.ts, packages/overlay/src/api.ts, packages/server/src/raster-frame.ts, packages/server/src/proxy.ts, packages/server/src/routes.ts, packages/server/src/inject.ts, packages/server/e2e/proxy.spec.ts, packages/server/e2e/fixture/server.mjs, docs/PRD.md, docs/troubleshooting.md]
---

## Summary
Under a strict app policy (`style-src 'self' 'nonce-…'`, `img-src 'self'`, as in Jack of Clubs) a capture is sent without screenshots: modern-screenshot needs an inline `<style>` in a scratch document and loads its SVG as a `data:` image, and the policy refuses both. Since CRT-0046 the bundle says so (`screenshots.error` names the directive). Decide how, or whether, to get screenshots back there.

## Context
- `packages/overlay/src/screenshot.ts` `rasteriseViewport` calls `domToCanvas` (modern-screenshot 4.7.0); its web-font step creates `<style>` in `document.implementation.createHTMLDocument("")`, whose `sheet` is null under the policy, and the final step decodes a `data:image/svg+xml` image.
- `packages/server/src/inject.ts` `relaxCsp` (F-2) already relaxes the proxied copy's script directive for `'self'`.

## Evidence
`e2e/proxy.spec.ts` "under a strict app's style-src …" (CRT-0046) asserts today's error.

## Ask
Choose one and propose the PRD change first: (a) proxy mode also adds `data:` to `img-src` and works around the scratch-document `<style>` (modern-screenshot's `font.cssText` option skips that step), on the proxied copy only, with a line saying it did; (b) a rasteriser path that needs neither; (c) leave screenshots off under such policies and say so in the panel. (a) loosens the app's policy in development, which is the call to make deliberately.

## Definition of Done
- [x] The PRD names the chosen behaviour.
- [x] e2e under the fixture's `/csp-styles` covers it.
- [x] `npm run check` green; `npm run e2e` green.

## Notes
Filed from CRT-0046.

## Log
- 2026-10-13T11:15+08:00 — filed by hand from CRT-0046 (backlog).
- 2026-10-13T20:30+08:00 — claimed (Simon, from the project thread: a capture on the latest build said "No screenshots rasterised (CSP blocked it)"; "fix it so screenshots work"), branch crt/CRT-0047-screenshots-strict-csp off origin/main fa91ad0.
- 2026-10-13T20:45+08:00 — finding: in Chromium a foreignObject SVG drawn onto a canvas leaves it clean only as a `data:` image; the same SVG from a same-origin URL taints the canvas (with or without `crossOrigin`), and a `blob:` URL is refused by `img-src 'self'` like `data:`. `createImageBitmap` does not decode SVG. So (a) as written could not avoid `data:`, and no in-page variant of the current rasteriser can.
- 2026-10-13T20:50+08:00 — decision: (b), a path that loosens nothing. The fonts go to modern-screenshot as `font.cssText` (collected here from readable sheets, @import/@media/@layer included, and fetched cross-origin sheets; `font: false` when there are none, since an empty cssText falls back to the scratch `<style>`), and the SVG is drawn in CRT's own frame, `GET /__crt/raster` (server `raster-frame.ts`): a page under its own policy (`default-src 'none'`, its one script by hash, `img-src data:`) that loads the `data:` image, draws it and posts the PNG back as a Blob, which the page decodes with `createImageBitmap` (no fetch, no policy check). Behind the proxy the frame is same-origin, so the app's `default-src 'self'` covers it; embedded mode needs the CRT origin in `frame-src`, like `script-src`. The page's policy is probed once per page (a scratch-document `<style>` with no `sheet`, a one-pixel `data:` image that errors); pages without a strict policy take modern-screenshot's own path, unchanged.
- 2026-10-13T21:10+08:00 — verified: `e2e/proxy.spec.ts` "under a strict app's style-src … a capture still has its screenshots (F-2, F-16, CRT-0046, CRT-0047)" now asserts the three PNGs and `error: null`. A throwaway spec (not committed) on a richer page under the policy (a self-hosted woff2 web font, a nonce'd `<style>`, a same-origin image and a canvas) gave a viewport PNG matching the policy-free render of the same page (Fraunces, the card, the image and the canvas all drawn), ~400 ms against ~150 ms. `test/proxy.test.ts` covers the route and its policy hash; `overlay-structure.test.ts` pins the message type on both sides.
- 2026-10-13T21:20+08:00 — ready for review.
- 2026-10-13T20:45+08:00 — verified: typecheck, lint and build green; `npm test` 817 passed, 3 skipped, 1 failed: `test/providers/exec.test.ts` "kills a process and its children …", the same environmental failure in this Linux cloud container CRT-0046 logged. `npx playwright test` 75/76; the one failure, `embedded.spec.ts` "health says embedded …", passed on its own straight after and touches no changed code (also as in CRT-0046).
- 2026-10-13T20:45+08:00 — prd-reviewer: PR-READY WITH NOTES. Left: the frame's font and redraw paths are covered by the throwaway spec only (the `/csp-styles` page has no web font or image); the transient iframe sits outside the shadow root, aria-hidden, zero-size and removed in `finally`, which the shadow-DOM rule (the overlay's UI) does not govern. CodeQL flagged the test's `<script>` regexp; the test now slices between the tags instead.
- 2026-10-14T10:30+08:00 — finding while setting up the Jack of Clubs trial: its development policy has `frame-src 'none'` (and `'unsafe-inline'` styles, so only the img-src half shows in `pnpm dev`), which refuses the rasteriser frame even behind the proxy. Fix: `relaxFrameSrc` (inject.ts) adds `http://<proxy host>/__crt/raster`, that one URL, to the directive that governs frames when it does not allow 'self' (replacing a lone 'none'; a `frame-src` beside a `default-src`), and only where the images directive refuses `data:`, alongside `relaxCsp`'s script relaxation (F-2). New fixture route `/csp-frames` and e2e "under a strict img-src and frame-src 'none' …", which fails without the relaxation; `test/inject.test.ts` covers the rewrite; `proxy.test.ts` "/csp" now expects the frame URL beside its `default-src 'none'`.
- 2026-10-14T10:40+08:00 — finding from Simon's capture on Jack of Clubs (20261014-102442-6cd3): besides `frame-src`, its `base-uri 'none'` refuses the `<base>` modern-screenshot puts in a scratch document to resolve a stylesheet's `url()`s, so a sheet-relative font URL (Next.js `../media/…`) resolves wrong. The policy probe now also checks a `<base>` there and, when it is ignored, takes the `font.cssText` path (fonts resolved with `new URL`). Verified with a throwaway spec in Jack of Clubs' shape (`'unsafe-inline'` styles, `img-src 'self'`, the relaxed `frame-src`, `base-uri 'none'`, a `../media/` woff2): screenshots taken, the web font drawn.
- 2026-10-14T10:40+08:00 — verified on Simon's machine against Jack of Clubs at 8dcbe30: proxy mode (its `frame-src` now gains `/__crt/raster`) and embedded mode (Jack of Clubs' development policy allowing the CRT origin in `script-src`, `connect-src` and `frame-src`, uncommitted there) each took a capture with screenshots and `error: null`; Simon confirmed both. CI green on 8dcbe30.
- 2026-10-14T10:45+08:00 — done; closed in https://github.com/simv/crt/pull/109
