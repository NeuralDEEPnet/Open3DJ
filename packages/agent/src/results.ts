// An MCP CallResult as the content of a Messages API tool_result block. Text stays text,
// redacted and capped; one PNG becomes an image block; an SVG resource becomes a note that
// names the file. Everything here goes to a remote API, so nothing that looks like an API key
// and no home folder path may pass.
import { homedir } from "node:os";
import { redactPaths } from "@open3dj/schemas";
import type { CallContent, CallResult } from "@open3dj/mcp";

export type ApiTextBlock = { type: "text"; text: string };
export type ApiImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } };
export type ApiContentBlock = ApiTextBlock | ApiImageBlock;

/** The fields a tool_result block needs besides type and tool_use_id. */
export interface ApiToolResult {
  content: ApiContentBlock[];
  is_error: boolean;
}

/** The text of one tool result, notes included, is cut to this many UTF-8 bytes (64 KiB). */
export const MAX_TEXT_BYTES = 64 * 1024;
/**
 * The Claude API takes images up to 10 MB, base64-encoded, and rejects images over 3,000 px
 * on a side once a request holds more than 20 images
 * (https://platform.claude.com/docs/en/build-with-claude/vision, "Request limits", checked
 * 2026-11-08). The conversation resends every earlier render, so larger images are left out
 * with a note instead of failing a later request.
 */
export const MAX_IMAGE_BASE64_CHARS = 10_000_000;
export const MAX_IMAGE_SIDE_PX = 3000;

const PNG_SIGNATURE = "89504e470d0a1a0a";

/** Map one MCP CallResult to tool_result content. is_error mirrors the result's isError. */
export function toApiContent(result: CallResult): ApiToolResult {
  const content: ApiContentBlock[] = [];
  const notes: string[] = [];
  let image = false;
  let dropped = 0;
  for (const item of result.content as CallContent[]) {
    if (item.type === "text") {
      if (item.text !== "") content.push({ type: "text", text: redactJsonOrText(item.text) });
    } else if (item.type === "image") {
      const why = imageProblem(item);
      if (why) notes.push(`An image was left out: ${why}.`);
      else if (image) dropped++;
      else {
        content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: item.data } });
        image = true;
      }
    } else if (item.type === "resource") {
      notes.push(resourceNote(item.resource));
    } else {
      notes.push(`A content item of type ${safeName(String((item as { type?: unknown }).type))} is not sent here.`);
    }
  }
  if (dropped > 0) notes.push(`${dropped} more ${dropped === 1 ? "image was" : "images were"} left out: a tool result carries one image here.`);
  const texts = capText(content.filter((b): b is ApiTextBlock => b.type === "text").map((b) => b.text), notes);
  const out: ApiContentBlock[] = texts.map((text) => ({ type: "text", text }));
  const img = content.find((b): b is ApiImageBlock => b.type === "image");
  if (img) out.push(img);
  if (out.length === 0) out.push({ type: "text", text: "The tool returned no content." });
  return { content: out, is_error: result.isError === true };
}

/**
 * A text block of a tool result. It is usually the JSON mirror of structuredContent; then the
 * string values are redacted one by one, because in JSON text a newline is "\n" and a Windows
 * separator is "\\", which path matching would misread. Other text is redacted as it is.
 */
function redactJsonOrText(text: string): string {
  if (text.startsWith("{") || text.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return redactText(text);
    }
    return JSON.stringify(redactValue(parsed));
  }
  return redactText(text);
}

function redactValue(v: unknown): unknown {
  if (typeof v === "string") return redactText(v);
  if (Array.isArray(v)) return v.map(redactValue);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [redactText(k), redactValue(x)]));
  return v;
}

