import { describe, it, expect } from "vitest";
import { stripComments, readSource, readVerbatim } from "./source";

/**
 * The reader every source-searching guard is built on.
 *
 * It has to be right about two things in opposite directions: remove enough
 * that a comment can never satisfy an assertion, and remove nothing that a
 * guard might legitimately be asserting on. The second is what the naive
 * version got wrong — it ate the back half of every URL in the file.
 */
describe("comments come out", () => {
  it("removes a line comment, including one that names the guard below it", () => {
    // The exact shape that made this necessary: the prose above a call names
    // the call, so a positive assertion passes off the prose after the call
    // has gone.
    const src = ["// calls checkRateLimit() before anything else", "const x = 1;"].join("\n");
    expect(stripComments(src)).not.toMatch(/checkRateLimit\(/);
    expect(stripComments(src)).toMatch(/const x = 1;/);
  });

  it("removes a doc block whose body lines are plain prose, not starred", () => {
    // draft-facts.ts has one of these. A stripper that only recognises lines
    // beginning with a marker leaves the body behind as bare text.
    const src = ["/**", "   describes freezeRoundHandicaps at length", "*" + "/", "const y = 2;"].join(
      "\n",
    );
    expect(stripComments(src)).not.toMatch(/freezeRoundHandicaps/);
    expect(stripComments(src)).toMatch(/const y = 2;/);
  });

  it("keeps line numbers, so a failure still points at the right line", () => {
    const src = ["const a = 1;", "/*", " x", " y", "*" + "/", "const b = 2;"].join("\n");
    expect(stripComments(src).split("\n").length).toBe(src.split("\n").length);
  });
});

describe("code comes through untouched", () => {
  it("does not eat a URL, which is the whole reason this is not a regex", () => {
    /**
     * The naive stripper is `.replace(/\/\/.*$/gm, "")`, and a URL contains
     * `//`. So `"https://tourneyhq.club"` became `"https:` and any guard
     * asserting on a link failed for a reason unrelated to the link — which
     * would have excused exactly the files most worth guarding.
     */
    const src = 'const site = "https://tourneyhq.club/privacy";';
    expect(stripComments(src)).toContain("https://tourneyhq.club/privacy");
  });

  it("leaves a comment marker alone inside every kind of quote", () => {
    const src = [
      "const a = 'a // b';",
      'const b = "c /* d */ e";',
      "const c = `f // g`;",
    ].join("\n");
    const out = stripComments(src);
    expect(out).toContain("a // b");
    expect(out).toContain("c /* d */ e");
    expect(out).toContain("f // g");
  });

  it("survives an escaped quote inside a string", () => {
    // Getting this wrong ends the string early and the rest of the file is
    // then parsed as if it were inside one - everything after would survive
    // uncut, and the stripper would silently stop working from there on.
    const src = ['const a = "he said \\"go\\" // not a comment";', "const b = 2;"].join("\n");
    const out = stripComments(src);
    expect(out).toContain("// not a comment");
    expect(out).toContain("const b = 2;");
  });

  it("keeps code that follows a block comment on the same line", () => {
    expect(stripComments("/* note */ const z = 3;")).toMatch(/const z = 3;/);
  });
});

describe("the two readers differ, and visibly", () => {
  it("readSource hides comments; readVerbatim shows them", () => {
    /**
     * Asserted against source.ts rather than against this file, and the
     * reason is the trap itself.
     *
     * The first version of this test read THIS file and looked for a phrase
     * from one of its comments. It failed, correctly: the phrase was also the
     * name of a test two blocks up, and a test name is a string literal, which
     * survives stripping exactly as it should. A file cannot be used to prove
     * its own comments were removed while the search term is written into it.
     */
    const target = ["src", "lib", "__tests__", "source.ts"];
    expect(readVerbatim(...target)).toContain("Comments out, strings intact");
    expect(readSource(...target)).not.toContain("Comments out, strings intact");
    // And the code is still all there.
    expect(readSource(...target)).toContain("export function stripComments");
  });
});
