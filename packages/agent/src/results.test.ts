// Tool results as Messages API tool_result content: text, the one PNG, SVG notes, the 64 KiB
// cap and redaction. Key-like strings are built at run time, never written as literals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { imageContent, toolResult } from "@open3dj/mcp";
import type { CallResult } from "@open3dj/mcp";
// A 1x1 PNG from the fake compute pool (test data of @open3dj/mcp).
import { TINY_PNG } from "../../mcp/src/testing.ts";
import { MAX_IMAGE_BASE64_CHARS, MAX_IMAGE_SIDE_PX, MAX_TEXT_BYTES, redactText, toApiContent } from "./results.ts";
import type { ApiTextBlock } from "./results.ts";

const png = (bytes: Uint8Array = TINY_PNG) => ({ format: "png" as const, name: "multiview.png", bytes, width: 1, height: 1 });
const svg = { format: "svg" as const, name: "multiview-lid.svg", bytes: new TextEncoder().encode("<svg/>"), width: 10, height: 10 };
const texts = (r: { content: Array<{ type: string }> }) => r.content.filter((b): b is ApiTextBlock => b.type === "text").map((b) => b.text);
const textBytes = (r: { content: Array<{ type: string }> }) => texts(r).reduce((n, t) => n + Buffer.byteLength(t), 0);
const fakeKey = () => ["sk", "ant", "api03", "A1b2C3d4".repeat(6)].join("-");

/** A PNG header of the given size, so the dimension check can be tested without a big image. */
function pngOfSize(width: number, height: number): Uint8Array {
  const b = Buffer.from(TINY_PNG);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

test("a plain result: the JSON text stays one text block and is_error mirrors isError", () => {
  const ok = toolResult({ status: "ok", rev: "r_0001" });
  assert.deepEqual(toApiContent(ok), { content: [{ type: "text", text: "{\"status\":\"ok\",\"rev\":\"r_0001\"}" }], is_error: false });
  const bad = toolResult({ status: "error", error: { code: "BAD_INPUT", message: "fields" } });
  const r = toApiContent(bad);
  assert.equal(r.is_error, true);
  assert.equal(texts(r)[0], JSON.stringify(bad.structuredContent));
  const docsError = toolResult({ error: { code: "BAD_INPUT", message: "query" } });
  assert.equal(toApiContent(docsError).is_error, true, "docs errors have no status");
});

test("a PNG render becomes one base64 image block after the text", () => {
  const r = toApiContent(toolResult({ status: "ok", rev: "r_0002" }, imageContent([png()], "/home/x/plate.o3j", "r_0002")));
  assert.equal(r.content.length, 2);
  assert.equal(r.content[0]!.type, "text");
  assert.deepEqual(r.content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from(TINY_PNG).toString("base64") } });
  assert.equal(r.is_error, false);
});

test("at most one image per result, and the text says how many were left out", () => {
  const three = toApiContent(toolResult({ status: "ok" }, imageContent([png(), png(), png()], "p.o3j", "r_0001")));
  assert.equal(three.content.filter((b) => b.type === "image").length, 1);
  assert.match(texts(three).join("\n"), /2 more images were left out: a tool result carries one image here\./);
  const two = toApiContent(toolResult({ status: "ok" }, imageContent([png(), png()], "p.o3j", "r_0001")));
  assert.match(texts(two).join("\n"), /1 more image was left out/);
});

test("an SVG resource becomes a note that names the file and the revision", () => {
  const r = toApiContent(toolResult({ status: "ok", rev: "r_0003" }, imageContent([svg], "/home/x/My Plate.o3j", "r_0003")));
  assert.equal(r.content.every((b) => b.type === "text"), true);
  const all = texts(r).join("\n");
  assert.match(all, /The SVG drawing multiview-lid\.svg of r_0003 is saved in the project and is not sent here\. Render with format "png"/);
  assert.ok(!all.includes("<svg"), "the SVG text is not sent");
  const both = toApiContent(toolResult({ status: "ok" }, imageContent([png(), svg], "p.o3j", "r_0001")));
  assert.deepEqual(both.content.map((b) => b.type), ["text", "text", "image"]);
});

test("images the API would refuse are left out with a reason", () => {
  const cases: Array<[CallResult["content"][number], RegExp]> = [
    [{ type: "image", data: Buffer.from(TINY_PNG).toString("base64"), mimeType: "image/jpeg" }, /image\/jpeg is not sent here, only PNG/],
    [{ type: "image", data: Buffer.from("not a png at all, just text bytes").toString("base64"), mimeType: "image/png" }, /the data is not a PNG/],
    [{ type: "image", data: "", mimeType: "image/png" }, /the data is not a PNG/],
    [{ type: "image", data: Buffer.from(pngOfSize(MAX_IMAGE_SIDE_PX + 1, 900)).toString("base64"), mimeType: "image/png" }, /3001 x 900 px, over 3000 px on a side; render again with width and height of 3000 or less/],
    [{ type: "image", data: "A".repeat(MAX_IMAGE_BASE64_CHARS + 4), mimeType: "image/png" }, /over the API limit of 10000000/],
  ];
  for (const [item, why] of cases) {
    const r = toApiContent({ structuredContent: { status: "ok" }, content: [{ type: "text", text: "{}" }, item] });
    assert.equal(r.content.some((b) => b.type === "image"), false, String(why));
    assert.match(texts(r).join("\n"), why);
  }
  const edge = toApiContent(toolResult({ status: "ok" }, imageContent([png(pngOfSize(MAX_IMAGE_SIDE_PX, MAX_IMAGE_SIDE_PX))], "p.o3j", "r_0001")));
  assert.equal(edge.content.filter((b) => b.type === "image").length, 1, "exactly 3000 px is sent");
  // A refused image does not use up the one image slot.
  const after = toApiContent({ structuredContent: {}, content: [{ type: "image", data: "", mimeType: "image/png" }, ...imageContent([png()], "p.o3j", "r_0001")] });
  assert.equal(after.content.filter((b) => b.type === "image").length, 1);
});

