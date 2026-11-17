/**
 * What the page's world told the probe, read as data (PRD-extension N-42). A page script can forge
 * any answer on the probe's wire (probe-wire.ts), so each one is checked against the capture
 * schema — the server's own (capture-schema.ts) — before the overlay uses it: a well-formed entry
 * is kept, anything else is dropped, and a capture is never refused by the server because of what
 * a page said.
 */
import {
  ComponentSchema,
  type ConsoleEntry,
  ConsoleEntrySchema,
  type FrameworkInfo,
  FrameworkSchema,
  type NetworkEntry,
  NetworkEntrySchema,
  type Schema,
  SourceSchema,
} from "../../../server/src/capture-schema.js";
import { type Cleaners, UNKNOWN_COMPONENTS, UNKNOWN_FRAMEWORK } from "../probe-wire.js";
import type { ComponentDetection } from "../probe.js";

const MAX_LOG = 50; // F-20, F-21
const MAX_COMPONENTS = 5; // F-18

function fits<T>(schema: Schema<T>, v: unknown): v is T {
  const errors: string[] = [];
  schema.check(v, "", errors);
  return errors.length === 0;
}

function list<T>(schema: Schema<T>, v: unknown, max: number): T[] {
  return Array.isArray(v) ? v.filter((x): x is T => fits(schema, x)).slice(-max) : [];
}

export const cleaners: Cleaners = {
  console: (v): ConsoleEntry[] => list(ConsoleEntrySchema, v, MAX_LOG),
  network: (v): NetworkEntry[] => list(NetworkEntrySchema, v, MAX_LOG),
  components(v): ComponentDetection {
    if (!v || typeof v !== "object") return UNKNOWN_COMPONENTS;
    const o = v as { framework?: unknown; components?: unknown; source?: unknown };
    const framework = o.framework === "react" || o.framework === "vue" ? o.framework : "unknown";
    return { framework, components: list(ComponentSchema, o.components, MAX_COMPONENTS), source: fits(SourceSchema, o.source) ? o.source : null };
  },
  framework: (v): FrameworkInfo => (fits(FrameworkSchema, v) ? v : UNKNOWN_FRAMEWORK),
};
