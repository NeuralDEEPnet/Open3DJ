// The docs tool: a small full-text search over docs/DSL.md (the DSL reference, the lib
// parts, the error playbook and examples). Every "###" section is one hit; the "##" section
// above it sets the hit's kind. The file is read once and kept in memory.
import { readFileSync } from "node:fs";
import type { DocsHit, DocsInput, DocsOutput } from "@open3dj/schemas";

/** docs/DSL.md in the repository. A published package will need its own copy. */
export const DEFAULT_DOCS_FILE: URL = new URL("../../../docs/DSL.md", import.meta.url);
export const PAGE_SIZE = 5;
const MAX_TEXT = 1500;

export interface DocSection extends DocsHit {
  /** Lower-case title and body, for matching. */
  haystack: { title: string; body: string };
}

export function parseDocs(markdown: string, file = "docs/DSL.md"): DocSection[] {
  const sections: DocSection[] = [];
  let kind: DocsHit["kind"] = "dsl";
  let current: { title: string; lines: string[] } | undefined;
  let inFence = false;
  const flush = () => {
    if (!current) return;
    const text = current.lines.join("\n").trim();
    const title = current.title.replace(/`/g, "");
    sections.push({ title, kind, text: clip(text), ref: `${file}#${anchor(current.title)}`, haystack: { title: title.toLowerCase(), body: text.toLowerCase() } });
    current = undefined;
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("```")) inFence = !inFence;
    if (!inFence && line.startsWith("## ")) {
      flush();
      kind = kindOf(line.slice(3));
      continue;
    }
    if (!inFence && line.startsWith("### ")) {
      flush();
      current = { title: line.slice(4).trim(), lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  flush();
  return sections;
}

function kindOf(heading: string): DocsHit["kind"] {
  const h = heading.toLowerCase();
  if (h.includes("error")) return "error";
  if (h.includes("lib") || h.includes("standard part")) return "lib";
  if (h.includes("example")) return "example";
  return "dsl";
}

/** GitHub-style heading anchor. */
export function anchor(heading: string): string {
  return heading.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
}

function clip(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT).trimEnd()}\n...`;
}

function tokens(query: string): string[] {
  const words = query.toLowerCase().split(/[^a-z0-9_.#]+/).filter(Boolean);
  const out = new Set<string>();
  for (const w of words) {
    out.add(w.replace(/^\.+|\.+$/g, ""));
    for (const part of w.split(".")) if (part.length > 1) out.add(part);
  }
  out.delete("");
  return [...out];
}

function score(s: DocSection, terms: string[], phrase: string): number {
  let total = 0;
  if (s.haystack.title === phrase) total += 50;
  for (const t of terms) {
    if (s.haystack.title === t) total += 30;
    else if (s.haystack.title.includes(t)) total += 10;
    let n = 0;
    let i = s.haystack.body.indexOf(t);
    while (i >= 0 && n < 5) {
      n++;
      i = s.haystack.body.indexOf(t, i + t.length);
    }
    total += n;
  }
  return total;
}

export function searchDocs(sections: DocSection[], input: DocsInput): DocsOutput {
  const terms = tokens(input.query);
  const phrase = input.query.toLowerCase().trim();
  const ranked = sections
    .map((s, i) => ({ s, i, score: score(s, terms, phrase) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const pages = Math.ceil(ranked.length / PAGE_SIZE);
  const page = input.page ?? 1;
  const hits: DocsHit[] = ranked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(({ s }) => {
    const hit: DocsHit = { title: s.title, kind: s.kind, text: s.text };
    if (s.ref) hit.ref = s.ref;
    return hit;
  });
  return { query: input.query, page, pages, hits };
}

/** Load and parse the docs file once. A missing file gives an empty index, not a crash. */
export function loadDocs(file: URL | string = DEFAULT_DOCS_FILE): DocSection[] {
  try {
    return parseDocs(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}
