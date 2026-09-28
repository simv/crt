/**
 * The framework snippet (PRD-embedded F-102, §4): which of the four integrations an app takes —
 * detected from the root `package.json` (dependency names only, no recursion) — and the first
 * existing candidate file it goes in. `crt init` prints it (`--snippet [--json]` alone), `/crt:init`
 * applies it, and `crt doctor`'s `integration` row reads only the candidate files. Never opens an
 * app file here.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "./config.js";

export type Framework = "next" | "vite" | "react" | "bundled" | "static";

export interface Integration {
  framework: Framework;
  /** The file the snippet goes in, relative with `/`; null when no candidate exists (or the page has no bundler). */
  file: string | null;
  /** The §4 snippet text, verbatim. */
  snippet: string;
  import: string;
  usage: string;
}

/** F-102: the files checked per framework, in order; the first that exists is `file`. The doctor's `integration` row reads only these. */
export const INTEGRATION_CANDIDATES: Record<Framework, readonly string[]> = {
  next: ["app/layout.tsx", "src/app/layout.tsx", "app/layout.jsx", "src/app/layout.jsx", "app/layout.js", "src/app/layout.js"],
  vite: ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"],
  react: ["src/main.tsx", "src/index.tsx", "src/main.jsx", "src/index.jsx", "src/main.ts", "src/index.ts"],
  bundled: ["src/main.tsx", "src/index.tsx", "src/main.jsx", "src/index.jsx", "src/main.ts", "src/index.ts"],
  static: [],
};

/** What to call the file when none of the candidates exists (the §4 comment headers). */
export const INTEGRATION_PLACEHOLDER: Record<Framework, string> = {
  next: "your root layout",
  vite: "vite.config.ts",
  react: "your client entry",
  bundled: "your client entry",
  static: "the development page only (no bundler)",
};

export const SCRIPT_TAG = '<script src="http://localhost:4400/__crt/loader.js"></script>';

/** PRD-embedded §4: the four snippets, verbatim (`next` keeps its `…` line; `react` and `bundled` share the loader form). */
const SNIPPETS: Record<Framework, { import: string; usage: string; snippet: string }> = {
  next: {
    import: 'import { CrtDevTools } from "claude-review-tool/react";',
    usage: "<body>{children}<CrtDevTools /></body>",
    snippet: 'import { CrtDevTools } from "claude-review-tool/react";\n…\n<body>{children}<CrtDevTools /></body>',
  },
  vite: {
    import: 'import { crt } from "claude-review-tool/vite";',
    usage: "export default defineConfig({ plugins: [react(), crt()] });",
    snippet: 'import { crt } from "claude-review-tool/vite";\nexport default defineConfig({ plugins: [react(), crt()] });',
  },
  react: {
    import: 'import { mountCrt } from "claude-review-tool/loader";',
    usage: 'if (process.env.NODE_ENV !== "production") mountCrt();',
    snippet: 'import { mountCrt } from "claude-review-tool/loader";\nif (process.env.NODE_ENV !== "production") mountCrt();   // the guard is optional (F-98); it lets the bundler drop the import',
  },
  bundled: {
    import: 'import { mountCrt } from "claude-review-tool/loader";',
    usage: 'if (process.env.NODE_ENV !== "production") mountCrt();',
    snippet: 'import { mountCrt } from "claude-review-tool/loader";\nif (process.env.NODE_ENV !== "production") mountCrt();   // the guard is optional (F-98); it lets the bundler drop the import',
  },
  static: { import: SCRIPT_TAG, usage: SCRIPT_TAG, snippet: SCRIPT_TAG },
};

/**
 * F-102: detect the framework from the root `package.json` (dependency names only, no recursion)
 * and the first existing candidate file. Never opens an app file.
 */
export function detectIntegration(root: string): Integration {
  const pkg = readJson(join(root, "package.json"));
  const framework = frameworkOf(pkg);
  const file = INTEGRATION_CANDIDATES[framework].find((f) => existsSync(join(root, ...f.split("/")))) ?? null;
  return { framework, file, ...SNIPPETS[framework] };
}

function frameworkOf(pkg: Record<string, unknown> | null): Framework {
  if (!pkg) return "static";
  const names = new Set<string>();
  for (const key of ["dependencies", "devDependencies"]) {
    const deps = pkg[key];
    if (deps && typeof deps === "object") for (const name of Object.keys(deps as object)) names.add(name);
  }
  if (names.has("next")) return "next";
  if (names.has("vite")) return "vite";
  if (names.has("react") || names.has("react-dom")) return "react";
  const scripts = pkg.scripts;
  if (scripts && typeof scripts === "object" && (typeof (scripts as Record<string, unknown>).dev === "string" || typeof (scripts as Record<string, unknown>).start === "string")) return "bundled";
  // A package.json with neither a framework nor a dev/start script gives no bundler to hook: the script tag.
  return "static";
}

/** The human form `crt init` ends with (F-102). */
export function renderSnippet(i: Integration): string[] {
  return [
    "Add CRT to your app (development only):",
    `  ${i.file ?? INTEGRATION_PLACEHOLDER[i.framework]}`,
    ...i.snippet.split("\n").map((l) => `    ${l}`),
    "Production builds contain nothing from CRT (docs/integration.md › Production). /crt:init in Claude Code applies this for you.",
  ];
}
