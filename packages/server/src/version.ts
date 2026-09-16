/**
 * This package's version, read from the local `package.json` (PRD-setup F-69 `crt --version`,
 * F-78 health `version`, N-16: never a registry lookup). `src/` and `dist/` both sit one level
 * below it, so the same relative path works for tests and the published bin.
 */
import { readFileSync } from "node:fs";

let cached: string | null = null;

export function packageVersion(): string {
  if (cached === null) {
    try {
      cached = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "0.0.0";
    } catch {
      cached = "0.0.0";
    }
  }
  return cached;
}
