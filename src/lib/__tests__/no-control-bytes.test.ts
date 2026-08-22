import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * No source file contains a control byte.
 *
 * `stroke-agg.ts` carried a literal NUL for months, inside the template
 * literal that keys one player's card to one round:
 *
 *     const key = `${card.playerId}\0${card.stageId}`;
 *
 * A `perl -0pi` edit put it there — CLAUDE.md warns about exactly that tool —
 * and nothing complained, because a NUL is a perfectly good separator. Two
 * things went wrong quietly instead.
 *
 * Every tool that sniffs for binary content treated a SCORING ENGINE as a
 * binary file. `grep` reported "Binary file matches" and printed nothing, so
 * anybody searching the codebase for how cards are counted silently missed it.
 *
 * And the key was one well-meant cleanup away from being wrong. Strip the
 * control characters and it becomes `playerIdstageId` — two different (player,
 * round) pairs can then produce the same string, and a round stops being
 * counted twice with nothing on screen to say so. The identical edit did this
 * to `match-cards.ts`, where it WAS caught and fixed; this file was missed.
 *
 * Cheap to check, impossible to see by reading. Tabs, newlines and carriage
 * returns are the only control characters a source file has any business
 * containing.
 */

const ROOT = join(process.cwd(), "src");
const EXTENSIONS = /\.(ts|tsx|css|json|md)$/;
/** Tab, newline, carriage return: the ones that legitimately appear. */
const ALLOWED = new Set([9, 10, 13]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (EXTENSIONS.test(entry.name)) out.push(path);
  }
  return out;
}

describe("source files hold no control bytes", () => {
  it("finds none anywhere under src", () => {
    // Swept from the filesystem rather than a list, for the reason the layout
    // sweep is: a hand-written list covers the files somebody thought of, and
    // this bug survived in the one file nobody thought of.
    const offenders: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      const bytes = readFileSync(file);
      for (let i = 0; i < bytes.length; i += 1) {
        const b = bytes[i];
        if (b < 32 && !ALLOWED.has(b)) {
          offenders.push(`${file.slice(ROOT.length + 1)}: byte 0x${b.toString(16)} at offset ${i}`);
          break;
        }
      }
    }
    expect(
      offenders,
      "A control byte in source. It is invisible, it makes grep skip the file as " +
        "binary, and inside a template literal it is a separator that vanishes the " +
        "first time somebody sanitises the file. Use a named separator instead.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
