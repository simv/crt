---
id: CRT-0001
title: Cart total excludes applied discount
status: backlog
priority: normal
created: 2026-09-15T10:32:00+08:00
updated: 2026-09-15T10:32:00+08:00
url: "http://localhost:4400/cart?promo=SAVE10#top"
route: /cart
session: 7a3d0000-0000-4000-8000-000000000000
tags: [cart, pricing]
files: [src/components/Cart.tsx]
---

## Summary
The cart total ignores the SAVE10 promo that the page shows as applied.

## Context
Reproduce: open /cart?promo=SAVE10. `CartSummary` (src/components/Cart.tsx:88) renders `subtotal` instead of `total`.

## Evidence
![viewport (annotated)](assets/CRT-0001/viewport-annotated.png)
![annotation 1](assets/CRT-0001/ann-1.png)
![annotation 2](assets/CRT-0001/ann-2.png)

Annotation 1 — `<span id="total" class="cart-total">` in `CartSummary` (src/components/Cart.tsx:88), selector `#total`: "total excludes discount"
Annotation 2 — pin at (300, 400): "missing a coupon field here"

Capture bundle: `assets/CRT-0001/capture.json` (page http://localhost:4400/cart?promo=SAVE10#top, 1280×720 @ 2x, 2026-09-15T00:00:00.000Z).
Console at send time: 1 entries (1 errors) — see capture.json.
Failed requests at send time: 1 (first: GET /api/cart/promo → 500) — see capture.json.

## Ask
Render the discounted total and cover it with a unit test.

## Definition of Done
- [ ] Cart total applies the promo discount
- [ ] Unit test covers the discounted total

## Notes
Golden fixture; nothing was read from disk.

## Log
- 2026-09-15T10:32+08:00 — created by intake session 7a3d0000-0000-4000-8000-000000000000 from capture 20260915-103200-g01d.
