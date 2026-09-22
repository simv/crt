---
id: CRT-0029
title: Screenshots of a better-looking page (the trial shop ported into the e2e fixture as /shop) at an 800 × 600 viewport
status: in_progress
priority: high
created: 2026-09-22T13:30:00+08:00
updated: 2026-09-22T13:32:00+08:00
url: null
route: null
session: null
tags: [screenshots, fixture, docs, f-116, n-27, prd-polish]
files: [packages/server/e2e/fixture/server.mjs, packages/server/e2e/screenshots.spec.ts, packages/server/playwright.screenshots.config.ts, packages/server/test/docs-images.test.ts, docs/images/README.md, docs/images/arrival.png, docs/images/select.png, docs/images/chat.png, docs/images/marker-states.png, docs/images/landing.png, docs/PRD-polish.md, CLAUDE.md, README.md]
---

## Summary
The five README/docs screenshots (M22, F-116) show the e2e fixture's `/app` playground — a bare page with two grey cards — which looks rough next to the product. Simon's trial app (`tool-validation`, a small Next.js shop: header, three product cards with gradient thumbs, a cart with an applied promo and its deliberate total bug, an actions row) looks much better; he asked for the screenshots to be of that instead, and at an 800 × 600 viewport so everything is tighter. Port the trial shop's page into the e2e fixture as `/shop` (same markup and CSS, rendered with the fixture's React 18 dev build so the Select label shows the component name as it does on the real app), point `npm run screenshots` at it, pin the viewport to 800 × 600 (1600 × 1200 at DPR 2), regenerate the five PNGs, and amend the places that state the size and the page.

## Context
Simon, 2026-09-22, after CRT-0027 merged: "the fixture app you used in the examples is pretty rough looking. the site you made as the 'tool-validation' site was much better, i suggest using screenshots of that instead. i would like the screenshots to be done on a 800x600 viewport so everything is a little tighter." The trial app is `C:\Projects\Claude\tool-validation` (`app/page.tsx`, `components/{Header,Shop,ProductCard,CartSummary}.tsx`, `lib/catalog.ts`, `app/globals.css` — 178 lines of CSS, no data fetching): "A small shop, for pointing at things" with the mug / dot-grid notebook (on sale, $9 was $12) / brass pen cards, the cart holding one notebook with `SAVE10` applied and a total that ignores the discount (`CartSummary.tsx`, the deliberate bug), Promo code / Apply / Checkout / Explode / Empty cart. F-116 and N-27 make `npm run screenshots` reproducible from a clean checkout of this repo — the fixture (`packages/server/e2e/fixture/server.mjs`) lives here, the trial app does not — so the page is ported into the fixture rather than screenshotted in place. The size is pinned in `docs/PRD-polish.md` §5.3 ("1280 × 800 CSS px at DPR 2"), `docs/images/README.md`, `CLAUDE.md` (Commands › `npm run screenshots`), `packages/server/playwright.screenshots.config.ts` (`viewport`) and `packages/server/test/docs-images.test.ts` (`{ width: 2560, height: 1600 }`). The spec (`e2e/screenshots.spec.ts`) drives the overlay through `window.__crt` against `/app`'s selectors (`[data-testid=card-1] .price`, `[data-testid=card-2] .price`, `#heading`); the e2e specs and `test/proxy.test.ts` use the fixture's existing routes, which stay untouched.

## Evidence
No page capture: filed from Simon's request in the CRT-0027 session (936b2ea5-3c24-425e-8a23-a38fb72af5a1). The current images: `docs/images/{arrival,select,chat,marker-states,landing}.png` on `main` at 2f164f7.

## Ask
1. **Fixture `/shop`** in `packages/server/e2e/fixture/server.mjs`: the trial shop's home page — header (`Tool Validation Shop`, Shop / About), `h1#heading` "A small shop, for pointing at things", the muted paragraph, the Products grid with the three cards from `lib/catalog.ts` (`data-testid="card-<id>"`, `.thumb`, `.price` / `.price.sale` + `.was`, Add to cart), the cart summary with the `SAVE10 applied` badge, the lines, Subtotal / Discount / Total (`data-testid="cart-total"`, the total ignoring the discount, as in the trial app), the actions row, the status line, the footer — its CSS inline, verbatim from `app/globals.css`; rendered with the fixture's UMD React 18 dev build (the `/react` pattern: `createElement` with `__source`) so `Header`, `Shop`, `ProductCard`, `CartSummary` are real components and the overlay's hover label reads the component name. Same loader-tag handling as the other pages (`withLoader`), `window.__fixture = "shop"`, a line in the Routes comment. No existing route changes.
2. **`npm run screenshots`** at 800 × 600: `playwright.screenshots.config.ts` `viewport: { width: 800, height: 600 }`; `screenshots.spec.ts` opens `/shop`, pins and hovers the shop's elements (the heading, the mug price, the notebook's sale price — all above the fold at 600 px), the notes rewritten for the shop, the hover-label assertion carrying the component name; everything else (fixed clock, seeded tasks, waits on the overlay's signals, `animations: "disabled"`) unchanged. Regenerate the five PNGs and commit them.
3. **The pinned size and page**: `docs/PRD-polish.md` §5.3 (800 × 600, the `/shop` page, a dated note that Simon asked for it), `docs/images/README.md` (sizes, the page, what varies), `CLAUDE.md`'s `npm run screenshots` line, `test/docs-images.test.ts` (1600 × 1200 and its comment); the README's alt texts where they describe the fixture.

## Definition of Done
- [ ] `GET /shop` on the fixture renders the trial shop's page (header, three cards, the cart with `SAVE10 applied` and a total that ignores the discount, the actions row) with the trial app's CSS, as React components; the existing fixture routes are byte-for-byte unchanged (`npm run e2e` green).
- [ ] `npm run screenshots` writes the five PNGs at 1600 × 1200 (800 × 600 at DPR 2), each ≤ 400 KB, from `/shop`; `select.png`'s hover label shows the component name; `test/docs-images.test.ts` green with the new size.
- [ ] `docs/PRD-polish.md` §5.3, `docs/images/README.md`, `CLAUDE.md` and `test/docs-images.test.ts` agree on 800 × 600 / 1600 × 1200 and name the shop page; `npm run check` green.
- [ ] Manual: the five new images looked at (composition at 800 × 600: the pill and the welcome card, the marker and its popover, the chat, the three markers, the landing page) and the README on the branch re-rendered — a screenshot in the Log. Run by the worker session (standing rule 2026-09-18).

## Notes
The trial app itself is not touched and not screenshotted: the fixture carries a copy of its page so F-116/N-27 hold (a reviewer regenerates from this repo alone). The 800 × 600 viewport is what Simon asked for; DPR stays 2. The PRD change is an amendment of §5.3's constants, not of F-116/N-27's guarantee. The GitHub render screenshots under `.crt/tasks/assets/CRT-0027/` show the old images and stay as CRT-0027's evidence.

## Log
- 2026-09-22T13:30+08:00 — filed by the CRT-0027 session (936b2ea5-3c24-425e-8a23-a38fb72af5a1) from Simon's request after PR #74 merged.
- 2026-09-22T13:32+08:00 — claimed by session 936b2ea5-3c24-425e-8a23-a38fb72af5a1, branch crt/CRT-0029-shop-fixture-screenshots-800x600
