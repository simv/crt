/**
 * Minimal argv parser: first positional is the command, `--k v` / `--k=v` / `--flag` become flags.
 * Switches that never take a value are listed so `crt --yes 3000` keeps `3000` as the target (F-69).
 */
export const BOOLEAN_FLAGS = new Set(["open", "no-open", "yes", "replace", "json", "refresh", "validate", "global", "help", "h", "version"]);

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const name = a.slice(2);
        const next = argv[i + 1];
        if (!BOOLEAN_FLAGS.has(name) && next !== undefined && !next.startsWith("--")) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positionals.push(a);
    }
  }
  return { command: positionals[0], positionals: positionals.slice(1), flags };
}
