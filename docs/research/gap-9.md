# Gap 9: Remaining unverified claims (code signing, CADGenBench, Apple fee, 3dj image input)

Checked 27 Oct 2026 against vendor docs, the Azure price API, CADGenBench `results.jsonl` (806 rows) and the 3dj MCP schemas (not called).

## Bottom line

| Claim | Verdict | Correction |
|---|---|---|
| "Apply to SignPath in week 0" | **Wrong timing** | SignPath requires the project to be "already released" with "verifiable reputation". Apply after the first unsigned preview. |
| SignPath signs as Neural Deep | **Wrong** | The certificate is issued to "SignPath Foundation", which is shown as the publisher. |
| Artifact Signing "about $9.99/month" | Correct (Basic) | Premium is $99.99/month. Overage is $0.005 per signature. |
| Artifact Signing orgs "USA/Canada/EU/UK" | Outdated | The list is broader now. Irish and Maltese companies qualify. Individuals must be in the US or Canada. |
| build123d-mcp "self-reported 0.457" | **Half right** | 0.4573 is a maintainer-**validated** row, but it used **GPT-5.5** and dates from June. build123d-mcp's best validated score is now **0.8298**. |
| G3 "≥ 0.457, top-3" | **Stale by ~0.37** | The validated bar is 0.830. Top-3 overall needs more than 0.835. |
| Apple $99/yr | Correct | The fee is charged in local currency plus tax. Organisations need a D-U-N-S number. |
| 3dj image input is a URL; no upload tool | **Confirmed** | A further gap: Open3DJ parts and evidence cannot be sent to 3dj for quoting (§4). |

## 1. Windows signing

