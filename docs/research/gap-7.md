# Gap 7: Adoption baselines and targets for Open3DJ

Measured on 27 Oct 2026. Data runs to 26 Oct. PyPI figures come from the pypistats daily `overall?mirrors=false` series, not the `recent` endpoint, because that endpoint's `last_month` value does not match the daily sums. I report "median-day x 7" next to raw 7-day totals to remove release and bot spikes. I also report the OS split, because a Linux-heavy split usually means CI or servers, not people. Star history comes from parsing star-history.com SVG curves, which is accurate to about ±5%.

## 1. Baselines

| Package / repo | Raw last 7 days | Median-day x 7 | 6-month change (28-day vs first 28 days in window) | Desktop share (Win+Mac) | Stars now (≈6 months ago) |
|---|---|---|---|---|---|
| `mcp-for-blender` (PyPI, renamed from `blender-mcp` on 16 Sep) | 895,546 | 277,742 | new name, Sep 2026 | 91% | 32.5k (≈18.0k) |
| `blender-mcp` (PyPI rename shim) | 60,067 | 59,584 | 2.0x | 88% | same repo |
| `freecad-mcp` (PyPI, neka-nat, run with `uvx`) | 23,344 | 11,424 | 10.3x | 79% | 3.1k (≈0.66k) |
| `zoo-mcp` (PyPI, repo KittyCAD/mcp) | 6,646 | 6,517 | 12.2x | 8% (85% Linux) | 10 |
| `build123d-mcp` (PyPI, pzfreo) | 1,350 | 1,379 | 1.5x | 26% (41% unknown) | 132 (0, created 30 Apr) |
| `agentcad` (PyPI) | 332 | 228 | ~1.0x raw | 29% | 177 (0, created 2 Jun) |
| `freecad-robust-mcp` / `openscad-mcp` / `solidworks-mcp` | 398 / 355 / 674 | 329 / 276 / 634 | 1.0-1.6x | — | — |
| `cadquery-mcp` (PyPI, cadquery-contrib) | 44 | 35 | 1.5x | — | — |
| `@vcad/mcp` (npm, first published 23 Jul) | 1,524 | — | 5.2k launch month, then about 2k a month | — | vcad 441 (≈325) |
| `earthtojake/text-to-cad` (skill pack, no package) | — | — | — | — | 23.6k (repo created 22 Apr; 6.9k by 27 Jun, 16.2k by 27 Sep) |
| SolidCraft (tangency-labs, GitHub releases) | — | — | repo created 7 Oct | — | 11.2k (2.0k on 14 Oct, 7.6k on 20 Oct) |

Other facts:

- **SolidCraft release downloads.** The repo shows 520k asset downloads in total over 20 days. v0.1.0 had 252, v0.5.0 had 901 and v0.10.0 had 2.4k. From v0.15.0 the figures jump to 31k (v0.15.0), 45k (v0.20.0), 27k (v0.22.0), 21-26k (v0.23.x) and 22-23k (v0.24.x). The jump lines up with the opt-out update checker: it runs at every start and once a day, and "Update now" fetches the new release assets. Each release ships 47 assets, and there are 2-3 releases a day. Read **about 20-25k per release as an upper bound on active desktop installs, not as a count of users.**
- **vcad.** Release assets total only 348 downloads, against 441 stars and 9 months of work.
- **text-to-cad.** It shows **120.8k installs** across 18 skills on skills.sh, which counts installs through anonymous `npx skills add` telemetry that is on by default. The top skill, `cad`, has 14.2k installs. Many skills sit at 9-11k, which suggests bulk "install all", so the number of unique adopters is closer to 10-15k.
- **Unrelated packages that share names.** npm `blender-mcp` (186 a week) and npm `freecad-mcp` (published 22 Oct, 344 downloads in 5 days) belong to other authors. The second one shows the **noise floor of a new package, about 300 a week from mirrors and scanners**.
- **Underlying libraries grew strongly too.** Comparing the last 28 days with the first 28 days of the window: `build123d` 5.4x (270k a week), `cadquery` 7.3x, `replicad` 8.1x (npm, 46k a week), `occt-import-js` 2.6x.

## 2. What the numbers say

1. **Bridges into large existing apps lead the category.** Blender MCP and FreeCAD MCP ride installed bases of millions. Their volume is mostly from desktop users: mcp-for-blender downloads spike to 100-280k on release days because `uvx` re-fetches each new version, and fall back to a floor of about 17-20k a day between releases. Open3DJ is a new application with no installed base, so these are ceilings, not peers.
2. **Download counts are badly confounded.** zoo-mcp has 6.6k downloads a week but 10 stars and 85% Linux traffic, so it is pipeline traffic. build123d-mcp's 1.4k a week is 41% "unknown installer". Any Open3DJ target stated as "downloads" must strip bots and CI: use median-day x 7, a desktop-OS share, and per-release updater fetches.
3. **The real peer group is independent code-CAD agent servers**, and they are small. After 5-6 months build123d-mcp, agentcad, openscad-mcp and freecad-robust-mcp each sit between 200 and 1,400 weekly downloads, with 130-180 stars. The vendor-backed Zoo MCP has 10 stars.
4. **Star virality is a power law and depends on launches.** text-to-cad reached 23.6k stars in 6 months, still adding about 7k a month. SolidCraft reached 11.2k in 20 days. vcad, with a comparable technical scope, has 441 stars. The difference is distribution: a skill pack that installs in one line, a landing page, a launch moment and fast releases.
5. **The market is growing 1.5-12x every six months**, so fixed targets go stale. Track Open3DJ as a share of a peer index as well as in absolute numbers.

