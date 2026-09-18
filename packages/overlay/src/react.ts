"use client";
/**
 * `claude-review-tool/react` (PRD-embedded F-97, §5.3): `<CrtDevTools />`, a client component that
 * renders nothing and mounts the CRT loader from an effect, so it drops into a Next.js App Router
 * root layout or any React tree. SSR-safe: nothing touches `document` at render, and effects never
 * run on the server. `createElement`-free (it returns `null`), so no JSX config is needed. Built to
 * `dist/integrations/react.js` (ES module, `react` external) with `"use client"` kept as the first
 * statement; `exports` routes production builds to `noop-react.js` and the body sits behind
 * `process.env.NODE_ENV !== "production"` as well (F-98).
 */
import { useEffect } from "react";
import { mountCrt, type MountOptions } from "./loader.js";

declare const process: { env: Record<string, string | undefined> };

export type CrtDevToolsProps = MountOptions;

/** Mounts CRT on this page once (F-96 makes `mountCrt` idempotent, so a re-render or Strict Mode's double effect is a no-op). */
export function CrtDevTools(props: CrtDevToolsProps): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") mountCrt(props); // F-98: the bundler folds this away
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once; the loader ignores later options anyway
  return null;
}
