/**
 * Provider routes (PRD-providers F-57, N-8):
 *
 *   GET /__crt/providers[?refresh=1]  → { ok, active, decision, providers: [...] }   (F-45's --json payload)
 *   PUT /__crt/config { provider?, models? } → writes .crt/config.local.json, replaces the active provider
 *
 * Page scripts run on this origin, so `PUT` takes exactly two allowlisted keys with validated
 * values: `provider` must be a listed built-in string id whose preflight passes (`stub` only
 * under `CRT_SESSION_STUB=1`), `models` an object of listed ids → strings matching `MODEL_RE`.
 * Anything else — an extra key, an ACP object, a `providers.<id>.command` — is a 400; the
 * committed `.crt/config.json` is never written from here.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { json, readJson } from "./http.js";
import { LOCAL_CONFIG_FILE, MODEL_RE, writeLocalConfig } from "./init.js";
import type { ProviderRegistry } from "./session.js";

export const PROVIDERS_PATH = "/__crt/providers";
export const CONFIG_PATH = "/__crt/config";
const MAX_BODY = 64 * 1024;

/** Returns false when the path is neither route. */
export async function handleProviderRoute(
  path: string,
  query: URLSearchParams,
  req: IncomingMessage,
  res: ServerResponse,
  providers: ProviderRegistry,
  projectRoot: string,
): Promise<boolean> {
  if (path === PROVIDERS_PATH) {
    if (req.method !== "GET") {
      json(res, 405, { ok: false, error: "GET /__crt/providers[?refresh=1]" });
      return true;
    }
    // F-56: opening the menu asks for a fresh preflight so a new `codex login` is noticed.
    if (query.get("refresh") === "1") await providers.refresh();
    json(res, 200, providers.payload());
    return true;
  }
  if (path !== CONFIG_PATH) return false;
  if (req.method !== "PUT") {
    json(res, 405, { ok: false, error: "PUT /__crt/config { provider?, models? }" });
    return true;
  }
  const body = await readJson(req, MAX_BODY);
  if (!body.ok) {
    json(res, body.status, { ok: false, error: body.error });
    return true;
  }
  const patch = validateConfigPatch(body.value, providers);
  if (!patch.ok) {
    json(res, 400, { ok: false, error: patch.error });
    return true;
  }
  let file: string;
  try {
    file = writeLocalConfig(projectRoot, patch.value);
  } catch (err) {
    json(res, 500, { ok: false, error: `could not write .crt/${LOCAL_CONFIG_FILE}: ${(err as Error).message}` });
    return true;
  }
  if (patch.value.models) providers.setModels(patch.value.models);
  if (patch.value.provider) {
    const set = providers.setActive(patch.value.provider);
    if (!set.ok) {
      json(res, 400, { ok: false, error: set.error });
      return true;
    }
  }
  json(res, 200, { ok: true, active: providers.resolve(null).provider, ...patch.value, file: `.crt/${LOCAL_CONFIG_FILE}` });
  return true;
}

/** N-8: the two keys, nothing else, values checked against the registry and `MODEL_RE`. */
export function validateConfigPatch(
  value: unknown,
  providers: ProviderRegistry,
): { ok: true; value: { provider?: string; models?: Record<string, string> } } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "body must be a JSON object with provider and/or models" };
  const o = value as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => k !== "provider" && k !== "models");
  if (extra.length) return { ok: false, error: `only provider and models can be set here (got ${extra.join(", ")})` };
  if (!("provider" in o) && !("models" in o)) return { ok: false, error: "nothing to set: give provider and/or models" };
  const out: { provider?: string; models?: Record<string, string> } = {};
  const ids = providers.ids();
  if ("provider" in o) {
    if (typeof o.provider !== "string") return { ok: false, error: `provider must be one of ${ids.join(", ")} (a string id; agent commands are set in .crt/config.json by hand)` };
    const check = providers.check(o.provider);
    if (!check.ok) return { ok: false, error: check.error };
    out.provider = check.id;
  }
  if ("models" in o) {
    const models = o.models;
    if (!models || typeof models !== "object" || Array.isArray(models)) return { ok: false, error: "models must be an object mapping a provider id to a model name" };
    const clean: Record<string, string> = {};
    for (const [id, model] of Object.entries(models as Record<string, unknown>)) {
      if (!ids.includes(id)) return { ok: false, error: `models.${id}: not a built-in provider (${ids.join(", ")})` };
      if (typeof model !== "string" || !MODEL_RE.test(model)) return { ok: false, error: `models.${id}: a model name is 1–64 characters of letters, digits, . _ : -` };
      clean[id] = model;
    }
    out.models = clean;
  }
  return { ok: true, value: out };
}
