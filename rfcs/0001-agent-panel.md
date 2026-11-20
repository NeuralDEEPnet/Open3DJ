# RFC 0001: Prompt Open3DJ from the viewer page (the agent panel)

- **Status:** draft
- **Issue:** #31
- **Author:** NeuralDEEPnet (founder), drafted with neuraldeep.net design agents
- **Started:** 2026-11-08
- **Final comment period:** starts when the issue proposes a decision; 10 calendar days, at least 5 business days

## Problem

Today a person drives Open3DJ from a terminal (`open3dj run`, `open3dj inspect`) or through their own agent client over MCP. The browser viewer (`open3dj view`) shows the model, but it cannot take a request. The founder asked on 2026-11-05 for "an interface that we can prompt it from the web and not only the command line", with two choices:

1. **Both AI engines, switchable:** the Claude Messages API with the person's own API key, and the person's own installed and logged-in Claude Code, so their Claude plan pays.
2. **Reach:** the computer running Open3DJ, plus an opt-in link so an iPad or phone on the same Wi-Fi can use the same page.

Three parts of today's design stand in the way, and this RFC changes each on purpose:

- The viewer page never changes the design ([ARCHITECTURE.md](../docs/ARCHITECTURE.md) section 13: "Until S5 the page never changes the design").
- Every cloud call is an egress approval ([ARCHITECTURE.md](../docs/ARCHITECTURE.md) section 12; [COMPUTE.md](../docs/COMPUTE.md) section 8), and the approval service only arrives in S5.
- An OS sandbox must wrap the worker "before any non-loopback transport or remote mode" ([ARCHITECTURE.md](../docs/ARCHITECTURE.md) section 12, the trigger under the threat table). The Wi-Fi link is a non-loopback transport.

## Proposal

### What the person gets

`open3dj view` gains an **Agent** tab at the top of the side panel:

- a prompt box with Send, Stop and New conversation;
- a live transcript, shown as plain text only, where every tool step is a row (for example "run: r_0012 ok, 5 of 5 definitions valid") that opens to show its script and result;
- the tokens used in this session and the limits left;
- an engine switch: **Claude API (your API key)** or **your Claude Code (your login)**.

The 3D view updates as revisions land, as it does today when an agent works over MCP. `--agent off` removes the tab and its routes.

### Package and contract

A new workspace package, `packages/agent` (`@open3dj/agent`), holds both engines, a server-sent-events parser, the turn loop, approvals, a budget ledger and an egress log. It never loads the kernel (the daemon rule in [AGENTS.md](../AGENTS.md)). It adds no runtime dependency: it uses Node's `fetch`, `node:crypto` and `node:child_process`.

The five MCP tools do not change, and no sixth tool is added. The tool dispatch in `packages/mcp/src/server.ts` becomes an exported `callTool()` so the MCP server and the agent panel share one code path.

New public surface, all documented in [docs/GETTING-STARTED.md](../docs/GETTING-STARTED.md) when it ships:

