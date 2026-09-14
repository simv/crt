/**
 * `crt init` (PRD F-35): make a project CRT-ready, idempotently.
 * Creates `.crt/tasks/`, writes `.crt/config.json` if absent, and adds `.crt/captures/`
 * to `.gitignore` (creating it if needed). `crt serve` runs this first.
 * The `.gitignore` line is the only write outside `.crt/` the server ever makes (N-5).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_PORT = 4400;
export const CAPTURES_IGNORE = ".crt/captures/";

export interface CrtConfig {
  tasksDir: string;
  target: string | null;
  port: number;
}

export const DEFAULT_CONFIG: CrtConfig = { tasksDir: ".crt/tasks", target: null, port: DEFAULT_PORT };

export interface InitResult {
  crtDir: string;
  tasksDir: string;
  configPath: string;
  /** Paths this run created or modified; empty when everything was already in place. */
  created: string[];
}

export function initProject(root: string): InitResult {
  const crtDir = join(root, ".crt");
  const tasksDir = join(crtDir, "tasks");
  const configPath = join(crtDir, "config.json");
  const gitignorePath = join(root, ".gitignore");
  const created: string[] = [];

  if (!existsSync(tasksDir)) {
    mkdirSync(tasksDir, { recursive: true });
    created.push(tasksDir);
  }
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf8");
    created.push(configPath);
  }
  const ignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  if (!ignore.split(/\r?\n/).some(isCapturesIgnore)) {
    const sep = ignore === "" || ignore.endsWith("\n") ? "" : "\n";
    writeFileSync(gitignorePath, `${ignore}${sep}${CAPTURES_IGNORE}\n`, "utf8");
    created.push(gitignorePath);
  }
  return { crtDir, tasksDir, configPath, created };
}

function isCapturesIgnore(line: string): boolean {
  const t = line.trim().replace(/^\//, "");
  return t === ".crt/captures/" || t === ".crt/captures" || t === ".crt/" || t === ".crt";
}

/** Read `.crt/config.json`, tolerating absence or malformed content (defaults win). */
export function readConfig(root: string): CrtConfig {
  try {
    const raw = JSON.parse(readFileSync(join(root, ".crt", "config.json"), "utf8")) as Partial<CrtConfig>;
    return {
      tasksDir: typeof raw.tasksDir === "string" ? raw.tasksDir : DEFAULT_CONFIG.tasksDir,
      target: typeof raw.target === "string" && raw.target ? raw.target : null,
      port: typeof raw.port === "number" && Number.isInteger(raw.port) && raw.port > 0 ? raw.port : DEFAULT_PORT,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
