/**
 * Capture bundle schema (PRD §6.3, task CRT-0002 Ask 6).
 *
 * One source of truth for the shape of `.crt/captures/<id>/capture.json`: a small JSON-schema-like
 * DSL declares every field with the requirement that demands it, the TypeScript types are inferred
 * from the declaration, and `validateCaptureBundle` checks a bundle at runtime (the server rejects
 * anything else with a 400). The overlay imports only the types.
 *
 * Every `doc` string starts with the F-id that requires the field.
 */

// ---------------------------------------------------------------------------------------------
// Schema DSL
// ---------------------------------------------------------------------------------------------

export interface Schema<T> {
  /** Phantom; never set at runtime. */
  readonly __t?: T;
  readonly doc: string;
  /** Marks an object field as optional (key may be absent). */
  readonly optional?: boolean;
  check(value: unknown, path: string, errors: string[]): void;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

type Fields = Record<string, Schema<unknown>>;
type OptionalKeys<F extends Fields> = { [K in keyof F]: F[K] extends { optional: true } ? K : never }[keyof F];
type RequiredKeys<F extends Fields> = Exclude<keyof F, OptionalKeys<F>>;
type InferObject<F extends Fields> = { [K in RequiredKeys<F>]: Infer<F[K]> } & {
  [K in OptionalKeys<F>]?: Infer<F[K]>;
};

function fail(errors: string[], path: string, expected: string, value: unknown): void {
  const got = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  errors.push(`${path || "$"}: expected ${expected}, got ${got}`);
}

export function str(doc: string, opts: { max?: number } = {}): Schema<string> {
  return {
    doc,
    check(v, path, errors) {
      if (typeof v !== "string") return fail(errors, path, "string", v);
      if (opts.max !== undefined && v.length > opts.max) {
        errors.push(`${path}: string longer than ${opts.max} chars`);
      }
    },
  };
}

export function num(doc: string): Schema<number> {
  return {
    doc,
    check(v, path, errors) {
      if (typeof v !== "number" || !Number.isFinite(v)) fail(errors, path, "finite number", v);
    },
  };
}

export function bool(doc: string): Schema<boolean> {
  return {
    doc,
    check(v, path, errors) {
      if (typeof v !== "boolean") fail(errors, path, "boolean", v);
    },
  };
}

export function lit<const L extends string | number | boolean>(value: L, doc: string): Schema<L> {
  return {
    doc,
    check(v, path, errors) {
      if (v !== value) fail(errors, path, JSON.stringify(value), v);
    },
  };
}

export function oneOf<const L extends readonly string[]>(values: L, doc: string): Schema<L[number]> {
  return {
    doc,
    check(v, path, errors) {
      if (typeof v !== "string" || !values.includes(v)) fail(errors, path, `one of ${values.join("|")}`, v);
    },
  };
}

export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return {
    doc: inner.doc,
    check(v, path, errors) {
      if (v !== null) inner.check(v, path, errors);
    },
  };
}

export function optional<T>(inner: Schema<T>): Schema<T> & { optional: true } {
  return { doc: inner.doc, optional: true, check: (v, p, e) => inner.check(v, p, e) };
}

export function arr<T>(item: Schema<T>, doc: string, opts: { max?: number } = {}): Schema<T[]> {
  return {
    doc,
    check(v, path, errors) {
      if (!Array.isArray(v)) return fail(errors, path, "array", v);
      if (opts.max !== undefined && v.length > opts.max) errors.push(`${path}: more than ${opts.max} items`);
      v.forEach((x, i) => item.check(x, `${path}[${i}]`, errors));
    },
  };
}

export function rec<T>(item: Schema<T>, doc: string): Schema<Record<string, T>> {
  return {
    doc,
    check(v, path, errors) {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(errors, path, "object", v);
      for (const [k, x] of Object.entries(v)) item.check(x, `${path}.${k}`, errors);
    },
  };
}

