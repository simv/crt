# Task format

The task file the intake session writes to `.crt/tasks/` — its frontmatter, its seven sections and the bar it holds itself to. The front page shows the loop that produces it: [README › The loop](../README.md#the-loop).

Tasks live at `.crt/tasks/CRT-NNNN-<slug>.md` (the ID is allocated by scanning the folder for the highest one, so there is no counter file to conflict on), with a generated `.crt/tasks/README.md` index that the server and `crt tasks` rewrite whenever a task changes. Commit `.crt/`; only `.crt/captures/` and `.crt/config.local.json` are ignored.

```markdown
---
id: CRT-0007
title: Cart total excludes applied discount
status: backlog            # backlog | in_progress | review | done | blocked
priority: normal           # low | normal | high
created: 2026-09-14T10:32:00+08:00
updated: 2026-09-14T10:32:00+08:00
url: http://localhost:4400/cart?promo=SAVE10
route: /cart
session: 7a3d…             # intake session id — `claude --resume 7a3d…` continues it
provider: claude           # which agent ran the intake (absent in v0.1 files)
tags: [cart, pricing]
files: [src/components/Cart.tsx, src/lib/pricing.ts]
---

## Summary
One paragraph: what is wrong / wanted, in plain language.

## Context
What the page showed, how to reproduce (URL, state, steps), what component renders it, where the logic lives.

## Evidence
![viewport (annotated)](assets/CRT-0007/viewport-annotated.png)
![annotation 1](assets/CRT-0007/ann-1.png)
Annotation 1 — `<span class="cart-total">` in `CartSummary` (src/components/Cart.tsx:88), selector `#total`: "this total doesn't include the discount"

## Ask
The change requested, precisely.

## Definition of Done
- [ ] Checkable item 1
- [ ] Checkable item 2
- [ ] Existing tests pass; new test covers the fix

## Notes
Constraints, hunches, non-goals, alternatives considered during intake.

## Log
- 2026-09-14T10:32+08:00 — created by intake session 7a3d… (claude) from capture 20260914-103200-ab12.
```

The seven sections are fixed and in this order. The **Log** is append-only: every status change, work session and verification result is a new bullet with a timestamp and the session that wrote it. A task is workable cold when a session that has never seen the page can start from the file alone — that is the bar intake holds itself to. `crt task CRT-0007 --validate` checks a file against the format; `crt tasks --json` is what the skills read.
