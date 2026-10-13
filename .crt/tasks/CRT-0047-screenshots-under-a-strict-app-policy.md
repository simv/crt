---
id: CRT-0047
title: Screenshots under a strict app policy (no inline styles, no data: images)
status: backlog
priority: normal
created: 2026-10-13T11:15:00+08:00
updated: 2026-10-13T11:15:00+08:00
url: null
route: null
session: null
tags: [overlay, screenshot, csp, f-16, f-2]
files: [packages/overlay/src/screenshot.ts, packages/server/src/inject.ts]
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
- [ ] The PRD names the chosen behaviour.
- [ ] e2e under the fixture's `/csp-styles` covers it.
- [ ] `npm run check` green; `npm run e2e` green.

## Notes
Filed from CRT-0046.

## Log
- 2026-10-13T11:15+08:00 — filed by hand from CRT-0046 (backlog).
