// The API client against the fake Messages API on 127.0.0.1: headers, retries and their
// limit, retry-after, error words, redirects, redaction, and the model list. Key-like strings are built
// at run time, never written as literals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { API_VERSION, ApiError, MAX_RETRY_WAIT_MS, createApiClient, retryWait } from "./client.ts";
import type { ApiClient, RetryInfo } from "./client.ts";
import { errorReply, startFakeMessagesApi, streamReply } from "./fake-messages-api.testing.ts";
import type { FakeMessagesApi } from "./fake-messages-api.testing.ts";
import { MAX_MODEL_PAGES, listModels } from "./models.ts";

const fakeKey = () => ["sk", "ant", "api03", "Q7w9E2r4".repeat(6)].join("-");

async function withFake(fn: (api: FakeMessagesApi, client: ApiClient, sleeps: number[]) => Promise<void>, key = fakeKey()): Promise<void> {
  const api = await startFakeMessagesApi();
  const sleeps: number[] = [];
  const client = createApiClient({ apiKey: key, baseUrl: api.url, sleep: async (ms) => void sleeps.push(ms) });
  try {
    await fn(api, client, sleeps);
  } finally {
    await api.close();
  }
}

async function drain(body: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(body).text();
}

test("a stream request: the key only in x-api-key, the pinned version, the body as given", async () => {
  await withFake(async (api, client) => {
    const key = fakeKey();
    api.reply(streamReply({ content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" }));
    const body = JSON.stringify({ model: "model-a", max_tokens: 1024, messages: [], stream: true });
    const r = await client.stream("/v1/messages", body);
    assert.equal(r.attempts, 1);
    assert.match(await drain(r.body), /event: message_start/);
    const req = api.requests[0]!;
    assert.equal(req.method, "POST");
    assert.equal(req.path, "/v1/messages");
    assert.equal(req.headers["x-api-key"], key);
    assert.equal(req.headers["anthropic-version"], API_VERSION);
    assert.equal(API_VERSION, "2026-10-21");
    assert.equal(req.headers["content-type"], "application/json");
    assert.equal(req.text, body);
    const others = Object.entries(req.headers).filter(([k]) => k !== "x-api-key");
    assert.ok(!JSON.stringify(others).includes(key), "the key is in no other header");
    assert.ok(!req.text.includes(key), "nor in the body");
    assert.equal(client.host, new URL(api.url).host);
    assert.ok(!JSON.stringify(client).includes(key), "nor on the client object");
  });
});

test("429 and 5xx are retried twice, honouring retry-after, then the error says how many attempts", async () => {
  await withFake(async (api, client, sleeps) => {
    const retries: RetryInfo[] = [];
    api.reply(errorReply(429, "rate_limit_error", "slow down", { "retry-after": "3" }), errorReply(529, "overloaded_error", "Overloaded"), streamReply({ content: [], stop_reason: "end_turn" }));
    const r = await client.stream("/v1/messages", "{}", { onRetry: (x) => retries.push(x) });
    assert.equal(r.attempts, 3);
    await drain(r.body);
    assert.deepEqual(sleeps, [3000, 2000], "retry-after first, then the 2 s backoff of the second retry");
    assert.deepEqual(retries.map((x) => [x.attempt, x.of, x.reason]), [[2, 3, "HTTP 429"], [3, 3, "HTTP 529"]]);
    assert.equal(api.requests.length, 3);

    api.reply(errorReply(500, "api_error", "boom"), errorReply(500, "api_error", "boom"), errorReply(500, "api_error", "boom"), errorReply(500, "api_error", "never reached"));
    await assert.rejects(client.stream("/v1/messages", "{}"), (e: unknown) => e instanceof ApiError && e.status === 500 && /busy or failing \(HTTP 500 api_error\) after 3 attempts: boom/.test(e.message));
    assert.equal(api.requests.length, 6, "three attempts, no fourth");
    assert.equal(api.pending(), 1);
  });
});

test("retry-after is capped at 60 s and may be an HTTP date; without it the waits are 1 s and 2 s", () => {
  assert.equal(retryWait("3600", 1), MAX_RETRY_WAIT_MS);
  assert.equal(retryWait("0.5", 1), 500);
  assert.equal(retryWait(new Date(10_000 + 7_000).toUTCString(), 1, 10_000), 7_000);
  assert.equal(retryWait("soon", 1), 1000);
  assert.equal(retryWait(null, 1), 1000);
  assert.equal(retryWait(null, 2), 2000);
  assert.equal(retryWait("-5", 2), 2000, "not a number of seconds");
});

test("network errors are retried too, and a Stop during the wait ends at once", async () => {
  let calls = 0;
  const failing: typeof fetch = async () => {
    calls++;
    throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
  };
  const sleeps: number[] = [];
  const client = createApiClient({ apiKey: fakeKey(), fetch: failing, sleep: async (ms) => void sleeps.push(ms) });
  await assert.rejects(client.getJson("/v1/models"), (e: unknown) => e instanceof ApiError && e.type === "network_error" && /could not reach api\.anthropic\.com after 3 attempts: fetch failed, ECONNREFUSED/.test(e.message));
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [1000, 2000]);

  const stop = new AbortController();
  const slow = createApiClient({ apiKey: fakeKey(), fetch: failing });
  const t0 = Date.now();
  const p = slow.getJson("/v1/models", { signal: stop.signal });
  setTimeout(() => stop.abort(new Error("stopped")), 30);
  await assert.rejects(p, /stopped/);
  assert.ok(Date.now() - t0 < 900, "the 1 s wait was cut short");
});

test("401, 404 and other refusals are not retried and get plain words", async () => {
  await withFake(async (api, client) => {
    api.reply(errorReply(401, "authentication_error", "invalid x-api-key"));
    await assert.rejects(client.stream("/v1/messages", "{}"), (e: unknown) => e instanceof ApiError && e.status === 401 && /^the API key was refused \(HTTP 401 authentication_error\)/.test(e.message));
    api.reply(errorReply(404, "not_found_error", "model: model-z"));
    await assert.rejects(client.stream("/v1/messages", "{}"), /^ApiError: unknown model: the API does not know this model/);
    api.reply(errorReply(400, "invalid_request_error", "messages: roles must alternate"));
    await assert.rejects(client.stream("/v1/messages", "{}"), /refused the request \(HTTP 400 invalid_request_error\): messages: roles must alternate/);
    api.reply(errorReply(413, "request_too_large", "too big"));
    await assert.rejects(client.stream("/v1/messages", "{}"), /too large/);
    assert.equal(api.requests.length, 4, "no retries");
    api.reply({ status: 200, json: { not: "a stream" } });
    await assert.rejects(client.stream("/v1/messages", "{}"), /without an event stream \(content-type application\/json\)/);
  });
});

test("a redirect is never followed: the key and the body stay with the API host", async () => {
  const key = fakeKey();
  const other = await startFakeMessagesApi();
  try {
    await withFake(async (api, client) => {
      for (const status of [301, 302, 303, 307, 308]) {
        api.reply({ status, headers: { location: `${other.url}/v1/messages` } });
        await assert.rejects(client.stream("/v1/messages", JSON.stringify({ prompt: "project data" })), (e: unknown) =>
          e instanceof ApiError && e.status === status && e.type === "redirect" && e.message.includes(`(HTTP ${status})`) && !e.message.includes(key) && !e.message.includes(other.url));
      }
      api.reply({ status: 307, headers: { location: `${other.url.replace("127.0.0.1", "localhost")}/v1/models` } });
      await assert.rejects(client.getJson("/v1/models"), /does not follow/);
      assert.equal(api.requests.length, 6, "one attempt each: a redirect is not retried");
      assert.equal(other.requests.length, 0, "the other address got nothing");
    }, key);
  } finally {
    await other.close();
  }
});

test("the key never appears in an error, even when the API echoes it", async () => {
  const key = fakeKey();
  await withFake(async (api, client) => {
    const other = ["sk", "ant", "admin01", "Zz".repeat(20)].join("-");
    api.reply(errorReply(400, "invalid_request_error", `bad key ${key} and ${other}`));
    const e = await client.stream("/v1/messages", "{}").catch((x: unknown) => x as Error);
    assert.ok(e instanceof ApiError);
    assert.ok(!e.message.includes(key) && !e.message.includes(key.slice(-20)), e.message);
    assert.ok(!e.message.includes(other.slice(8)), "any key-shaped text is removed");
    assert.match(e.message, /bad key \[redacted key\] and \[redacted key\]/);
    assert.ok(!JSON.stringify(e).includes(key));
  }, key);
  // A key that does not look like one is still removed by its value.
  const plain = createApiClient({ apiKey: "plain-test-key-12345", baseUrl: "http://127.0.0.1:9" });
  assert.equal(plain.redact("x plain-test-key-12345 y"), "x [redacted key] y");
});

test("holdFrom keeps back the end of streaming text that could start a key", () => {
  const key = fakeKey();
  const c = createApiClient({ apiKey: key, baseUrl: "http://127.0.0.1:9" });
  assert.equal(c.holdFrom("hello"), 5);
  assert.equal(c.holdFrom("hello s"), 6);
  assert.equal(c.holdFrom("hello sk-an"), 6);
  assert.equal(c.holdFrom("hello sk-ant-api03-abc"), 6);
  assert.equal(c.holdFrom("hello sk-ant-api03-abc done"), 27, "a finished run is redacted, not held");
  assert.equal(c.holdFrom(`x ${key.slice(0, 30)}`), 2);
});

test("only https, or http on loopback, and a bare origin; a bad key is refused without naming it", () => {
  for (const baseUrl of ["http://example.com", "ftp://127.0.0.1", "https://api.anthropic.com/v1", "https://u:p@api.anthropic.com", "not a url"]) {
    assert.throws(() => createApiClient({ apiKey: fakeKey(), baseUrl }), /base URL/, baseUrl);
  }
  for (const apiKey of ["", "  ", "two words", "line\nbreak"]) {
    assert.throws(() => createApiClient({ apiKey }), (e: unknown) => e instanceof Error && /API key is empty or holds characters/.test(e.message) && (apiKey.trim() === "" || !e.message.includes(apiKey)));
  }
  assert.equal(createApiClient({ apiKey: fakeKey() }).host, "api.anthropic.com");
});

test("listModels follows has_more and last_id and keeps the API's order", async () => {
  await withFake(async (api, client) => {
    api.reply(
      { json: { data: [{ type: "model", id: "model-c", display_name: "Model C", max_tokens: 64000, max_input_tokens: 400000, created_at: "2026-10-01T00:00:00Z" }, { id: "model-b", display_name: "Model B", max_tokens: 32000 }], has_more: true, first_id: "model-c", last_id: "model-b" } },
      { json: { data: [{ id: "model-a", display_name: "Model\nA" }, { id: "bad id with spaces" }, { id: "model-b" }, { nope: 1 }], has_more: false, last_id: "model-a" } },
    );
    const models = await listModels(client);
    assert.deepEqual(models, [
      { id: "model-c", display_name: "Model C", max_tokens: 64000, max_input_tokens: 400000 },
      { id: "model-b", display_name: "Model B", max_tokens: 32000 },
      { id: "model-a", display_name: "Model A" },
    ]);
    assert.deepEqual(api.requests.map((r) => [r.method, r.path]), [["GET", "/v1/models?limit=100"], ["GET", "/v1/models?limit=100&after_id=model-b"]]);
    assert.equal(api.requests[0]!.headers["anthropic-version"], API_VERSION);
  });
});

test("listModels refuses a list that never ends or has no data", async () => {
  await withFake(async (api, client) => {
    api.reply({ json: { data: [], has_more: true, last_id: "x" } }, { json: { data: [], has_more: true, last_id: "x" } });
    await assert.rejects(listModels(client), /says it has more but gives no new last_id/);
    for (let i = 0; i < MAX_MODEL_PAGES; i++) api.reply({ json: { data: [], has_more: true, last_id: `p${i}` } });
    await assert.rejects(listModels(client), /longer than 20 pages/);
    api.reply({ json: { models: [] } });
    await assert.rejects(listModels(client), /no data array/);
    api.reply(errorReply(401, "authentication_error", "invalid x-api-key"));
    await assert.rejects(listModels(client), /the API key was refused/);
  });
});
