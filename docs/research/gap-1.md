# Gap 1: funding, grants and burn for the 68-week plan

Researched 27 Oct 2026. Figures marked (agg.) come from aggregators or community posts. Check them on the official page before applying.

## Bottom line

- **Burn.** The plan uses 3 senior engineers, plus a fourth from week 12, for 68 weeks. That is 261 engineer-weeks, about 5.0 engineer-years. On UK payroll that costs **about £0.55M to £0.80M, with a mid case near £0.66M (about €0.78M)**. The founder's own time is not included.
- **Grants.** Cash a UK Ltd can realistically win in that window is about **€0 to €60k**: almost every fund requires adoption or excludes prototypes, user-facing apps or AI. The largest non-dilutive source is **UK R&D tax relief (about £75k to £150k)**, paid only after the accounting year ends.
- **Who pays.** The core needs a named payer (3dj.app revenue, founder capital or equity) before "don't monetise the core" is safe.
- **NLnet conflict.** NLnet's GenAI policy v2.0 (20 Oct 2026) limits LLM use in funded development to read-only, but this plan has AI agents write stdlib parts, tests, adapters and docs. NLnet money only fits a separate, hand-written work package.

## Programmes (status on 27 Oct 2026)

| Programme | Award | UK Ltd eligible? | Next deadline | Fit now |
|---|---|---|---|---|
| NLnet **Restack** / **CodeSupply** (EC Open Internet Stack) | €5k-50k for a first grant | Yes: the UK is Horizon Europe-associated; at least 60% of funds must go to people in eligible countries | **3 Nov 2026 12:00 CET**, then the 3rd of every odd month | **Weak.** Restack funds internet infrastructure and "AI-related projects are not within scope" below 1M users; CodeSupply funds software metadata. NGI Zero Commons (which funded Lens/FreeCAD) closed for good on 1 Jun 2026. GenAI policy v2.0 applies |
| **Sovereign Tech Fund** | Work must cost over €50k; 2026 deals €377k (Scala) to €1.29M (KDE) | "Invests globally" | Rolling; about 6 months to contract | **No for now:** "We do not finance the development of prototypes"; "not looking for user-facing applications". Possible after 1.0 for a base library others depend on |
| **Prototype Fund** (DE) | Up to €79k individual / €158k team (agg.) | **No:** needs German residence or tax liability | 1 Oct-30 Nov 2026 (agg.) | Only via a Germany-resident contributor applying personally |
| **GitHub Secure Open Source Fund** | $10k ($6k/$2k/$2k) plus $10k Azure credits | Yes (UK is a Sponsors region); max 2 maintainers | Rolling | Later: needs "demonstrated community traction and adoption"; security focus |
| **FLOSS/fund** (Zerodha) | $10k-100k a year | Global | Quarterly | Later: "Very new projects or projects with minimal usage are not considered" |
| **Mozilla Human-Scale AI Incubator** | $300k for 12 months from Apr 2027, up to $500k over 3 years | Unclear (one listing says US only) | **20 Nov 2026** | Not this cycle: needs already-deployed technology |
| **Open Cascade** | No startup or partner funding programme found; sells support and components | n/a | n/a | Not a source |
| **NVIDIA Inception** | Free; AWS credits up to $100k reported, often $25k without VC (agg.); hardware discounts | Yes | Rolling | **Apply now** for the cloud-GPU provider work |
| **Anthropic Claude for OSS** / **OpenAI Codex for OSS** | 6 months of a $200/month plan per maintainer, plus OpenAI API credits from a $1M fund | Yes | Rolling | Tooling only; favours widely used projects |
| **Google for Startups Cloud** | $2k, or up to $350k on the AI tier with VC/SAFE | Yes | Rolling | Only after raising |
| **Innovate UK** | Smart grants paused since Jan 2025; Growth Catalyst needs matched investment | Yes | None confirmed | Watch |
| **EU Open Source Strategy** (3 Jun 2026) | €2bn over 7 years, incl. a new Open Source Maintenance Instrument | Not defined | Not operational | Watch in 2027 |

**UK R&D relief.** ERIS (loss-making SMEs with R&D at least 30% of spend) gives an extra 86% deduction plus a 14.5% payable credit, roughly **27p per £1** of qualifying spend. The merged scheme gives a 20% RDEC (about 15-16% net). Since April 2024, overseas contractor and EPW costs are excluded.

## Salaries (2026)

| Market | Figure | Source |
|---|---|---|
| UK, jobs citing Rust (6 months to 27 Oct 2026, n=230) | Median £90k. 75th percentile £100k, 90th percentile £120k | ITJobsWatch |
| UK, jobs citing C++ (n=1,102) | Median £67.5k. 75th percentile £82.5k, 90th percentile £100k | ITJobsWatch |
| UK, "Senior C++ Developer" title (n=38) | Median £57.4k, 90th percentile £100k. Small sample, mostly outside London | ITJobsWatch |
| UK, OCCT or geometric-kernel specialists | No dataset found. *Assumption:* 75th-90th percentile of C++ (£85k-100k+) | n/a |
| Berlin, senior software engineer | About €94k median total compensation (levels.fyi). Rust-specific Berlin data is thin (Glassdoor about €89k, n=4) | levels.fyi, Glassdoor |
| Poland, senior C++ on a B2B contract | 20k-33k PLN net per month, about €55k-90k a year at 4.37 PLN/EUR | justjoin.it ads |

UK employer costs for 2026/27: NIC at 15% above £5,000, with an Employment Allowance of £10,500.

## Burn model

