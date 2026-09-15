import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * A PROP NAME ONLY MEANS ANYTHING AT A BOUNDARY.
 *
 * #292 found that `expect(src).toMatch(/hasTeeSheet=\{/)` passes against
 * `x-hasTeeSheet={` — an attribute React never reads. The assertion looked
 * like it pinned a prop being passed; it pinned a substring. Both instances
 * found then were anchored by hand, and the register has carried an entry ever
 * since saying the rest of the suite shares the weakness and nobody had swept
 * it.
 *
 * SWEPT NOW, and the entry's estimate was wrong in the good direction: it
 * guessed "~23 unanchored assertions" and there was ONE. Thirty-four of the
 * thirty-five `=\{` assertions in the suite pin a whole VALUE —
 * `staffApproves={!allowsAutoConfirm(settings)}` — and a value-pinning
 * assertion cannot be satisfied by a longer prop name, because the collision
 * has to eat the name AND the expression.
 *
 * So this file is not a cleanup. It is the sink, in the shape CLAUDE.md asks
 * for: a rule enforced where the data is built cannot be forgotten by a caller,
 * and a rule written in a comment will be. The one instance is anchored; this
 * stops the thirty-sixth arriving unanchored.
 *
 * WHY IT IS WORTH A GUARD WHEN THE SUITE IS ALREADY CLEAN. The mechanism is
 * live even though nothing currently trips it. Measured across the 175 product
 * `.tsx` files, comments stripped: 390 distinct attribute names and
 * FIFTY-NINE real suffix collisions among them. A bare presence assertion
 * written tomorrow on any of these would be silently satisfied by the one
 * beside it:
 *
 *     label      <- aria-label            hidden    <- aria-hidden
 *     key        <- data-flip-key         selected  <- aria-selected
 *     round      <- ground                expanded  <- aria-expanded
 *     locked     <- configUnlocked        hole      <- submitWhole
 *     dates      <- candidates            fill      <- prefill
 *
 * `aria-label` is the one to think about: a test meaning to assert that a
 * component receives a `label` prop passes on any element in the file that has
 * an accessible name, which is most of them.
 *
 * ONE TRAP IN WRITING THIS, recorded because it nearly shipped. The first
 * version of the collision scan read source WITHOUT stripping comments and
 * reported `x-hasTeeSheet` as a live attribute. It is not — it exists only
 * inside the comment in `render.test.tsx` that documents this very bug. That
 * is the `readSource` trap one layer out: the file explaining a defect becomes
 * the first hit of every sweep for it. Both scans below strip comments.
 */

const ROOT = process.cwd();

