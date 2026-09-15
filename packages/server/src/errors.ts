/**
 * CrtError: a user-facing failure with a single actionable line (PRD N-6).
 * The CLI prints `crt: <message>` to stderr and exits with `exitCode`.
 */
export class CrtError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CrtError";
    this.exitCode = exitCode;
  }
}