export function obj<F extends Fields>(fields: F, doc: string): Schema<InferObject<F>> & { fields: F } {
  return {
    doc,
    fields,
    check(v, path, errors) {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(errors, path, "object", v);
      const o = v as Record<string, unknown>;
      for (const [k, s] of Object.entries(fields)) {
        const p = path ? `${path}.${k}` : k;
        if (!(k in o) || o[k] === undefined) {
          if (!s.optional) errors.push(`${p}: missing`);
          continue;
        }
        s.check(o[k], p, errors);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Capture bundle
// ---------------------------------------------------------------------------------------------

export const CAPTURE_VERSION = 1;
export const MAX_TEXT_CHARS = 500; // F-17
export const MAX_HTML_CHARS = 4096; // F-19
export const MAX_CONSOLE_ENTRIES = 50; // F-20
export const MAX_NETWORK_ENTRIES = 50; // F-21
export const MAX_BOX_ELEMENTS = 10; // F-9 (task Ask 3)
export const MAX_COMPONENTS = 5; // F-18

export const RectSchema = obj(
  {
    x: num("F-17 left edge, CSS px"),
    y: num("F-17 top edge, CSS px"),
    width: num("F-17 width, CSS px"),
    height: num("F-17 height, CSS px"),
  },
  "F-17 a rectangle in viewport coordinates at capture time",
);
export type Rect = Infer<typeof RectSchema>;

export const PointSchema = obj({ x: num("F-10 x, CSS px"), y: num("F-10 y, CSS px") }, "F-10 a viewport point");
export type Point = Infer<typeof PointSchema>;

export const PageSchema = obj(
  {
    url: str("F-15 full URL as the browser shows it (the CRT origin)"),
    pathname: str("F-15 location.pathname"),
    query: str("F-15 location.search including the leading ? (empty when none)"),
    hash: str("F-15 location.hash including the leading # (empty when none)"),
    title: str("F-15 document.title"),
    viewport: obj(
      { width: num("F-15 window.innerWidth"), height: num("F-15 window.innerHeight") },
      "F-15 viewport size in CSS px",
    ),
    devicePixelRatio: num("F-15 window.devicePixelRatio"),
    userAgent: str("F-15 navigator.userAgent"),
    timestamp: str("F-15 ISO-8601 time the capture started"),
    scroll: obj({ x: num("F-15 window.scrollX"), y: num("F-15 window.scrollY") }, "F-15 scroll offset in CSS px"),
  },
  "F-15 page metadata",
);
export type PageInfo = Infer<typeof PageSchema>;

export const FrameworkSchema = obj(
  {
    name: oneOf(
      ["next", "react", "vue", "svelte", "angular", "unknown"] as const,
      "F-22 detected UI framework; 'next' implies React",
    ),
    version: nullable(str("F-22 framework version when exposed (next.version, Vue app.version, ng-version)")),
    bundler: oneOf(["vite", "webpack", "unknown"] as const, "F-22 detected bundler/dev server"),
    route: nullable(str("F-22 matched route pattern when derivable (Next.js pages router: __NEXT_DATA__.page)")),
    hints: arr(str("F-22 evidence string"), "F-22 what the detection was based on"),
  },
  "F-22 framework hints",
);
export type FrameworkInfo = Infer<typeof FrameworkSchema>;

export const ComponentSchema = obj(
  {
    name: str("F-18 component display name"),
    kind: oneOf(
      ["function", "class", "forward_ref", "memo", "server", "unknown"] as const,
      "F-18 component kind; 'server' is a React Server Component known only by name on the client",
    ),
  },
  "F-18 one component in the owner chain, nearest first (the components whose JSX rendered the element)",
);
export type ComponentInfo = Infer<typeof ComponentSchema>;

export const SourceSchema = obj(
  {
    file: str("F-18 source file as recorded by the dev build (React _debugSource.fileName, React 19 owner-stack frame, Vue __file)"),
    line: nullable(num("F-18 1-based line number when known (for 'owner_stack' it is a line in the dev-bundled module, so approximate)")),
    column: nullable(num("F-18 1-based column when known")),
    via: oneOf(
      ["debug_source", "owner_stack", "vue_file"] as const,
      "F-18 how the location was derived: React ≤18 _debugSource (exact), React ≥19 _debugStack owner stack (file exact, line approximate), Vue component __file",
    ),
  },
  "F-18 source location of the nearest component that has one",
);
export type SourceInfo = Infer<typeof SourceSchema>;

export const ElementSchema = obj(
  {
    selector: str("F-17 unique CSS selector (document.querySelectorAll(selector).length === 1 at capture time)"),
    xpath: str("F-17 absolute XPath"),
    tag: str("F-17 lower-case tag name"),
    id: str("F-17 id attribute, empty when none"),
    classes: arr(str("F-17 one class"), "F-17 classList"),
    dataset: rec(str("F-17 data-* value"), "F-17 data-* attributes keyed by dataset name (camelCase)"),
    role: nullable(str("F-17 ARIA role: explicit role attribute, else null")),
    ariaLabel: nullable(str("F-17 aria-label, else null")),
    text: str("F-17 trimmed textContent, whitespace collapsed", { max: MAX_TEXT_CHARS }),
    rect: RectSchema,
    styles: rec(str("F-17 computed value"), "F-17 curated computed-style subset (display, position, size, box, font, color, background)"),
    components: arr(ComponentSchema, "F-18 nearest named components, innermost first", { max: MAX_COMPONENTS }),
    source: nullable(SourceSchema),
    componentFramework: oneOf(["react", "vue", "unknown"] as const, "F-18 which walker produced components/source"),
    outerHtml: str("F-19 element outerHTML, truncated", { max: MAX_HTML_CHARS }),
    parentOuterHtml: str("F-19 parent outerHTML, truncated; empty for the root", { max: MAX_HTML_CHARS }),
    detached: bool("F-12 true when the annotated element was no longer in the document at send time (SPA navigation) and details come from the annotation-time snapshot"),
  },
  "F-17/F-18/F-19 everything recorded about one annotated element",
);
export type ElementInfo = Infer<typeof ElementSchema>;

export const AnnotationSchema = obj(
  {
    n: num("F-11 1-based number shown on the badge"),
    kind: oneOf(["select", "box", "pin"] as const, "F-8/F-9/F-10 tool that created it"),
    note: str("F-11 developer's free-text note (may be empty)"),
    rect: RectSchema,
    point: nullable(PointSchema),
    element: nullable(ElementSchema),
    elements: arr(ElementSchema, "F-9 elements inside a Box, largest first; empty for select/pin", {
      max: MAX_BOX_ELEMENTS,
    }),
    image: nullable(str("F-16 file name of this annotation's crop inside the capture dir (ann-<n>.png); null when rasterisation failed")),
  },
  "F-11 one annotation; `rect` is the element box (select), the drawn box (box) or a 1x1 at the point (pin)",
);
export type AnnotationInfo = Infer<typeof AnnotationSchema>;

export const ConsoleEntrySchema = obj(
  {
    level: oneOf(["error", "warn", "uncaught", "unhandledrejection"] as const, "F-20 origin of the entry"),
    message: str("F-20 formatted message, truncated to 2000 chars", { max: 2000 }),
    stack: nullable(str("F-20 stack when an Error was involved, truncated to 4000 chars", { max: 4000 })),
    timestamp: str("F-20 ISO-8601 time"),
    url: nullable(str("F-20 location.href when the entry was recorded")),
  },
  "F-20 one console/error entry",
);
export type ConsoleEntry = Infer<typeof ConsoleEntrySchema>;

export const NetworkEntrySchema = obj(
  {
    method: str("F-21 HTTP method, upper-case (GET for resources seen only through PerformanceObserver)"),
    url: str("F-21 request URL as issued, truncated to 2000 chars", { max: 2000 }),
    status: nullable(num("F-21 HTTP status (>= 400); null when no response arrived")),
    error: nullable(str("F-21 error message when the request threw (network failure, CORS, abort); null for a status failure", { max: 500 })),
    via: oneOf(
      ["fetch", "xhr", "resource"] as const,
      "F-21 how the failure was observed: the fetch hook, the XMLHttpRequest hook, or a PerformanceObserver resource entry with responseStatus (img, script, css, …)",
    ),
    durationMs: nullable(num("F-21 wall time from request start to failure, when known")),
    timestamp: str("F-21 ISO-8601 time the failure was recorded"),
  },
  "F-21 one failed network request (status >= 400 or errored) since page load",
);
export type NetworkEntry = Infer<typeof NetworkEntrySchema>;

export const ScreenshotsSchema = obj(
  {
    viewport: nullable(str("F-16 clean viewport screenshot file name (viewport.png), null when rasterisation failed")),
    annotated: nullable(str("F-16 viewport screenshot with annotation markers drawn on (viewport-annotated.png)")),
    error: nullable(str("F-16 why screenshots are missing, when they are")),
  },
  "F-16 screenshot file names relative to the capture dir",
);
export type ScreenshotsInfo = Infer<typeof ScreenshotsSchema>;

export const CaptureBundleSchema = obj(
  {
    version: lit(CAPTURE_VERSION, "schema version"),
    id: str("F-23 capture id, assigned by the server (empty when sent by the overlay)"),
    page: PageSchema,
    framework: FrameworkSchema,
    annotations: arr(AnnotationSchema, "F-11 the frozen annotation set, in badge order"),
    console: arr(ConsoleEntrySchema, "F-20 console.error/warn + uncaught errors since overlay load, oldest first", {
      max: MAX_CONSOLE_ENTRIES,
    }),
    network: arr(NetworkEntrySchema, "F-21 failed network requests since overlay load, oldest first", {
      max: MAX_NETWORK_ENTRIES,
    }),
    screenshots: ScreenshotsSchema,
  },
  "F-13 the frozen capture bundle written to .crt/captures/<id>/capture.json",
);
export type CaptureBundle = Infer<typeof CaptureBundleSchema>;

/** Returns validation errors (empty when the value is a well-formed CaptureBundle). */
export function validateCaptureBundle(value: unknown): string[] {
  const errors: string[] = [];
  CaptureBundleSchema.check(value, "", errors);
  return errors;
}

export function isCaptureBundle(value: unknown): value is CaptureBundle {
  return validateCaptureBundle(value).length === 0;
}

/**
 * What the overlay POSTs to /__crt/captures (F-13): the bundle plus PNGs as base64.
 * Keys are the file names referenced from the bundle (`viewport.png`, `ann-1.png`, …).
 */
export const CapturePostSchema = obj(
  {
    bundle: CaptureBundleSchema,
    images: rec(str("F-16 base64 PNG bytes (no data: prefix)"), "F-16 PNG files keyed by file name"),
  },
  "F-13 POST /__crt/captures body",
);
export type CapturePost = Infer<typeof CapturePostSchema>;

export function validateCapturePost(value: unknown): string[] {
  const errors: string[] = [];
  CapturePostSchema.check(value, "", errors);
  if (errors.length) return errors;
  const { bundle, images } = value as CapturePost;
  const names = Object.keys(images);
  for (const name of names) {
    if (!/^[a-z0-9-]+\.png$/.test(name)) errors.push(`images.${name}: file name must match [a-z0-9-]+.png`);
  }
  const referenced = [bundle.screenshots.viewport, bundle.screenshots.annotated, ...bundle.annotations.map((a) => a.image)];
  for (const ref of referenced) {
    if (ref && !(ref in images)) errors.push(`images: bundle references ${ref} which was not sent`);
  }
  return errors;
}
