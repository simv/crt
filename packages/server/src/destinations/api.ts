/**
 * `claude-review-tool/destination` (PRD-destinations F-143): what a destination written outside
 * CRT imports — the contract's types, its version, and `defineDestination`, which only gives an
 * author's object its types. Nothing else of the server is reachable through this entry.
 */
import { API_VERSION, type Destination } from "./types.js";

export { API_VERSION };
export type { Destination, DestinationContext, DestinationPlan, FeedbackImage, FeedbackItem, PublishedItem, PublishInput, ToolResult } from "./types.js";

/** `export const destination = defineDestination({ … })` — returns its argument. */
export function defineDestination(destination: Destination): Destination {
  return destination;
}
