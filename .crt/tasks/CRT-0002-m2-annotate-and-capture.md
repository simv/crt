---
id: CRT-0002
title: M2 — Annotation tools and capture engine
status: backlog
priority: high
created: 2026-09-14T20:50:00+08:00
updated: 2026-09-14T20:50:00+08:00
url: null
route: null
session: null
tags: [m2, overlay, capture]
files: [packages/overlay/src/index.ts, packages/server/src/cli.ts]
---

## Summary
Build the in-page markup experience: Select / Box / Pin tools with numbered notes, and the capture engine that freezes screenshots, element details, component chain, console errors and page metadata into `.crt/captures/<id>/`.

## Context
PRD §6.2 (F-7…F-13) and §6.3 (F-15…F-23), milestone M2. Depends on CRT-0001 (proxy serving the overlay and a `/__crt/` API). The overlay is framework-free TypeScript inside Shadow DOM; the server exposes `POST /__crt/captures` that writes the JSON and PNGs. Screenshots use DOM rasterisation (`html-to-image` or `modern-screenshot`) — evaluate both for fidelity on the trial Next.js app and pick one; document the choice in the Log.

## Evidence
None — greenfield task from the PRD.

## Ask
1. Launcher (F-7): draggable corner button, `Ctrl/Cmd+Shift+.` toggles the toolbar; toolbar has Select, Box, Pin, Clear, Send, and a count badge.
2. Select (F-8): hover outline + label (tag, id/classes, component name); click pins; `↑`/`↓` walk parent/first child; `Esc` cancels.
3. Box (F-9): drag rectangle; record intersecting elements (top 10 by area).
4. Pin (F-10): point annotation with no element.
5. Notes and numbering (F-11): each annotation gets a number badge and an inline note field; delete individually; annotations persist across SPA navigation (F-12) and, as a Should, across reloads via `sessionStorage`.
6. Capture engine (F-15…F-20, F-22): implement `capture(): Promise<CaptureBundle>` producing the schema in `packages/server/src/capture-schema.ts` (define it with a JSON-schema-like TS type and a runtime validator). Include React fiber walk for component chain and `_debugSource`, Vue fallback, console/error hooks installed at overlay load, framework detection.
7. Send (F-13): POST the bundle plus PNGs (multipart or base64) to `/__crt/captures`; server writes `.crt/captures/<capture-id>/capture.json`, `viewport.png`, `viewport-annotated.png`, `ann-<n>.png`; prunes captures older than 7 days on start (F-23). For M2 the UI simply shows the capture path; the chat panel arrives in M3.
8. e2e: Playwright drives the fixture page through the proxy, places one Select and one Box annotation via the overlay's `window.__crt` test hooks, sends, and asserts the written `capture.json` validates and PNGs exist. Unit-test the selector generator and the fiber walk against a small React 18 fixture rendered with `react-dom` in jsdom or a Playwright page.

## Definition of Done
- [ ] All Must items F-7…F-13 and F-15…F-20, F-23 implemented and referenced in tests or the Log.
- [ ] `npm run check` and `npm run e2e` pass locally and in CI.
- [ ] Manual on the trial Next.js app: selecting a component-rendered element records the React component chain and a source file; console errors thrown before Send appear in the bundle; screenshots are recognisable.
- [ ] Overlay bundle ≤ 150 KB gzipped (N-3); measured size recorded in the Log.
- [ ] `capture-schema.ts` documents every field with the F-id that requires it.

## Notes
Do not start the chat panel here; keep the M3 boundary clean so the SDK work is isolated.

## Log
- 2026-09-14T20:50+08:00 — created from PRD milestone M2 during project setup.
