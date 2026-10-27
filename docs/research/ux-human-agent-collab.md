# Professional UI and Human-Agent Collaboration Patterns for Agent-First CAD

Research dimension for Open3DJ, 2026-10-27. Method note: the shared web-search budget was exhausted before this sweep, so all facts come from direct fetches of primary sources (vendor docs, changelogs, GitHub, specs, arXiv). Unreachable pages (FreeCAD wiki/forum behind Anubis, Autodesk help/forums 403, Onshape forum SSO, Reddit) are stated and those claims are marked lower confidence.

## Executive summary

Every serious CAD vendor now ships or previews an AI agent, but as of October 2026 none has solved the human-agent collaboration loop that an agent-first CAD tool needs. Zoo Design Studio (v1.5.2, 2026-10-21) is the most advanced: its Zookeeper agent writes KCL code, sees the model through self-triggered snapshots, is "aware of what you have selected" (face, edge, feature or part), reads an `AGENTS.md` project-conventions file, and can "compare the model before and after" a migration. But its viewport is a video stream from a hosted engine, its public docs never describe how an agent edit is reviewed, accepted, rejected or undone, and its community forum's top threads are connection failures and "Zookeeper hanging". Adam (copilot for Onshape, Fusion, SolidWorks) argues in "The Bitter Lesson of AI CAD" (2026-05-24) that the whole harness collapses to two tools, code generation and view-screenshot, and explicitly does not address human review ("let them cook"). Onshape's AI Advisor (April 2025) "does not generate designs"; PTC previewed 12 agents at PTC Next (June 2026) with no public workflow details; Autodesk's AU 2026 AutoTimeline/AutoAssemble and Dassault's Leo/Marie/Aura companions are pre-beta or consumption-priced cloud features with no documented approval UX. Meanwhile the review patterns that do work well exist outside CAD: Claude Code's side-by-side diff with per-change accept/reject, plan mode, an auto-mode classifier with an explicit destructive-command block list and a "3 blocks in a row pauses auto mode" fallback; Cursor's checkpoints, run modes (Auto-review / Allowlist / Run Everything) and sandbox; Figma Make's point-and-edit, version history that "tracks every AI and manual edit", and plan mode; and Onshape's own Compare tool (Base blue / Target red overlay plus feature-list diff), presence indicators and Follow mode. The MCP 2025-06-18 spec itself says there "SHOULD always be a human in the loop with the ability to deny tool invocations" and gives `readOnlyHint`/`destructiveHint`/`idempotentHint` annotations plus elicitation (accept/decline/cancel) as the protocol-level hooks. Open3DJ's opportunity is to be the first CAD where an agent edit is a first-class, reviewable, geometry-diffed, feature-tree-native transaction with stable shared references, local 60 fps rendering, and professional mouse/keyboard conventions from day one.

## 1. State of the art: how current tools let humans and agents co-edit

**Zoo Design Studio / Zookeeper (zoo.dev).** Design Studio is at v1.5.2 (page says "Last updated October 21, 2026"), runs on Mac, Windows and Linux and in the browser, and is built on Zoo's own engine. The app repo (KittyCAD/modeling-app, MIT, ~1.3k stars) states: "The 3D view in Design Studio is just a video stream from our hosted geometry engine" and "The app sends new modeling commands to the engine via WebSockets." The UI stack is React, Headless UI, TailwindCSS, XState, CodeMirror with a custom WASM LSP. Zookeeper (announced 2026-02-05) can "view and interpret your model from any angle", "by default triggers snapshots to review and validate its own modifications", and uses mouse-highlighted bodies, features, faces or edges in its prompts. The Zookeeper docs add: "When you point at a face, an edge, a feature, or a part, the agent understands that context", output is "real models with a full feature tree and editable parameters", conventions go in an `AGENTS.md` file, the agent "maintains its own Markdown working documents in the project", and there are Auto/Standard/Thoughtful modes (Free users get Auto). A documented limitation: "point-and-click tools cannot currently edit sketches inside custom KCL function bodies." Launch pricing (Feb 2026): Free $10/month Zookeeper credit then $0.50/min; Plus $20/month ~400 min; Pro $99/month unlimited. KCL 3.0 (2026-10-08) is the first breaking language change, requires Design Studio 1.5, and Zookeeper "can also compare the model before and after to catch unintended changes" during migration. The May 2026 sketch redesign (Design Studio 1.2) introduced the `ezpz` constraint solver (Rust, MIT, 54 stars), sketch blocks with constraints in code, shortcuts B=Parallel, D=Dimension, V=Vertical, and a colour convention: blue = underconstrained, white = fully constrained. None of the Zoo pages describe where the chat lives, how an agent edit is shown as a diff, or an accept/reject gate.

