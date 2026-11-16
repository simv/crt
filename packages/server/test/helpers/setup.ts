// PRD-zero N-34: a test never touches the developer's real `~/.crt`. Every Vitest worker gets a
// CRT home of its own under the OS temp dir; `crtHome()` refuses to fall back to the real one under
// Vitest, so a test that forgets cannot write there. Rows that care about the home's content make
// their own directory and pass `CRT_HOME` (or an `env`) explicitly.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CRT_HOME = mkdtempSync(join(tmpdir(), "crt-home-"));
