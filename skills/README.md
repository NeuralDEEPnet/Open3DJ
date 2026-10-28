# Skills

What agents read to use Open3DJ well (ARCHITECTURE.md section 17, PLAN.md S1).

| Path | What it is |
|---|---|
| `open3dj/SKILL.md` | The skill for any agent: the five tools, the DSL essentials with three examples, the error-fix loop, the assembly rules, units and Z-up, and what never to do. Under 5k tokens. |
| `claude-code-plugin/` | A Claude Code plugin: `.claude-plugin/plugin.json`, the same skill under `skills/open3dj/SKILL.md`, and `.mcp.json`, which starts `node <repo>/packages/open3dj/src/cli.ts mcp`. |

`open3dj/SKILL.md` is the source. The plugin holds a copy, because a plugin may not point outside its own folder. `scripts/skills.test.ts` fails when the two differ, runs every example in the skill, and checks the plugin files. Edit the source, then copy it: `cp skills/open3dj/SKILL.md skills/claude-code-plugin/skills/open3dj/SKILL.md`.

## Install the Claude Code plugin

The plugin runs the MCP server from this checkout, so install the dependencies first (`npm ci`) and have Node 24 on your `PATH`. Until the package is published, the plugin works only from a git checkout.

Load it for one session, from the folder you want your projects in:

```
claude --plugin-dir /path/to/Open3DJ/skills/claude-code-plugin
```

Then run `/mcp` to see the `plugin:open3dj:open3dj` server, and ask for a part. The skill also runs by name as `/open3dj:open3dj`. Projects (`*.o3j` folders) are created in the folder Claude Code was started in.

To check the files before loading them, run `claude plugin validate /path/to/Open3DJ/skills/claude-code-plugin`.

Format checked against the Claude Code plugin documentation on 28 Oct 2026: [plugin manifest reference](https://code.claude.com/docs/en/plugins-reference), [plugin components](https://code.claude.com/docs/en/plugins/components.md) and [skills](https://code.claude.com/docs/en/skills). The pages carry no version number. `claude plugin validate skills/claude-code-plugin` with Claude Code 2.1.312 printed `Validation passed`, with one directory-listing warning: the plugin has no icon, which matters only for a listing in Anthropic's plugin directory.

## Other agents

Any MCP client can start the server the same way: `node /path/to/Open3DJ/packages/open3dj/src/cli.ts mcp` over stdio. Give the agent `open3dj/SKILL.md` as instructions. docs/GETTING-STARTED.md has the setup for Codex, Gemini CLI, Cursor and VS Code.
