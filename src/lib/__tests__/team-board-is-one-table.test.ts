import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * A TEAM ROUND'S STANDINGS ARE ONE TABLE, RENDERED TWICE.
 *
 * The organizer's leaderboard showed the sides. The player's own board said
 * "This round ranks teams rather than players. Ask your organizer for the team
 * board" — and then printed the winning side four lines below it, out of
 * `ResultLines`. One screen sending a member to ask a human for an answer it
 * was already showing them, read off the seeded club's foursomes on
 * 2026-09-20.
 *
 * The fix is not new copy, it is the same component: `TeamStandingsTable`,
 * split out of `TeamLeaderboard` that day so a screen which already has an
 * `<h1>` can render the table without a second one. This pins the two screens
 * to it, because the failure mode of fixing this with a hand-rolled table on
 * the player side is two tables that quietly rank sides differently — which is
 * precisely what the week sheet did on the same night, placing three sides
 * level on net as 1st, 2nd and 3rd while the leaderboard tied them at 1st.
 *
 * Source-read, so `readSource` — a positive assertion satisfied by the comment
 * describing it is the one mutation failure that looks like a success.
 */

const BOARD = "src/app/(player)/me/board/page.tsx";
const LEADERBOARD = "src/app/(app)/leaderboard/page.tsx";
const COMPONENT = "src/components/TeamLeaderboard.tsx";
const TODAY = "src/app/(player)/me/page.tsx";

describe("the sides a member sees and the sides an organizer sees", () => {
  it("are the same table", () => {
    const board = readSource(BOARD);
    expect(board, "the player's board no longer renders the shared side table").toMatch(
      /<TeamStandingsTable/,
    );
    // The organizer's screen reaches it through TeamLeaderboard, which is the
    // wrapper that adds the page heading.
    expect(readSource(LEADERBOARD)).toMatch(/<TeamLeaderboard/);
    expect(readSource(COMPONENT)).toMatch(/<TeamStandingsTable/);
  });

  it("are read from the same function", () => {
    // Both call `teamStandings`. A second reader would be a second answer.
    expect(readSource(BOARD)).toMatch(/teamStandings\(/);
    expect(readSource(LEADERBOARD)).toMatch(/teamStandings\(/);
  });

  it("does not send a member to go and ask somebody", () => {
    /**
     * An absence assertion, which is the safe direction: a comment mentioning
     * the sentence fails this loudly rather than satisfying it quietly. The
     * comment on this file says the words and reads the source stripped.
     */
    expect(readSource(BOARD)).not.toMatch(/Ask your organizer for the team board/);
  });

  it("finds a player's own side by ID, never by name", () => {
    /**
     * Today shows "your side". Two members of a club can share a name, and the
     * result on somebody's phone is the one thing that must not be somebody
     * else's — so the lookup goes through `memberIds`.
     */
    const today = readSource(TODAY);
    expect(today, "Today no longer looks a player's side up").toMatch(/memberIds\.includes\(/);
    expect(today).toMatch(/teamStandings\(/);
  });

  it("places a player's side the way the board places it", () => {
    // `placesByValue`, the same function the table uses, so Today cannot print
    // a different number from the board the button beside it links to.
    expect(readSource(TODAY)).toMatch(/placesByValue\(/);
  });

  it("describes the round in one sentence, written once", () => {
    // `teamBoardNote` — the round's format, how many sides, and what wins.
    // Two hand-written versions are two sentences that will come to disagree
    // about whether the round is decided on points or on net.
    expect(readSource(BOARD)).toMatch(/teamBoardNote\(/);
    expect(readSource(COMPONENT)).toMatch(/teamBoardNote\(/);
  });
});
