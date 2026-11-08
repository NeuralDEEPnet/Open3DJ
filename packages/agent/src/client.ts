// A small client for the Claude Messages API over fetch (RFC 0001, Engine A). The official
// SDK fails the licence gate today, so this speaks the documented HTTP API with a pinned
// anthropic-version. The API key lives only in this module's closure: it goes into the
// x-api-key header of each request and nowhere else, and every message this client makes is
// passed through redact(), which removes the key and anything shaped like one.

/** The API version every request pins (the anthropic-version header). */
export const API_VERSION = "2026-10-21";
/** The only API host. The base URL option exists for tests on 127.0.0.1. */
export const DEFAULT_BASE_URL = "https://api.anthropic.com";
/** Retries after the first attempt, for 429, 5xx and network errors. */
export const MAX_RETRIES = 2;
/** The longest wait between attempts, whatever retry-after says. */
export const MAX_RETRY_WAIT_MS = 60_000;
/** Messages the client makes are cut to this many characters. */
const MAX_MESSAGE_CHARS = 500;

/** Anything shaped like an Anthropic API key: sk-ant- and the word characters and dashes after it. */
export const KEY_PATTERN = /sk-ant-[\w-]*/g;
const REDACTED = "[redacted key]";

export interface RetryInfo {
  /** The attempt about to start, 2 or more. */
  attempt: number;
  /** All attempts allowed. */
  of: number;
  waitMs: number;
  /** For example "HTTP 429" or "a network error". */
  reason: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
  onRetry?: (r: RetryInfo) => void;
}

export interface ApiClient {
  /** The host requests go to, for example api.anthropic.com. */
  readonly host: string;
  /** POST a JSON body to a streaming endpoint; returns the event stream after a 2xx answer. */
  stream(path: string, body: string, options?: RequestOptions): Promise<{ body: ReadableStream<Uint8Array>; attempts: number }>;
  /** GET a JSON document. */
  getJson(path: string, options?: RequestOptions): Promise<unknown>;
  /** Text without the key and without anything shaped like one. */
  redact(text: string): string;
  /**
   * For text that is still streaming: the index from which the end of text could be the
   * start of a key, so the caller holds that part back until more text arrives.
   */
  holdFrom(text: string): number;
}

export interface ApiClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Waits between attempts. Tests pass one that records the time and returns at once. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** An answer of the API that is not usable, with a message safe to show (no key). */
export class ApiError extends Error {
  readonly status: number | undefined;
  /** The API's error type (authentication_error, not_found_error, ...) or "network_error". */
  readonly type: string;
  constructor(message: string, status: number | undefined, type: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
  }
}

/**
 * A client for one key. The key is checked here, kept in this closure and never stored on
 * the returned object. An http base URL is accepted only for 127.0.0.1, ::1 or localhost.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const key = options.apiKey;
  if (typeof key !== "string" || key.trim() === "" || /[\s\0]/.test(key) || key.length > 512) {
    throw new Error("the API key is empty or holds characters a header cannot carry; set ANTHROPIC_API_KEY to the key alone");
  }
  const base = checkBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? abortableSleep;
  const host = base.host;

  const redact = (text: string): string => {
    let out = String(text);
    if (key.length >= 8) out = out.split(key).join(REDACTED);
    return out.replace(KEY_PATTERN, REDACTED);
  };

  const holdFrom = (text: string): number => {
    let at = text.length;
    // A key-shaped run that reaches the end may still grow.
    const m = /sk-ant-[\w-]*$/.exec(text);
    if (m) at = Math.min(at, m.index);
    // The end may be the start of "sk-ant-" or of the key itself.
    for (const prefix of ["sk-ant-", key]) {
      for (let n = Math.min(prefix.length - 1, text.length); n > 0; n--) {
        if (text.endsWith(prefix.slice(0, n))) {
          at = Math.min(at, text.length - n);
          break;
        }
      }
    }
    return at;
  };

  const clean = (text: string): string => {
    const s = redact(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ");
    return s.length > MAX_MESSAGE_CHARS ? `${s.slice(0, MAX_MESSAGE_CHARS)}...` : s;
  };

  /** One request with retries. Returns the 2xx response and how many attempts it took. */
  async function send(method: "GET" | "POST", path: string, body: string | undefined, accept: string, opts: RequestOptions): Promise<{ res: Response; attempts: number }> {
    const url = new URL(path, base);
    if (url.origin !== base.origin) throw new ApiError("the client sends requests to its own API host only", undefined, "invalid_request_error");
    const of = MAX_RETRIES + 1;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        // The headers object is made here and dropped with this attempt. A redirect is never
        // followed: fetch would send x-api-key, and for 307 and 308 the body, to the new address.
        const init: RequestInit = { method, redirect: "manual", headers: { "x-api-key": key, "anthropic-version": API_VERSION, "content-type": "application/json", accept } };
        if (body !== undefined) init.body = body;
        if (opts.signal) init.signal = opts.signal;
        res = await doFetch(url, init);
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        if (attempt >= of) throw new ApiError(clean(`could not reach ${host} after ${of} attempts: ${errorText(e)}`), undefined, "network_error");
        const waitMs = backoff(attempt);
        opts.onRetry?.({ attempt: attempt + 1, of, waitMs, reason: "a network error" });
        await sleep(waitMs, opts.signal);
        continue;
      }
      if (res.ok) return { res, attempts: attempt };
      if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
        await res.body?.cancel().catch(() => undefined);
        throw new ApiError(clean(`the API answered with a redirect (HTTP ${res.status}), which Open3DJ does not follow: requests go to ${host} only`), res.status || undefined, "redirect");
      }
      const info = await errorInfo(res);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= of) throw new ApiError(clean(describe(res.status, info, path, retryable ? of : 1)), res.status, info.type);
      const waitMs = retryWait(res.headers.get("retry-after"), attempt);
      opts.onRetry?.({ attempt: attempt + 1, of, waitMs, reason: `HTTP ${res.status}` });
      await sleep(waitMs, opts.signal);
    }
  }

  return {
    host,
    async stream(path, body, opts = {}) {
      const { res, attempts } = await send("POST", path, body, "text/event-stream", opts);
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("text/event-stream") || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        throw new ApiError(`the API answered without an event stream (content-type ${clean(type) || "none"})`, res.status, "api_error");
      }
      return { body: res.body, attempts };
    },
    async getJson(path, opts = {}) {
      const { res } = await send("GET", path, undefined, "application/json", opts);
      try {
        return await res.json();
      } catch {
        throw new ApiError(`the API answered ${clean(path)} with something that is not JSON`, res.status, "api_error");
      }
    },
    redact,
    holdFrom,
  };
}

function checkBaseUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("the API base URL is not a URL");
  }
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "[::1]" || u.hostname === "localhost";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) {
    throw new Error("the API base URL must use https (http only for 127.0.0.1, ::1 or localhost in tests)");
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) {
    throw new Error("the API base URL must be a bare origin, for example https://api.anthropic.com");
  }
  return new URL(u.origin);
}

/** The wait before the next attempt: retry-after (seconds or an HTTP date), capped, or 1 s then 2 s. */
export function retryWait(header: string | null, attempt: number, nowMs: number = Date.now()): number {
  if (header !== null && header.trim() !== "") {
    const s = header.trim();
    let ms: number | undefined;
    if (/^\d+(\.\d+)?$/.test(s)) ms = Number(s) * 1000;
    else if (/^[A-Za-z]{3}, /.test(s)) {
      // An HTTP date, for example "Wed, 21 Oct 2026 07:28:00 GMT".
      const t = Date.parse(s);
      if (Number.isFinite(t)) ms = t - nowMs;
    }
    if (ms !== undefined && Number.isFinite(ms)) return Math.min(MAX_RETRY_WAIT_MS, Math.max(0, Math.round(ms)));
  }
  return backoff(attempt);
}

function backoff(attempt: number): number {
  return Math.min(MAX_RETRY_WAIT_MS, 1000 * 2 ** (attempt - 1));
}

async function errorInfo(res: Response): Promise<{ type: string; message: string }> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    // The body is optional for the message.
  }
  try {
    const j = JSON.parse(text) as { error?: { type?: unknown; message?: unknown } };
    const type = typeof j.error?.type === "string" ? j.error.type.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64) : "error";
    const message = typeof j.error?.message === "string" ? j.error.message : "";
    return { type, message };
  } catch {
    return { type: "error", message: text.slice(0, 200) };
  }
}

/** A sentence for an HTTP error. 401 and a 404 on /v1/messages get their own words. */
function describe(status: number, info: { type: string; message: string }, path: string, attempts: number): string {
  const detail = info.message ? `: ${info.message}` : "";
  if (status === 401) return `the API key was refused (HTTP 401 ${info.type}). Check ANTHROPIC_API_KEY and start open3dj view again.`;
  if (status === 404 && path.startsWith("/v1/messages")) return `unknown model: the API does not know this model, or this key cannot use it (HTTP 404). Load the models again and pick one from the list.`;
  if (status === 403) return `the API key may not do this (HTTP 403 ${info.type})${detail}`;
  if (status === 402) return `the API refused the request for a billing reason (HTTP 402 ${info.type})${detail}`;
  if (status === 413) return `the request is too large for the API (HTTP 413). Start a new conversation or ask for less.`;
  if (status === 429 || status >= 500) return `the API is busy or failing (HTTP ${status} ${info.type}) after ${attempts} attempts${detail}`;
  return `the API refused the request (HTTP ${status} ${info.type})${detail}`;
}

function errorText(e: unknown): string {
  const err = e as { message?: unknown; cause?: { message?: unknown; code?: unknown } };
  const parts = [typeof err?.message === "string" ? err.message : String(e)];
  if (err?.cause && typeof err.cause.code === "string") parts.push(err.cause.code);
  else if (err?.cause && typeof err.cause.message === "string") parts.push(err.cause.message);
  return parts.join(", ");
}

/** setTimeout that the signal can cut short. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
