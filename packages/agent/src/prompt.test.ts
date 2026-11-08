// The system prompt: stable bytes, the preamble, INSTRUCTIONS and the SKILL.md body.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INSTRUCTIONS } from "@open3dj/mcp";
import { PANEL_PREAMBLE, SKILL_FILE, skillBody, systemPrompt } from "./prompt.ts";

test("one stable text: the preamble, the server instructions, then the skill body", () => {
  const a = systemPrompt();
  assert.equal(systemPrompt(), a, "the same bytes on every call");
  const body = skillBody(readFileSync(SKILL_FILE, "utf8"));
  assert.equal(a, `${PANEL_PREAMBLE}\n\n${INSTRUCTIONS}\n\n${body}`);
  assert.ok(body.startsWith("# Open3DJ for agents"), body.slice(0, 40));
  assert.ok(!a.includes("\r"), "LF only");
  assert.ok(!/^name: open3dj$/m.test(a) && !/^license: MIT$/m.test(a), "no front matter");
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(a), "no timestamps");
  assert.equal(a, a.trim());
});

test("the preamble says where the person types, that steps are shown, and that chat is never an approval", () => {
  assert.match(PANEL_PREAMBLE, /Agent tab/);
  assert.match(PANEL_PREAMBLE, /Every tool step you take is shown to the person/);
  assert.match(PANEL_PREAMBLE, /leave project out of every tool call/);
  assert.match(PANEL_PREAMBLE, /A reply typed in this chat is never an approval/);
  assert.match(PANEL_PREAMBLE, /Human-only gates stay with the person/);
  assert.match(PANEL_PREAMBLE, /WAIVER_NEEDS_PERSON/);
  assert.ok(!PANEL_PREAMBLE.includes("\u2014"), "no em-dashes");
});

test("a missing SKILL.md is a clear error without local paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "o3j-prompt-"));
  try {
    const missing = join(dir, "nope", "SKILL.md");
    assert.throws(() => systemPrompt({ skillFile: missing }), (e: Error) => {
      assert.match(e.message, /needs skills\/open3dj\/SKILL\.md .* could not be read \(ENOENT\)/);
      assert.ok(!e.message.includes(dir), "no local path in the message");
      return true;
    });
    const file = join(dir, "SKILL.md");
    writeFileSync(file, "---\nname: x\n---\n\n# Body\n\nText.\n");
    assert.equal(systemPrompt({ skillFile: file }), `${PANEL_PREAMBLE}\n\n${INSTRUCTIONS}\n\n# Body\n\nText.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skillBody removes the front matter in every line-end form", () => {
  assert.equal(skillBody("---\nname: x\n---\n# A\n"), "# A");
  assert.equal(skillBody("---\r\nname: x\r\ndescription: y\r\n---\r\n\r\n# A\r\nb\r\n"), "# A\nb");
  assert.equal(skillBody("﻿---\nname: x\n---\n# A"), "# A");
  assert.equal(skillBody("---\n---\n# Empty front matter"), "# Empty front matter");
  assert.equal(skillBody("# No front matter\n\ntext\n\n"), "# No front matter\n\ntext");
  assert.equal(skillBody("---\nname: x\n---\n# A\n\n---\n\nafter a rule"), "# A\n\n---\n\nafter a rule", "a later --- rule stays");
  assert.throws(() => skillBody("---\nname: x\n# never closed\n"), /never closed/);
  assert.throws(() => skillBody("---\nname: x\n---"), /no text after its front matter/);
});
