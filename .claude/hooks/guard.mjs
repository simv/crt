// PreToolUse hook on Edit|Write: enforce three CLAUDE.md / PRD invariants before a file is touched.
//   1. Generated files are regenerated, never edited (.crt/tasks/README.md is the F-34 index).
//   2. Product scripts (packages/*/src, plugin/) import the Agent SDK only in
//      packages/server/src/providers/claude.ts (PRD §12, PRD-providers F-63); comments, docs and
//      tests may name the package.
//   3. Files are LF-only (.editorconfig; CLAUDE.md "write files with \n").
// Reads the hook JSON from stdin. Exit 2 blocks the tool call and feeds stderr back to Claude;
// anything else (bad JSON, no file_path) exits 0 so a broken hook can never block real work.
import { isAbsolute, relative, resolve, sep } from "node:path";

const GENERATED = [
  [/^\.crt\/tasks\/README\.md$/, "the F-34 task index — run `crt tasks` to regenerate it"],
  [/^package-lock\.json$/, "the npm lockfile — change it with `npm install`, not by hand"],
  [/^packages\/server\/dist\//, "build output — run `npm run build`"],
];
// An actual import of the SDK (static, dynamic or require) — not a mention in a comment or doc.
const SDK_IMPORT = /\b(?:from|import|require)\s*\(?\s*["']@anthropic-ai\/claude-agent-sdk["']/;
const SDK_HOME = "packages/server/src/providers/claude.ts";
// Product scripts only: tests and e2e fixtures may mock or quote the import.
const SDK_SCOPE = /^(?:packages\/[^/]+\/src\/|plugin\/).*\.[cm]?[jt]sx?$/;

/** Returns a reason to block, or null. `input` is the parsed PreToolUse JSON. */
export function check(input, projectDir) {
  const t = input?.tool_input;
  if (!t || typeof t.file_path !== "string") return null;
  const root = projectDir || input.cwd || process.cwd();
  const abs = isAbsolute(t.file_path) ? t.file_path : resolve(root, t.file_path);
  const file = relative(root, abs).split(sep).join("/");
  if (file.startsWith("../")) return null; // outside the project: not ours to police
  const text = typeof t.content === "string" ? t.content : typeof t.new_string === "string" ? t.new_string : "";

  for (const [re, what] of GENERATED) {
    if (re.test(file)) return `${file} is ${what}.`;
  }
  if (SDK_SCOPE.test(file) && file !== SDK_HOME && SDK_IMPORT.test(text)) {
    return `Agent SDK imports live only in ${SDK_HOME} (CLAUDE.md, PRD §12) — not in ${file}.`;
  }
  if (text.includes("\r\n")) {
    return `CRLF in the new content for ${file} — this repo is LF-only (.editorconfig, CLAUDE.md).`;
  }
  return null;
}

// Only act when run as the hook itself (not when imported by a test).
if (process.argv[1] && /guard\.mjs$/.test(process.argv[1])) {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let reason = null;
  try {
    reason = check(JSON.parse(raw), process.env.CLAUDE_PROJECT_DIR);
  } catch {
    // unreadable input: never block on a hook bug
  }
  if (reason) {
    process.stderr.write(`${reason}\n`);
    process.exit(2);
  }
  process.exitCode = 0;
}
