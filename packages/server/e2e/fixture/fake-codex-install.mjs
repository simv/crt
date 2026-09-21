// Installs a fake CLI into a scratch bin directory the way npm would (PRD-providers F-61, N-10;
// PRD-setup F-90): on Windows an npm-shaped `<name>.cmd` (and sh `<name>`) shim pointing at
// `node_modules/<pkg>/bin/<name>.js`, so `exec.ts`'s shim parser is exercised; elsewhere an
// executable `<name>` script with a node shebang. `installFakeCodex` (fake-codex.mjs) is used by
// test/providers/codex.test.ts and by e2e/fixture/crt.mjs, which prepends the directory to PATH
// before `crt serve` preflights; `installFakeClaude` (fake-claude.mjs) by test/setup.test.ts;
// `installFakeGemini` (fake-acp.mjs as `gemini`) by test/providers/acp.test.ts (PRD-providers F-54).
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The JS entry every layout runs: a CommonJS stub that hands argv to the fake's `main`. */
const entryFor = (fake) => `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(fake).href)}).then((m) => m.main(process.argv.slice(2))).then((code) => { process.exitCode = code; });\n`;

/**
 * Lay `fake` out under `bin` as the command `name` of npm package `pkg` (path segments) for
 * `platform` (default: this one) and return the directory to prepend to PATH. On Windows the entry
 * is `bin/node_modules/<pkg>/bin/<name>.js` behind `bin/<name>.cmd`; on POSIX it is `bin/<name>` itself.
 */
export function installFakeBin(bin, { name, pkg, fake }, platform = process.platform) {
  mkdirSync(bin, { recursive: true });
  // The entry is CommonJS-shaped (a bare `import()`), whatever `"type"` the enclosing package declares.
  writeFileSync(join(bin, "package.json"), '{ "type": "commonjs" }\n');
  const ENTRY = entryFor(fake);
  if (platform === "win32") {
    const rel = ["node_modules", ...pkg, "bin", `${name}.js`];
    const entry = join(bin, ...rel);
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, ENTRY);
    // Byte-for-byte the shape npm 10 writes (the `%dp0%` path is what exec.ts parses).
    writeFileSync(join(bin, `${name}.cmd`), `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${rel.join("\\")}" %*\r\n`);
    writeFileSync(join(bin, name), `#!/bin/sh\nbasedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")\n\ncase \`uname\` in\n    *CYGWIN*|*MINGW*|*MSYS*)\n        if command -v cygpath > /dev/null 2>&1; then\n            basedir=\`cygpath -w "$basedir"\`\n        fi\n    ;;\nesac\n\nif [ -x "$basedir/node" ]; then\n  exec "$basedir/node"  "$basedir/${rel.join("/")}" "$@"\nelse \n  exec node  "$basedir/${rel.join("/")}" "$@"\nfi\n`);
    return bin;
  }
  const script = join(bin, name);
  writeFileSync(script, ENTRY);
  chmodSync(script, 0o755);
  return bin;
}

/** The fake Codex CLI (fake-codex.mjs) as `codex` from `@openai/codex`. */
export function installFakeCodex(bin, platform = process.platform) {
  return installFakeBin(bin, { name: "codex", pkg: ["@openai", "codex"], fake: join(here, "fake-codex.mjs") }, platform);
}

/** The fake Claude Code CLI (fake-claude.mjs) as `claude` from `@anthropic-ai/claude-code` (PRD-setup F-86 tests). */
export function installFakeClaude(bin, platform = process.platform) {
  return installFakeBin(bin, { name: "claude", pkg: ["@anthropic-ai", "claude-code"], fake: join(here, "fake-claude.mjs") }, platform);
}

/** The fake ACP agent (fake-acp.mjs) as `gemini` from `@google/gemini-cli` (PRD-providers F-54, M10). */
export function installFakeGemini(bin, platform = process.platform) {
  return installFakeBin(bin, { name: "gemini", pkg: ["@google", "gemini-cli"], fake: join(here, "fake-acp.mjs") }, platform);
}
