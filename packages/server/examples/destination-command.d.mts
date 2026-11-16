import type { Destination } from "../src/destinations/api.js";

export const destination: Destination;
export default destination;
/** What the command printed last: `{"id": …, "url": …}`, a bare URL, or nothing. */
export function parseAnswer(stdout: string, fallbackId: string): { id: string; url?: string };
