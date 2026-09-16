# Security

CRT is a local development tool: it binds to `127.0.0.1` only, writes only under `.crt/` in your project, and sends nothing off the machine except the model calls the coding agent you chose already makes (PRD N-4, N-12).

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting for this repository:

https://github.com/simv/crt/security/advisories/new

You will get a reply within a week. Fixes ship as a new `claude-review-tool` release on npm and a GitHub Release.

## Supported versions

Only the latest published version of `claude-review-tool` receives fixes.
