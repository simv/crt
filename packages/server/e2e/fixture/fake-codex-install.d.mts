/** Lay `fake` out under `bin` as the command `name` of npm package `pkg`; returns the directory to put on PATH. */
export function installFakeBin(bin: string, fake: { name: string; pkg: string[]; fake: string }, platform?: NodeJS.Platform): string;
/** The fake Codex CLI (fake-codex.mjs) as `codex` from `@openai/codex`. */
export function installFakeCodex(bin: string, platform?: NodeJS.Platform): string;
/** The fake Claude Code CLI (fake-claude.mjs) as `claude` from `@anthropic-ai/claude-code`. */
export function installFakeClaude(bin: string, platform?: NodeJS.Platform): string;
/** The fake ACP agent (fake-acp.mjs) as `gemini` from `@google/gemini-cli`. */
export function installFakeGemini(bin: string, platform?: NodeJS.Platform): string;
/** The fake Antigravity CLI (fake-agy.mjs) as `agy`. */
export function installFakeAgy(bin: string, platform?: NodeJS.Platform): string;