**Adam (adam.new).** "AI CAD copilot for hardware teams" working across Onshape, Fusion and (via a desktop connector) SolidWorks and local apps; plans Free/Pro/Max/Team/Enterprise; a versioned REST API, OAuth, and an MCP server for projects and tasks; CADAM is its open-source text-to-CAD tool. The Onshape integration has two modes; only the Onshape extension (from the Onshape App Store) "knows the document you're viewing and your selection". Its 2026-05-24 essay "The Bitter Lesson of AI CAD" says the team deleted "hundreds of feature-specific tools, the CAD DSL, and the plane resolver" and now relies on "Two tools. Code generation and view screenshot... because the models can see now." Human review is not addressed.

**Onshape / PTC.** AI Advisor (launch post dated 04.03.2025) answers questions with citations to docs and videos; it "does not generate designs, predict errors in real time, or make complex engineering decisions". The 2026 changelog (releases 1.210 through 1.222, 2026-01-30 to 2026-10-09) contains no agent entries; AI items are guardrail/markdown improvements and an AI-powered thumbnail document search in Labs (1.221). PTC Next (June 2026) announced "12 new AI agents, 10 new integrations" and previewed "agentic tools within Creo, Onshape, Windchill" with no workflow detail.

**Autodesk Fusion.** AU 2025 (DEVELOP3D, 2025-10-13): "Neural CAD" models, one of which "works more like autocomplete, recreating the modeling steps so users can inspect and edit the history"; Autodesk MCP servers will expose Fusion data to third-party agents; CEO Anagnost: engineers stay "the arbiter and person responsible". AU 2026 (DEVELOP3D, 2026-09-15): AutoTimeline "converts imported geometry into editable parametric parts" and AutoAssemble builds assemblies; no review UX or dates given. Autodesk help and blog pages returned HTTP 403, so Automated Modeling's documented inputs could not be re-verified.

**Dassault / SolidWorks.** 3DEXPERIENCE World 2026 (DEVELOP3D, 2026-03-16): "Virtual Companions" Aura (2025, upgraded), Marie (materials/science) and Leo (engineering/simulation/manufacturing), running on a Mistral model on Outscale; pricing "consumption-based"; Leo's demo in xDesign turned drawings into parametric sketches and ran FEA from a prompt. The "What's New in SOLIDWORKS 2027 - Design" post (2026-10-21) has no agent, only "Performance Assistants" and a persistent colour-coded status bar for graphics performance, mate issues and circular references.

**Coding agents (the reference pattern).** Claude Code in VS Code: "when Claude wants to edit a file, it shows a side-by-side comparison of the original and proposed changes, then asks for permission. You can accept, reject, or tell Claude what to do instead. If you edit the proposed content directly in the diff view before accepting, Claude is told that you modified it"; per-change Accept/Reject buttons (v2.1.275+); a diff with more than 100 changes opens without per-change buttons; the editor selection is auto-attached and `Option/Alt+K` inserts `@file.ts#5-10`. Permission modes: `default` (Manual), `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`. Plan mode ends with "Yes, and use auto mode / Yes, manually approve edits / No, keep planning". Auto mode uses a classifier with a block list (force push, `git reset --hard`, `git clean -fd`, `terraform destroy`, production deploys) and "3 blocks in a row or 20 total pauses auto mode". Cursor: checkpoints snapshot files "before making significant changes" and restore "reverts files only"; run modes Auto-review (allowlist + sandbox + LLM classifier), Allowlist, Run Everything ("Ask Every Time" deprecated in 3.5); File-Deletion and External-File protections; sandbox via Seatbelt (macOS) and Landlock+seccomp (Linux 6.2+); Agent Review with Quick/Deep depth; `/multitask` subagents; and "Artifacts such as screenshots and demo videos help you check whether the software runs without reading every line of the diff."

