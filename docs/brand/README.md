# The CRT mark

1. **Where:** `crt-lockup.svg` / `crt-lockup-dark.svg` in the README hero (a `<picture>` on `prefers-color-scheme`) and the npm README; `crt-mark.svg` / `-dark` in the landing page header; `favicon.svg` at `/__crt/favicon.svg` (its own dark-mode rule; `favicon-32.png` / `favicon-16.png` for browsers that ignore SVG favicons).
2. **Size:** the mark alone below 24 px (`crt-mark-small.svg` — a solid tube and a plain dot), the lockup at 24 px and above; the numeral only survives at 48 px and up.
3. **Minimum:** 16 px — the small mark's coordinates are whole pixels for exactly that.
4. **Clear space:** one bezel width (8 units of the 128 grid, 1/16 of the mark's height) on every side.
5. **Colour:** ink `#111` on light, bezel `#f2f2f4` on dark, the glass `#2b2b31` on both — the two variants and nothing else; never recolour, never a one-colour version.
6. **Accent:** `#ff3d71` appears once, in the badge, and never as the screen fill.
7. **Never** rotate, skew, add a glass highlight or an outline, or put the mark inside the overlay's launcher pill (it stays `CRT` + dot, PRD-polish §13).
8. **Geometry:** a 4:3 superellipse (|x/a|⁴ + |y/b|⁴ = 1) drawn as four cubic Béziers; the badge sits on the curve's corner with a 2-unit transparent ring so it separates from the bezel on any background.
9. **Tokens:** the values above are `INK`, `BEZEL_DARK`, `GLASS` and `ACCENT` in `packages/overlay/src/tokens.ts`; `packages/server/test/brand.test.ts` pins the files to them and to their size budgets (≤ 4 KB, favicon ≤ 2 KB).
10. **Record:** the five directions considered are in `options/` (regenerate with `node gen-logo.mjs`; the committed `contact-sheet.html` carries a hand-added Final row rendered in `renders/`), the ranking and the fixes in `../design/design-review-2026-09-21.md` §A, the decision in `../PRD-polish.md` §13.
