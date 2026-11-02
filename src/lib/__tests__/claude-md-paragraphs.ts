// How CLAUDE.md and docs/claude/*.md are cut into paragraphs, for claude-md-is-whole.test.ts
// and for whoever regenerates claude-md-paragraphs.json.
//
// A paragraph is a run of lines between blank lines. A fenced code block is ONE unit, blank lines
// and all, so a command is never half-counted. Whitespace is normalised and nothing else: a
// paragraph is "the same" only if its words are.
import { createHash } from "node:crypto";

export function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function paragraphs(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fenced = false;
  const flush = () => {
    const joined = normalise(cur.join("\n"));
    if (joined) out.push(joined);
    cur = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && line.trim() === "") {
      flush();
      continue;
    }
    cur.push(line);
  }
  flush();
  return out;
}

export function hashOf(paragraph: string): string {
  return createHash("sha1").update(paragraph).digest("hex").slice(0, 16);
}
