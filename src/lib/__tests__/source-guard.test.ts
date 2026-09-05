import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource, readVerbatim, stripComments } from "./source";

/**
 * The guard on the guards.
 *
 * A test that reads source to assert something about it has one failure mode
 * indistinguishable from success: the string it searches for sits in a COMMENT
 * rather than in the code. The prose above a guard almost always names the
 * guard, so `expect(src).toMatch(/checkRateLimit\(/)` keeps passing after the
 * call it pins has been deleted.
 *
 * It happened twice on 2026-09-05 — the second time in a test written by
 * somebody who had been bitten by the first that same afternoon. That is the
 * argument for checking it here rather than remembering it.
 *
 * Swept from the filesystem, never a hand list, for the reason
 * `e2e/layout.spec.ts` gives: its curated predecessor covered 14 of 22 routes
 * and the eight it missed had no assertion at all.
 */

const ROOT = process.cwd();

function testFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) testFiles(p, out);
    else if (/\.(test|spec)\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const FILES = testFiles(join(ROOT, "src")).concat(testFiles(join(ROOT, "e2e")));
const rel = (p: string) => p.replace(ROOT + "\\", "").replace(ROOT + "/", "").replace(/\\/g, "/");

describe("the sweep finds the files it is meant to", () => {
  it("has a real corpus, so an empty pass is impossible", () => {
    // Every assertion below loops over FILES. A broken walk would make them all
    // pass by iterating nothing, which is the exact shape of decoration this
    // file exists to prevent.
    expect(FILES.length).toBeGreaterThan(150);
    expect(FILES.map(rel)).toContain("src/lib/__tests__/audit-guards.test.ts");
  });
});

describe("there is one comment stripper, and it knows what a string is", () => {
  it("no test writes its own", () => {
    /**
     * Eleven copies, in ten files, every one the same naive pair:
     * `.replace(block, "").replace(line, "")`. `registration-intake.test.ts`
     * carried TWO of them, the second under a comment reading "asserted at the
     * source because the alternative is three copies drifting again".
     *
     * They all shared its bug, below.
     *
     * Read with readSource, and that detail is this guard's own first run: with
     * readVerbatim it failed on `audit-guards.test.ts`, whose only remaining
     * trace of the old stripper is a COMMENT explaining what was removed. An
     * absence assertion tripped by prose describing the thing that is gone —
     * this file's subject arriving through the front door. It failed loudly
     * rather than passing quietly, which is why absence assertions are the safe
     * direction.
     */
    for (const f of FILES) {
      // The one file that must contain the banned pattern is the one banning
      // it. Named rather than pattern-dodged: an exception you can read beats a
      // regex contorted to avoid matching itself.
      if (rel(f) === "src/lib/__tests__/source-guard.test.ts") continue;
      expect(readSource(rel(f)), `${rel(f)} defines its own comment stripper`).not.toMatch(
        /replace\(\s*\/\\\/\\\*\[\\s\\S\]/,
      );
    }
  });

  it("does not eat the // in a URL, which a regex stripper does", () => {
    // Why the shared one is a scanner and not two replaces. Under the naive
    // version `"https://tourneyhq.club"` becomes `"https:` — so any file with a
    // link in it could not safely adopt the safe reader, excusing precisely the
    // files most worth guarding.
    expect(stripComments('const u = "https://tourneyhq.club/privacy";')).toContain(
      "https://tourneyhq.club/privacy",
    );
  });

  it("keeps a comment marker that is inside a string", () => {
    const src = ["const a = 'a // b';", 'const b = "c /* d */ e";', "const c = `f // g`;"].join("\n");
    const out = stripComments(src);
    expect(out).toContain("a // b");
    expect(out).toContain("c /* d */ e");
    expect(out).toContain("f // g");
  });
});

describe("the two readers really differ", () => {
  it("readSource hides comments; readVerbatim shows them", () => {
    /**
     * Asserted against source.ts rather than against this file, and the reason
     * is the trap itself. The first draft read THIS file and searched for a
     * phrase from one of its own comments — which failed, correctly, because
     * the phrase was also a test NAME, and a test name is a string literal that
     * survives stripping exactly as it should. A file cannot prove its comments
     * were removed while the search term is written into it.
     */
    const target = "src/lib/__tests__/source.ts";
    expect(readVerbatim(target)).toContain("Comments out, strings intact");
    expect(readSource(target)).not.toContain("Comments out, strings intact");
    expect(readSource(target)).toContain("export function readSource");
  });
});
