// SessionStart hook (PRD F-41; PRD-setup F-84): if this project has CRT tasks in backlog, add one
// line of context, and if the project's installed claude-review-tool is a different major.minor
// than this plugin, add one drift line. Reads nothing but .crt/tasks/*.md frontmatter, this
// plugin's plugin.json and <project>/node_modules/claude-review-tool/package.json (local files
// only, never npm — N-16); prints nothing when there is nothing to say, and never fails the
// session start: any error (unreadable dir, odd file, missing project) is swallowed.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function backlogLine(projectDir) {
  const dir = join(projectDir, ".crt", "tasks");
  let backlog = 0;
  let total = 0;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return null; // no .crt/tasks here — CRT is not set up in this project
  }
  for (const f of names) {
    if (!/^CRT-\d{4}-.*\.md$/.test(f)) continue;
    let head;
    try {
      head = readFileSync(join(dir, f), "utf8").slice(0, 2000);
    } catch {
      continue;
    }
    total++;
    if (/^status:\s*backlog\s*$/m.test(head)) backlog++;
  }
  if (backlog === 0) return null;
  return `CRT: ${backlog} of ${total} tasks in backlog under .crt/tasks. Run /crt:next to work the next one, /crt:tasks to list.`;
}

/** `version` of a package.json / plugin.json, or null when the file is missing or odd. */
function readVersion(file) {
  try {
    const v = JSON.parse(readFileSync(file, "utf8")).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** `0.3.1` → `0.3`; null for anything that does not start with two numbers. */
function majorMinor(version) {
  const m = /^(\d+)\.(\d+)/.exec(version ?? "");
  return m ? `${m[1]}.${m[2]}` : null;
}

/**
 * F-84: one line when the plugin's major.minor differs from the project's installed
 * claude-review-tool; silent when either file is missing or the versions agree.
 */
export function driftLine(projectDir, pluginVersion) {
  const installed = readVersion(join(projectDir, "node_modules", "claude-review-tool", "package.json"));
  const ours = majorMinor(pluginVersion);
  const theirs = majorMinor(installed);
  if (!ours || !theirs || ours === theirs) return null;
  return `CRT: plugin ${pluginVersion} but the project's claude-review-tool is ${installed} — npm update claude-review-tool (or crt setup after updating)`;
}

/** This plugin's version, from ../.claude-plugin/plugin.json next to this file. */
export function pluginVersion() {
  return readVersion(join(dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json"));
}

// Only act when run as the hook itself (not when imported by a test).
if (process.argv[1] && /session-start\.mjs$/.test(process.argv[1])) {
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    for (const line of [backlogLine(projectDir), driftLine(projectDir, pluginVersion())]) {
      if (line) process.stdout.write(`${line}\n`);
    }
  } catch {
    // never block or fail a session start over a hint
  }
  process.exitCode = 0;
}
