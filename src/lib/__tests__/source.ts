import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reading a source file in order to ASSERT something about it.
 *
 * A guard that reads source has one failure mode that looks exactly like
 * success: the string it searches for is present in a COMMENT rather than in
 * the code. The comment above a guard almost always names the guard, so
 * `expect(src).toMatch(/checkRateLimit\(/)` goes on passing after the call it
 * pins has been deleted — the prose describing the guard satisfies the
 * assertion instead.
 *
 * That happened twice on 2026-09-05, the second time in a test written by
 * somebody who had just been bitten by the first. It is not a thing to
 * remember; it is a thing to make impossible at the point the file is read.
 *
 * So `readSource` returns code with the comments removed, and is the only way
 * a test should obtain source it intends to search. `readVerbatim` exists for
 * the cases that genuinely want the whole file, and is named so that choosing
 * it is visible in review rather than implied by a bare `readFileSync`.
 *
 * Absence assertions are not the danger and are still worth writing: a
 * `not.toMatch` fails LOUDLY when a comment mentions the banned thing, so it
 * corrects itself. It is the positive ones that rot silently.
 */

/**
 * Comments out, strings intact.
 *
 * The naive version of this — replace block comments, then replace `//` to
 * end of line — is what several of these tests grew up with, and it eats the
 * back half of every URL in the file. `"https://tourneyhq.club"` becomes
 * `"https:`, so a test asserting on a link fails for a reason that has nothing
 * to do with the link. Any file with a URL in it therefore could not adopt the
 * safe reader, which is the wrong way round: the files most worth guarding
 * would have been the ones excused.
 *
 * A single pass that knows it is inside a quote costs almost nothing and
 * removes that objection. Regular-expression literals are not tracked — a `//`
 * inside one is an empty regex, which does not occur — and a lone `/` is left
 * alone.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    // A string, of any of the three kinds. Copied through whole, escapes and
    // all, so nothing inside it is ever mistaken for a comment.
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        if (src[i] === "\\") {
          out += src.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }

    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        // Newlines are kept so line numbers survive: a failure message that
        // names a line is worth more than a compact string.
        if (src[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

/**
 * A source file, comments removed, for a test that searches it.
 *
 * Takes path segments relative to the repository root, the same way the tests
 * that read source already build their paths.
 */
export function readSource(...parts: string[]): string {
  return stripComments(readFileSync(join(process.cwd(), ...parts), "utf8"));
}

/**
 * A source file exactly as it is on disk, comments and all.
 *
 * For the tests whose subject IS the whole file — the control-byte sweep, the
 * encoding checks, anything counting lines. Deliberately not the default: a
 * test that reaches for this is saying it means to see the prose.
 */
export function readVerbatim(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}
