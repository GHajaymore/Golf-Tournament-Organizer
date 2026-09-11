import { describe, it, expect } from "vitest";
import {
  boardIntro,
  boardFootnote,
  boardShowsHighlights,
  boardShowsCommentary,
} from "@/lib/domain/board-copy";
import { readSource } from "./source";

/**
 * THE LEADERBOARD A FOURBALL READS.
 *
 * `/leaderboard` is one of the screens a casual round deliberately KEEPS —
 * `nav.ts` says "Score entry, Live leaderboard, Rules reference and Group
 * games mean exactly the same thing to a fourball as to a championship", and
 * for the TABLE that is true. Walked on 2026-09-11 with both cards in, the
 * rest of the screen said:
 *
 *     Overall standings across all flights · stroke play (gross / net / to-par)
 *     TOURNAMENT HIGHLIGHTS
 *     🏆 LEADER — Bly Kessinger leads at +2 (net 74)
 *     [ Overall | By flight ]
 *     … Advancing rows reflect the qualification cutoff.
 *     Commentary — Drafting comes with the paid plan
 *
 * There are no flights. There is no cut — `capabilitiesOf("match")` has said
 * `chainsRounds: false` since the shape was added. The highlight card
 * announced a leader directly above a two-row table whose first row says the
 * same thing. And press commentary, with an upsell attached, is a broadcast
 * channel aimed at the person standing next to you.
 */
const stroke = { isStroke: true, stableford: false };
const stableford = { isStroke: true, stableford: true };
const match = { isStroke: false, stableford: false };

describe("what the board says it is", () => {
  it("does not mention flights to a round that cannot have them", () => {
    for (const base of [stroke, stableford, match]) {
      expect(boardIntro({ ...base, casual: true })).not.toMatch(/flight/i);
    }
  });

  it("still says it to a tournament", () => {
    for (const base of [stroke, stableford, match]) {
      expect(boardIntro({ ...base, casual: false })).toMatch(/flights/);
    }
  });

  it("still names the scoring, which is the half that helps either way", () => {
    // Dropping the tournament furniture must not drop what the numbers mean.
    expect(boardIntro({ ...stroke, casual: true })).toMatch(/gross, net and to-par/);
    expect(boardIntro({ ...stableford, casual: true })).toMatch(/Stableford points/);
    expect(boardIntro({ ...match, casual: true })).toMatch(/holes won, halved and lost/);
  });

  it("keeps Stableford and stroke apart on a casual round too", () => {
    /**
     * They read in opposite directions — points where higher is better, shots
     * where lower is. One sentence for both is how a first-timer reads their
     * Stableford as a score.
     */
    expect(boardIntro({ ...stableford, casual: true })).not.toBe(boardIntro({ ...stroke, casual: true }));
  });
});

describe("what the board says under the table", () => {
  it("promises no cut to a round that has none", () => {
    for (const base of [stroke, stableford, match]) {
      expect(boardFootnote({ ...base, casual: true })).not.toMatch(/cutoff/i);
      expect(boardFootnote({ ...base, casual: true })).not.toMatch(/Advancing/);
    }
  });

  it("still explains it to a tournament", () => {
    for (const base of [stroke, stableford, match]) {
      expect(boardFootnote({ ...base, casual: false })).toMatch(/cutoff/);
    }
  });

  it("keeps the arithmetic, which a fourball needs just as much", () => {
    /**
     * The casual versions are the tournament sentences minus the cut, on
     * purpose. "Why is my net not my gross" is the commonest question a
     * leaderboard gets, and it does not depend on there being a committee.
     */
    expect(boardFootnote({ ...stroke, casual: true })).toMatch(/Net = gross minus handicap strokes/);
    expect(boardFootnote({ ...stableford, casual: true })).toMatch(/2 for a net par/);
    expect(boardFootnote({ ...match, casual: true })).toMatch(/P played, W won/);
  });

  it("leaves the tournament footnotes exactly as they were", () => {
    // This screen is the club's too, and the wording is pinned elsewhere.
    expect(boardFootnote({ ...stroke, casual: false })).toBe(
      "Net = gross minus handicap strokes received on the holes played; To-par is versus the holes played. Advancing rows reflect the qualification cutoff.",
    );
  });
});

describe("what the board stops printing altogether", () => {
  it("drops the highlight cards on a quick round", () => {
    expect(boardShowsHighlights(true)).toBe(false);
    expect(boardShowsHighlights(false)).toBe(true);
  });

  it("drops press commentary on a quick round", () => {
    expect(boardShowsCommentary(true)).toBe(false);
    expect(boardShowsCommentary(false)).toBe(true);
  });
});

/**
 * And the page has to ASK, with the round's own shape.
 *
 * The pure tests hand `casual` in, so they cannot see a page that never reads
 * it — in which case every board is a tournament board again and the whole
 * thing is decoration.
 */
describe("where the board gets its answer", () => {
  const page = () => readSource("src", "app", "(app)", "leaderboard", "page.tsx");

  it("reads the round's shape, the same way /entry and /dashboard do", () => {
    expect(page()).toMatch(/isMatch\(state\.event\.shape\)/);
  });

  it("routes all four decisions through the one reader", () => {
    const src = page();
    for (const fn of ["boardIntro(", "boardFootnote(", "boardShowsHighlights(", "boardShowsCommentary("]) {
      expect(src, `${fn} not wired`).toContain(fn);
    }
  });

  it("keeps no second copy of the wording it just moved out", () => {
    /**
     * An absence check, which is the safe direction and cannot be satisfied by
     * a comment — `readSource` strips those. A sentence left behind in the
     * page is how this comes back: it is exactly what happened to the certify
     * copy between #280 and #281, one week apart.
     */
    const src = page();
    expect(src).not.toMatch(/Overall standings across all flights/);
    expect(src).not.toMatch(/Advancing rows reflect the qualification cutoff/);
  });
});

/**
 * The flight toggle, which is data rather than shape.
 *
 * It rendered always. With no flights "By flight" switched to a view holding
 * nothing; with ONE it reprinted the overall table under a heading. A quick
 * round is the second case, not the first — `createMatch` creates a single
 * group called "A" because a player row needs a group — so the obvious
 * `length > 0` would have missed it.
 */
describe("when the board offers a flight view", () => {
  const src = () => readSource("src/components/LeaderboardBoard.tsx");

  it("needs more than one flight, not merely one", () => {
    expect(src()).toMatch(/flights\.length > 1 &&/);
    expect(src()).not.toMatch(/flights\.length > 0 &&/);
  });

  it("falls back to the overall table rather than rendering nothing", () => {
    // Without this the state could still be "flight" from before, and the
    // table would vanish with no control left to bring it back.
    expect(src()).toMatch(/view === "overall" \|\| flights\.length < 2/);
  });
});
