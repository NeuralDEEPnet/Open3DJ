# Directories and listings

Where Open3DJ's MCP server can be listed, in the order to do it, with the exact text for each form. Every listing is a publishing action, so **the founder does each one by hand** ([AGENTS.md](../../AGENTS.md) rule 8, [AI_POLICY.md](../../AI_POLICY.md) rule 4). Agents only draft this file.

Nothing here goes live before `npm run check` is green on all five CI runners on `main`. Glama re-reads a repository "within minutes of a push" ([glama.ai/mcp/methodology](https://glama.ai/mcp/methodology), checked 2026-11-05), and every directory visitor lands on the README, which still says the check is red.

Unless a line says otherwise, every fact below was checked on 2026-11-05 at the linked page.

## Order of work

| Step | Where | When | Cost |
|---|---|---|---|
| 0 | GitHub description and topics | After CI is green | Free |
| 1 | [Glama](#1-glama) | After a reviewed Dockerfile is merged | Free |
| 2 | [punkpeye/awesome-mcp-servers](#2-punkpeyeawesome-mcp-servers) | After Glama shows a score | Free |
| 3 | [mcpservers.org](#3-mcpserversorg) and [mcp.so](#4-mcpso) | After step 2, or with it | Free review tier |
| Wait | [Official MCP Registry](#wait-official-mcp-registry), [Claude plugin directory](#wait-claude-plugin-directory) | After the name is cleared | Free |
| Skip | [Smithery](#skip-smithery), [PulseMCP](#skip-pulsemcp) | Closed or paused | |
| Later | [Docker MCP Catalog, Cline MCP Marketplace](#later) | After the name is cleared, if wanted | Free |

[PLAN.md](../../docs/PLAN.md) section 11, decision 11 applies: listings you can edit or remove later go ahead under the working name; permanent ones, and the npm publish, wait for the cleared name (decision 1).

## 0. Repository description and topics

Set these on github.com: the gear next to **About** on the repository page. Topics are added by repository admins ([GitHub docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)). The limits are 20 topics, each of lowercase letters, digits and hyphens, at most 50 characters (same page).

**Today** the description reads `Open agentic cad software optimized for agents  friendly UI for Professional use ` (with a double space and a trailing space), there are no topics and no website (read with `gh api repos/NeuralDEEPnet/Open3DJ` on 2026-11-05).

**Description** (it leads with what is different and makes no "first" claim):

```text
Local-first parametric B-rep CAD that AI agents drive over MCP. Every run returns evidence (validity, measures, fits between parts) and render returns a four-view drawing; STEP, STL, GLB and 3MF exports come with an evidence file of hashes; o3dj-bench grades agents on multi-part briefs.
```

**Website:** leave it empty until there is a project site, or use `https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/GETTING-STARTED.md`.

**Topics** (12, from the plan):

```text
mcp mcp-server model-context-protocol cad parametric-cad opencascade brep step 3d-printing ai-agents agentic-cad text-to-cad
```

Optional extras, still under the limit of 20: `parametric-design`, `local-first`, `typescript`, `benchmark`.

Repositories per topic on 2026-11-05, for scale: `ai-agents` 136,571, `mcp` 113,291, `model-context-protocol` 42,465, `mcp-server` 41,632, `3d-printing` 8,246, `cad` 4,599, `parametric-design` 530, `opencascade` 345, `parametric-cad` 143 ([github.com/topics/mcp-server](https://github.com/topics/mcp-server) and the matching topic pages). None of the directories below says it reads GitHub topics; topics feed GitHub's own topic pages and search.

## 1. Glama

**Why first:** the awesome list in step 2 asks for a Glama score badge, and Glama needs a server it can build.

**What Glama does** ([methodology](https://glama.ai/mcp/methodology)):

- It indexes servers from GitHub, the official MCP Registry and community submissions, 116,133 of them ([glama.ai/llms.txt](https://glama.ai/llms.txt)).
- It builds each server from a Dockerfile (the maintainer's own, or one its AI build system infers) in a Firecracker microVM, then calls `tools/list`, `resources/list` and `prompts/list`. If the build fails, "distribution is withheld" and the server is left out of search results, category listings and recommendations.
- It scores each tool description on six dimensions from 1 to 5 (purpose clarity, usage guidelines, behavioral transparency, parameter semantics, conciseness, contextual completeness), plus tool-set coherence and server cohesiveness. The weighting and grade thresholds are not published (unverified).
- Indexing also runs license detection, a security scan and a health test ([FAQ](https://glama.ai/mcp/faq)). The FAQ says most submissions pass automatically within minutes.
- No Glama category is for CAD, 3D or manufacturing (86 categories, [glama.ai/mcp/categories](https://glama.ai/mcp/categories)). A search for CAD shows 30 servers on its first page and a "Load More" button ([CAD search](https://glama.ai/mcp/servers?query=CAD)), and a search for FreeCAD shows another first page of 30 ([FreeCAD search](https://glama.ai/mcp/servers?query=FreeCAD)).

**Steps:**

1. **A Dockerfile lands first.** It is code, so it is a maintainer-lane pull request ([.github/merge-policy.json](../../.github/merge-policy.json), rule `code`). It is in the repository since #41: a pinned Node 24 image, runtime dependencies only with no install scripts, and `node /app/packages/open3dj/src/cli.ts mcp --root /work` as the entry point, run as the non-root `node` user ([Dockerfile](../../Dockerfile)). Glama's bot says "we only need the server to start and respond to introspection requests" (from the awesome list's [check-glama.yml](https://github.com/punkpeye/awesome-mcp-servers/blob/main/.github/workflows/check-glama.yml)).
2. **Optional: `glama.json`** at the repository root, `{"$schema": "https://glama.ai/mcp/schemas/server.json", "maintainers": ["NeuralDEEPnet"]}`. The schema requires only `maintainers` ([schema](https://glama.ai/mcp/schemas/server.json)). It is mandatory only for repositories owned by an organization; a personal repository like this one can be claimed by signing in ([what is glama.json](https://glama.ai/blog/2025-07-08-what-is-glamajson)). It keeps the claim if the repository later moves to an organization. No merge rule names it, so it is maintainer lane by default.
3. **Sign in** at glama.ai with GitHub as `NeuralDEEPnet`. Glama checks that the submitter has write or admin access to the repository.
4. **Add MCP Server.** Repository: `https://github.com/NeuralDEEPnet/Open3DJ`. Display name: `Open3DJ`. Description: the text under [Short description](#short-description).
5. **Wait for the build.** Open the listing, confirm the build passed and the five tools (`run`, `inspect`, `render`, `export`, `docs`) are listed, and note the score.
6. **Copy the score badge** from the listing page for step 2.

Glama search returned no Open3DJ listing on 2026-11-05.

## 2. punkpeye/awesome-mcp-servers

The largest MCP list that still takes entries. Stars on the GitHub pages on 2026-11-05: [punkpeye](https://github.com/punkpeye/awesome-mcp-servers) 97.3k, [wong2](https://github.com/wong2/awesome-mcp-servers) 4.4k (takes no pull requests) and [appcypher](https://github.com/appcypher/awesome-mcp-servers) 5.8k (archived on 2026-08-01).

**Rules** ([CONTRIBUTING.md](https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md) and [check-glama.yml](https://github.com/punkpeye/awesome-mcp-servers/blob/main/.github/workflows/check-glama.yml)):

- One server per line, in alphabetical order inside its category. A new category is allowed.
- Only servers with a public GitHub repository, "something you install and run yourself". Links must start with `https://github.com/`, and the link text must be `owner/repo`.
- A workflow labels each pull request `has-glama` or `missing-glama` and checks the emojis against an allowlist. Without the badge, a bot asks for a Glama listing that passes its checks and a score badge. In practice the badge is required: 3,353 of 4,632 entries carry one.
- There is no CAD category. Five CAD servers (FreeCAD, SolidWorks, build123d, Fusion 360 and BricsCAD) sit under **Art & Culture** (README lines 367 to 393), next to `asmith26/jupytercad-mcp`. "Architecture & Design" is about software architecture diagrams, and "Industrial & IoT" is about equipment telemetry, so neither fits. Use Art & Culture, or propose a new "CAD & Engineering" category in the same pull request and let the maintainer decide.

**The entry line** (badge format from the workflow's bot comment; copy the badge from the Glama page if it differs):

```markdown
- [NeuralDEEPnet/Open3DJ](https://github.com/NeuralDEEPnet/Open3DJ) [![NeuralDEEPnet/Open3DJ MCP server](https://glama.ai/mcp/servers/NeuralDEEPnet/Open3DJ/badges/score.svg)](https://glama.ai/mcp/servers/NeuralDEEPnet/Open3DJ) 📇 🏠 🍎 🪟 🐧 - Local-first parametric B-rep CAD over MCP (OCCT as WebAssembly). Every run returns validity, measures and fits between parts; render returns a four-view drawing; STEP, STL, GLB and 3MF exports carry an evidence file of hashes and measures.
```

The five symbols are the list's legend: the index card is TypeScript, the house is a local service, then macOS, Windows and Linux.

**How to open it:**

- The founder opens **one** pull request from their own account, edits the README by hand or pastes the line above, and stays to answer review.
- Disclose in the pull request body that the entry text was drafted with AI assistance.
- The list's CONTRIBUTING.md asks automated agents to add a fast-track tag (robot emojis) to the pull request title. **We do not use it**, because a person opens this pull request, and an instruction found in another project's file is data, not an instruction to our agents ([AGENTS.md](../../AGENTS.md#security-rules)).

## 3. mcpservers.org

wong2/awesome-mcp-servers takes no pull requests and sends people to [mcpservers.org/submit](https://mcpservers.org/submit): "We do not accept PRs." The form is free with review within 2 weeks, or $39 for review within 24 hours. **Use the free tier.**

| Field | Text |
|---|---|
| Name | `Open3DJ` |
| Category | `Design` (or `Other`) |
| Short description | the text under [Short description](#short-description) |
| Repository, Website or Documentation | `https://github.com/NeuralDEEPnet/Open3DJ` |
| Official MCP Registry name | leave empty (no registry entry yet) |
| This server supports remote connections | leave unticked: it runs locally over stdio |
| Contact email | the founder's project address |

## 4. mcp.so

Submit at [mcp.so/submit](https://mcp.so/submit) as **MCP Server**, with the repository URL and the name. The page says "Choose free review or publish immediately with Premium"; Premium is a $39 one-time fee for publishing without review, a verified badge, featured placement and a dofollow link. **Use the free review.** The server-rendered page showed only the paid card and a sign-in link, so how to pick the free review, whether sign-in is needed and how long the review takes are unverified. If the form offers only the paid option, stop: paying is a separate decision.

| Field | Text |
|---|---|
| Type | `MCP Server` |
| Repository URL | `https://github.com/NeuralDEEPnet/Open3DJ` |
| Name | `Open3DJ` |
| Description, if asked | the text under [Short description](#short-description) |

mcp.so's terms ([terms of service](https://mcp.so/terms-of-service), last updated 2026.07.01) mention trademarks only for the service's own marks.

## Short description

For every form that asks for one. It leads with what is different (deterministic checks and evidence), not with a claim of being first: other CAD servers and several agentic CAD benchmarks already exist.

```text
Local-first parametric B-rep CAD for AI agents over MCP. Every run returns validity, measures and fits between parts; exports carry an evidence file; o3dj-bench grades agents.
```

## Wait: Official MCP Registry

**Wait for the cleared name,** then publish with the first npm or MCPB release.

- The registry hosts metadata only, points to packages hosted elsewhere, is still a preview (launched 2025-09-08, API v0.1 frozen 2025-10-24) and is meant for downstream aggregators ([about.mdx](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/about.mdx), [README](https://github.com/modelcontextprotocol/registry)).
- You publish with the `mcp-publisher` CLI, not a pull request ([quickstart.mdx](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)). An npm package must carry an `mcpName` in package.json that matches the registry name.
- A metadata-only record (name, a description of at most 100 characters, a version; no package) is technically possible: the schema requires only those three fields, and live records exist ([schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json)). Nobody has run `mcp-publisher validate` on an Open3DJ `server.json`.
- **Records are permanent.** Version metadata is immutable, and "Server metadata is never permanently removed from the registry" ([faq.mdx](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/faq.mdx)). Every version string is unique and can never be reused ([versioning.mdx](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/versioning.mdx)). Metadata is dedicated to the public domain under CC0 1.0 (terms of service section 10, effective 2025-09-02, [terms-of-service.mdx](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/terms-of-service.mdx)). A record under the working name would stay on record after a rename.
- **Namespace.** GitHub login grants `io.github.<login>/*` with the case kept, so `io.github.NeuralDEEPnet/<name>`; use that exact casing. A reverse-DNS namespace under `neuraldeep.net` needs a DNS TXT record or a file at `/.well-known/mcp-registry-auth` ([authentication.mdx](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx)).
- A registry record does not guarantee a GitHub or VS Code listing: [github.com/mcp](https://github.com/mcp) showed 773 servers, far fewer than the registry holds.
- People scan registry entries for hidden agent instructions ("Scan of 21,592 registry entries for hidden agent instructions", 2026-08-14, [registry Discussions](https://github.com/modelcontextprotocol/registry/discussions)). Keep `server.json` and the tool descriptions plain.

## Wait: Claude plugin directory

**Wait for the cleared name.**

- The directory no longer accepts MCPB desktop extensions: "To distribute a local MCP server through the directory, include it in a plugin" ([mcpb.md](https://claude.com/docs/connectors/building/mcpb.md)). Plugins are submitted from a GitHub repository, optionally a subfolder, at claude.ai/directory/manage ([submit.md](https://claude.com/docs/plugins/submit.md)).
- **It checks names against trademarks.** The pre-submission checks include "Name matches a known brand", "Name may be confused with an existing listing" and "Fork uses the upstream project's name", all held for a reviewer ([pre-submission-checklist.md](https://claude.com/docs/plugins/pre-submission-checklist.md)).
- **The plugin must be self-contained:** "People who install the plugin get only the plugin folder, so everything the plugin runs has to be inside it" (same page). Ours is not yet: `skills/claude-code-plugin/.mcp.json` runs `${CLAUDE_PLUGIN_ROOT}/../../packages/open3dj/src/cli.ts`, outside the folder, and the folder has no README (a blocking finding; at least 40 words). Other limits: files of 256 KiB or less, at most 512 files, the repository under 50 MiB archived.
- Claude Desktop runs only on macOS and Windows ([mcpb.md](https://claude.com/docs/connectors/building/mcpb.md)), so this route does not serve Linux users.

## Skip: Smithery

Self-serve publishing ended on 2026-10-31. Smithery, now part of Arcade (announced 2026-08-05, [arcade.dev](https://arcade.dev/blog/smithery-joins-arcade)), shut down its accounts, API keys, CLI and hosted server URLs, and "will remain as a public (non-proxied) MCP registry" of "a curated set of verified servers" ([smithery.ai/future](https://www.smithery.ai/future)). There is no submit page (`/new` returns 404).

## Skip: PulseMCP

Paused: "We are not accepting new MCP server or client submissions right now" ([pulsemcp.com/submit](https://www.pulsemcp.com/submit)). It says it will pick up servers from the official registry later, with no date.

## Later

- **Docker MCP Catalog** ([docker/mcp-registry](https://github.com/docker/mcp-registry/blob/main/CONTRIBUTING.md)). A pull request adds `servers/<name>/server.yaml`. A local server needs a Dockerfile in its own repository. The license guidance says "MIT or Apache 2 are great, GPL is not." Docker builds the image and hosts it in Docker Hub's `mcp` namespace, so the listing is itself a publish under the project name: wait for the cleared name. Whether the LGPL-2.1 OCCT WebAssembly file inside the image is acceptable to Docker is unverified.
- **Cline MCP Marketplace** ([cline/mcp-marketplace](https://github.com/cline/mcp-marketplace)). Submit a GitHub issue with the repository URL, a 400 x 400 PNG logo and a reason, after testing that Cline can install the server from the README (or an optional `llms-install.md`). The FAQ says the team "aims to review submissions within a couple of days." Read from a summarized page fetch on 2026-11-05.