**SignPath Foundation** ([conditions](https://signpath.org/terms); its code of conduct is still a "draft"):
- Licence: "OSI-approved Open Source license **without commercial dual-licensing** for all components". MIT OR Apache-2.0 passes, but Neural Deep must never sell a commercial licence to Open3DJ code.
- No "proprietary, non open-source component (especially code published by a maintainer or an affiliated person/organization)". An open 3dj adapter is fine. Closed 3dj.app assets cannot be bundled.
- The project must be "actively maintained", "already released in the form that should be signed", and documented on its download page.
- There is no numeric threshold for age or stars. However, "for executable programs … we require a certain verifiable reputation". Acceptance is discretionary and has no appeal.
- Further obligations:
  - builds from verifiable CI;
  - manual approval of every release;
  - MFA on SignPath and GitHub for all members;
  - named authors, reviewers and approvers;
  - a "Code signing policy" section on the home and download pages;
  - enforced name and version metadata;
  - an uninstaller.
- Data sent to systems the user did not specify needs a privacy policy shown during installation, plus an opt-out. This affects crash-bundle upload and telemetry.

**Azure Artifact Signing** (formerly Trusted Signing):
- **Price.** The retail price API still lists it as "Trusted Signing": Basic $9.99/month (5,000 signatures), Premium $99.99/month (100,000), overage $0.005 per signature. Billing is not pro-rated. Free, trial and sponsored Azure subscriptions are refused.
- **Availability.** The quickstart (updated 8 Oct 2026) offers Public Trust to organisations in:
  - the US, Canada, the EU and the UK;
  - Australia, New Zealand, Japan, South Korea, Singapore, Switzerland, Norway and Israel.

  Individuals must be in the US or Canada. The 29 Aug Windows page still lists only US/CA/EU/UK. Either way, Neural Deep Network LTD qualifies as an EU company, but its founder would not qualify as an individual.
- **Validation.** It takes 1-20 business days, and documents must be under 12 months old. The CN must be the validated legal name.
- **Three-year rule.** "Three years of verifiable history" appears only in 2025 Q&A answers. It is not in the current quickstart or FAQ (I searched both). Treat it as a residual risk.
- No route gives instant SmartScreen reputation.

## 2. CADGenBench

- **What it is.** A Hugging Face benchmark ([code](https://github.com/huggingface/cadgenbench), Apache-2.0) with two tasks: **generation** from an engineering drawing (49 fixtures) and **editing** of a STEP file (32 fixtures). Submissions are STEP files, and the ground truth is private.
- **Metric.** The per-sample CAD Score is 0 unless the part is a valid, watertight solid. Otherwise:
  - generation: 0.4·shape (mean of surface F1 and volume IoU) + 0.4·interface (keep-in/keep-out) + 0.2·topology (Betti numbers);
  - editing: 0.6·shape (renormalised against a no-op) + 0.3·interface + 0.1·topology.

  The aggregate is the mean over all 81 samples. I checked it: (0.3718·49 + 0.5881·32)/81 = 0.4573.
- **Leaderboard.** It lives in the HF Space `HuggingAI4Engineering/CADGenBench`, which is running. Only the GPU-image Space is paused. Rows publish as **unvalidated**. Maintainers promote rows to **validated** after a manual methodology review, and each tier has its own table.
- **Top scores:**
  - Validated: 0.8298 by pzfreo, "build123d-mcp 0.3.85 + Claude Opus 5.5 (max effort) r2" (24 Sep, 100% validity). Next is Godela at 0.8113.
  - Unvalidated: deeprd-v2 at 0.8482 (11 Oct), then 0.8373, 0.8352 (Siemens NX MCP + Opus 5.5) and 0.8315.
  - Best HF baseline: Claude Fable 5 at 0.4514. Aggregator sites citing 0.444 are stale.
- **The 0.457 figure.** It comes from the row `gpt-5.5-build123d-mcp-0.3.59-xhigh-r5`: 0.4573 at 100% validity, 27 Jun, validated tier. The "0.360" it is compared with is HF's GPT-5.5 baseline (0.3596, 87.7% validity), which ran on an earlier data revision (`1dfcbbcedc20` against `f76f96558581`). The README still quotes these June numbers, although the package is now at 0.3.91.
- **Same model.** With Opus 5.5, the official prompt with no MCP scored 0.752 (unvalidated), and build123d-mcp scored 0.805-0.830. Tooling is still worth about 0.08.

## 3. Apple Developer Program

Apple: "99 USD per membership year. Prices may vary by region and are listed in local currency during the enrollment process." Tax is added "when applicable", and the Enterprise programme is 299 USD.

Organisations need:
- a **D-U-N-S Number**;
- legal-entity status (no DBAs or branches);
- a public website on their own domain;
- an enroller who has signing authority.

Fee waivers cover only nonprofits, education and government. I found no change to the fee in 2026.

## 4. 3dj MCP image input and quotes

The 3dj server has 18 tools.
- **`generate_from_image_url`** takes a required `imageUrl` ("HTTPS URL of the source image. Must be publicly reachable. Max 12 MB.") and an optional `name`. The server downloads the image.
- **No upload path.** No tool accepts file bytes, base64 or a local path.
- **`get_model_download_url`** returns **GLB only**. STEP export happens in the browser workbench.
- **`request_print_quote`** needs the `modelId` of "a completed saved model" in the 3dj account, plus fixed brief fields. Its only free text is `notes` (≤2000 characters). It has **no file, evidence or hash field**.
- **`list_providers`** reports provider health, input types and remaining allowance. The router can use it directly.

## Plan changes

1. **SignPath.** Apply just after the first unsigned preview (around weeks 8-12). Publish the signing policy, the roles and MFA, and the privacy text first.
2. **Artifact Signing.** Start organisation validation for Neural Deep Network LTD in parallel, budgeting about $120/year. It is the fallback, and the only route that shows Neural Deep as the publisher.
3. **G3.**
   - Launch target: match or beat build123d-mcp's best validated score with the same model and effort, currently 0.830, in the validated tier.
   - Stretch target: the best validated score at release.
   - Fix landscape-ai-cad.md: the 0.360→0.457 run used GPT-5.5.
4. **Apple.** Budget about $99 in local currency plus VAT. Start the D-U-N-S lookup in week 0.
5. **3dj provider.**
   - A local photo must be hosted at a public HTTPS URL first. That needs explicit egress consent.
   - `o3dj_quote` cannot send local parts or evidence to 3dj today. Neural Deep should add a presigned upload tool and an evidence/hash field to 3dj before v0.5. Until then, limit 3dj quotes to models made on 3dj, with hashes in `notes`.
   - Downloads are GLB only.

## Sources

- SignPath conditions: https://signpath.org/terms ; home: https://signpath.org/
- Microsoft code-signing options (29 Aug 2026): https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- Artifact Signing quickstart (8 Oct 2026): https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart ; FAQ: https://learn.microsoft.com/en-us/azure/artifact-signing/faq ; pricing: https://azure.microsoft.com/en-us/pricing/details/artifact-signing/
- Azure retail price API: https://prices.azure.com/api/retail/prices?$filter=serviceName%20eq%20%27Trusted%20Signing%27
- 2025 three-year-history Q&A: https://learn.microsoft.com/en-us/answers/questions/2263040/trusted-signing-identity-validation-not-available
- CADGenBench: https://github.com/huggingface/cadgenbench ; metrics: https://raw.githubusercontent.com/huggingface/cadgenbench/main/docs/metrics.md ; validation: https://raw.githubusercontent.com/huggingface/cadgenbench/main/docs/benchmark/validation.md
- Leaderboard Space: https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench ; code: https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench/blob/main/leaderboard.py
- Submissions: https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-submissions (results.jsonl)
- build123d-mcp: https://github.com/pzfreo/build123d-mcp ; https://pypi.org/project/build123d-mcp/
- Apple: https://developer.apple.com/programs/enroll/ ; https://developer.apple.com/support/purchase-activation/
- 3dj MCP tool schemas (`mcp__3dj__*`, 18 tools), read 27 Oct 2026 without calling them.
