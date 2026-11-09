// The models this API key can use, from GET /v1/models. Open3DJ never names a model: the
// person loads this list and picks one, and the view server accepts only ids from it.
import type { ApiClient, RequestOptions } from "./client.ts";

export interface ModelInfo {
  id: string;
  display_name: string;
  /** The model's largest max_tokens, when the API says. */
  max_tokens?: number;
  /** The model's context window, when the API says. */
  max_input_tokens?: number;
}

/** Entries per page, the most the endpoint takes. */
export const MODELS_PAGE_SIZE = 100;
/** Pages read at most, so a broken has_more cannot loop for ever. */
export const MAX_MODEL_PAGES = 20;

/** A model id as the API gives it. Anything else is left out of the list. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;

/** Every model, in the order the API lists them (newest first), following has_more and last_id. */
export async function listModels(client: ApiClient, options: RequestOptions = {}): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  const seen = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < MAX_MODEL_PAGES; page++) {
    const q = new URLSearchParams({ limit: String(MODELS_PAGE_SIZE) });
    if (after !== undefined) q.set("after_id", after);
    const body = (await client.getJson(`/v1/models?${q}`, options)) as { data?: unknown; has_more?: unknown; last_id?: unknown } | null;
    const data = Array.isArray(body?.data) ? body.data : undefined;
    if (!data) throw new Error("the API's model list has no data array");
    for (const raw of data) {
      const m = model(raw);
      if (m && !seen.has(m.id)) {
        seen.add(m.id);
        out.push(m);
      }
    }
    if (body?.has_more !== true) return out;
    if (typeof body.last_id !== "string" || body.last_id === "" || body.last_id === after) throw new Error("the API's model list says it has more but gives no new last_id");
    after = body.last_id;
  }
  throw new Error(`the API's model list is longer than ${MAX_MODEL_PAGES} pages`);
}

function model(raw: unknown): ModelInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !MODEL_ID.test(r.id)) return undefined;
  const name = typeof r.display_name === "string" ? r.display_name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 128) : "";
  const m: ModelInfo = { id: r.id, display_name: name || r.id };
  if (isCount(r.max_tokens)) m.max_tokens = r.max_tokens;
  if (isCount(r.max_input_tokens)) m.max_input_tokens = r.max_input_tokens;
  return m;
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}