- CLI flags on `open3dj view`: `--agent api|cli|off`, `--agent-rounds <n>`, `--agent-input-budget <tokens>`, `--agent-output-budget <tokens>`, `--agent-timeout <s>`, `--claude <path>`, `--lan [address]`. (`--no-sync-script` already shipped with the watcher fix in #35.)
- Routes under the page's own origin: `GET api/agent` (a snapshot), and `POST api/agent/prompt`, `approve`, `deny`, `stop`, `reset`, `models`.
- One new event, `agent`, on the existing `api/events` stream, with an `id` per event so a reconnecting page replays what it missed (`Last-Event-ID`).
- A new schema, `agent-event`, and an egress log record format.

### Engine A: the Claude Messages API with the person's key

- Runs inside the `open3dj view` process, on a second set of tool handlers over the view's compute pool, so Stop cancels only the agent's jobs, never the file watcher's.
- Speaks the documented Messages API over `fetch`, with a pinned `anthropic-version` header. The official TypeScript SDK fails the licence gate today (one of its dependencies is licensed under the Unlicense, which is not on the allowlist), and a new runtime dependency needs its own decision ([AGENTS.md](../AGENTS.md)). Swapping the SDK in later is a change inside `packages/agent` only.
- Tool definitions come from `TOOL_DEFINITIONS` in `packages/mcp/src/tools.ts`. The top-level `anyOf`, `$schema`, `$id` and `title` are removed (the handlers validate the same rules), and the `project` input is removed: the engine pins the project the viewer shows and refuses any other.
- Render PNGs go back to the model as image blocks; SVGs as a note with the file name.
- Prompt caching: the tools and one system block (the server's `INSTRUCTIONS` plus the body of `skills/open3dj/SKILL.md`) come first with a cache breakpoint, and the growing conversation uses automatic caching. The conversation is append-only.
- The key is read once from `ANTHROPIC_API_KEY`, removed from `process.env` before any worker thread or child process starts, sent only in the `x-api-key` header, and redacted from every event, log line and error. The page only learns whether a key is present.
- **No model identifier appears in code or docs.** The person clicks "Load models" (the API's model list), picks one, and the server accepts only ids from that list.
- If the model leaves out `base_rev` on a `run`, the engine fills in the last revision the agent saw, so a person's save in between gives `REV_CONFLICT` instead of a silent overwrite.

### Engine B: the person's own Claude Code

One `claude -p` child process per prompt, and `--resume <session id>` for follow-ups. The flags below were checked against the Claude Code documentation at https://code.claude.com/docs on 2026-11-05 (CLI reference, headless mode, permissions and permission modes):

| Flag or setting | Why |
|---|---|
| prompt sent over stdin, never in argv | any local account can read a process's argv |
| working folder: a private, empty temporary folder (mode 0700) | no project `.mcp.json`, hooks or instructions are picked up from it |
| `--mcp-config <file>` naming only `open3dj mcp --root <project>`, plus `--strict-mcp-config` | the person's other MCP servers are not loaded |
| `--tools ""` | no built-in tools (no shell, file or web tools) |
| `--allowedTools mcp__open3dj__*` and `--permission-mode dontAsk` | the five Open3DJ tools run without prompts; anything else is denied, never asked |
| `--safe-mode` | the person's own CLAUDE.md, hooks, plugins and skills do not load. `--bare` is not used: it skips the subscription login |
| `--output-format stream-json --verbose`, `--max-turns <rounds>` | machine-readable progress and the round limit |
| `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` removed from the child's environment | otherwise a key pays instead of the person's plan |

Before the first prompt, `claude auth status` must report a claude.ai login. On the `system/init` event, the child is stopped if its tool list holds anything other than the five Open3DJ tools, or its MCP server list holds anything other than a connected `open3dj`. Stop sends SIGINT to the process group, then SIGTERM. A minimum Claude Code version is pinned once these flags are confirmed on a real install.

Anthropic's documentation does not clearly allow or forbid an application that runs the person's own, unmodified, locally installed Claude Code with the person's own login (https://code.claude.com/docs/en/legal-and-compliance, checked 2026-11-05). So Engine A is the default, Engine B is an explicit opt-in that says this on screen, and the project asks Anthropic for written confirmation before Engine B is advertised.

### The egress approval, ahead of the S5 approval service

No prompt, project content or tool result leaves the machine until the person approves a card that `open3dj view` itself creates and checks. The one request without a card is the model list that "Load models" fetches: it sends only the API key, to the same API host, when the person clicks. The card shows:

- the engine and who pays ("billed to the API key in ANTHROPIC_API_KEY", or "uses your Claude Code login and plan limits");
- the host (`api.anthropic.com`, or "through Claude Code");
- the model (for Engine B, the one Claude Code reports when it starts);
- the project;
- what is sent: the prompt, the conversation so far, Open3DJ's instructions and tool list, and during the turn the tool results from this project (reports, scripts, part and face names, error text and drawing PNGs), up to the round limit;
- the limits and the budget left.

Send needs the card's payload hash. A card expires after 10 minutes and covers one prompt. "Don't ask again until this viewer stops (same engine, model and limits)" is offered only on the computer's own page, never on a paired device. A reply typed in the chat is never an approval, the same rule as for MCP elicitation and the viewer selection ([ARCHITECTURE.md](../docs/ARCHITECTURE.md) section 12). Each approval is written to an owner-only egress log in the user's state folder and to the provenance `approvals[]` of every revision the turn creates. When the S5 approval service ships, it takes over these cards.

Limits come only from CLI flags (rounds per prompt, session input and output tokens, a turn timeout). The page cannot raise them. Defaults: 12 rounds per prompt, 4,000,000 input tokens and 200,000 output tokens per session.

### Two viewer fixes that come first

1. **The file watcher re-runs agent commits.** A successful agent `run` rewrites the project's `main.o3j.js`; the watcher sees a change and runs it again. With `--param`, that run overrides the agent's value and makes a new revision. When the viewer watches a script outside the project, the person's next save silently replaces the agent's work. The fix: skip a watcher run when the file equals the head revision's script; watcher runs pass `base_rev`; and an agent's revision is written back to the watched script only when the file is unchanged since the viewer last ran it, with a conflict notice otherwise (`--no-sync-script` turns the write-back off). This already affects agents that use `open3dj mcp` with the viewer open, so it ships on its own.
2. **A cookie replaces the nonce in the URL.** The first visit trades the one-time nonce for an `HttpOnly; SameSite=Strict` cookie and moves to a path without it. This closes the residual risk that [ARCHITECTURE.md](../docs/ARCHITECTURE.md) section 12 says must close before the page writes design data. A cookie is sent to every port on 127.0.0.1, so the existing Origin, Host and `Sec-Fetch-Site` checks stay, and that residual risk is documented. The same change checks whether today's automatic browser open (a redirect from a local file) is refused by the `Sec-Fetch-Site: cross-site` check, and fixes it if so.

Both fixes merged on 2026-11-08: the cookie in #32 and the watcher in #35. As built, the cookie is set on a small bounce page after the one-time link, because a `SameSite=Strict` cookie set during a cross-site redirect is not sent on the next request; the automatic browser open was refused and now works. A save that an agent's revision overtakes while it runs is kept in `.o3j-view/unrun.o3j.js`, and a save based on an older revision is refused with `REV_CONFLICT` and shown as a conflict. `packages/open3dj/src/view.ts` describes both in its header comment.

### The Wi-Fi link (`--lan`)

Off by default and never remembered: it is turned on for one run of `open3dj view` at a time.

- A second listener on one private address only (RFC 1918 or IPv6 unique local). Public, link-local, carrier-grade NAT and wildcard addresses are refused. The loopback listener is unchanged.
- **HTTPS only**, with a self-signed certificate that Open3DJ makes with `node:crypto`. Its fingerprint is printed in the terminal and shown on the computer's page. Plain HTTP is never offered, because anyone on the same Wi-Fi could read designs and prompts or take over the session. HTTPS with a self-signed certificate stops only passive listeners: the device shows a certificate warning either way, so an active attacker on the network (a spoofed address or a rogue access point) could sit in the middle unless the person checks the fingerprint.
- Pairing: the terminal and the computer's page show a one-time link and QR code that expire after 120 seconds. The device shows a 6-digit code, and the person allows it on the computer. Before allowing, the person compares the certificate fingerprint the device's browser shows with the one on the computer's page, which shows the two side by side with the code; a mismatch means someone is in the middle, and the computer's page says so. Only then does the device get its own `HttpOnly; Secure; SameSite=Strict` cookie.
- Each device can be revoked from the computer's page. Requests that are not paired get only the pairing routes; everything else is a plain 404. Per-address rate limits are tight. A paired device approves one prompt at a time, never a session.

## Security and privacy

| Threat | Control |
|---|---|
| A web page or local process starts prompts or approves egress | Cookie session, page Origin and `Sec-Fetch-Site` checks, JSON only with a size cap, a separate token bucket for prompts, one turn at a time; the approval needs the card's hash. Residual, as [ARCHITECTURE.md](../docs/ARCHITECTURE.md) section 12 records for the viewer: a browser sends the cookie to every port on 127.0.0.1, so any local server the browser visits receives it, whoever runs that server; and the printed one-time link is worth as much as the cookie until it is used. A holder of either can do what the page can, which with the panel means starting paid prompts, approving cards (the page reads the card's hash) and writing revisions. Any process of the same user that can read the browser's cookies can do the same, as in S5 |
| Prompt injection through project content (comments, part names, error text) steering the model | Every tool step is shown with its script; human-only gates stay refused by the handlers (`WAIVER_NEEDS_PERSON`); limits come only from CLI flags; nothing from a project folder is loaded into the model's context as history; revisions are append-only and reversible; the injected `base_rev` stops silent overwrites |
| The API key leaking | Read once, removed from the environment before any worker or child starts, sent only in one header, redacted everywhere, never sent to the page; no setting can change the API host |
| Engine B loading more than intended | `--tools ""`, `--strict-mcp-config`, `--safe-mode`, `dontAsk`, a private empty working folder, a scrubbed environment, and the start check that stops the child on any unexpected tool or server |
| The Wi-Fi link | Off by default, private address only, HTTPS only, pairing confirmed on the computer after comparing the certificate fingerprint, per-device revoke, tight limits, one-prompt approvals from devices. Residual: an active attacker on the network can relay pairing, or take the device cookie after a certificate warning is clicked through, when the person does not compare the fingerprint |
| Data leaving the machine | The approval card before every prompt, or once per viewer run when the person chooses "Don't ask again" on the computer's own page; recorded in the egress log and in provenance. Residual: "Load models" sends the API key to the API host without a card |

The trigger in [ARCHITECTURE.md](../docs/ARCHITECTURE.md) section 12 changes from "before any non-loopback transport or remote mode" to "before any non-loopback transport that a party not paired on this computer can use to start scripts, before remote mode (any address outside RFC 1918 or IPv6 unique local, tunnels or relays), or after any sandbox finding". The first sandbox finding or report of misuse over the Wi-Fi link turns `--lan` off until the OS sandbox ships. Scripts still run only in the QuickJS-WASM worker, exactly as when any MCP agent writes them today.

## Dependencies and licenses

None. The certificate encoder, the QR code encoder and the server-sent-events parser are written for Open3DJ under its MIT license.

## Alternatives

- **Do nothing.** People keep using a terminal or their own agent client. This does not meet the request, and an iPad cannot run either.
- **The official TypeScript SDK for Engine A.** Better maintained, but it fails the licence gate today. Revisit if the allowlist decision changes.
- **The Claude Agent SDK.** A new dependency with its own license review, and it brings built-in tools we would have to switch off.
- **A separate `open3dj chat` process.** A second server, a second login and a second port to secure, for no gain over the viewer that already shows the model.
- **Plain HTTP on the Wi-Fi link.** Rejected: designs, prompts and the session cookie would cross the network in clear text.
- **Waiting for the OS sandbox before the Wi-Fi link.** Safer, but the sandbox is not scheduled before the iPad use the founder asked for. The pairing controls above are the compensating measure, and the trigger change is recorded as the founder's decision.

## Risks and open questions

1. **The security model widens on two fronts**: the page now causes design writes and spends money, and project content can steer the model. The controls are in the table above; the residual risks are recorded in [ARCHITECTURE.md](../docs/ARCHITECTURE.md) section 12 when the code ships.
2. **The Wi-Fi link comes before the OS sandbox.** It ships last, HTTPS only, and is turned off by the first misuse report. To check by hand: that iPadOS Safari accepts the self-signed certificate for an IP address and keeps the `Secure` cookie.
3. **Engine B rests on a surface Open3DJ does not control.** Claude Code's flags and output can change between releases. The start check, a minimum version, the fake-`claude` contract tests and the monthly manual client checklist catch drift. Open questions: the minimum version for `--safe-mode`, the exact stdin form for `-p`, and Anthropic's confirmation of the terms question above.

## How we will know it worked

- **Kaizen metric:** the share of prompts that end in a valid revision without the person touching the file. Recorded in the build log from the founder's manual checklist: 3 prompts per engine on `examples/enclosure`.
- **Checks:** offline tests at every stage, including refusal tables for every route (Origin, type, size, rate, `--agent off`), a fake Messages API on 127.0.0.1 and a fake `claude` script. No test calls the network ([AGENTS.md](../AGENTS.md)).
- **Exit for the Wi-Fi link:** an iPad pairs, prompts once and is revoked, recorded in the build log.

## Plan

Each pull request is about 400 changed lines, in the maintainer lane.

| # | Change |
|---|---|
| 1 | Cookie replaces the URL nonce; check and fix the automatic browser open |
| 2 | File watcher coordination (the first viewer fix) |
| 3 | `callTool()`; the `packages/agent` skeleton: tool mapping, result mapping, system prompt |
| 4 | Server-sent-events parser and the fake Messages API; model listing; the turn loop with limits, Stop, retries, refusals and output limits |
| 5 | Approvals, budget ledger, egress log, the `agent-event` schema; the agent session with replay |
| 6 | Wiring into `open3dj view`: routes, flags, key handling |
| 7 | The Agent tab: transcript, composer, Stop, approval card, model picker, usage |
| 8 | Engine B: start, isolation, start checks, events, follow-ups, Stop |
| 9 | The Wi-Fi link: certificate, listener, pairing, devices, QR code |
| 10 | Docs and roadmap placement, and the build-log result |

Pull requests 1 and 2 fix today's viewer and stand on their own; they merged as #32 and #35. Pull requests 3 to 5 add code that nothing calls yet; they merged as #49 and #51 (step 3), #52, #53 and #55 (step 4), and #56 and #59 (step 5). Pull requests 6 to 9 wait for the decision.

## Decision

To be filled in at the end of the final comment period.
