# Gap 6: MCP 2026-07-28 client support and rmcp readiness (checked 2026-10-27)

## Bottom line
- MCP 2026-07-28 is final. It removes `initialize`, adds `server/discover`, Multi Round-Trip `input_required` (SEP-2322) and the Tasks extension (SEP-2663). [1][2]
- Of the five target clients, only **Claude Code** speaks 2026-07-28 by default. Codex has it behind a flag that is off by default. Gemini CLI, Cursor and VS Code Copilot still open with `initialize`.
- Two of those clients, **Codex and Gemini CLI, send 2025-06-18**, not 2025-11-25. The legacy floor has to be 2025-06-18.
- The plan's line "older clients are served by negotiating through server/discover" is wrong. The spec says legacy clients have no fall-forward mechanism. A **dual-era** server has to answer `initialize` and keep a legacy session. [3]
- **rmcp 1.4 implements none of 2026-07-28.** Its `LATEST` is 2025-06-18. The current release is **rmcp 3.8.0** (crates.io, 2026-10-26). From 3.1 on it implements discover, MRTR, Tasks and stateless HTTP while still answering `initialize`. [4][5]

## Client matrix

| Client (version checked) | What it negotiates by default | 2026-07-28 | Elicitation | Tasks |
|---|---|---|---|---|
| Claude Code 2.1.312 | Probes 2026-07-28 and falls back to legacy (dual-era). Default for stdio since 2.1.292, direct HTTP since 2.1.274, claude.ai connectors since 2.1.295. `MCP_PROTOCOL_NEGOTIATION=legacy` opts out. [6][7] | Yes, including `input_required` and URL-mode elicitation (2.1.281) | Form and URL. **Elicitation hooks can answer automatically.** Non-interactive sessions cancel input requests. [7][8] | SEP-2663 public beta from 2.1.304, only on 2026-07-28 connections [7] |
| Codex CLI 0.165.0 (main pins rmcp =3.5.1) | Legacy `initialize` with **2025-06-18**. Feature `mcp_2026_07_28` is "UnderDevelopment" and off by default. Even with the flag on, stdio servers stay legacy unless they set `CODEX_MCP_PROTOCOL_VERSION=2026-07-28`. [9] | Opt-in only | Yes (`elicitation/create` handled) [9] | No evidence |
| Gemini CLI 0.66 / 0.67-nightly | Pins `@modelcontextprotocol/sdk` 1.23.0, whose `LATEST_PROTOCOL_VERSION` is **2025-06-18** [10][11] | No | **None**: the client declares only `roots` [10] | No |
| Cursor 3.21.x | "2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05". A responder said "No timeline" for 2026-07-28 (Sep 2026). [12] | No | Form mode since 1.5. Windows hang reported. [13] | Unknown |
| VS Code Copilot (main, 2026-10-27) | `initialize` with `LATEST_PROTOCOL_VERSION = "2025-11-25"`. Issue #329848 is open with no milestone. [14][15] | No | Form and URL [14] | **2025-11-25 experimental** tasks (`tasks/list`, `tasks/result`), which are not SEP-2663 [14] |

The completeness review said no client is on 2026-07-28. That is out of date: Claude Code is. The conclusion still holds, though. Most clients are legacy, and some are older than 2025-11-25.

## rmcp facts (3.8.0 source and CHANGELOG)
- `ProtocolVersion::KNOWN_VERSIONS` covers 2024-11-05 through 2026-07-28. `LATEST_WITH_INITIALIZE` is 2025-11-25. `ServerHandler::supported_protocol_versions` and `negotiate_initialize` exist (3.3.0). [5]
- 3.0.0-beta.1 added discover/negotiation (SEP-2575), MRTR (SEP-2322), SEP-2663 Tasks and stateless serving (SEP-2567). `legacy_session_mode` applies only below 2026-07-28. [5]
- Era-gating is strict:
  - `InputRequiredResult` returned to a legacy peer becomes an `invalid_request` error.
  - `peer.elicit()` returns an error on 2026-07-28 peers, because server-to-client requests are not allowed there.
  - A task result needs the client's tasks capability.
  - The 2025-11-25 experimental task methods are gone; only `tasks/get|update|cancel` remain. [5]
