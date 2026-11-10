# Programs, grants and student routes

Which mentoring programs, grants and university routes fit Open3DJ, which do not yet, and what to do next. The founder applies to every program by hand; agents only research and draft ([AGENTS.md](../AGENTS.md) rule 8). Some programs forbid AI-written applications, so read each one's AI rules before using any draft.

Unless a line says otherwise, every fact was checked on 2026-11-05 at the linked page. Facts that could not be confirmed at a primary source are marked unverified.

## At a glance

| Program | Verdict | When |
|---|---|---|
| [Google Summer of Code](#google-summer-of-code) | Not eligible as its own org before 2029. Build the ideas list now; ask an umbrella org about 2027 | Ask the umbrella in December 2026 |
| [Hacktoberfest](#hacktoberfest) | Pull requests no longer count. Host a local Fest instead | October 2027 |
| [Outreachy](#outreachy-and-lfx-mentorship) | Skip for now | When governance spans several companies or volunteers |
| [LFX Mentorship](#outreachy-and-lfx-mentorship) | Skip for now | Only for Linux Foundation projects |
| [NLnet](#nlnet) | Not suitable | |
| [Sovereign Tech Agency](#sovereign-tech-agency) | Not now | After 1.0, if a base library gains outside users |
| [GitHub Secure Open Source Fund](#github-secure-open-source-fund) | Later | With outside contributors and visible adoption |
| [Xjenza Malta P2M and Digital Vouchers](#xjenza-malta) | Only with a Maltese-registered entity | Confirm the entity first |
| [University of Malta Knowledge Transfer](#university-of-malta) | Yes: write to them | December 2026 |

## Google Summer of Code

**Not eligible as its own organization before GSoC 2029.**

- **18 months of history.** Google's 2026 call lists seven requirements for organizations, including at least 18 months of history and an OSI-approved license, and "strongly" suggests that first-time organizations get a referral ([Google Open Source blog, 2026-01-19](https://opensource.googleblog.com/2026/01/mentor-org-applications-for-google-summer-of-code-2026-open-through-feb-3.html)). Open3DJ's first commit is dated 2026-10-27 (git log), so it turns 18 months old on 2028-04-27. GSoC 2026 took organization applications from 2026-01-19 to 2026-02-03 ([program API](https://summerofcode.withgoogle.com/api/program/2026/)), so the 2028 window very likely closes before that date (inferred: "The timeline for Google Summer of Code can shift a bit each year", [timeline](https://developers.google.com/open-source/gsoc/timeline)). The first realistic own application is in January or February 2029.
- **People.** The Mentor Guide asks for "at least 5 active people in your community" ([org application guide](https://google.github.io/gsocguides/mentor/org-application)). The binding 2026 Program Rules say "Each Organization must have at least two (2) Organization Administrators", and every administrator and mentor must contribute to the project ([2026 Program Rules](https://summerofcode.withgoogle.com/api/tos/rules/content/?version=2026.01&format=html)). Open3DJ has one maintainer today.
- **The ideas list matters most.** The guide calls the ideas page "the most important part of the organization application", and "Do not make your Ideas List a link to a list of bug tracker issues, that will be a rejection." Ours is [docs/IDEAS.md](../docs/IDEAS.md).
- **Project sizes** are "~90 hours (Small), ~175 hours (Medium), or ~350 hours (Large)" ([GSoC FAQ](https://developers.google.com/open-source/gsoc/faq), checked 2026-11-08).
- **First-year organizations** should request 1 contributor slot for every 2 mentors and "will probably receive 1-2 GSoC contributors" ([notes for first-year organizations](https://google.github.io/gsocguides/mentor/notes-for-first-year-organizations)). Google welcomes "around 30 new organizations" a year ([blog, 2025-12-03](https://opensource.googleblog.com/2025/12/shape-future-with-google-summer-of-code.html)).
- **AI use.** Google's guidance says "Each organization has their own opinion on when/if using AI tooling is appropriate" and asks organizations to state their expectations ([AI guidance](https://developers.google.com/open-source/gsoc/resources/ai_guidance)). Open3DJ would point to [AI_POLICY.md](../AI_POLICY.md).
- **No company exclusion found.** Neither the 2026 Program Rules nor the Organization Agreement excludes company-owned projects; 2026 organizations included Gemini CLI, OpenVINO Toolkit and "52°North Spatial Information Research GmbH" ([2026 organizations](https://summerofcode.withgoogle.com/api/program/2026/organizations/)).
- **Public universities.** The Rules say "Google shall not issue any funds to any government agency or public university", nor to their employees. Mentors employed by the University of Malta would bring no organization stipend.
- **GSoC 2027** was not announced on 2026-11-05: [the 2027 program API](https://summerofcode.withgoogle.com/api/program/2027/) answered "Program matching query does not exist." GSoC 2026 was announced on 2025-12-03.

**The umbrella route for 2027.** In GSoC 2026 the organization listed as "BRL-CAD" (ISC license) put its ideas at [github.com/opencax/GSoC](https://github.com/opencax/GSoC), whose README lists BRL-CAD, OpenSCAD, IfcOpenShell, KiCad, Appleseed and Manifold ([2026 organizations](https://summerofcode.withgoogle.com/api/program/2026/organizations/)). The README describes no way for a new project to join, so whether it would host one Open3DJ idea is unverified: ask. Shared student work with OpenSCAD keeps our [clean-room rule](outreach/communities.md#the-clean-room-rule-for-code-contributors).

## Hacktoberfest

**Pull requests no longer count, so there is nothing to opt into. Host a local Fest in October 2027 instead.**

- Hacktoberfest 2026 (October 1 to 31) said: "Instead of counting pull requests, we put the focus on building with open-weight models and open source AI." MLH and DEV now steward it, with DigitalOcean as presenting partner. It suggested participants "write your first skills.md, build your own open-source agent, fine-tune an open-weight model" ([hacktoberfest.com/llms.txt](https://hacktoberfest.com/llms.txt), [llms-full.txt](https://hacktoberfest.com/llms-full.txt)).
- There is no repository or maintainer opt-in in 2026: the FAQ, directory and host pages are retired. Adding the `hacktoberfest` topic does nothing now.
- Fests were MLH Hack Days or Meet Ups. The public events API listed 510 events in 71 countries. Ireland had 2 Hack Days (Dublin on 2026-10-03, Galway on 2026-10-29); Malta had none ([events API](https://hacktoberfest-api.mlh.com/api/events)).
- MLH Hack Days are "12-hour-or-less, in-person mini hackathons"; MLH reimburses "up to 350 USD for food, snacks, and other event expenses" and pays "7 USD" per checked-in hacker. The page does not say who may host ([mlh.com/hack-days](https://www.mlh.com/hack-days)).
- Hacktoberfest 2027 is not announced. The site says only "We can't wait to do it again."

A Fest fits the [Agent Build Night](build-night/README.md) format. The 2026 theme was open-weight models, so the demo should also work with a locally run model through MCP, not only with hosted agents. Open3DJ has not been tested with local models yet.

## Outreachy and LFX Mentorship

**Skip both for now.**

- **Outreachy** needs funding and independent governance: "At this time, communities must donate at least $8,000 USD per intern"; "Participating free software communities can't be too tightly tied to any one company"; governance "should include multiple companies or volunteers"; it "cannot be used for internal company internships"; and there must be "no difference in functionality between the free and paid versions" ([Outreachy community docs](https://www.outreachy.org/docs/community/)). Open3DJ is run by one company with one maintainer. Cohorts run May to August and December to March, with calls in early January and early August.
- **LFX Mentorship** enrollment requires a Linux Foundation project: "Select the Linux Foundation open source project this mentorship program is associated with … This is a required field" ([enrollment form](https://docs.linuxfoundation.org/lfx/mentorship/administrators/enroll-your-program/mentorship-project-enrollment-form.md)). Open3DJ is not hosted by the Linux Foundation.

## NLnet

**Not suitable.** NLnet's Generative AI policy v2.0 (2026-10-20) bans generative AI in proposals (accessibility is the only exception) and in funded work: "It is not allowed to use generative AI for producing artefacts of any kind, including code, design, and documentation". It covers code assistants, and AI costs are not reimbursed ([policy v2.0](https://nlnet.nl/foundation/policies/generativeAI/2.0/)). The proposal page adds: "Proposals and projects should be made by humans, not AI" ([nlnet.nl/propose](https://nlnet.nl/propose/)). Open3DJ is agent-first.

Also: the NGI Zero Commons Fund's final call closed on 2026-06-01 ([Commons Fund](https://nlnet.nl/commonsfund/)), and the open Restack fund excludes "AI-related projects" unless they have more than 1 million active users ([Restack](https://nlnet.nl/restack/)). The next Restack and CodeSupply deadline is 2027-01-03 at 12:00 CET, for the record only.

## Sovereign Tech Agency

**Not now.** The Sovereign Tech Fund needs work costing more than EUR 50,000, says "We do not finance the development of prototypes" and is "currently not looking for user-facing applications". Applications go through apply.sovereign.tech with no deadline, and contracts take about 6 months ([Sovereign Tech Fund](https://www.sovereign.tech/programs/fund)). The 2026 Fellowship closed on 2026-04-06, and no 2027 round is announced ([Fellowship](https://www.sovereign.tech/programs/fellowship)). Revisit after 1.0, if an Open3DJ base library gains outside users.

## GitHub Secure Open Source Fund

**Later, with traction.** It gives USD 10,000 per project (6,000 during the program, 2,000 at 6 months, 2,000 at 12 months) and USD 10,000 in Azure credits, for 15 hours over a 3-week security program plus two 2.5-hour check-ins. It asks for a current maintainer, teams of up to 2, age 18 or over, residence in a GitHub Sponsors region, a clear license, clear governance and "community traction and adoption". Applications are rolling ([the fund](https://github.com/open-source/github-secure-open-source-fund)). Ireland and Malta are both Sponsors regions ([about GitHub Sponsors](https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors)). On 2026-11-05 the repository had 1 star and 0 forks ([GitHub API](https://api.github.com/repos/NeuralDEEPnet/Open3DJ)).

## Xjenza Malta

**Only if a Maltese-registered legal entity applies.** Every scheme below requires one. Which Neural Deep Network entity is registered in Malta, and which in Ireland, is not on record: **the founder confirms which entity would apply** before anything else.

- **Prototype to Minimum Viable Product (P2M):** up to EUR 30,000 for "Maltese registered SME's, and start-ups": EUR 16,000 base, EUR 5,000 performance top-up, EUR 5,000 start-up top-up for companies incorporated within one year before submission, and a EUR 4,000 market-discovery voucher. Half the base grant is held back until the MVP is done, and the majority shareholder must not hold a controlling interest in another active company. Applications run all year with cut-offs at the end of March, June and September; the call is closed from the end of September to the end of December ([P2M](https://xjenzamalta.mt/2026/05/14/prototype-to-minimum-viable-product-p2m-programme/)). So the next cut-off is the end of March 2027 (inferred from that pattern).
- **Digital Vouchers Programme 2026:** for "Sole Applicants which are Maltese Registered Legal Entities". Data Readiness up to EUR 20,000, Build up to EUR 20,000, Regulatory Assessment (AI Act and Cyber Resilience Act checks) up to EUR 1,000, and a TARF/MDIA Sandbox voucher up to EUR 25,000; 90% funding under State Aid. Run with the Malta Digital Innovation Authority. Contact: ri.xjenza@gov.mt ([Digital Vouchers 2026](https://xjenzamalta.mt/2026/07/13/digital-vouchers-programme-2026/)). The official page states no deadline; a third-party aggregator lists **30 November 2026** (unverified), so ask now.
- Other open schemes on 2026-11-05 ([open funding schemes](https://xjenzamalta.mt/media/open-funding-schemes/)) need an approved Xjenza research grant first (Voucher Programme) or a product at TRL 7 or higher (EIT RIB Malta). No FUSION Technology Development Programme call was open, and its next date is unknown.

**The "Xjenza grant story".** No public record of an Xjenza grant to Neural Deep Network or Open3DJ was found. **The founder confirms the grant's name, scheme and year before anyone cites it** in a post, an application or a talk.

## University of Malta

The University's Knowledge Transfer office offers companies collaborative research, contracted research, technology licensing and "short-term paid part-time placements" for students, which are extracurricular. Contact: **knowledgetransfer@um.edu.mt**, +356 2340 3452 ([UM Knowledge Transfer, industry](https://um.edu.mt/knowledgetransfer/industry)). No published channel for companies to propose final-year projects or dissertations at the Faculty of ICT was found (unverified): ask the office. [docs/IDEAS.md](../docs/IDEAS.md) gives them concrete, sized projects to look at.

## Next actions with dates

| By | Action | Who |
|---|---|---|
| 2026-11-13 | Confirm which Neural Deep Network entity, if any, is registered in Malta | Founder |
| 2026-11-13 | Email ri.xjenza@gov.mt: the Digital Vouchers 2026 deadline (an aggregator says 30 November 2026), and whether the Regulatory Assessment or Sandbox voucher fits | Founder, if a Maltese entity exists |
| 2026-11-13 | Confirm the "Xjenza grant story" (name, scheme, year), or drop it from every text | Founder |
| 2026-12-15 | Write to knowledgetransfer@um.edu.mt about a collaborative project or a paid student placement, with [docs/IDEAS.md](../docs/IDEAS.md) attached; ask about company-proposed dissertation topics | Founder |
| 2026-12-15 | Ask the OpenCAx/BRL-CAD umbrella ([opencax/GSoC](https://github.com/opencax/GSoC)) whether it would list one Open3DJ idea for GSoC 2027 | Founder |
| From 2026-12-01 | Watch for the GSoC 2027 announcement at [the program API](https://summerofcode.withgoogle.com/api/program/2027/) and the Google Open Source blog | Founder or an agent, read-only |
| 2027-03-31 | P2M application for the end-of-March cut-off, if a Maltese entity can apply | Founder |
| 2027-06-01 | Review: Hacktoberfest 2027 format, a Fest date and venue in Malta or Dublin; GitHub Secure Open Source Fund readiness | Founder |
| October 2027 | Host the Fest, if the format continues | Founder |
| January 2029 | First possible GSoC application as Open3DJ's own organization, with 2 administrators and about 5 active people | Founder |
