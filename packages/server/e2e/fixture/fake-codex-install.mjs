// Installs fake-codex.mjs into a scratch bin directory the way npm would (PRD-providers F-61,
// N-10): on Windows an npm-shaped `codex.cmd` (and sh `codex`) shim pointing at
// `node_modules/@openai/codex/bin/codex.js`, so `exec.ts`'s shim parser is exercised; elsewhere an
// executable `codex` script with a node shebang. Used by test/providers/codex.test.ts and by
// e2e/fixture/crt.mjs, which prepends the directory to PATH before `crt serve` preflights.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fake-codex.mjs");
/** The JS entry every layout runs: a CommonJS stub that hands argv to fake-codex.mjs. */
const ENTRY = `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(FAKE).href)}).then((m) => m.main(process.argv.slice(2))).then((code) => { process.exitCode = code; });\n`;

/**
 * Lay the fake out under `bin` for `platform` (default: this one) and return the directory to
 * prepend to PATH. On Windows the entry is `bin/node_modules/@openai/codex/bin/codex.js` behind
 * `bin/codex.cmd`; on POSIX it is `bin/codex` itself.
 */
export function installFakeCodex(bin, platform = process.platform) {
  mkdirSync(bin, { recursive: true });
  // The entry is CommonJS-shaped (a bare `import()`), whatever `"type"` the enclosing package declares.
  writeFileSync(join(bin, "package.json"), '{ "type": "commonjs" }\n');
  if (platform === "win32") {
    const rel = ["node_modules", "@openai", "codex", "bin", "codex.js"];
    const entry = join(bin, ...rel);
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, ENTRY);
    // Byte-for-byte the shape npm 10 writes (the `%dp0%` path is what exec.ts parses).
    writeFileSync(join(bin, "codex.cmd"), `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${rel.join("\\")}" %*\r\n`);
    writeFileSync(join(bin, "codex"), `#!/bin/sh\nbasedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")\n\ncase \`uname\` in\n    *CYGWIN*|*MINGW*|*MSYS*)\n        if command -v cygpath > /dev/null 2>&1; then\n            basedir=\`cygpath -w "$basedir"\`\n        fi\n    ;;\nesac\n\nif [ -x "$basedir/node" ]; then\n  exec "$basedir/node"  "$basedir/${rel.join("/")}" "$@"\nelse \n  exec node  "$basedir/${rel.join("/")}" "$@"\nfi\n`);
    return bin;
  }
  const script = join(bin, "codex");
  writeFileSync(script, ENTRY);
  chmodSync(script, 0o755);
  return bin;
}