Per-engineer cost = base + 15%·(base − £5k) NIC + 5% pension + £6k for kit, software and recruiting (*assumption*). Non-staff costs (CI on three operating systems, code signing, GPU test hardware, legal and accounting) are a further £40k-80k (*assumption*).

| Case | Base | Loaded per year | Staff (5.02 years) | Plus non-staff | ERIS back (60-80% qualifying) |
|---|---|---|---|---|---|
| Low | £80k | £101k | £508k | **£548k** | about £77k |
| Mid | £95k | £119k | £599k | **£659k** | about £107k |
| High | £115k | £143k | £719k | **£799k** | about £149k |

An alternative is EU B2B contractors at about €55k-90k per engineer-year, which comes to roughly €0.28M-0.47M. Those costs do not qualify for UK R&D relief.

## Implications for the plan

1. **Name the payer** for £0.55M-0.8M before committing (3dj.app revenue, founder capital or a seed round). A seed round also unlocks the larger Google, NVIDIA and AWS credit tiers.
2. **Write an AI-use policy for each work package.** Any grant-funded component must follow NLnet's rule (LLMs read-only), kept separate from the agent-assisted core.
3. **Design grantable sub-components.** A STEP/3MF I/O library, an OCCT binding crate or the Evidence Pack schema could become infrastructure that STF, FLOSS/fund and GitHub SOSF fund once adopted, realistically after week 28.
4. **The schedule is coupled to funding.** These funds pay only after traction, so if the MVP slips to the judges' 36-44 weeks, eligibility slips with it. The plan's ×1.4 factor for 2 engineers is the fallback if only 2 are funded.
5. **Correct the FreeCAD evidence.** "$14k/yr" is only the Open Collective account. The FreeCAD Project Association raised **€130k in 2025** and has a **€230k budget for 2026**, still only 1-2 engineer-years, so the conclusion holds.
6. **Side note.** OCCT 8.0.1 is current (30 Jul 2026), while 3dj.app runs OCCT.js 7.7.2.

## Sources

- https://nlnet.nl/commonsfund/ ; https://nlnet.nl/propose/ ; https://nlnet.nl/restack/ ; https://nlnet.nl/codesupply/
- https://nlnet.nl/NGI0/european-dimension/ ; https://nlnet.nl/news/2026/20260803-phaseshift.html ; https://nlnet.nl/news/2026/20261020-AI-policy.html ; https://nlnet.nl/project/Lens-FreeCAD-integration/
- https://www.sovereign.tech/programs/fund ; https://www.scala-lang.org/blog/2026/01/27/sta-invests-in-scala.html ; https://www.phoronix.com/news/KDE-1M-EUR-Investment
- https://discourse.nixos.org/t/prototype-fund-started-next-application-round/80433 ; https://foerdermittelkompass.reflecta.org/grants/prototype-fund?locale=en ; https://grantedai.com/grants/prototype-fund-open-knowledge-foundation-germany-ac23a4d2
- https://github.com/open-source/github-secure-open-source-fund ; https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors
- https://floss.fund/faq/
- https://www.mozillafoundation.org/en/what-we-do/grantmaking/incubator/human-scale-ai/call-for-proposals/ ; https://www.developmentaid.org/grants/view/1735925/request-for-applications-human-scale-ai-incubator-cohort-united-states
- https://occt3d.com/ ; https://en.wikipedia.org/wiki/Open_Cascade_Technology
- https://thundercompute.com/blog/nvidia-inception-program-guide ; https://superscout.co/perk/nvidia
- https://simonwillison.net/2026/Feb/27/claude-max-oss-six-months/ ; https://www.engineerscodex.com/claude-free-max-open-source/ ; https://developers.openai.com/community/codex-for-oss
- https://cloud.google.com/startup/faq
- https://echogrant.com/resources/innovate-uk-smart-grants-alternatives ; https://www.pnoinnovation.com/uk/funding/innovate-uk-growth-catalyst/
- https://digital-strategy.ec.europa.eu/en/library/communication-european-tech-sovereignty-accompanied-eu-open-source-strategy ; https://euperspectives.eu/2026/06/can-open-source-free-europe-from-big-tech/
- https://gofile.co.uk/knowledgebase/r-and-d-tax-credits/eris-scheme/ ; https://www.bdo.co.uk/en-gb/insights/tax/innovation-and-research-and-development-tax-incentives/r-d-expenditure-credit-rdec-and-merged-scheme ; https://www.gov.uk/government/publications/additional-tax-relief-for-research-and-development-intensive-small-and-medium-sized-enterprises/technical-note-additional-tax-relief-for-research-and-development-intensive-small-and-medium-enterprise
- https://www.itjobswatch.co.uk/jobs/uk/rust.do ; https://www.itjobswatch.co.uk/jobs/uk/c++.do ; https://www.itjobswatch.co.uk/jobs/uk/senior%20c++%20developer.do
- https://www.levels.fyi/t/software-engineer/levels/senior/locations/germany ; https://www.glassdoor.com/Salaries/berlin-germany-rust-developer-salary-SRCH_IL.0,14_IM1020_KO15,29.htm
- https://justjoin.it/job-offer/altimetrik-poland-senior-c-developer-wroclaw-c ; https://remotive.com/remote/jobs/software-development/senior-mobile-c-developer-2766233 ; https://www.exchange-rates.org/converter/pln-eur
- https://www.iris.co.uk/blog/payroll/employer-national-insurance-contributions-guide/
- https://blog.freecad.org/2026/04/24/2025-annual-report-and-plans-for-2026/ ; https://opencollective.com/freecad
