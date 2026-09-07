import { describe, it, expect } from "vitest";
import { reorderShifts } from "../reorder";
import { readSource } from "./source";

/**
 * The leaderboard's one animation, and the four cases that decide whether it
 * says something true.
 *
 * The whole justification for this motion existing is that a position change
 * IS information — `globals.css` removed the hover translation on cards
 * because "a moving surface is read as a glitch, not as affordance". So every
 * case below is really the same question: would this movement be telling the
 * viewer something that actually happened?
 */

const board = (...rows: Array<[string, number]>) => new Map(rows);

describe("which rows moved", () => {
  it("animates a row that changed places, from where it was", () => {
    // b overtakes a: b was at 60 and is now at 0, so it must START 60px lower
    // and rise. The sign is the whole point — get it backwards and the board
    // animates every change in the opposite direction to what happened.
    const shifts = reorderShifts(board(["a", 0], ["b", 60]), board(["b", 0], ["a", 60]));
    expect(shifts).toEqual([
      { key: "b", dy: 60 },
      { key: "a", dy: -60 },
    ]);
  });

  it("says nothing about a board that did not change", () => {
    const same = board(["a", 0], ["b", 60], ["c", 120]);
    expect(reorderShifts(same, board(["a", 0], ["b", 60], ["c", 120]))).toEqual([]);
  });

  /**
   * A player whose first score has just landed has not MOVED — they have
   * arrived. Sliding them in from a position they never held invents a story
   * the viewer will read as "they were beaten down the board", which is the
   * opposite of what happened.
   */
  it("does not move a row that was not on the previous board", () => {
    const shifts = reorderShifts(board(["a", 0]), board(["a", 60], ["new", 0]));
    expect(shifts.map((s) => s.key)).toEqual(["a"]);
  });

  /**
   * THE FIRST RENDER. There is no previous board, so nothing has moved — and
   * animating here would fly every row in from wherever it was first measured,
   * which reads as the page breaking rather than as news.
   *
   * KEPT DELIBERATELY, THOUGH IT CANNOT FAIL ON ITS OWN. `reorder.ts` used to
   * carry a `before.size === 0` early return for this, and mutation testing
   * showed that deleting it changed nothing: on a first render every row is
   * unknown to the previous board, so the new-row rule above already covers
   * it. The early return is gone; this stayed, because the BEHAVIOUR still has
   * to hold however it is implemented, and a reader arriving at this file will
   * ask about the first render whether or not there is a branch for it.
   *
   * Its honest status: it is a statement of intent, not an independent guard.
   * The assertion that actually bites is "does not move a row that was not on
   * the previous board".
   */
  it("is silent on the first render", () => {
    expect(reorderShifts(board(), board(["a", 0], ["b", 60]))).toEqual([]);
  });

  /**
   * Not a preference to read and then ignore. Someone who has asked their
   * device for less motion is often someone for whom it causes nausea, and a
   * lurching leaderboard is exactly the kind that does.
   */
  it("is silent when the device asks for less motion", () => {
    const shifts = reorderShifts(board(["a", 0], ["b", 60]), board(["b", 0], ["a", 60]), {
      reduceMotion: true,
    });
    expect(shifts).toEqual([]);
  });

  /**
   * Sub-pixel wobble — a font settling, a scrollbar appearing — is not a
   * position change. Without a floor an idle board shimmers, which is the
   * "moving surface read as a glitch" failure arriving by the back door.
   */
  it("ignores a sub-pixel wobble", () => {
    expect(reorderShifts(board(["a", 0]), board(["a", 0.4]))).toEqual([]);
    expect(reorderShifts(board(["a", 0]), board(["a", 12]))).toEqual([{ key: "a", dy: -12 }]);
  });

  it("handles a row leaving the board without inventing a shift for it", () => {
    // `gone` is no longer rendered; only what is still on the board can move.
    const shifts = reorderShifts(board(["a", 0], ["gone", 60]), board(["a", 0]));
    expect(shifts).toEqual([]);
  });
});

/**
 * The rule the motion is an exception to, asserted so the exception cannot
 * quietly become the norm.
 *
 * Read through `readSource` because both files discuss transforms and hover
 * states in prose at length, and a naive scan would find the words it is
 * looking for inside the explanation of why they were removed.
 */
describe("motion stays on data, not on chrome", () => {
  it("does not put a hover translation back on cards", () => {
    const css = readSource("src/app/globals.css");
    expect(
      css,
      "a card that moves on hover is the 'glitch, not affordance' problem this app already decided against",
    ).not.toMatch(/\.card[^{]*:hover[^}]*transform\s*:\s*translate/);
  });

  /**
   * THE RULE IS "ONLY WHERE THE BOARD UPDATES IN PLACE", NOT "ONLY ON THE
   * PLAYER BOARD" — and the difference is why this assertion changed.
   *
   * It used to require that `LeaderboardTable` did NOT animate, with the
   * reason: "no live update behind it; animating it would animate a
   * navigation". That was correct when written. `LiveRefresh` was mounted on
   * `/live/[token]` and nowhere else, so the console board only ever changed
   * across a full navigation, where the component remounts and there is no
   * previous board to have moved from.
   *
   * It is no longer correct, because the console leaderboard now polls — see
   * `(app)/leaderboard/page.tsx`, where a static badge reading "Updating live"
   * was replaced by the component that actually does it. So the table now
   * satisfies the same condition the list always did, and the motion belongs
   * there for exactly the same reason.
   *
   * The assertion is therefore about the CONDITION rather than about which
   * file: a board that animates must have something behind it that updates it
   * in place. If polling is ever taken off a board, the motion has to come off
   * with it, and this is what says so.
   */
  it("animates only the boards that update in place", () => {
    const players = readSource("src/components/PlayerLeaderboard.tsx");
    expect(players).toMatch(/<FlipList/);
    expect(players).toMatch(/data-flip-key=/);

    const table = readSource("src/components/LeaderboardTable.tsx");
    expect(table).toMatch(/<FlipTableBody>/);
    expect(table).toMatch(/data-flip-key=/);

    // And the two pages that render them both mount the poller. Without this
    // the pair above is satisfied by animation on a board nothing refreshes,
    // which is the failure the original version of this test was guarding.
    for (const page of ["src/app/(app)/leaderboard/page.tsx", "src/app/live/[token]/page.tsx"]) {
      expect(
        readSource(page),
        `${page} renders an animated board but nothing updates it in place`,
      ).toMatch(/<LiveRefresh\b/);
    }
  });
});
