<!--
Thank you for contributing to Open3DJ! This template keeps reviews fast and fair for everyone.
Fill in what applies and delete what does not. Small, focused pull requests are reviewed fastest.
Security fixes for undisclosed vulnerabilities: please follow SECURITY.md before opening a public pull request.
-->

## Summary

<!-- What does this change do, and why? Two or three sentences are enough. -->

## Linked issue

<!-- For example: Closes #123. If there is no issue, explain briefly why the change is needed. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature or improvement
- [ ] Standard part for the parts library
- [ ] Industrial design pipeline
- [ ] Documentation
- [ ] Research correction (`docs/research/`)
- [ ] RFC (`rfcs/`)
- [ ] Tests, CI or tooling
- [ ] Refactor or maintenance
- [ ] Security hardening

## New dependencies, data or models

<!-- Name each new dependency, dataset, model or file, its license (SPDX id) and a link to the license text. Write "None" if there are none. -->

## Root cause (bug fixes only)

<!-- The 5 whys: why it broke, and what prevents it from happening again. Delete this section if this is not a bug fix. -->

## Checks run

<!--
Paste the commands you ran and their output, so reviewers can see what passed.
Commands will be added when the first code lands in Step 1 of docs/PLAN.md.
Until then, describe how you checked your change (for example: links checked, Markdown previewed, YAML validated).
-->

```text
$ <command>
<output>
```

## Evidence (required when geometry changes)

<!--
If this change can affect any geometry, show the result. Once the evidence tooling from docs/PLAN.md exists, agents will be able to produce most of this automatically.
- Renders: before and after, from the same views.
- Geometry report (the planned GeometryReport measurement report, see docs/PLAN.md): paste the concise report, or attach the detailed one.
- Measurements: volume, bounding box, key dimensions and tolerances, compared with the expected values and their source.
Write "No geometry change" if this does not apply.
-->

- Renders:
- Geometry report:
- Measurements:

## AI assistance

<!--
AI help is welcome here. Disclosure helps reviewers and gives credit where it is due.
The human operator is responsible for every line, and signs off the commits. Agents must never add a Signed-off-by line themselves.
-->

- [ ] No AI tools were used for this pull request.

If AI tools were used:

- Agent or tool: <!-- for example Claude Code, Codex, Cursor, a custom MCP agent -->
- Model: <!-- for example the model name and version, if known -->
- What it did: <!-- for example wrote the code, wrote the tests, drafted the docs, found the bug -->
- Human operator: <!-- your GitHub handle. You reviewed the whole change and can explain it. -->

## Before you request review

- [ ] Every commit is signed off by a person under the [Developer Certificate of Origin](https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/LICENSING.md#3-contributing-developer-certificate-of-origin-no-cla) (`git commit -s`, or automatic in the browser editor).
- [ ] No code was copied from GPL, AGPL or other copyleft sources, or from sources with an unknown license. Any new dependency and its license are listed above.
- [ ] Documentation is updated, or no documentation change is needed.
- [ ] Tests are added or updated for the change, including a regression test for any bug fixed.
- [ ] I agree my contribution may also be distributed under Apache-2.0 if Open3DJ adopts MIT OR Apache-2.0 (see [CONTRIBUTING.md](https://github.com/NeuralDEEPnet/Open3DJ/blob/main/CONTRIBUTING.md#licensing-of-contributions)). If you do not agree, say so here.
- [ ] I added myself to [CONTRIBUTORS.md](https://github.com/NeuralDEEPnet/Open3DJ/blob/main/CONTRIBUTORS.md) (optional).

<!-- TODO(founder): the Apache-2.0 line above mirrors the forward-looking consent sentence in CONTRIBUTING.md#licensing-of-contributions. Confirm or remove both together. -->