**Design tools.** Figma Make: "Point and edit: click an element in the preview to style it, swap it, or prompt for a change"; annotations batch several element-level prompts; plan mode "lets you review and edit a structured plan before generation"; "Version history tracks every AI and manual edit" with restore of any iteration. Penpot's MCP server (MPL-2.0, 531 stars) let an LLM "write and execute arbitrary code snippets" against the Plugin API over WebSocket; it was archived 2026-02-03 and merged into the main repo under `mcp`.

**Blender MCP (ahujasid/blender-mcp, MIT, ~32.5k stars).** JSON over TCP on `localhost:9876`, nine tools including `execute_blender_code` (arbitrary Python) and `look` (viewport, camera, multi-angle, render). README: "ALWAYS save your work before using it"; the socket "has no authentication or encryption"; optional `BLENDER_MCP_SAFE_MODE=1` screens for file/process/network access. Issue tracker themes: a ~5-minute timeout per call (#279), connection failures, prompt injection via tool descriptions (#214), telemetry opt-in (#232), and repeated requests for screenshots/rendering (#61, #112). There is no in-app chat and no view of what the agent changed beyond Blender's undo stack.

**Research.** CAD-Assistant (arXiv 2412.13810, rev. Aug 2025) runs a VLLM planner over FreeCAD's Python API with rendering and cross-section tools; CAD-Editor (arXiv 2502.03997) frames text-based editing as "locate-then-infill"; BlenderGym (CVPR 2025) finds "even the strongest tested system struggles with tasks that are relatively easy for human Blender users" and that splitting compute between generation and verification helps. UI takeaway: agents need cheap verification views, and humans need to see what the agent verified.

## 2. How should agent edits appear in the feature tree, and be reviewable and undoable?

No shipping CAD tool documents this. The closest analogues: Onshape Compare (feature lists side by side, "by default only differences are shown", icons for not-identical / only-in-Base / only-in-Target / moved up or down, Feature Studio code diffed line by line); Autodesk's "autocomplete" Neural CAD that recreates "modeling steps so users can inspect and edit the history"; Zoo's claim of "a full feature tree and editable parameters"; and Claude Code's per-change accept/reject with the >100-change fallback.

Recommended model: an agent turn produces a **proposal** = an ordered set of feature-tree operations (insert, edit params, reorder, suppress, delete, rename) plus the resulting geometry. The tree shows the proposal as a collapsible, colour-tagged group ("Zookeeper-style" naming but with the agent's name and turn id), each operation individually acceptable/rejectable, with "accept all / reject all / edit then accept". Accepting commits one undo-stack entry per operation (so Ctrl+Z works at the granularity a professional expects) and a single named checkpoint for the whole turn (Cursor-style "restore to before turn 7"). Rejected operations are kept as a greyed "declined" record in the turn log, not in the tree. Edits the human makes to a proposal before accepting must be reported back to the agent (Claude Code does this). Proposals that fail to regenerate must show the failing feature and the error inline, which is also what the agent gets back.

## 3. How to show geometry diffs

Precedent: Onshape Compare overlays Base in blue and Target in red with a slider controlling how much of each side is visible, plus Show/Hide Part to isolate; FreeCAD 1.0 added rotational-centre indicators and "universal measuring tools"; Zoo's March 2026 update added 0-100 model transparency; Zookeeper can "compare the model before and after" during KCL migration (text only as documented). Nobody renders a per-face change map for agent edits.

Recommended diff stack, in order of cost: (1) numeric delta card (volume, surface area, bounding box, mass, face/edge counts, number of features changed) because it is instant and exact; (2) ghosted before-geometry (translucent, Base colour) under the proposed after-geometry; (3) changed-face colouring computed from face identity (unchanged / modified / added / removed) using persistent references; (4) section-view diff for internal features; (5) a flip toggle (hold a key to see before, release for after), which is the fastest human comparator. Diffs must also be agent tools (for self-checking), returned as structured JSON plus a snapshot image, since Zoo and Adam both report that model vision made their agents work.

## 4. Chat in the viewport vs side panel

Figma Make's "point and edit" (click an element, prompt in place) is the best evidence that element-anchored prompts beat a detached chat for edits; its plan mode shows that bigger tasks still need a document-style panel. Claude Code and Cursor both keep a side panel but pull editor selection into the prompt automatically. Zoo and Adam pull viewport selection into the prompt.

Recommendation: a docked side panel for the conversation, plans and turn history, plus a **contextual prompt** that opens at the cursor when the user presses a key with geometry selected (same mechanic as a command palette). The panel shows the agent's camera and snapshots as thumbnails, so the human sees what the agent looked at. Prompts always carry a serialized selection (see section 5) and the current view/section state.

## 5. Selection sharing: stable references

Three production approaches: Onshape FeatureScript queries ("A query does not reference entities, it simply encodes criteria"; `qCreatedBy` matches geometry created by an operation; `evaluateQuery` resolves at regeneration time); KCL tags and edge references (faces named via `tag = $name`, edges identified "by the faces around it, not by its position in the body's internal ordering", with `sideFaces`, `endFaces` and `index` as a last resort, plus `edgeId` for untaggable edges added March 2026); and FreeCAD's TNP mitigation (Realthunder's algorithm included in 1.0, 2024-11-19, "resiliency against topology changes in a parametric chain", still being extended, with a Q3-2026 grant for TechDraw feature identification). FreeCAD issue #8432 ("User Models break when topological entities change name") had 56 thumbs-up before closing.

Open3DJ should expose one reference format to humans and agents: `ref://<body>/<feature-that-created-it>/<semantic-selector>` with a geometric fingerprint (centroid, normal, area, adjacency hash) for re-resolution and a human label ("top face of boss_3"). Clicking a face in the viewport puts that token on the clipboard and in the prompt; the agent's replies render tokens as hover-highlightable chips; the agent can call `resolve_ref` to get current geometry and `make_ref` to mint one from a pick ray or snapshot coordinate.

## 6. Approval gates for destructive operations

MCP 2025-06-18: tools "SHOULD always [have] a human in the loop with the ability to deny tool invocations"; clients "SHOULD present confirmation prompts to the user for operations" and "show tool inputs to the user before calling the server"; `ToolAnnotations` carry `readOnlyHint` (default false), `destructiveHint` (default true), `idempotentHint` (default false), `openWorldHint` (default true), and "Clients should never make tool use decisions based on ToolAnnotations received from untrusted servers". Elicitation lets a server ask the user for flat primitive fields with accept/decline/cancel. Claude Code's tiers (read-only auto; edits prompt; classifier for the rest; hard-coded never-approve list such as `rm -rf /`) and Cursor's protections (file deletion, files outside workspace, browser) are the mature reference. Blender MCP's "ALWAYS save your work" is the anti-pattern.

Recommendation: classify every CAD tool as read-only (measure, snapshot, export preview), additive (new feature at end of tree), modifying (parameter edit, reorder), or destructive (delete feature, delete body, overwrite file, change units, edit a sketch with N dependents, reset history). Modes mirror Claude Code: Manual, Accept-additive, Plan, Auto (classifier plus geometric risk score: number of dependent features, mass change > x%, regeneration failures), Bypass only in sandboxed CI. Destructive ops always run as a dry run producing a diff first; the approval card shows the diff from section 3. Every write goes through a checkpoint, and the file is never saved in place by the agent without a named version.

## 7. Multi-agent sessions

Onshape's collaboration model (presence colours in tabs and feature lists, Follow mode, "non-collaborative tabs allow only one user at a time") is the right mental model: agents are collaborators. Claude Code subagents run with separate context, tool allowlists, up to 20 concurrently, optional `isolation: worktree`, and "no agent message counts as your approval"; Cursor runs subagents via `/multitask`. Open3DJ should give each agent session a branch, a colour and a cursor; show "Agent B is editing sketch_4" in the tree; merge through the Compare view; and let a human follow an agent's camera. Permission prompts from background agents surface in the main session labelled with the agent name (Claude Code behaviour).

## 8. Keyboard and mouse conventions professionals expect

Zoo's `cameraControls.ts` is a primary-source encoding of industry conventions (seven presets): Zoo (rotate right-drag, pan middle-drag or Shift+right, zoom scroll or Ctrl+right-drag); OnShape (rotate right-drag, pan Ctrl+right or middle, zoom scroll); Trackpad Friendly (Alt+left rotate, Alt+Shift+left pan, Alt+Meta+left zoom); Solidworks (rotate middle-drag, pan Ctrl+middle, zoom scroll or Shift+middle); NX (rotate middle, pan Shift+middle, zoom Ctrl+middle); Creo (rotate Ctrl+middle, pan Ctrl+left, zoom Ctrl+right); AutoCAD (pan middle, rotate Shift+middle). FreeCAD ships selectable navigation styles too (its 1.1.4 notes fix "the TinkerCAD navigation style"), and the macOS trackpad-gesture request (#5938) drew 42 reactions. Onshape added touch input (1.210) and pen-as-mouse (1.212) in 2026. Sketch conventions from Zoo: single-key constraint shortcuts, colour for constraint state, double-click a dimension to edit, drag points to test freedom. FreeCAD's most-reacted open UX issue after TNP is "Pop-up command search (like Blender's)" (#8290, 38 reactions), and "Title bar is wasted screenspace" (#12742, 40). Onshape and SolidWorks keyboard tables could not be fetched (help URLs redirected to landing pages), so exact key bindings are not cited.

Must-haves: navigation preset switcher with the seven mappings above plus Blender-style; view cube and Shift+number views; N normal-to-face; section view with draggable plane; measure that auto-reports distance/angle/diameter on selection (FreeCAD 1.0 "universal measuring tools"); exploded view in assemblies (v1.0); command palette with fuzzy search; Esc cancels any tool; Ctrl+Z/Y across both human and agent operations.

## 9. Accessibility and dark mode

WCAG 2.2 (W3C Recommendation, 2024-12-12) adds criteria that bite CAD UIs: 2.5.7 Dragging Movements (every drag must have a non-drag alternative), 2.5.8 Target Size minimum, 2.4.11 Focus Not Obscured, alongside 2.1.1 Keyboard, 1.4.3 contrast 4.5:1 and 1.4.11 non-text contrast 3:1. The European Accessibility Act covers "computers and operating systems" and e-commerce; the Commission page confirms scope, and the application date is 28 June 2025 (Article 31; not re-verified on EUR-Lex, which returned an empty body). Dark mode is table stakes: Onshape has it (2026 fixes in 1.212 and 1.219), FreeCAD 1.0 shipped "brand-new dark and light themes", Zoo uses Tailwind theming. No CAD vendor VPAT was reachable (Onshape's accessibility page returned 404); treat CAD accessibility as an open field where keyboard-complete modelling plus an agent acting as an accessibility layer (voice/text to feature) is a differentiator.

## 10. Performance expectations

Zoo streams video from a hosted GPU engine, which is exactly what a local-first tool must beat; its community's top threads are "Failed to connect", "Zookeeper hanging" and "Engine is not connecting". Onshape (WebGL2 since 1.211, 2026-02-20) culls assembly components below 2 px on screen for assemblies under 5,000 bodies and 10 px above, "graphical only; the BOM does not change". WebGPU ships by default in Chrome/Edge 113+ and Safari iOS 26+, partial on macOS Safari 26, disabled by default in Firefox per caniuse, with roughly 86-88% global usage. The Steam survey (September 2026) puts the modal GPU at RTX 5070 (6.15%), RTX 5060 (4.40%), 5060 Ti (4.06%), RTX 4060 (3.89%), RTX 3060 (3.66%) and GTX 1650 still at 2.19%; "mid-range" for Open3DJ should mean RTX 3060/4060-class desktop and 4060 Laptop, with a GTX 1650/Intel iGPU floor. Target: 60 fps orbit of a 100k-triangle part and a 2,000-body assembly at 1440p on an RTX 3060 with tessellation decoupled from kernel regeneration and progressive LOD; agent snapshot renders must come from the same renderer (off-screen) so the agent and human see identical pixels.

## 11. UI framework and component conventions

Zoo uses Electron with React/Headless UI/Tailwind/XState/CodeMirror and a WASM LSP; Tauri 2 (MIT, Linux/macOS/Windows/Android/iOS, "as little as 600KB") is the lighter alternative using the OS webview and Rust. For a tool whose core is a native kernel and renderer, a Rust/C++ core with a web UI (Tauri) keeps the agent API, the CLI and the GUI on one process boundary and gives WebGPU in the webview; the learning-curve reducers are convention-level, not framework-level: feature tree on the left with rollback bar, properties/parameters on the right, bottom status bar with units and regen state, command palette, VS Code-style keybinding JSON so SolidWorks/Fusion/Onshape users can import presets, and a code panel (CodeMirror) that round-trips with the GUI as KCL and Replicad already do.

## 12. What users actually complain about

Verified signals: FreeCAD top-reacted issues are TNP (#8432, 56), clipping-plane shells (#5570, 53), trackpad gestures (#5938, 42), wasted title bar (#12742, 40), multithreading (#5581, 39), Blender-style command search (#8290, 38), git-friendly file format (#11936, 37); Zoo community: connectivity, agent hangs, billing, STEP imports over 90 MB failing; blender-mcp: timeouts, setup failures, prompt injection, need for screenshots; DEVELOP3D's sponsored Autodesk piece (2026-06-01) states the industry line: "AI tools in a CAD workflow today must respect design intent and keep the engineer in control."

## Prioritized UI capabilities

**MVP (first public release):**
1. Local renderer at 60 fps on RTX 3060-class, with off-screen snapshot API shared by agent and human.
2. Feature tree with rollback bar; every agent turn lands as a grouped proposal with per-operation accept/reject and one checkpoint per turn.
3. Geometry diff v1: numeric delta card + ghosted before/after + flip key.
4. Stable reference tokens: click-to-copy from viewport, chips in chat, `resolve_ref`/`make_ref` tools.
5. Side-panel chat with selection auto-attached, plan mode, and permission modes Manual / Accept-additive / Plan / Auto.
6. Destructive-op classification with dry-run diff before commit; never save in place without a version.
7. Navigation presets (Zoo, Onshape, SolidWorks, NX, Creo, AutoCAD, Blender, trackpad), view cube, section view, measure-on-select, command palette, dark/light themes, full keyboard reachability.
8. Code panel round-tripping with the GUI; `AGENTS.md`-style project conventions file.

**v1.0:**
1. Changed-face colouring and section-view diffs; Compare between any two versions or branches.
2. Multi-agent: per-agent branches, presence colours, follow-agent camera, merge via Compare.
3. Assemblies: mates, exploded views, large-assembly culling with BOM unaffected.
4. Sketch mode with solver-state colours, single-key constraints, trim, region detection.
5. Verification artifact cards (measure reports, print gates, fit checks) rendered in the turn log so humans review outcomes, not only diffs.
6. WCAG 2.2 conformance pass (dragging alternatives, target sizes, focus) and a published VPAT.
7. Importable keybinding presets, touch and pen input, and a voice/text accessibility mode driven by the agent.

## Interaction patterns unique to agent-first CAD that nobody has done well yet

1. Proposal-as-transaction in the feature tree (per-operation accept/reject, turn checkpoints, declined-ops log).
2. Geometry diffs as first-class objects available to both the human UI and the agent's tools, with numeric deltas first.
3. A single stable reference grammar shared by picks, chat, code and MCP, re-resolvable after regeneration, with the agent able to "point" back.
4. Risk-scored approval gates derived from tree dependency counts and mass/volume change, not just tool names.
5. Agents as collaborators with presence, branches and follow mode.
6. "What the agent saw" camera trail and snapshot thumbnails inline with each turn.
7. Verification artifacts instead of raw diffs for outcome review.
8. Design-intent ledger: agent must attach rationale and constraints to each feature it creates; the tree shows it on hover.

## Recommendations for Open3DJ

Build the review loop before building more modelling features: the differentiator is not text-to-CAD (Zoo, Adam, Autodesk and Dassault all have it) but a trustworthy, inspectable, undoable agent transaction model on local hardware. Adopt MCP tool annotations and elicitation literally, mirror Claude Code's permission modes and classifier fallbacks, and reuse Onshape Compare's visual grammar (Base blue / Target red, difference-only feature lists). Ship the seven navigation presets from day one, since they are the cheapest way to make SolidWorks/NX/Creo users feel at home. Treat FreeCAD's TNP history as the warning: stable references are a product feature, not an implementation detail, so design the reference token format with the kernel team now. Keep the renderer local and measure 60 fps on an RTX 3060 in CI; Zoo's streamed viewport and its "Failed to connect" threads are the gap to exploit. Finally, log every agent action with inputs, snapshots and diffs so that "what did the agent do and why" is always answerable, which is both the professional expectation and the MCP spec's audit guidance.

## Sources

- Zoo Design Studio product page (v1.5.2, 2026-10-21): https://zoo.dev/design-studio
- Zoo blog index (2026 posts and dates): https://zoo.dev/blog
- Announcing Zookeeper (2026-02-05): https://zoo.dev/blog/announcing-zookeeper
- Why AI Must Generate Parametric CAD (2026-02-24): https://zoo.dev/blog/why-ai-must-generate-parametric-cad
- What's New With Zoo, March 2026: https://zoo.dev/blog/whats-new-mar-2026
- Zoo sketch mode redesign / ezpz solver (2026-05-28): https://zoo.dev/blog/announcing-solver
- Announcing KCL 3.0 (2026-10-08): https://zoo.dev/blog/kcl-3
- KCL edge references: https://zoo.dev/docs/kcl-lang/edge-references
- Zookeeper docs (selection awareness, AGENTS.md, modes): https://zoo.dev/docs/zoo-design-studio/zookeeper
- Zoo Design Studio getting started: https://zoo.dev/docs/zoo-design-studio/getting-started
- Zoo pricing page: https://zoo.dev/pricing
- KittyCAD/modeling-app (MIT, stack, streamed viewport): https://github.com/KittyCAD/modeling-app
- Zoo camera control presets source: https://github.com/KittyCAD/modeling-app/blob/main/src/lib/cameraControls.ts
- KittyCAD/ezpz solver (MIT): https://github.com/KittyCAD/ezpz
- Zoo community top threads: https://community.zoo.dev/top
- Adam home: https://www.adam.new/
- Adam docs overview: https://docs.adam.new/
- Adam Onshape integration (selection sharing): https://docs.adam.new/integrations
- Adam pricing: https://www.adam.new/pricing
- The Bitter Lesson of AI CAD (2026-05-24): https://adam.new/blog/bitter-lesson-ai-cad
- Onshape AI Advisor: https://www.onshape.com/en/features/ai-advisor
- Onshape changelog 2026: https://www.onshape.com/en/changelog/
- Onshape performance (culling thresholds): https://cad.onshape.com/help/Content/performance.htm
- Onshape Compare tool: https://cad.onshape.com/help/Content/compare.htm
- Onshape collaboration / presence / follow mode: https://cad.onshape.com/help/Content/collaboration.htm
- FeatureScript modeling (queries as criteria): https://cad.onshape.com/FsDoc/modeling.html
- DEVELOP3D: PTC Next AI agents (2026-06-10): https://develop3d.com/cad/ptc-brings-ai-into-play-at-its-ptc-next-event/
- DEVELOP3D: Autodesk AU 2026 AutoTimeline/AutoAssemble (2026-09-15): https://develop3d.com/cad/autodesk-latest-ai-for-fusion-inventor/
- DEVELOP3D: Autodesk shows its AI hand (2025-10-13): https://develop3d.com/cad/autodesk-shows-its-ai-hand/
- DEVELOP3D: 3DEXPERIENCE World 2026 companions (2026-03-16): https://develop3d.com/cad/event-report-3dexperience-world-2026/
- DEVELOP3D sponsored: The Case for AI in Design & Manufacturing (2026-06-01): https://develop3d.com/sponsored/the-case-for-ai-in-design-manufacturing/
- What's New in SOLIDWORKS 2027 - Design (2026-10-21): https://blogs.solidworks.com/products/solidworks/whats-new-in-solidworks-2027-design/
- Claude Code permissions: https://code.claude.com/docs/en/permissions
- Claude Code permission modes (plan, auto classifier, protected paths): https://code.claude.com/docs/en/permission-modes
- Claude Code VS Code extension (diff review, per-change accept/reject, selection): https://code.claude.com/docs/en/vs-code
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- Cursor Agent overview (checkpoints, steering): https://cursor.com/docs/agent/overview
- Cursor run modes and sandbox: https://cursor.com/docs/agent/security/run-modes
- Cursor Agent Review: https://cursor.com/docs/agent/agent-review
- Cursor multi-agent: https://cursor.com/help/ai-features/multi-agent
- Figma Make: https://www.figma.com/make/
- Penpot MCP (archived, MPL-2.0): https://github.com/penpot/penpot-mcp
- Penpot blog (AI whitepaper 2025-08-05): https://penpot.app/blog
- blender-mcp README: https://github.com/ahujasid/blender-mcp
- blender-mcp issues: https://github.com/ahujasid/blender-mcp/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc
- FreeCAD 1.0 released (2024-11-19): https://blog.freecad.org/2024/11/19/freecad-version-1-0-released/
- FreeCAD blog (1.1.4, 26.3 RC, Q3 2026 TNP grant): https://blog.freecad.org/
- FreeCAD releases: https://github.com/FreeCAD/FreeCAD/releases
- FreeCAD top-reacted issues: https://github.com/FreeCAD/FreeCAD/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc
- MCP spec 2025-06-18 Tools (human in the loop, annotations): https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP spec schema (ToolAnnotations defaults): https://modelcontextprotocol.io/specification/2025-06-18/schema
- MCP spec Elicitation: https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- European Accessibility Act (scope): https://commission.europa.eu/strategy-and-policy/policies/justice-and-fundamental-rights/disability/union-equality-strategy-rights-persons-disabilities-2021-2030/european-accessibility-act_en
- WebGPU browser support: https://caniuse.com/webgpu
- Steam Hardware Survey, video cards (Sept 2026): https://store.steampowered.com/hwsurvey/videocard/
- Tauri 2: https://v2.tauri.app/
- CAD-Assistant (arXiv 2412.13810): https://arxiv.org/abs/2412.13810
- CAD-Editor (arXiv 2502.03997): https://arxiv.org/abs/2502.03997
- BlenderGym (arXiv 2504.01786, CVPR 2025): https://arxiv.org/abs/2504.01786