## 3. Recommended targets

Definitions:

- **WAI (weekly active installs):** opt-in telemetry pings divided by the measured opt-in rate. Open3DJ's telemetry is off by default.
- **DL:** median-day x 7 across the PyPI, npm and GitHub release-asset channels.
- **Desktop share:** the Windows and macOS share of PyPI downloads.

Each milestone is measured 4 weeks after its release. Values are floor / **base** / stretch.

| Metric | Agent Preview (v0.1, wk 12) | Public Beta (v0.5, wk 28) | 1.0 (wk ~60) |
|---|---|---|---|
| DL per week | 300 / **1,000** / 3,000 | 3,000 / **8,000** / 25,000 | 10,000 / **25,000** / 80,000 |
| Desktop share of DL | ≥ 35% | ≥ 50% | ≥ 60% |
| WAI | 100 / **300** / 800 | 1,000 / **3,000** / 10,000 | 4,000 / **10,000** / 25,000 |
| Downloads per release (updater included) | — | 1,000 / **5,000** / 20,000 | 5,000 / **15,000** / 40,000 |
| GitHub stars | 250 / **700** / 2,000 | 2,000 / **5,000** / 12,000 | 6,000 / **12,000** / 25,000 |
| skills.sh installs of the Open3DJ SKILL.md | 200 / **1,000** / 5,000 | 2,000 / **8,000** / 20,000 | — / **25,000** / 60,000 |
| Peer-index share (Open3DJ DL ÷ DL of build123d-mcp + agentcad + openscad-mcp + freecad-mcp) | ≥ 5% | ≥ 40% | ≥ 100% |

Rationale:

- **Preview.** The base of 1,000 DL a week is about build123d-mcp's level after 6 months, and the floor sits just above the new-package noise floor. That makes the plan's 300 WAI an honest base. The plan's 1k stars is a stretch for a headless CLI; vcad and agentcad show that the base is a few hundred.
- **Beta.** The desktop app, Show HN, winget and Homebrew put Open3DJ between vcad and SolidCraft. 3,000 WAI (the plan's figure) stays the base. Lower stars to a base of 5k: 6k matches text-to-cad at about 2 months, which is a viral outcome.
- **1.0.** A base of 25k DL is about twice freecad-mcp today, and freecad-mcp rides FreeCAD's user base. Lower the plan's 15k WAI to a 10k base with 15k as stretch. Keep 15k stars as a stretch-adjacent goal and set 12k as the base.
- **Re-base every quarter.** If the peer index keeps growing 5x or more every six months, scale the absolute targets and keep the share targets fixed.

## Sources

- PyPI daily series, OS split and recent counts (pypistats API). Apply the same pattern to `mcp-for-blender`, `freecad-mcp`, `zoo-mcp`, `build123d-mcp`, `agentcad`, `cadquery-mcp`, `openscad-mcp`, `freecad-robust-mcp`, `solidworks-mcp`, `build123d`, `cadquery` and `kittycad`:
  - https://pypistats.org/api/packages/blender-mcp/overall?mirrors=false
  - https://pypistats.org/api/packages/mcp-for-blender/system
  - https://pypistats.org/api/packages/freecad-mcp/recent
- PyPI metadata (repo mapping, rename shim, release dates): https://pypi.org/pypi/zoo-mcp/json , https://pypi.org/pypi/blender-mcp/json , https://pypi.org/pypi/mcp-for-blender/json , https://pypi.org/pypi/freecad-mcp/json
- npm downloads: https://api.npmjs.org/downloads/range/2026-04-28:2026-10-26/@vcad%2Fmcp , https://api.npmjs.org/downloads/range/2026-04-28:2026-10-26/freecad-mcp , https://api.npmjs.org/downloads/range/2026-04-28:2026-10-26/replicad , https://api.npmjs.org/downloads/point/last-week/blender-mcp ; registry metadata: https://registry.npmjs.org/freecad-mcp , https://registry.npmjs.org/@vcad%2Fmcp
- GitHub repos (stars via GitHub search API): https://github.com/ahujasid/mcp-for-blender , https://github.com/neka-nat/freecad-mcp , https://github.com/earthtojake/text-to-cad , https://github.com/tangency-labs/solidcraft , https://github.com/ecto/vcad , https://github.com/pzfreo/build123d-mcp , https://github.com/jdilla1277/agentcad , https://github.com/KittyCAD/mcp
- Star history: https://api.star-history.com/svg?repos=ahujasid/mcp-for-blender&type=Date (and the same for each repo above)
- Release download totals: https://img.shields.io/github/downloads/tangency-labs/solidcraft/total , https://img.shields.io/github/downloads/tangency-labs/solidcraft/v0.24.1/total (one per tag), https://img.shields.io/github/downloads/ecto/vcad/total
- SolidCraft releases and updater: https://github.com/tangency-labs/solidcraft/releases , https://raw.githubusercontent.com/tangency-labs/solidcraft/main/README.md , https://docs.solidcraft.io/guide/updates.html
- skills.sh: https://skills.sh/earthtojake/text-to-cad , https://skills.sh/docs/faq
- Plan targets compared: PLAN.md section 7 in this folder
