import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cardRefusal } from "../scorecard-parse";

/**
 * One standard, wherever a card is written down.
 *
 * There were four ways a course card could enter this app and four different
 * standards applied to them. Pasting one ran the full check. A player naming a
 * new course on the first tee got a weaker one. The library editor checked the
 * stroke index and nothing else. The score-entry course setup checked nothing
 * at all — and that one is a `"use server"` export, so a public HTTP endpoint
 * writing the card every round of the tournament is then scored against.
 *
 * The weakest check sat on the least supervised path. That is the wrong way
 * round, and it is what these tests exist to keep fixed.
 */

const REAL = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];

describe("what the one standard refuses", () => {
  it("takes a real card", () => {
    expect(cardRefusal(REAL, [], SI)).toBeNull();
  });

  it("takes a blank placeholder card, which is how a course starts life", () => {
    // A club adds the course first and types the card later. Flat par 4s with
    // a 1..18 stroke index is what the library stores meanwhile, and refusing
    // it would stop a course being created at all.
    const flat = new Array(18).fill(4);
    const inOrder = Array.from({ length: 18 }, (_, i) => i + 1);
    expect(cardRefusal(flat, [], inOrder)).toBeNull();
  });

  it("names the hole for a par no golf hole has", () => {
    const pars = [...REAL];
    pars[7] = 9;
    const refusal = cardRefusal(pars, [], SI);
    expect(refusal).toBeTruthy();
    // The hole, because "invalid card" tells somebody nothing to go and look at.
    expect(refusal).toContain("8");
  });

  it("refuses a stroke index that is not a permutation of 1-18", () => {
    // The failure that never looks like one: a duplicate index gives one hole
    // two shots and another none, in every match, for as long as the course is
    // on the list.
    const si = [...SI];
    si[3] = si[2];
    expect(cardRefusal(REAL, [], si)).toBeTruthy();
  });

  it("refuses a routing sorted by par, which is what caught Green Crest", () => {
    // Every hole individually fine, a par total that matches, a clean stroke
    // index — and wrong on every hole. Only the shape check sees it.
    const sorted = [5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3];
    expect(cardRefusal(sorted, [], SI)).toContain("sorted order");
  });

  it("refuses a par total no eighteen-hole course plays", () => {
    const p79 = [5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 4, 4, 4, 4];
    expect(p79.reduce((a, b) => a + b, 0)).toBe(79);
    expect(cardRefusal(p79, [], SI)).toContain("79");
  });

  it("ignores yardage when there is none, because it is optional", () => {
    expect(cardRefusal(REAL, [], SI)).toBeNull();
  });

  it("scores a nine-hole card against nine holes", () => {
    const si9 = Array.from({ length: 9 }, (_, i) => i + 1);
    expect(cardRefusal(REAL.slice(0, 9), [], si9, 9)).toBeNull();
  });
});

describe("every path that stores a card uses it", () => {
  /**
   * A sweep rather than a list, because the list is the thing that goes stale.
   * CLAUDE.md: a guard you must remember to call is a guard that will be
   * forgotten — so this at least makes forgetting visible.
   */
  const ACTIONS = join(process.cwd(), "src", "app", "actions");
  const read = (f: string) => readFileSync(join(ACTIONS, f), "utf8");

  /** Actions that write a hole-by-hole card, and must therefore check one. */
  const WRITERS: Record<string, string[]> = {
    "courses.ts": ["saveClubCourse", "nameMatchVenue", "importClubCourseCard"],
    "tournament.ts": ["saveCustomCourse"],
  };

  for (const [file, fns] of Object.entries(WRITERS)) {
    for (const fn of fns) {
      it(`${file}:${fn} runs the shared card check`, () => {
        const src = read(file);
        const start = src.indexOf(`export async function ${fn}`);
        expect(start, `${fn} not found in ${file}`).toBeGreaterThan(-1);
        // To the next exported function, which is this one's whole body.
        const next = src.indexOf("\nexport ", start + 1);
        const body = src.slice(start, next === -1 ? undefined : next);
        // Either the shared refusal, or parseCard — which is validateCard by
        // another name and is what the paste screen already used.
        expect(
          /cardRefusal\(|parseCard\(/.test(body),
          `${fn} stores a card without running cardRefusal or parseCard`,
        ).toBe(true);
      });
    }
  }

  /**
   * Writers that legitimately need no check of their own, each with the
   * reason. Anything added here is a deliberate decision on the record — an
   * unexplained entry is how this test would quietly stop protecting
   * anything. Same shape as audit-idor.test.ts, and for the same reason.
   */
  const EXEMPT: Record<string, string> = {
    "courses.ts:importCourseFromDirectory":
      "the card comes from fetchDirectoryCourse -> courseFrom -> cardFrom, which runs cardProblems AND implausibleCard and refuses an unusable card outright; the check is one frame down",
    "courses.ts:applySourceCard":
      "same path, and it additionally refuses unless fresh.card.usable — a card the directory could not be trusted for never reaches the update",
    "courses.ts:checkCourseAgainstSource":
      "never writes: it reports cardDifferences for a human to act on, by design, so the source can never outrank the club",
    "tournament.ts:saveMatchScorecard":
      "writes a PLAYER’s strokes, not a course card — the strokeIndex it names is read from the course to allocate shots",
    "tournament.ts:saveEvent":
      "CLEARS the event’s card when the venue changes, never writes one — blank hole arrays are the absence of a card, and refusing to blank one would keep the previous course’s stroke index on a tournament that has moved",
    "tournament.ts:cloneEvent":
      "copies a card already stored on the event it is cloning, which was checked when it was first written; re-refusing it would make an old tournament un-copyable",
  };

  it("has not grown a card writer this sweep does not know about", () => {
    // The honest limit of the test above: it can only check what it is told
    // about. This at least fails loudly when a new action starts writing the
    // columns a card lives in.
    const suspects: string[] = [];
    for (const f of readdirSync(ACTIONS).filter((x) => x.endsWith(".ts"))) {
      const src = read(f);
      if (!/customStrokeIndex|strokeIndex:\s/.test(src)) continue;
      const known = WRITERS[f] ?? [];
      for (const m of src.matchAll(/export async function (\w+)/g)) {
        const name = m[1];
        const next = src.indexOf("\nexport ", m.index! + 1);
        const body = src.slice(m.index!, next === -1 ? undefined : next);
        const writes = /strokeIndex:\s|customStrokeIndex/.test(body);
        const checks = /cardRefusal\(|parseCard\(/.test(body);
        const exempt = EXEMPT[`${f}:${name}`];
        if (writes && !checks && !known.includes(name) && !exempt) suspects.push(`${f}:${name}`);
      }
    }
    expect(suspects, "these write a card without checking one").toEqual([]);
  });
});
