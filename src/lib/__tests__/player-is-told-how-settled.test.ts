import { describe, it, expect } from "vitest";
import { snapshotStanding } from "../domain/lifecycle-state";
import { readSource } from "./source";

/**
 * WHAT THE PLAYER'S OWN SCREENS CLAIM IS SETTLED.
 *
 * Two readings off the demo tournament on 2026-09-12, signed in as a player.
 *
 * "POSITION 5" BESIDE "FINAL". The label is honest — `rankedScore` says in its
 * own words that "final" is "a claim about this player's own round, not about
 * eighteen holes", and this player had returned every hole they owed. What
 * nothing said is that twenty-six of the thirty-three cards were still out. A
 * reader takes the card in as one thing and concludes they finished fifth.
 *
 * "YOU'RE DOWN OVER THE WHOLE TOURNAMENT −$10.00", with "Side bets −$15.00"
 * four inches below it. Both figures are right. `roundMoneyFor` counts only
 * rounds whose pots are final — deliberately, and `money-layout.ts` argues it
 * at length — so the header excluded a closest-to-the-pin already won on a
 * round still being played. The phrase was the part that could not be kept.
 *
 * NEITHER FIX CHANGES AN AMOUNT. Both are the app stopping short of a claim it
 * cannot support, which is the same correction `/reports` took for its printed
 * sheet — and the position note reads through that same rule rather than a
 * second opinion about it.
 */

