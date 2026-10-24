// How CLAUDE.md and docs/claude/*.md are cut into paragraphs, shared by
// src/lib/__tests__/claude-md-is-whole.test.ts and by whoever regenerates its manifest.
//
// A paragraph is a run of lines between blank lines. A fenced code block is ONE unit, blank lines
// and all, so a command is never half-counted. Whitespace is normalised and nothing else: a
// paragraph is "the same" only if its words are.
import { createHash } from "node:crypto";

export function normalise(text) {
  return text.replace(/\s+/g, " ").trim();
}

export function paragraphs(text) {
  const out = [];
  let cur = [];
  let fenced = false;
  const flush = () => {
    const joined = normalise(cur.join("\n"));
    if (joined) out.push(joined);
    cur = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && line.trim() === "" && !/^\s*```/.test(line)) {
      flush();
      continue;
    }
    cur.push(line);
  }
  flush();
  return out;
}

export function hashOf(paragraph) {
  return createHash("sha1").update(paragraph).digest("hex").slice(0, 16);
}