// One path segment, as in redactPaths: no separators, whitespace, quotes or colon.
const SEG = String.raw`[^\\/\s'"\x60:]+`;
// Where a bare home folder ends: the end, a line break, a quote or punctuation, or a space
// that does not continue the segment ("/home/Jane Doe/x" is one path, as redactPaths reads it).
const END = String.raw`(?=$|[\r\n'"\x60:,;)\]}]|[ \t](?!${SEG}(?: ${SEG})*[\\/]))`;
// A bare /home/<name>, /Users/<name> or C:\Users\<name>. Unquoted, the name ends at a space,
// as in redactPaths; quoted paths with spaces are left to redactPaths, which keeps the last segment.
const HOME_ROOT = new RegExp(String.raw`(?<![\w.-])(?:[A-Za-z]:)?[\\/](?:home|Users)[\\/][^\\/\s'"\x60:,;()\[\]{}]+${END}`, "g");
// The same in quotes, where the name may hold spaces: '/Users/Jane Doe'.
const QUOTED_HOME_ROOT = /(['"`])(?:[A-Za-z]:)?[\\/](?:home|Users)[\\/][^\\/'"`\n]+[\\/]?\1/g;

/**
 * Text with secrets and home folder paths removed. Anything shaped like an Anthropic API key
 * becomes [redacted key]. A bare home folder (its last segment is a user name) becomes ~.
 * Other absolute paths keep only their last segment, as in the MCP errors (redactPaths).
 */
export function redactText(text: string): string {
  let out = text.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "[redacted key]");
  const home = homedir();
  if (home.length > 1) out = out.replace(new RegExp(escapeRegExp(home) + END, "g"), "~");
  out = out.replace(QUOTED_HOME_ROOT, "$1~$1").replace(HOME_ROOT, "~");
  return redactPaths(out, (last) => `…/${last}`);
}

/** Why an image cannot go to the API, or undefined when it can. */
function imageProblem(item: Extract<CallContent, { type: "image" }>): string | undefined {
  if (item.mimeType !== "image/png") return `${safeName(item.mimeType)} is not sent here, only PNG`;
  if (item.data.length > MAX_IMAGE_BASE64_CHARS) return `the PNG is ${item.data.length} base64 characters, over the API limit of ${MAX_IMAGE_BASE64_CHARS}`;
  const head = Buffer.from(item.data.slice(0, 44), "base64");
  if (head.length < 24 || head.subarray(0, 8).toString("hex") !== PNG_SIGNATURE || head.subarray(12, 16).toString("latin1") !== "IHDR") return "the data is not a PNG";
  const w = head.readUInt32BE(16);
  const h = head.readUInt32BE(20);
  if (w > MAX_IMAGE_SIDE_PX || h > MAX_IMAGE_SIDE_PX) {
    return `the drawing is ${w} x ${h} px, over ${MAX_IMAGE_SIDE_PX} px on a side; render again with width and height of ${MAX_IMAGE_SIDE_PX} or less`;
  }
  return undefined;
}

/** A note for an embedded resource, naming the file from its open3dj://project/rev/name URI. */
function resourceNote(resource: { uri: string; mimeType: string }): string {
  const parts = resource.uri.replace(/^open3dj:\/\//, "").split("/");
  const name = safeName(decode(parts.pop() ?? ""));
  const rev = parts.length >= 2 ? safeName(decode(parts.pop() ?? "")) : "";
  if (resource.mimeType === "image/svg+xml") {
    return `The SVG drawing ${name}${rev ? ` of ${rev}` : ""} is saved in the project and is not sent here. Render with format "png" to see the drawing.`;
  }
  return `The ${safeName(resource.mimeType)} resource ${name} is not sent here.`;
}

/**
 * The texts, then the notes as one more text, cut so that all of it together is at most
 * MAX_TEXT_BYTES. Where the cut falls, a note says how much was shown.
 */
function capText(texts: string[], notes: string[]): string[] {
  const tail = notes.join("\n");
  const total = texts.reduce((n, t) => n + Buffer.byteLength(t), 0);
  if (total + Buffer.byteLength(tail) <= MAX_TEXT_BYTES) return tail ? [...texts, tail] : texts;
  const cutNote = (shown: number) => `[Open3DJ cut this tool result at 64 KiB: ${shown} of ${total} bytes shown. Ask for less, for example fewer inspect fields or targets.]`;
  // The note holds a number; reserve room for the largest one it can show, and one newline.
  let budget = Math.max(0, MAX_TEXT_BYTES - Buffer.byteLength(cutNote(total)) - Buffer.byteLength(tail) - 1);
  const kept: string[] = [];
  let shown = 0;
  for (const t of texts) {
    const piece = cutUtf8(t, budget);
    if (piece === "") break;
    kept.push(piece);
    shown += Buffer.byteLength(piece);
    budget -= Buffer.byteLength(piece);
  }
  return [...kept, [cutNote(shown), tail].filter((s) => s !== "").join("\n")];
}

/** The longest prefix of text that is at most max UTF-8 bytes, never splitting a character. */
function cutUtf8(text: string, max: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= max) return text;
  let end = max;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** A name safe to put in a note: letters, digits and . _ # / + -, at most 128 characters. */
function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._#/+-]/g, "_").slice(0, 128);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
