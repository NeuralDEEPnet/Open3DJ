# CLAUDE.md

Claude Code: follow [AGENTS.md](AGENTS.md). It is the single source of rules for every AI agent in this repository, and it is imported below.

@AGENTS.md

## Notes for Claude Code

- **Use plan mode for multi-file changes.** Present the plan, including which files change and why, and wait for the operator's approval before editing.
- **Prefer subagents for research.** Use them to read sources and check claims in parallel, and bring back only the findings with their links.
- **Keep commits small.** One logical change per commit, signed off with `git commit -s` using the operator's identity, and only when the operator asks you to commit.
- **Keep the disclosure trailer.** Leave the `Co-Authored-By:` trailer that Claude Code adds, or add `Assisted-by: Claude Code (<model>)`.
- **Never echo secrets.** Do not print, log or paste tokens or keys from the environment into files, commits, comments or tool output.
