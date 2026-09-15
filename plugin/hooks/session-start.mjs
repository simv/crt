// SessionStart hook (PRD F-41): if this project has CRT tasks in backlog, add one line of context.
// Reads nothing but .crt/tasks/*.md frontmatter; prints nothing when there is nothing to say, and
// never fails the session start: any error (unreadable dir, odd file, missing project) is swallowed.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

// Only act when run as the hook itself (not when imported by a test).
if (process.argv[1] && /session-start\.mjs$/.test(process.argv[1])) {
  try {
    const line = backlogLine(process.env.CLAUDE_PROJECT_DIR || process.cwd());
    if (line) process.stdout.write(`${line}\n`);
  } catch {
    // never block or fail a session start over a hint
  }
  process.exitCode = 0;
}
