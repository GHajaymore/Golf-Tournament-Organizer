import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
// Plain JavaScript on purpose: the same splitter cuts the files and made the manifest.
import { hashOf, paragraphs } from "../../../scripts/claude-md-paragraphs.mjs";

/**
 * CLAUDE.md IS A SHORT CORE AND AN INDEX; THE LONG LESSONS LIVE IN docs/claude/ (2026-10-24).
 *
 * Every session reads CLAUDE.md in full before it starts, so its size is paid dozens of times a
 * day. It was ~160 KB. The long material (incident write-ups, measurements, rationale) moved,
 * verbatim, into one file per topic, and this test is the proof that nothing was lost in the move:
 *
 *   claude-md-paragraphs.json   a hash of every paragraph of the file as it stood before the move
 *   this test                   cuts CLAUDE.md and docs/claude/*.md into paragraphs the same way
 *                               and fails, naming the first words, for any that is no longer in one
 *
 * A paragraph is a run of lines between blank lines (a fenced code block is one unit); whitespace
 * is normalised and nothing else. A paragraph may live in the core, in a topic file, or — if a
 * later ruling made it untrue — in docs/claude/retired.md with the reason beside it.
 *
 * TO CHANGE A PARAGRAPH ON PURPOSE (a lesson corrected, a rule superseded): edit it where it lives
 * AND delete its entry from claude-md-paragraphs.json in the same pull request. The deletion is
 * visible in review, which is the point: a paragraph cannot go missing quietly.
 */
const at = (p: string) => join(process.cwd(), p);
const read = (p: string) => readFileSync(at(p), "utf8");
const topicFiles = () => readdirSync(at("docs/claude")).filter((f) => f.endsWith(".md")).sort();

type Entry = { h: string; t: string };
const manifest: Entry[] = JSON.parse(read("src/lib/__tests__/claude-md-paragraphs.json"));

describe("CLAUDE.md is whole", () => {
  it("every paragraph of the original is in the core or in a topic file", () => {
    const have = new Set<string>();
    for (const file of ["CLAUDE.md", ...topicFiles().map((f) => `docs/claude/${f}`)]) {
      for (const p of paragraphs(read(file))) have.add(hashOf(p));
    }
    const missing = manifest.filter((m) => !have.has(m.h)).map((m) => m.t);
    expect(
      missing,
      "These paragraphs of the original CLAUDE.md are in neither CLAUDE.md nor docs/claude/*.md. " +
        "Put them back, or — if you changed them on purpose — delete their entries from " +
        "src/lib/__tests__/claude-md-paragraphs.json in the same pull request.",
    ).toEqual([]);
  });

  it("the manifest is the whole of the original (a guard against emptying it)", () => {
    expect(manifest.length).toBeGreaterThan(400);
    expect(new Set(manifest.map((m) => m.h)).size).toBe(manifest.length);
  });

  it("CLAUDE.md stays a short core: long lessons go to docs/claude/ and the index", () => {
    const size = read("CLAUDE.md").length;
    expect(
      size,
      `CLAUDE.md is ${size} characters. Every session reads it in full; move the long form to a docs/claude/ topic file and leave the rule (1-4 lines) here.`,
    ).toBeLessThan(40_000);
  });

  it("the index names every topic file, and every file it names exists", () => {
    const core = read("CLAUDE.md");
    const named = [...core.matchAll(/`docs\/claude\/([a-z0-9-]+\.md)`/g)].map((m) => m[1]);
    for (const f of topicFiles()) {
      expect(core.includes(`\`docs/claude/${f}\``), `${f} is not in CLAUDE.md's index`).toBe(true);
    }
    for (const f of new Set(named)) {
      expect(existsSync(at(`docs/claude/${f}`)), `CLAUDE.md points at docs/claude/${f}, which does not exist`).toBe(true);
    }
  });

  it("keeps the hard rules in the core, verbatim", () => {
    const core = read("CLAUDE.md");
    for (const must of [
      "Never modify, seed into, or test against an event holding real people.",
      "The GitHub repository is public.",
      "`main` auto-deploys to production via Vercel.",
      "Commit with explicit paths.",
      "Never `git stash`",
      "Never `prisma migrate reset`",
      "It never moves money.",
    ]) {
      expect(core.includes(must), `hard rule missing from the core: ${must}`).toBe(true);
    }
  });

  describe("the instrument can fail (controls)", () => {
    it("a changed word is a different paragraph; whitespace is not", () => {
      const a = paragraphs("Never   rewrite\na source file.");
      const b = paragraphs("Never rewrite a source file.");
      const c = paragraphs("Never rewrite a source files.");
      expect(hashOf(a[0])).toBe(hashOf(b[0]));
      expect(hashOf(b[0])).not.toBe(hashOf(c[0]));
    });

    it("a fenced block with a blank line inside stays one paragraph", () => {
      const ps = paragraphs("Before.\n\n```bash\none\n\ntwo\n```\n\nAfter.");
      expect(ps).toHaveLength(3);
      expect(ps[1]).toContain("one two");
    });
  });
});
