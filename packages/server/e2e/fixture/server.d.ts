export interface Fixture {
  port: number;
  url: string;
  close(): Promise<void>;
}
export function startFixture(opts?: { port?: number }): Promise<Fixture>;
export function readFrame(buf: Buffer): { opcode: number; payload: Buffer; size: number } | null;
export function encodeFrame(opcode: number, payload: Buffer, mask?: Buffer | null): Buffer;