function walk(dir: string, keep: (p: string) => boolean, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

const rel = (p: string) => p.replace(ROOT, "").replace(/^[\\/]/, "").replace(/\\/g, "/");

/**
 * The body of every positive `toMatch` regex literal in the suite.
 *
 * Negative assertions are excluded deliberately, and the reason is the same
 * one `readSource` is built on: `not.toMatch` fails LOUDLY when something it
 * bans turns up, so an over-broad pattern there corrects itself. It is the
 * positive ones that rot silently.
 */
interface Assertion {
  file: string;
  body: string;
}

function assertions(): Assertion[] {
  const out: Assertion[] = [];
  const files = walk(join(ROOT, "src"), (p) => /\.(test|spec)\.tsx?$/.test(p));
  for (const f of files) {
    const src = readSource(rel(f));
    let i = 0;
    while ((i = src.indexOf("toMatch(/", i)) !== -1) {
      // `not.toMatch` and `.not .toMatch` are the safe direction — skip them.
      const before = src.slice(Math.max(0, i - 6), i);
      if (before.endsWith("not.")) {
        i += 9;
        continue;
      }
      let j = i + "toMatch(/".length;
      let body = "";
      let inClass = false;
      while (j < src.length) {
        const c = src[j];
        if (c === "\\") {
          body += src.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (c === "[") inClass = true;
        if (c === "]") inClass = false;
        if (c === "/" && !inClass) break;
        if (c === "\n") break;
        body += c;
        j += 1;
      }
      out.push({ file: rel(f), body });
      i = j;
    }
  }
  return out;
}

/**
 * A bare presence check on a JSX prop: the WHOLE pattern is `name=\{`, with no
 * boundary in front of it and no value behind it. That is the only shape #292
 * describes, and the only one this file refuses.
 */
const BARE = /^[A-Za-z0-9_$-]+=\\\{$/;

const ALL = assertions();
const BARE_ONES = ALL.filter((a) => BARE.test(a.body));

describe("the sweep can see, before it reports anything", () => {
  it("found a real corpus of toMatch patterns", () => {
    // Without this, a broken extractor reports zero offenders and reads as a
    // clean suite. CLAUDE.md: a sweep that finds nothing may be broken.
    expect(ALL.length, "no toMatch patterns extracted at all").toBeGreaterThan(200);
  });

  it("classifies the shape #292 was actually fooled by as bare", () => {
    // The literal pattern from the bug, as a control on the classifier rather
    // than on the suite.
    expect(BARE.test("hasTeeSheet=\\{")).toBe(true);
  });

  it("does not classify an anchored or value-pinning pattern as bare", () => {
    expect(BARE.test("\\shasTeeSheet=\\{"), "anchored form flagged").toBe(false);
    expect(BARE.test("staffApproves=\\{!allowsAutoConfirm"), "value form flagged").toBe(false);
  });
});

describe("no assertion pins a prop name without a boundary", () => {
  it("every `name=\\{` assertion is anchored or pins a value", () => {
    const named = BARE_ONES.map((a) => `${a.file}  /${a.body}/`);
    expect(
      named,
      "a bare `name=\\{` matches a LONGER attribute too — anchor it with \\s, or pin the value",
    ).toEqual([]);
  });
});

describe("the collision the anchor exists to stop is real", () => {
  /**
   * Not a claim about any current assertion — the suite is clean. This asserts
   * the HAZARD still exists, so that if the product ever stops having suffix
   * collisions this guard can be retired knowingly rather than kept out of
   * superstition.
   */
  function productAttributeNames(): Map<string, string> {
    const names = new Map<string, string>();
    const files = walk(
      join(ROOT, "src"),
      (p) => p.endsWith(".tsx") && !p.includes(`${"__tests__"}`),
    );
    for (const f of files) {
      const src = readSource(rel(f));
      let i = 0;
      while ((i = src.indexOf("={", i)) !== -1) {
        let j = i - 1;
        let n = "";
        while (j >= 0 && /[A-Za-z0-9_$-]/.test(src[j])) {
          n = src[j] + n;
          j -= 1;
        }
        if (n && !names.has(n)) names.set(n, rel(f));
        i += 2;
      }
    }
    return names;
  }

  const names = productAttributeNames();

  it("reads the product's attribute names", () => {
    expect(names.size, "no JSX attributes found — the scan is broken").toBeGreaterThan(100);
  });

  it("still contains names that are suffixes of other names", () => {
    const list = [...names.keys()];
    const pairs = list.flatMap((a) => list.filter((b) => b !== a && b.endsWith(a)).map((b) => [a, b]));
    expect(pairs.length, "no suffix collisions left — this guard may be retired").toBeGreaterThan(0);
  });

  it("does NOT count a name that appears only in a comment", () => {
    /**
     * The trap this file nearly shipped. `x-hasTeeSheet` is written in
     * `render.test.tsx`'s comment explaining #292 and nowhere else; an
     * unstripped scan reports it as live markup and the control then passes on
     * the documentation of the bug rather than on the bug.
     */
    expect(names.has("x-hasTeeSheet"), "comment text is being read as markup").toBe(false);
  });
});
