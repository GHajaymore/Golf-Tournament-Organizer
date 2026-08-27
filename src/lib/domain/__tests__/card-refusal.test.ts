import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cardRefusal } from "../scorecard-parse";
import { cardProblems } from "../venue";

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

describe("a nine-hole course stays nine holes", () => {
  /**
   * The directory import now accepts nine-hole courses — 119 of them were
   * being thrown away. That makes a padding bug reachable that was harmless
   * while every card was eighteen: the library editor built its arrays at a
   * fixed length of 18, so opening a nine-hole course and pressing save
   * turned it into eighteen holes, nine of them invented par 4s that look
   * exactly like real ones to every screen downstream.
   */
  const si9 = [5, 1, 7, 3, 9, 2, 8, 4, 6];
  const pars9 = [4, 3, 5, 4, 4, 3, 5, 4, 4];

  it("judges a nine-hole card at nine holes", () => {
    expect(cardRefusal(pars9, [], si9, 9)).toBeNull();
  });

  it("refuses a nine-hole card carrying an eighteen-hole stroke index", () => {
    // Slicing an 18-hole index in half leaves gaps and duplicates against
    // 1..9, which allocates shots to the wrong holes exactly as a bad
    // eighteen would.
    const sliced = [6, 10, 12, 16, 14, 2, 18, 4, 8];
    expect(cardRefusal(pars9, [], sliced, 9)).toBeTruthy();
  });

  it("does not judge a nine-hole card against eighteen", () => {
    // The old behaviour, stated so it cannot come back: nine real holes
    // measured against an eighteen-hole rule is nine missing holes.
    expect(cardRefusal(pars9, [], si9, 18)).toBeTruthy();
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
describe("an absent stroke index is not a scrambled one", () => {
  const PARS18 = [4, 4, 3, 5, 4, 3, 5, 3, 4, 5, 3, 3, 4, 5, 4, 5, 4, 4];

  it("says the index is missing when the source gave none", () => {
    /**
     * Abbey Par 3: eighteen real par-3 holes, every stroke index empty. It
     * used to be told its index "must use each number from 1 to 18 exactly
     * once", which reads as an accusation that the card is jumbled and sends
     * somebody hunting for a transcription error in a card that never had an
     * index at all.
     */
    const problems = cardProblems({ pars: PARS18, strokeIndex: new Array(18).fill(0) }, 18);
    expect(problems.join(" ")).toMatch(/no stroke index was given/i);
    expect(problems.join(" ")).not.toMatch(/exactly once/i);
  });

  it("still says SCRAMBLED when the index is present and wrong", () => {
    // The distinction is only worth having if the other message survives.
    const si = Array.from({ length: 18 }, (_, i) => i + 1);
    si[17] = 1; // 1 twice, 18 never
    const problems = cardProblems({ pars: PARS18, strokeIndex: si }, 18);
    expect(problems.join(" ")).toMatch(/exactly once/i);
  });

  it("does not call a partly-missing index absent", () => {
    // One hole without an index is a gap in a real card, not a card with no
    // index — and it must not be waved through as either.
    const si = Array.from({ length: 18 }, (_, i) => i + 1);
    si[5] = 0;
    const problems = cardProblems({ pars: PARS18, strokeIndex: si }, 18);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" ")).not.toMatch(/no stroke index was given/i);
  });

  it("applies on a nine as well", () => {
    const problems = cardProblems(
      { pars: [4, 5, 3, 4, 4, 4, 3, 4, 5], strokeIndex: new Array(9).fill(0) },
      9,
    );
    expect(problems.join(" ")).toMatch(/no stroke index was given/i);
  });
});