- The crate moves fast: nine 3.x releases since 2026-07-28, with breaking changes in the 3.0 betas. Pin the exact minor version. [4]

## What changes in the plan
1. **Dependency:** replace rmcp 1.4 with rmcp `=3.8` (3.6 or later is needed for the server-to-client rejection fix). Run it as a **dual-era server** on stdio and Streamable HTTP. Modern `_meta` requests are served statelessly. `initialize` opens a legacy session that negotiates 2025-11-25, 2025-06-18 and 2025-03-26.
2. **Consent cannot rest on MRTR or elicitation alone.** Model each quote, proposal or egress as a daemon-owned **approval object** (`pending → approved/denied`), approved only in the Open3DJ desktop UI or a local page protected by a nonce. Delivery adapters:
   - modern clients: MRTR `input_required` carrying **URL-mode** elicitation to that page;
   - legacy clients with elicitation: `elicitation/create` (URL mode where 2025-11-25 allows it, otherwise form mode with a link);
   - Gemini CLI, headless and non-interactive runs: a normal tool result `approval_pending{url, id}` plus an `approvals.get` poll tool.

   An `accept` that arrives over MCP is never proof of human consent, because Claude Code Elicitation hooks can return `accept` with content automatically. [8]
3. **Long jobs:** the universal path is Open3DJ's own job model: `job_id` from the tool, then `jobs.get`/`jobs.cancel`, progress notifications and resources. SEP-2663 Tasks is an optional enhancement for Claude Code 2.1.304 and later. Do not build the 2025-11-25 experimental tasks; rmcp 3.x dropped them.
4. **Concurrency without transactions:** key all daemon state on explicit revision or ETag tokens in tool arguments. Never key it on `Mcp-Session-Id` or protocol session; legacy sessions exist and modern ones do not.
5. **Week-12 agent surface:** every core capability must work over plain `tools/list` and `tools/call` on 2025-06-18. 2026-07-28 features are layered on top.
6. **CI conformance matrix:** test Claude Code in default and `legacy` modes, Codex with the flag off and on, Gemini CLI, VS Code, the MCP conformance suite, and the rmcp client in `Auto` mode.

## Sources
1. https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
2. https://github.com/modelcontextprotocol/modelcontextprotocol/releases
3. https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
4. https://crates.io/crates/rmcp (API: versions 1.4.0 = 2026-04-10, 3.0.0 = 2026-07-28, 3.8.0 = 2026-10-26)
5. https://github.com/modelcontextprotocol/rust-sdk (README, crates/rmcp/CHANGELOG.md, rmcp-3.8.0 src/model.rs, src/handler/server.rs, src/service/server.rs)
6. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md (2.1.274, 2.1.281, 2.1.292, 2.1.295, 2.1.299, 2.1.302, 2.1.310)
7. https://code.claude.com/docs/en/mcp
8. https://code.claude.com/docs/en/hooks (Elicitation hook: action accept/decline/cancel + content)
9. https://github.com/openai/codex: codex-rs/Cargo.toml, codex-rs/features/src/lib.rs (`mcp_2026_07_28`, default_enabled false), codex-rs/rmcp-client/src/protocol_mode.rs; npm @openai/codex latest 0.165.0
10. https://github.com/google-gemini/gemini-cli: packages/core/package.json, packages/core/src/tools/mcp-client.ts
11. https://www.npmjs.com/package/@modelcontextprotocol/sdk/v/1.23.0 (dist/cjs/types.js `LATEST_PROTOCOL_VERSION = '2025-06-18'`)
12. https://forum.cursor.com/t/mcp-client-cannot-connect-to-modern-only-2026-07-28-streamable-http-servers-legacy-initialize-rejected/172536
13. https://forum.cursor.com/t/mcp-elicitation-create-hangs-agent-on-windows-in-cursor-3-10-20-but-works-on-macos/165391
14. https://github.com/microsoft/vscode: src/vs/platform/mcp/common/modelContextProtocol.ts, src/vs/workbench/contrib/mcp/common/mcpServerRequestHandler.ts
15. https://github.com/microsoft/vscode/issues/329848
