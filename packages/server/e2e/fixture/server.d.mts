export interface Fixture {
  port: number;
  url: string;
  close(): Promise<void>;
}
export function startFixture(opts?: { port?: number }): Promise<Fixture>;
export function readFrame(buf: Buffer): { opcode: number; payload: Buffer; size: number } | null;
export function encodeFrame(opcode: number, payload: Buffer, mask?: Buffer | null): Buffer;
/** The origin of a loopback http(s) URL (the F-6 list), else null — what the fixture writes into <script src>. */
export function loopbackOrigin(value: string | null | undefined): string | null;
/** A strict app's Content-Security-Policy: styles and images from 'self' or with a nonce only (CRT-0046). */
export const STRICT_STYLES_CSP: string;
