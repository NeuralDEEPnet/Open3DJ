# Outreach: the call for testers

Ready-to-post texts that ask people to test Open3DJ on their own machines. They were drafted by neuraldeep.net design agents for the founder. **The founder reviews and posts every one of them by hand.** No agent posts, comments or replies on any of these sites ([AI_POLICY.md](../../AI_POLICY.md)).

Every text links to the repository and to the tester guide, [docs/TESTING.md](../../docs/TESTING.md), names Neural Deep Network LTD as the creator, and says that testers are credited.

| File | Where it goes |
|---|---|
| [call-for-testers-issue.md](call-for-testers-issue.md) | A pinned GitHub issue, labeled `help wanted` and `good first issue` |
| [discussions-announcement.md](discussions-announcement.md) | GitHub Discussions, Announcements category, pinned |
| [show-hn.md](show-hn.md) | Hacker News: a Show HN title and the first comment |
| [social.md](social.md) | Two posts for X and one for LinkedIn |
| [reddit.md](reddit.md) | r/cad, r/3Dprinting, r/FreeCAD, r/ClaudeAI and, only if it applies, r/LocalLLaMA |
| [chat.md](chat.md) | A short message for Discord or Slack communities |

## Posting checklist

Work through this in order. Each step depends on the ones before it.

**Before anything is posted**

- [ ] Pull request #3 is merged into `main`.
- [ ] The two example goldens (`box-with-lid` and `enclosure`) are regenerated, and `npm run check` is green on all five CI runners on `main`.
- [ ] The one-line installers from `main` work on a clean Windows machine and a clean macOS or Linux machine. Run each command exactly as [docs/TESTING.md](../../docs/TESTING.md#install) prints it.
- [ ] The `-Ref` callout and the "Before pull request #3 merges" subsection are removed from docs/TESTING.md, and the matching line is removed from the README's "Help test Open3DJ on your machine" section. Search both files for `REMOVE AFTER PULL REQUEST #3 MERGES`.
- [ ] The README's "Not yet" paragraph and the platform tables in docs/TESTING.md match what is true on the day you post (CI results, the golden failures, what has been tested by a person).
- [ ] The labels exist: `help wanted`, `good first issue`, `hardware-report`, `failure-report` and `needs-triage` ([REPO-SETTINGS.md section 5](../../docs/REPO-SETTINGS.md#5-labels)). The hardware report form cannot apply a label that does not exist.
- [ ] Discussions are enabled, with the Announcements, Q&A and Show and tell categories ([REPO-SETTINGS.md section 3](../../docs/REPO-SETTINGS.md#3-discussions)). The guide and several posts link there.
- [ ] Open the [hardware report form](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=hardware_report.yml) once yourself and check that it renders. Then close the tab without submitting, or file your own machine's report as the first one.

**Day 1: on GitHub**

- [ ] Open the call-for-testers issue from [call-for-testers-issue.md](call-for-testers-issue.md), add both labels, and pin it.
- [ ] Post [discussions-announcement.md](discussions-announcement.md) in Announcements and pin it.

**Day 1 or 2: outside GitHub**

- [ ] Post Show HN when you can stay for the next few hours to answer comments. Post it once; do not repost if it gets little attention.
- [ ] Post on X and LinkedIn.

**Over the next week: communities**

- [ ] Reddit: one subreddit per day at most, each with its own text from [reddit.md](reddit.md). Read the subreddit's rules on the day you post.
- [ ] Discord and Slack: only in communities you already take part in, and only in channels meant for projects or announcements.

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
