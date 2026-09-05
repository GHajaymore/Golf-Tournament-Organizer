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

/**
 * The rule itself, and the one that would have caught the second incident.
 *
 * A variable assigned straight from `readFileSync(..., "utf8")` still holds
 * comments. Asserting positively on it — or on something sliced out of it, or
 * searching it with `indexOf` — is what a comment can satisfy.
 *
 * Absence assertions are deliberately allowed. A `not.toMatch` that a comment
 * trips fails LOUDLY and gets fixed; it is the positive ones that rot in
 * silence.
 */
describe("no assertion is made against source that still has its comments", () => {
  /** The names this file's tests may legitimately hand raw text. */
  const WRAPPERS = ["stripComments", "strip", "readSource", "readVerbatim"];

  /**
   * Variables holding raw file text, plus anything sliced out of one.
   *
   * Only names declared EXACTLY ONCE in the file count. A test file reuses
   * `src` and `page` across a dozen describe blocks, some reading through a
   * stripper and some not, and this analysis has no block scope — so treating a
   * reused name as raw because one of its twelve declarations is raw reported
   * eleven innocent assertions. The first version of this did exactly that and
   * flagged 200 lines across nine files, which is a guard nobody would keep.
   * Unambiguous names only: fewer catches, and no false ones.
   */
  function rawVars(src: string): Set<string> {
    const declared = new Map<string, number>();
    for (const m of src.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
      declared.set(m[1], (declared.get(m[1]) ?? 0) + 1);
    }
    const once = (n: string) => declared.get(n) === 1;

    const raw = new Set<string>();
    for (const m of src.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*\()?\s*readFileSync\(/g)) {
      const tail = src.slice(m.index, m.index + 300);
      if (!/"utf8"/.test(tail)) continue; // a byte read is not text
      if (m[2] && WRAPPERS.includes(m[2].slice(0, -1))) continue; // already stripped
      if (once(m[1])) raw.add(m[1]);
    }
    // One hop of derivation: `const body = whole.slice(...)` is still raw text.
    for (const m of src.matchAll(
      /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*slice\(/g,
    )) {
      if (raw.has(m[2]) && once(m[1])) raw.add(m[1]);
    }
    return raw;
  }

  it("finds raw reads at all, so this cannot pass by matching nothing", () => {
    // A control. If `rawVars` stopped matching, every file below would look
    // clean and this suite would report a problem solved that is not.
    const probe = 'const s = readFileSync(p, "utf8");\nconst b = s.slice(1);';
    expect([...rawVars(probe)].sort()).toEqual(["b", "s"]);
    // And a wrapped read is NOT raw, or every converted file would be flagged.
    expect([...rawVars('const w = stripComments(readFileSync(p, "utf8"));')]).toEqual([]);
  });

  for (const f of FILES) {
    const name = rel(f);
    it(`${name} asserts only on stripped text`, () => {
      const src = readVerbatim(name);
      const raw = rawVars(src);
      if (raw.size === 0) return;

      const offences: string[] = [];
      for (const v of raw) {
        const esc = v.replace(/\$/g, "\\$");
        const positive = new RegExp(
          `expect\\(\\s*${esc}\\b[^)]*\\)(?:\\s*,[^)]*\\))?\\s*\\.(toMatch|toContain)\\(`,
          "g",
        );
        for (const m of src.matchAll(positive)) {
          offences.push(`line ${src.slice(0, m.index).split("\n").length}: expect(${v}).${m[1]}(...)`);
        }
        // `indexOf` is the same search wearing a different hat: it is how a
        // guard asserts one thing comes before another, and a comment
        // satisfies it just as well.
        const searched = new RegExp(`\\b${esc}\\s*\\.\\s*indexOf\\(`, "g");
        for (const m of src.matchAll(searched)) {
          offences.push(`line ${src.slice(0, m.index).split("\n").length}: ${v}.indexOf(...)`);
        }
      }

      expect(
        offences,
        `${name} searches file text that still has its comments — read it with readSource() ` +
          `from src/lib/__tests__/source.ts, or wrap it in stripComments():\n  ` +
          offences.join("\n  "),
      ).toEqual([]);
    });
  }
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
