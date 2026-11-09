# @open3dj/agent

The agent panel of `open3dj view`: a person types a request in the viewer page, and a model works on the project with the five Open3DJ tools. The design is RFC 0001 (`rfcs/0001-agent-panel.md`, issue #31).

**Status: stub.** This is the first slice (plan step B3) and the parts of step B4 below the turn loop. It holds the tool entries, the result mapping, the system prompt, and Engine A's client, model list and stream reading. Nothing calls the package yet, and nothing in `open3dj view` changes. The turn loop, approvals, the budget ledger and the egress log come in later steps; `PACKAGE_STATUS` flips to `"ready"` when Engine A runs a turn.

The package never loads the kernel (it runs inside the `open3dj view` process) and has no third-party dependency: only `@open3dj/mcp`, `@open3dj/schemas` and Node's `fetch`.

## What is here

| File | Export | What it does |
|---|---|---|
| `src/types.ts` | `TokenUsage` | The start of the shared contract: the tokens of one request, `input` (the uncached input only), `output`, `cache_read` and `cache_write`. The engine, turn and event types join it with Engine A's turn loop. |
| `src/api-tools.ts` | `apiTools()` | The five tools as Messages API entries `{name, description, input_schema}`, in the fixed order run, inspect, render, export, docs, made from `TOOL_DEFINITIONS` in `@open3dj/mcp`. Each input schema loses `$schema`, `$id`, `title` and any top-level `anyOf`, `oneOf` or `allOf`; run's `anyOf` (script or ops) becomes one sentence of its description, and any other top-level combinator throws, so a schema change cannot drop a rule unnoticed. `project` is removed from run, inspect, render and export. Every call returns new objects with the same bytes, so prompt caching can reuse the tools part of each request. |
| | `withProject(name, input, project)` | Puts the pinned project back into a tool input. A project the model sends anyway is accepted only when it is the pinned path or the pinned folder's name; anything else is a `PATH_REFUSED` result (a tool result, not a throw) that names only the folder. |
| `src/results.ts` | `toApiContent(callResult)` | Maps an MCP `CallResult` (from `callTool()` in `@open3dj/mcp`) to the `content` and `is_error` of a Messages API `tool_result` block. Text stays text, cut at 64 KiB in all with a note that says how much was shown. One PNG becomes a base64 image block; more images are left out with a count. An SVG resource becomes a note naming the file. Images the API would refuse are left out with a reason: not PNG, over 10 MB base64, or over 3,000 px on a side (the API rejects those once a request holds more than 20 images, and the conversation resends every render). |
| | `redactText(text)` | Removes anything shaped like an Anthropic API key and home folder paths. A bare home folder (`/home/<name>`, `/Users/<name>`, `C:\Users\<name>`, in any letter case, with or without a trailing separator) becomes `~`. Other absolute paths keep only their last segment, with the same `redactPaths` rule the MCP errors use; that rule also turns a bare home folder into `~`, so an MCP error never leaves a user name behind as `…/<name>/`. JSON text is redacted value by value, so escaped newlines and backslashes are not read as paths. |
| `src/prompt.ts` | `systemPrompt()` | One system text that is the same bytes on every call: a short preamble for the viewer page, the MCP server's `INSTRUCTIONS`, and the body of `skills/open3dj/SKILL.md` without its YAML front matter. It reads SKILL.md at run time and throws a clear error when the file is missing. |
| `src/sse.ts` | `SseParser`, `readSse()` | A server-sent-events parser over bytes, after the WHATWG rules: chunks may split a line or a UTF-8 character anywhere; LF, CRLF and CR end lines; comments are skipped; data lines join with a newline; an unfinished event at the end is dropped; one event is capped at 32 MiB. |
| `src/stream.ts` | `MessageAccumulator` | Turns the stream events (`message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`, `ping`, `error`) into the final assistant message, its usage, `stop_reason` and `stop_details`. Text, tool_use, thinking (with its signature) and redacted_thinking blocks are kept as sent. A tool input is parsed strictly at its block's end; input that is not a JSON object keeps its raw text and reason, and the block's input becomes `{}`. An unknown block or delta type is the error "unsupported response block <type>; update Open3DJ", never a guess. Unknown event types are ignored, as the API's versioning allows. `outputReported` says whether a `message_delta` gave the reply's output count; until then the output in its usage is only `message_start`'s placeholder. |
| `src/client.ts` | `createApiClient({apiKey, baseUrl?, fetch?, sleep?})` | Speaks the Messages API over `fetch` with `anthropic-version: 2026-10-21`. The key lives only in the function's closure and goes only into the `x-api-key` header. 429, 5xx and network errors are retried twice, honouring `retry-after` (seconds or an HTTP date, capped at 60 s; otherwise 1 s, then 2 s), and Stop cuts a wait short. 401 becomes "the API key was refused" and a 404 on `/v1/messages` "unknown model". A redirect is never followed (it would carry the key, and for 307 and 308 the body, to another address): any 3xx answer is an error and is not retried. Every message it makes goes through `redact()`, which removes the key by value and any `sk-ant-` run. The base URL must be https, or http on 127.0.0.1 for tests. |
| `src/models.ts` | `listModels(client)` | `GET /v1/models`, page by page with `after_id` until `has_more` is false, newest first as the API lists them: `{id, display_name, max_tokens?, max_input_tokens?}`. Ids outside the documented form are left out. Open3DJ never names a model. |
| `src/fake-messages-api.testing.ts` | (tests only) | A fake Messages API on 127.0.0.1. It scripts a reply per request, records each request's method, path, headers and body, streams SSE in 7-byte chunks, and can answer 401, 404, 429 with `retry-after`, 500, a mid-stream error event, `max_tokens` and `refusal`, or keep a stream open until the client goes away. |

The system prompt's preamble tells the model that the person types in the Agent tab of the viewer page, that every tool step is shown to them, that the viewer pins the project, that a chat reply is never an approval, and that human-only gates (for example `WAIVER_NEEDS_PERSON`) stay with the person.

## Tests

All offline, with the fake Messages API on 127.0.0.1 and the fake compute pool from `@open3dj/mcp`:

- `sse.test.ts`: every chunk size, CRLF and CR split between chunks, field rules, the byte order mark, the end of the stream and the cap.
- `stream.test.ts`: every block type, usage, stop details, tool input parsing, unknown block and delta types, the error event and broken streams.
- `client.test.ts`: headers, retries and their limit, `retry-after`, network errors, error words, redirects that are never followed, redaction, the base URL rules and `listModels` pagination.
- `api-tools.test.ts`: the order, the removed keys, the unchanged properties, the run sentence, byte-stable output, the pinned project, every refusal, and a pinned call through `callTool()`.
- `results.test.ts`: text, the one image, SVG notes, refused images, the 64 KiB cap at a multi-byte character, and redaction (home folders with trailing separators and in any letter case included, also after the MCP error redaction). Key-like test strings are built at run time.
- `prompt.test.ts`: stable bytes, the preamble, a missing SKILL.md, and front matter in every line-end form.
- `index.test.ts`: the status, the dependencies, and a child process that imports the package and checks that no kernel or compute worker module is resolved. A placeholder test for the Engine A turn is skipped while the package is a stub and fails on purpose once it flips.

```sh
npm test -- packages/agent
```
