# RFC NNNN: Title

- **Status:** draft | final comment period | accepted | rejected | postponed
- **Issue:** #NNN (labeled `rfc`)
- **Author:** your GitHub handle, and the agent or tool that helped, if any
- **Started:** YYYY-MM-DD
- **Final comment period:** YYYY-MM-DD to YYYY-MM-DD (10 calendar days, at least 5 business days)

Copy this file to `rfcs/NNNN-short-name.md`, using the next free number. Keep sentences short and concrete. [GOVERNANCE.md](../GOVERNANCE.md#big-changes-rfcs) says when an RFC is needed and how the decision is made.

## Problem

What is wrong or missing today, and who it affects. Link the issues, files and measurements that show it.

## Proposal

What changes, described so that someone could build it. Name the files, commands, file formats, tool inputs and outputs, and settings that change. Say what stays the same.

## Security and privacy

What new data leaves the machine, what new inputs are trusted, what a hostile file, page, process or person could do, and the controls for each. Update the threat table in [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) section 12 in the same pull request as the code.

## Dependencies and licenses

Every new dependency, dataset, model or file, with its license (SPDX id) and a link to the license text. Write "None" if there are none.

## Alternatives

The other ways to solve the problem, and why this proposal is better. "Do nothing" is always one of them.

## Risks and open questions

What could go wrong, what is not known yet, and what must be checked before or during the work.

## How we will know it worked

The measurement, test or checklist that shows the change did what it promised, and the Kaizen metric it moves, if any.

## Plan

The pull requests, in order, each small enough to review (about 400 changed lines).

## Decision

Filled in at the end of the final comment period: accepted, rejected or postponed, with the reasons and a link to the comment that records them.
