// SessionStart hook (PRD F-41): if this project has CRT tasks in backlog, add one line of context.
// Reads nothing but .crt/tasks/*.md frontmatter; prints nothing when there is nothing to say.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), ".crt", "tasks");
if (existsSync(dir)) {
  let backlog = 0;
  let total = 0;
  for (const f of readdirSync(dir)) {
    if (!/^CRT-\d{4}-.*\.md$/.test(f)) continue;
    total++;
    const head = readFileSync(join(dir, f), "utf8").slice(0, 2000);
    if (/^status:\s*backlog\s*$/m.test(head)) backlog++;
  }
  if (backlog > 0) {
    process.stdout.write(
      `CRT: ${backlog} of ${total} tasks in backlog under .crt/tasks. Run /crt:next to work the next one, /crt:tasks to list.\n`,
    );
  }
}
