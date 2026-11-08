# Outreach: the call for testers

Texts and notes that ask people to test Open3DJ on their own machines. They were drafted by neuraldeep.net design agents for the founder. **The founder reviews and posts every one of them by hand.** No agent posts, comments or replies on any of these sites ([AI_POLICY.md](../../AI_POLICY.md)). Hacker News forbids text written or edited by a language model, so for Show HN there is a fact sheet, and the founder writes the post and every reply in their own words.

Every ready-to-post text (the issue, the announcement, and the social, Reddit and chat texts) links to the tester guide, [docs/TESTING.md](../../docs/TESTING.md), names Neural Deep Network LTD as the creator, and says that testers are credited. The texts for LinkedIn, Reddit and chat also link to the repository's front page. The X posts link only the tester guide, to stay under the length limit. The r/mcp text also links the client setup in [docs/GETTING-STARTED.md](../../docs/GETTING-STARTED.md#connect-a-client). The messages to moderators are questions, not posts, and carry none of this.

| File | Where it goes |
|---|---|
| [call-for-testers-issue.md](call-for-testers-issue.md) | A pinned GitHub issue, labeled `help wanted` and `good first issue` |
| [discussions-announcement.md](discussions-announcement.md) | GitHub Discussions, Announcements category, pinned |
| [show-hn.md](show-hn.md) | Hacker News: a fact sheet and the rules. The founder writes the post |
| [social.md](social.md) | Three posts for X and one for LinkedIn |
| [reddit.md](reddit.md) | Notes and a text per subreddit: r/3Dprinting, r/cad, r/ClaudeAI, r/mcp, r/LocalLLaMA (only with a local-model demo), and r/FreeCAD and r/openscad only after asking the moderators |
| [chat.md](chat.md) | A short message for Discord or Slack communities |
| [directories.md](directories.md) | The repository description and topics, then Glama, awesome-mcp-servers, mcpservers.org and mcp.so; what waits for the cleared name and what to skip |
| [communities.md](communities.md) | CadQuery and build123d, the OpenSCAD list, the FreeCAD forum, the MCP spaces, and the clean-room rule for code contributors |
| [techxpo.md](techxpo.md) | The TechXPO stand: a 3-minute demo, what to say, and the QR code target |

The issue, the announcement, the social posts, the chat message, the TechXPO pitch and the Build Night page carry the same line for people who work with agents: "Bring your Claude Code, Codex or Cursor agent. It does the work, you press the button."

## Posting checklist

Work through this in order. Each step depends on the ones before it.

**Before anything is posted**

- [x] Pull request #3 is merged into `main`.
- [ ] The two example goldens (`box-with-lid` and `enclosure`) are regenerated, and `npm run check` is green on all five CI runners on `main`.
- [ ] The one-line installers from `main` work on a clean Windows machine and a clean macOS or Linux machine. Run each command exactly as [docs/TESTING.md](../../docs/TESTING.md#install) prints it.
- [x] The `-Ref` callout and the "Before pull request #3 merges" subsection are removed from docs/TESTING.md, and the matching line is removed from the README's "Help test Open3DJ on your machine" section. Search both files for `REMOVE AFTER PULL REQUEST #3 MERGES`.
- [ ] The README's "Not yet" paragraph and the platform tables in docs/TESTING.md match what is true on the day you post (CI results, the golden failures, what has been tested by a person).
- [x] The labels exist: `help wanted`, `good first issue`, `hardware-report`, `failure-report` and `needs-triage` ([REPO-SETTINGS.md section 5](../../docs/REPO-SETTINGS.md#5-labels)). The hardware report form cannot apply a label that does not exist.
- [ ] Discussions are enabled, with the Announcements, Q&A and Show and tell categories ([REPO-SETTINGS.md section 3](../../docs/REPO-SETTINGS.md#3-discussions)). The guide and several posts link there.
- [ ] Open the [hardware report form](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=hardware_report.yml) once yourself and check that it renders. Then close the tab without submitting, or file your own machine's report as the first one.

**Day 1: on GitHub**

- [ ] Open the call-for-testers issue from [call-for-testers-issue.md](call-for-testers-issue.md), add both labels, and pin it.
- [ ] Post [discussions-announcement.md](discussions-announcement.md) in Announcements and pin it.

**Day 1 or 2: outside GitHub**

- [ ] Write your Show HN from the fact sheet in [show-hn.md](show-hn.md), in your own words, and post it from your own account when you can stay for the next few hours to answer comments. Post it once; do not repost if it gets little attention, and never ask anyone to upvote.
- [ ] Post on X and LinkedIn.

**After CI is green: directories** (in order, from [directories.md](directories.md))

- [ ] Set the repository description and topics.
- [ ] Submit to Glama, after the Dockerfile pull request is merged, and check that the build passes.
- [ ] Open one pull request to punkpeye/awesome-mcp-servers with the Glama badge, from your own account, without the agent fast-track tag.
- [ ] Submit to mcpservers.org and mcp.so on their free review tiers.
- [ ] Leave the official MCP Registry and the Claude plugin directory until the name is cleared. Skip Smithery and PulseMCP.

**Over the next week: communities**

- [ ] Reddit: one subreddit per day at most, each with its own text from [reddit.md](reddit.md). Read the subreddit's rules on the day you post; they could not be read when the notes were written.
- [ ] Discord and Slack: only in communities you already take part in, and only in channels meant for projects or announcements.

**After that: the open CAD and MCP communities** (from [communities.md](communities.md), one at a time)

- [ ] Subscribe to the OpenSCAD mailing list a few days before you want to write; an administrator approves each subscription.
- [ ] CadQuery and build123d: join the shared Discord, read its rules, and offer o3dj-bench as a neutral evaluation, not a launch post.
- [ ] FreeCAD forum: read its rules in a browser, then post only an interoperability question in the open discussion area, or skip it.
- [ ] MCP: no product posts in the MCP Contributors Discord or the specification's Discussions.
- [ ] TechXPO: print the QR code to docs/TESTING.md and rehearse the demo in [techxpo.md](techxpo.md).

**After posting**

- [ ] Answer every hardware report within a few days, even with a one-line thank you. Label failures and turn each one into a test ([the Kaizen rule](../../AGENTS.md#the-kaizen-rule-test-first-when-something-breaks)).
- [ ] Update the platform tables in docs/TESTING.md as reports arrive, and link the first report for each platform.
- [ ] Add every tester who asked for credit to [CONTRIBUTORS.md](../../CONTRIBUTORS.md).
- [ ] Note in the [build log](../build-log.md) what was posted where and how many reports each place brought in, so the next call can focus on what worked.

## Community norms

- **Say who you are.** Every text says the project is by Neural Deep Network LTD. In replies, say you are the founder.
- **Respect each community's rules.** Many subreddits and servers limit self-promotion, require a flair, or keep a weekly thread for projects. These drafts were not checked against each community's current rules. Read them on the day you post, and skip a community where a post would not fit.
- **Ask, do not sell.** The texts ask for help testing an early project. Keep replies the same: honest about what does not work yet, no hype words, no promises about dates.
- **Do not cross-post the same text everywhere at once.** Each community gets the version written for it.