describe("the player's position says whether it can move", () => {
  it("reads through the rule the printed sheet uses", () => {
    /**
     * ONE RULE, TWO READERS. A second opinion would have the organizer's
     * noticeboard and the player's phone saying different things about one
     * round — the split this codebase keeps rediscovering.
     */
    const me = readSource("src", "lib", "services", "me.ts");
    expect(me).toContain("snapshotStanding(");
    expect(me, "the player screen worked finality out for itself").not.toMatch(/status === "completed"/);
  });

  it("is measured against the board's own progress, not the round's hole count", () => {
    // `boardProgress` is what "7 of 33 cards in" comes from, and it is the
    // number the dashboard prints beside it. Reading anything else here would
    // put two counts of one thing on two screens.
    const me = readSource("src", "lib", "services", "me.ts");
    const call = me.slice(me.indexOf("snapshotStanding("), me.indexOf("snapshotStanding(") + 320);
    expect(call).toContain("state.boardProgress.certified");
    expect(call).toContain("state.boardProgress.total");
    expect(call).toContain("state.event.status");
  });

  it("prints under the position, which is what it qualifies", () => {
    /**
     * Not beside "Final". That label belongs to the SCORE and is correct about
     * it; moving the qualifier there would contradict a true statement instead
     * of completing an incomplete one.
     */
    const page = readSource("src", "app", "(player)", "me", "page.tsx");

    /**
     * Today was rebuilt round-first on 2026-09-18: the SCORE moved into the
     * hero at the top and the POSITION became its own row beneath it. The
     * rule this pins survives the move, so it is asserted against the new
     * layout rather than against the old variable names.
     */
    /**
     * And re-hung as a SCOREBOARD on 2026-09-19 (design D): the hero is now
     * `<ScoreboardCard>` and the position is the LEADERS board, which takes
     * the qualifier as its `note` and prints it beneath the rows. The plain
     * position row remains where there is no board to hang.
     */
    // The card panel carries the score, and the qualifier is NOT in it.
    const heroStart = page.indexOf("<ScoreboardCard");
    const heroEnd = page.indexOf("/>", heroStart);
    expect(heroStart, "the scoreboard card is gone").toBeGreaterThan(-1);
    const hero = page.slice(heroStart, heroEnd);
    expect(hero).toContain("standing?.scoreLabel");
    expect(hero, "the qualifier moved beside the score").not.toContain("standing.note");
    expect(hero, "the qualifier moved beside the score").not.toContain("standing?.note");

    // The leaders board is handed the qualifier…
    const board = page.slice(page.indexOf("<ScoreboardLeaders"));
    expect(board.slice(0, board.indexOf("/>"))).toContain("standing?.note");
    // …and prints it UNDER the rows it qualifies.
    const panel = readSource("src", "components", "Scoreboard.tsx");
    const leaders = panel.slice(panel.indexOf("export function ScoreboardLeaders"), panel.indexOf("export interface HoleTile"));
    expect(leaders.indexOf("{note}")).toBeGreaterThan(leaders.indexOf("</ol>"));

    /**
     * Without a board, the position row carries the place, and the qualifier
     * sits under it.
     *
     * ANCHORED ON THE ROW ITSELF, not on "the first link to the board after
     * the hero". That anchor has now been wrong twice: the watching card above
     * it links to the board, and on 2026-09-20 so does the panel showing a
     * player their SIDE on a team round. Each time the slice landed on
     * somebody else's link and the failure read as "the position row lost its
     * position" — which it had not.
     *
     * A third link would break it again, so it searches back from the row's
     * own label to the link that opens it.
     */
    const rowAnchor = page.indexOf('"On the board"');
    expect(rowAnchor, "the position row is gone").toBeGreaterThan(heroEnd);
    const rowStart = page.lastIndexOf('href="/me/board"', rowAnchor);
    const rowEnd = page.indexOf("</Link>", rowAnchor);
    const row = page.slice(rowStart, rowEnd);
    expect(row).toContain("standing.position");
    expect(row).toContain("standing.note");
    expect(row.indexOf("standing.note")).toBeGreaterThan(row.indexOf("standing.position"));

    // And the card a match player still sees keeps the old order: place,
    // then its qualifier, then the score label. Anchored on the card's LABEL,
    // which since 2026-09-26 is `standingLabels(...)` ("Position", or
    // "Qualifying" once the round is a draw) rather than a literal "Position".
    const cardAt = page.indexOf("standingLabels({ position: standing.position");
    expect(cardAt, "the position card's label is gone").toBeGreaterThan(-1);
    const card = page.slice(cardAt);
    expect(card.indexOf("standing.note")).toBeGreaterThan(-1);
    expect(card.indexOf("standing.note")).toBeLessThan(card.indexOf("standing.scoreLabel"));
  });

  it("says nothing once the tournament is closed", () => {
    // Self-clearing, so it is not furniture on every finished tournament for
    // the rest of the season.
    expect(snapshotStanding({ status: "completed", done: 7, total: 33, unit: "cards" }).note).toBe("");
    expect(snapshotStanding({ status: "live", done: 7, total: 33, unit: "cards" }).note).toContain("7 of 33");
  });

  describe("on a knockout, where the table below is the qualifying", () => {
    /**
     * A BRACKET RESULT CANNOT MOVE THE TABLE IT SITS UNDER. The standings a
     * knockout event shows are the GROUP phase's — played, won, halved, match
     * points — and a tie is a `BracketWinner` row rather than a `Match`, so
     * deciding one changes no figure in it. The qualifying is over; what is
     * being decided is who wins.
     *
     * "5 of 6 ties in — these standings will change" was two true halves and a
     * false join, which is the same shape as a note describing one panel while
     * sitting under another.
     */
    it("counts the ties without promising the table will move", () => {
      const note = snapshotStanding({ status: "live", done: 5, total: 6, unit: "ties" }).note;
      expect(note).toContain("5 of 6 ties decided");
      expect(note, "the bracket was said to change the qualifying table").not.toContain(
        "these standings will change",
      );
      expect(note).toContain("bracket");
    });

    it("says what an undecided bracket means, rather than reporting an absence", () => {
      // "Nothing returned for this round yet" reads as a missing card on a
      // round that has none to return.
      const note = snapshotStanding({ status: "live", done: 0, total: 4, unit: "ties" }).note;
      expect(note).toContain("No tie has been decided yet");
      expect(note).not.toContain("Nothing returned");
    });

    it("does not call a bracket all in while the final is unplayed", () => {
      // Every tie DRAWN, which is the honest claim: `knockoutProgress` counts
      // only ties that have two players in them, so "all of them" does not
      // mean the knockout is over.
      const note = snapshotStanding({ status: "live", done: 4, total: 4, unit: "ties" }).note;
      expect(note).toContain("Every tie drawn has been decided");
      expect(note).not.toContain("This round is all in");
    });

    it("does not report a hand-scored round as one waiting for cards", () => {
      /**
       * `isManualFormat` rounds have no engine by design — the format's own
       * entry says so — so nothing is owed and nothing will change. The note
       * said "Nothing returned for this round yet" on `/reports`, two inches
       * above its own notice explaining that no result is expected, and on the
       * player's screen where there is no notice at all.
       *
       * The unit carries it, so neither screen has to know what a manual
       * format is.
       */
      const note = snapshotStanding({ status: "live", done: 0, total: 0, unit: "manual" }).note;
      expect(note).toContain("scored by hand");
      expect(note).not.toContain("Nothing returned");
      expect(note).not.toContain("will change");
    });

    it("leaves every other unit exactly as it was", () => {
      // The control: this is a branch for one unit, and a change that reworded
      // the others would pass the three cases above.
      expect(snapshotStanding({ status: "live", done: 7, total: 33, unit: "cards" }).note).toBe(
        "7 of 33 cards in — these standings will change.",
      );
      expect(snapshotStanding({ status: "live", done: 0, total: 8, unit: "sides" }).note).toContain(
        "Nothing returned for this round yet",
      );
      expect(snapshotStanding({ status: "live", done: 8, total: 8, unit: "sides" }).note).toContain(
        "This round is all in",
      );
    });
  });
});

