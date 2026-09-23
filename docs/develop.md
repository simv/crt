# Develop

How to build, test and release CRT, the repository layout and the product requirements documents. The three-line version is on the front page: [README › Develop](../README.md#develop).

## Build and test

```bash
npm ci
npm run check   # typecheck, lint, unit tests, build
npm run e2e     # Playwright smoke: fixture app carrying the loader tag, a real embedded `crt serve` (and a `crt proxy` for the proxy spec); needs `npx playwright install chromium` once
```

Plugin changes: `claude plugin validate ./plugin` (and `.` for the marketplace, and `packages/server/dist/plugin-marketplace` after a build) must pass — CI runs all of them. To try a local skill edit before it is on `main`, run `claude --plugin-dir ./plugin` in the project you are testing against, or `crt setup` from a fresh profile (`CLAUDE_CONFIG_DIR=<empty dir>`) with `crt` npm-linked to this repo.

## Release

Release: re-run `npm run screenshots` when the overlay's UI changed since the last release (the PNGs in `docs/images/` are committed — [docs/images/README.md](images/README.md)), bump `version` in `packages/server/package.json`, both plugin manifests and the pinned `claude-review-tool@<major.minor>` in the seven skills (a unit test fails when they disagree), merge, then `git tag v<version> && git push origin v<version>`. The `release` workflow checks the tag matches the package version, runs `npm run check`, **stages** `claude-review-tool` on npm through trusted publishing (OIDC from this repository's `release.yml`; no token, provenance attested) and creates a GitHub Release with generated notes. The version goes live only when the maintainer promotes the staged version on npmjs.com (package → Versions) with 2FA — CI can stage a release but never ship one.

## Repository

| Path | What |
|---|---|
| `packages/server` | npm package `claude-review-tool` — the `crt` CLI, the CRT server (embedded and proxy modes), capture store, session manager, the `claude-review-tool/{react,vite,loader}` entries; its `dist/plugin-marketplace/` is the plugin as `crt setup` installs it |
| `packages/overlay` | in-page UI and the loader, bundled into the server |
| `plugin/` | the Claude Code plugin (skills + hooks); marketplace manifest at `.claude-plugin/marketplace.json` |
| `docs/` | the eight reference pages the README indexes, the product requirements documents (`PRD.md`, `PRD-providers.md`, `PRD-setup.md`, `PRD-embedded.md`, `PRD-polish.md` — below), the design review, the spikes, the brand files and the images |
| `.crt/tasks` | this repo's own work items, in CRT's task format |

## The PRDs

The requirement IDs (F-n, N-n) referenced in code comments, tests, commits and PRs come from these, in order; each later one amends the earlier ones in its §9:

- [PRD.md](PRD.md) — v1.0: the scope, the milestones M1–M5 and the project definition of done.
- [PRD-providers.md](PRD-providers.md) — v0.2: provider-agnostic intake (Codex, then Gemini CLI and any ACP agent, Antigravity CLI), F-42…F-64, N-7…N-13, M6–M11.
- [PRD-setup.md](PRD-setup.md) — v0.3: setup and first run (`crt [target]`, `crt doctor`, `crt setup`, login preflight, arrival UX), F-69…F-90, N-14…N-17, M12–M14.
- [PRD-embedded.md](PRD-embedded.md) — v0.4: embedded mode (the CRT server without a proxy by default, the loader and the package entries, explicit `crt init`, the production guarantee), F-91…F-110, N-18…N-22, M15–M18.
- [PRD-polish.md](PRD-polish.md) — v0.6: the brand mark, the landing page as a status page, the README as a front page with the reference under `docs/`, reproducible screenshots, release 0.6.0, F-112…F-118, N-23…N-27, M20–M24.
- [PRD-chat.md](PRD-chat.md) — v0.7: compact chat (the first bubble shows the developer's words, the agent's proposal folds to its restatement and item count, the full text one click away), the close-out in the PR, release 0.7.0, F-119…F-122, N-28…N-30, M25–M27.

Alongside them: the design review ([design/design-review-2026-09-21.md](design/design-review-2026-09-21.md)), the spikes under [spikes/](spikes/), the brand files under [brand/](brand/README.md) and the images under [images/](images/README.md).
