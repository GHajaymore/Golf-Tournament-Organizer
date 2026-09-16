import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readSource } from "./source";

/**
 * NOBODY ASKS `matchSettled` WHETHER A MATCH IS OVER.
 *
 * Two functions, very similar names, opposite strictness:
 *
 *     matchSettled   services/tournament.ts   one hole, or a forfeit
 *     matchIsOver    domain/match.ts          decided — a closeout counts
 *
 * `matchSettled` is right for "is this thing under way": somebody is out on
 * the course whatever the status column says, and a single hole is exactly the
 * evidence wanted. It is wrong for every claim about a RESULT, because a match
 * one hole old is not one.
 *
 * THE DISTINCTION HAS BEEN WRITTEN DOWN TWICE AND CONFUSED THREE TIMES. It is
 * on `matchSettled` itself, and at length on `matchIsOver`, whose doc block
 * exists only to record the second occurrence:
 *
 *     "That gap was load-bearing. `roundMoneyFor` fed `matchSettled` into
 *      `roundMoneyIsFinal`, so a match round flipped to 'final' the moment
 *      every pairing had a single hole entered."
 *
 * The third was 2026-09-16, on `live-board.ts`: `allIn` drives the chip on
 * `/live/[token]`, so a club's spectators were told the round was FINAL while
 * every pairing was still on the 2nd tee. Its card branch demanded `thru >=
 * holeCount` from every player who was in; its match branch demanded one hole.
 *
 * The fix for the second occurrence was a longer comment. That is what did not
 * work, which is why this is a guard instead — CLAUDE.md's "a guard you must
 * remember to call is a guard that will be forgotten", applied to a rule that
 * has now been forgotten twice after being written down.
 *
 * WHAT THIS ACTUALLY ENFORCES: an allow-list. Every call site is named below
 * with the reason it may ask the loose question, so a NEW one turns this red
 * the day it is added and its author has to write down which question they
 * meant. It cannot tell a right answer from a wrong one — only that somebody
 * thought about it.
 *
 * Read through `readSource`, which strips comments, so the paragraphs above —
 * and the many elsewhere that name this function while explaining it — cannot
 * satisfy the search. See `source-guard.test.ts`.
 */

const SRC = join(process.cwd(), "src");

/** Repo-relative under src/, which is what `readSource` wants. */
const relOf = (full: string): string => relative(SRC, full).split(sep).join("/");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every file that may read `matchSettled`, and why its question is the loose
 * one.
 *
 * Anything added here needs the reason written beside it. An entry with no
 * reason is the next occurrence waiting to happen.
 */
const ALLOWED: Record<string, string> = {
  /**
   * It lives here. The declaration and the one place that builds on it.
   */
  "lib/services/tournament.ts":
    "declares it, and asks it only for progress: which round is being played, " +
    "how many of a round's fixtures have been touched, and whether anybody has " +
    "played at all. Every one of those is 'is this under way'.",

  /**
   * "Has this week been played" — the same question, on the league's calendar.
   * The stroke branch beside it asks `cards.some(...)`, which is also 'does a
   * card exist' rather than 'is it complete', so the two halves agree.
   */
  "lib/services/week-view.ts":
    "asks whether a week has been played at all, so a round nobody has started " +
    "reads as not started. The stroke branch beside it is equally loose, which " +
    "is what keeps the two halves of the answer agreeing.",
};

const CALL = /\bmatchSettled\s*\(/;
const IMPORT = /\bmatchSettled\b/;

describe("matchSettled is only asked where the loose question is the right one", () => {
  const files = sourceFiles(SRC);

  it("has source to sweep", () => {
    // The control. A file walk that found nothing would make every assertion
    // below vacuous while this still reported green.
    expect(files.length, "no source files found").toBeGreaterThan(200);
  });

  it("finds the declaration, so the sweep is looking at the right name", () => {
    /**
     * The second control, and the one that matters. `readSource` strips
     * comments; if the name were ever changed, every assertion below would
     * pass by finding nothing at all — a sweep reporting a clean app because
     * it is searching for a string that no longer exists.
     */
    const decl = files.filter((f) => /export function matchSettled\b/.test(readSource("src", relOf(f))));
    expect(decl.length, "matchSettled is not declared anywhere — has it been renamed?").toBe(1);
  });

  it("is not read anywhere it has not been justified", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readSource("src", relOf(file));
      if (!IMPORT.test(src)) continue;
      const rel = relative(SRC, file).split(sep).join("/");
      if (ALLOWED[rel]) continue;
      offenders.push(rel);
    }
    expect(
      offenders,
      "these read matchSettled without a stated reason — if the question is " +
        "'is this match OVER', the answer is matchIsOver; if it really is 'has " +
        "this begun', add the file to ALLOWED with the reason",
    ).toEqual([]);
  });

  it("every allowed file still reads it, so the list cannot go stale", () => {
    /**
     * An allow-list that outlives its call sites is a list nobody is reading.
     * `live-board.ts` sat in exactly that state for a day after the fix: the
     * import stayed behind when the call went, and neither tsc nor next lint
     * said a word about it.
     */
    for (const [rel, why] of Object.entries(ALLOWED)) {
      const src = readSource("src", ...rel.split("/"));
      expect(CALL.test(src), `${rel} no longer calls matchSettled — drop it from ALLOWED (${why})`).toBe(true);
    }
  });
});
