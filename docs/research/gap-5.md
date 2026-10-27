# Gap 5: Trademark clearance and namespace availability for "Open3DJ" / "3DJ"

Checked 2026-10-27. This is not legal advice. It replaces the plan's unsourced claims (the "2013 3DJ online store" and the "Medium/High" rating) with what the registers say.

## Method and coverage

- **USPTO:** queried live through the JSON backend of the USPTO Trademark Search system ([tmsearch.uspto.gov](https://tmsearch.uspto.gov), the replacement for TESS). Queries covered wordmark and pseudo-mark text for `3dj`, `*3dj*`, `3dj*`, "3 dj", "3-dj", "three dj", `*open3d*`, "open 3d", `open3dj`, `o3dj` and `o3de`, plus an owner search for "Neural Deep". Records were spot-checked in [TSDR](https://tsdr.uspto.gov/statusview/sn90330051).
- **EUIPO eSearch, TMview, UKIPO and the WIPO Global Brand Database could not be reached from this sandbox.** EUIPO and TMview returned 503 or an empty reply, UKIPO returned 403 and the WIPO API returned 403. The EU and UK answers below therefore rest on web-search proxies and Companies House. **They are not a clearance.**

## USPTO findings (Nice classes 9 and 42, plus neighbours)

| Mark | Serial / Reg. | Class | Owner | Status |
|---|---|---|---|---|
| **OPEN3D** | 90330051 / **Reg. 6468139** (2021-08-31) | **9**: "Downloadable computer software for an open-source library that supports rapid development of software that deals with 3D data" | Embodied AI Foundation, Watsonville CA. The index also lists Open Source Vision Foundation via an assignment recorded in May 2022 | **LIVE.** Section 8 (6-year) reminders were emailed 2026-08-31, so the maintenance window is open ([TSDR](https://tsdr.uspto.gov/statusview/sn90330051), [Justia](https://trademarks.justia.com/owners/embodied-ai-foundation-5193860)) |
| OPEN3D | 50150097, filed 2026-10-08 | 17 (3D-printing PLA/ABS filament, plastics) | Guangzhou Xujin Technology Co., Ltd. | LIVE, new application |
| O3DE | Reg. 7026356 | 9, 42 | The Linux Foundation (Open 3D Engine) | LIVE ([markinton](https://markinton.com/trademark/o3de-90081451)) |
| 3DJOES | Reg. 7401839 | 35 (online retail of books and posters) | Locomotion Media Group LLC | LIVE, not in class 9 or 42 |
| 3DJ | 76684356 | 9 (audio and DJ equipment) | Yamaha Corp. | DEAD, abandoned 2008 ([markinton](https://markinton.com/trademark/3dj-76684356)) |
| 3DJET | Reg. 4871256 | 1/7/9/17 | XYZprinting | DEAD, cancelled under Section 8 |
| OPEN3D (1999), OPEN 3D (CEA, cl. 42), OPEN3DHOUSE, OPEN3DESIGN | n/a | 9 / 42 | various | all DEAD |

- **OPEN3DJ and O3DJ: no records.** No live US mark containing "3DJ" exists in class 9 or 42. Nobody named "Neural Deep" has filed anything.
- The same foundation also owns **OPENCV** (Reg. 7130206) and **CCC** (Reg. 7130205) in classes 9, 41 and 42. The OPEN3D registrant therefore runs an active trademark programme rather than holding a single defensive filing.

**Reading (not a legal opinion):** "OPEN3DJ" contains the whole of the registered mark OPEN3D and adds one letter. It would be used for nearly the same goods: downloadable open-source software for 3D data. Open3D is also the well-known Intel-originated library ([PyPI `open3d`](https://pypi.org/project/open3d/), [isl-org/Open3D](https://github.com/isl-org/Open3D)), and Open3DJ's mesh and scan-to-CAD work overlaps its user base. A Section 2(d) likelihood-of-confusion refusal of an OPEN3DJ application in class 9 is a realistic outcome, and the registrant could object to use of the name. **The main conflict comes from OPEN3D, not from "3DJ".** The bare **3DJ** mark is clear on the US register in classes 9 and 42.

## EU and UK (not verified on the registers)

Web searches found no EUTM or UK registration for 3DJ, OPEN3D or OPEN3DJ, but that result carries little weight. The searches did turn up these prior users of "3DJ":

- **3DJake** (niceshops GmbH, Austria) is a large EU and UK online store for 3D printers and filament, launched around 2015, with its own filament brand ([niceshops](https://www.niceshops.com/en/shops-and-brands/3djake), [3djake imprint](https://www.3djake.com/info/imprint)). Whether it holds a trademark is unknown. It is the most relevant EU risk for a "3DJ" print-provider brand.
- **UK companies (Companies House):** 3DJ DIGITAL LIMITED (incorporated 2026-01-14, SIC 62020 IT consultancy, active), 3DJ CONSULTANCY LIMITED (2014, active) and 3DJ MARKETING LTD (2019, active). **3DJ LTD** was incorporated 2013-03-07 for "other business support" and dissolved in 2022 ([CH 08435271](https://find-and-update.company-information.service.gov.uk/company/08435271)). That company is the likely source of the plan's "2013 3DJ" claim. **No 2013 "3DJ online store" was found.**
- Other dormant prior uses: the GitHub org **3DJ** ("3DJ App", Kinect music performance, last active in 2017, [github.com/3DJ](https://github.com/3DJ)) and WHITEvoid's 2004 **3DJ** VJ software ([whitevoid.com/3dj](https://www.whitevoid.com/3dj/)).

## Namespace availability (live checks, 2026-10-27)

| Namespace | Result |
|---|---|
| npm `open3dj`, `3dj`, `o3dj` | 404, free |
| npm scope `@open3dj` (also `@3dj`, `@o3dj`) | `/-/org/<scope>/package` returned 404 "Scope not found", so free |
| PyPI `open3dj`, `o3dj`, `3dj` | 404 on both the JSON API and the simple index, so free |
| crates.io `open3dj`, `o3dj`, `3dj` | 404 on both the API and the sparse index, so free |
| GitHub `open3dj`, `o3dj` | 404, free. `3DJ` is taken (dormant org). `neuraldeepnet` is a **user** account ("Neural deep network LTD"), not an org |
| Homebrew formula and cask `open3dj`, Docker Hub `open3dj`, official MCP Registry search for "open3dj" and "3dj" | none found |
| Domains `open3dj.com/.org/.io/.dev/.app` | unregistered (RDAP 404). `3dj.app` has been registered since 2023-10-20. `3dj.com` (since 2002) and `open3d.com` (since 2001) belong to third parties |

Two neighbouring names are already taken: npm `open3d` (a JS geometry library) and PyPI `open3d` (Intel). Because `open3dj` is one edit away from the popular `open3d`, typosquat detectors that rank names by edit distance and popularity may flag it ([SpellBound](https://arxiv.org/pdf/2003.03471), [TypoSmart](https://arxiv.org/html/2502.20528v1)). This is an inference that has not been tested.

## Implications for the plan

1. **Move the naming decision before any public listing.** It is currently scheduled "before v0.5". The OPEN3D conflict is concrete (live registration, overlapping goods, an owner with an active trademark programme). Get a counsel clearance opinion on "Open3DJ" in weeks 0 to 2, before npm, PyPI, crates, MCP Registry, Homebrew or winget listings, signing certificates and Show HN.
2. **Prefer a name built on the 3DJ house mark**, such as "3DJ Desktop", "3DJ Open" or "3DJ Workbench (OSS)". It is clear on the US register and ties the open client to 3dj.app. Have Neural Deep Network file **3DJ** in classes 9 and 42 (US, EU and UK, possibly through Madrid) once counsel has done a full EU/UK search with 3DJake in mind.
3. **Reserve namespaces cheaply now**, but only under the final name: a GitHub org, an npm org, and PyPI and crates projects shipped as real 0.0.x releases (squatting policies disfavour empty placeholders). Domains are also available.
4. Remove the unverified "2013 3DJ online store" claim from the plan and replace it with the findings above.