describe("what the money header is over", () => {
  const client = () => readSource("src", "components", "RoundMoney.tsx");

  it("stops claiming the whole tournament while a round is out", () => {
    const src = client();
    expect(src, "the unconditional claim is back").not.toContain('"You\'re down over the whole tournament"');
    expect(src).toContain("on the rounds that have finished");
  });

  it("still says the whole tournament once nothing is outstanding", () => {
    /**
     * THE CONTROL. A change that simply deleted the phrase would pass the test
     * above and would be a different understatement — a finished tournament's
     * total really is over the whole thing, and hedging it forever is its own
     * untruth.
     */
    expect(client()).toContain("over the whole tournament");
  });

  it("asks the same question the sentence below it asks", () => {
    /**
     * "Still being played: Round 1, Round 3…" and the header's scope are one
     * question. The header reading anything else is how a card comes to hedge
     * its total while telling the reader everything is in, or the reverse.
     *
     * THIS USED TO PIN THE DUPLICATION — the same expression written twice,
     * asserted to appear more than once — and that was the right guard while
     * the rule was one clause long. It grew a second (a shared-ball round is
     * finished and unpayable, so it is not something to wait for), at which
     * point "both copies say the same thing" is a test that passes while
     * somebody updates one of them. The list is built ONCE now and both read
     * it, which is the guarantee the assertion was after.
     */
    const src = client();
    expect(src.split("const stillPlaying =").length - 1, "the list is built once").toBe(1);
    // Neither reader may go back to asking the rounds directly.
    expect(src, "a second copy of the question is back").not.toContain("view.rounds.some((r) => !r.final)");
    expect(src, "the header stopped reading the shared list").toContain("const outstanding = stillPlaying.length > 0");
    expect(src, "the footer stopped reading the shared list").toContain("{stillPlaying");
  });

  it("changes no arithmetic", () => {
    /**
     * The figure was never wrong. `roundMoneyFor` gates on finality for
     * reasons `money-layout.ts` sets out — "a skins pot can carry to the last
     * green, so a running total would only be a different number that looked
     * like the answer" — and this must stay a wording fix.
     */
    const src = client();
    expect(src).toContain("money(view.yourTotalCents)");
    expect(src, "the header started doing sums of its own").not.toMatch(/yourTotalCents\s*[+\-*/]/);
  });
});