test("text is capped at 64 KiB in all, with a note, and never splits a character", () => {
  const big = toolResult({ status: "ok", tree: "é".repeat(50_000) + "x".repeat(20_000) });
  const full = Buffer.byteLength((big.content[0] as { text: string }).text);
  const r = toApiContent(big);
  assert.ok(textBytes(r) <= MAX_TEXT_BYTES, `${textBytes(r)} bytes`);
  assert.ok(textBytes(r) > MAX_TEXT_BYTES - 400, "the cut keeps nearly all of the budget");
  const last = texts(r).at(-1)!;
  assert.match(last, new RegExp(`^\\[Open3DJ cut this tool result at 64 KiB: \\d+ of ${full} bytes shown\\. Ask for less`));
  const shown = Number(/: (\d+) of/.exec(last)![1]);
  assert.equal(Buffer.byteLength(texts(r)[0]!), shown);
  assert.ok(!texts(r)[0]!.includes("\uFFFD"), "no broken character at the cut");
  // With notes and an image, the image stays and the notes come after the cut note.
  const withImage = toApiContent(toolResult({ status: "ok", tree: "x".repeat(70_000) }, imageContent([png(), png(), svg], "p.o3j", "r_0001")));
  assert.ok(textBytes(withImage) <= MAX_TEXT_BYTES);
  assert.equal(withImage.content.at(-1)!.type, "image");
  assert.match(texts(withImage).at(-1)!, /cut this tool result[^\n]*\n.*1 more image was left out/s);
  // Just under the cap: nothing is cut.
  const fits = toolResult({ s: "y".repeat(MAX_TEXT_BYTES - 20) });
  assert.equal(texts(toApiContent(fits))[0], (fits.content[0] as { text: string }).text);
});

test("key-like strings and home folder paths are removed from text", () => {
  const key = fakeKey();
  const home = homedir();
  const message = [
    `x-api-key: ${key}`,
    "open '/home/Jane Doe/designs/plate.o3j/main.o3j.js' failed",
    "cwd is /home/jane",
    "C:\\Users\\Jane\\designs\\lid.step was written",
    `home ${home}`,
    "relative out/r_0001/plate.step stays",
  ].join("\n");
  const r = toApiContent(toolResult({ status: "error", error: { code: "INTERNAL_ERROR", message } }));
  const text = texts(r).join("\n");
  assert.ok(!text.includes(key), "no key");
  assert.match(text, /\[redacted key\]/);
  assert.ok(!/Jane|jane/.test(text), `no user names: ${text}`);
  assert.ok(home.length <= 1 || !text.includes(home), "no home folder");
  assert.match(text, /main\.o3j\.js/, "the file name stays");
  assert.match(text, /lid\.step/);
  assert.match(text, /out\/r_0001\/plate\.step stays/);
  assert.match(redactText("cwd is /home/jane"), /^cwd is ~$/);
  assert.equal(redactText(`a ${home}/x/y.step b`), "a …/y.step b");
  assert.equal(redactText("the run took 12 s; 3 of 4 parts are valid"), "the run took 12 s; 3 of 4 parts are valid");
  // Plain text (not JSON) gets the same rules.
  assert.equal(redactText("open '/home/Jane Doe/designs/a.o3j/main.o3j.js' failed"), "open '…/main.o3j.js' failed");
  assert.equal(redactText("missing: /Users/jane, then C:\\Users\\Jane"), "missing: ~, then ~");
  assert.equal(redactText("(see /home/jane)"), "(see ~)");
  assert.equal(redactText("open \"/Users/Jane Doe\" and 'C:\\Users\\Jane Doe\\' failed"), "open \"~\" and '~' failed");
  // JSON text with nothing to redact keeps its exact bytes.
  const clean = toolResult({ status: "ok", rev: "r_0001", parts: [{ def: "lid", volume_mm3: 1000.5, note: "a\nb \"q\" é" }] });
  assert.equal(texts(toApiContent(clean))[0], (clean.content[0] as { text: string }).text);
  // Notes are built from names the server made; text from other content is redacted too.
  const second = toApiContent({ structuredContent: {}, content: [{ type: "text", text: "{}" }, { type: "text", text: `key ${key}` }] });
  assert.ok(!texts(second).join("").includes(key));
});

test("empty and unknown content never leaves an empty result", () => {
  assert.deepEqual(toApiContent({ structuredContent: {}, content: [] }), { content: [{ type: "text", text: "The tool returned no content." }], is_error: false });
  assert.deepEqual(toApiContent({ structuredContent: {}, content: [{ type: "text", text: "" }] }).content, [{ type: "text", text: "The tool returned no content." }]);
  const odd = toApiContent({ structuredContent: {}, content: [{ type: "audio<x>", data: "" } as never] });
  assert.match(texts(odd)[0]!, /A content item of type audio_x_ is not sent here\./);
  const other = toApiContent({ structuredContent: {}, content: [{ type: "resource", resource: { uri: "open3dj://p.o3j/r_0001/notes.txt", mimeType: "text/plain", text: "hello" } }] });
  assert.match(texts(other)[0]!, /The text\/plain resource notes\.txt is not sent here\./);
});
