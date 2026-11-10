import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, dayFromNow, prisma } from "./status-fixture";
import { pressComplete } from "./end-early";
import { END_EARLY } from "../src/lib/domain/lifecycle-track";

/**
 * A KNOCKOUT IN FLIGHTS, WALKED THROUGH THE STATE MACHINE (J13; the flighted
 * knockout family). Flights are SEPARATE KNOCKOUTS, so the tournament is over
 * only when every flight's Final is decided — not the first, not the top two.
 *
 * Nine players in three flights of three (a bracket of four each: the top seed
 * has the bye, so a flight is one tie to play and its Final — two results). The
 * keys are the app's own: the first flight is `winners-…`, the second
 * `consolation-…`, the third `flight3-…` (`flightKind`) — the third is the first
 * draw filed under a word of its own, the one a reader that names "winners and
 * consolation" never sees, which is why this has THREE flights (knockouts doc).
 *
 *   launched, division not yet made   Live; Complete refused — and the division can still be made
 *                                     (a flighted championship is divided AFTER the qualifying round,
 *                                     which is after launch)
 *   division made, nothing played     Live; Complete refused
 *   flight A decided                  Live
 *   flights A and B decided           Live — one Final still to play
 *   all three                         Play over · "Every final decided · results not released"
 *   completed                         Reopen
 *
 * The division lives in `Event.bracketDraw` as `{ v: 2, criterion, flights }`;
 * each flight's `playerIds` are in seed order, so a flight of three is seed 1
 * (bye) against the winner of 2 v 3.
 *
 * WHAT IT CANNOT SEE: the draw's lock (open after launch, shut by the first
 * result, shut by completion) is held scope by scope in
 * `tournament-status-by-family.test.ts`, and the screen that moves players is
 * `organizer-knockout-flights.spec.ts`'s.
 *
 * Its own throwaway club (`zz-status-knockoutflights-*`), deleted in `finally`.
 */

test("a knockout in flights is over only when all three Finals are decided (J13)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const day = dayFromNow(10);
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "knockoutflights",
    players: 8,
    event: { shape: "knockout", bracketMode: "flights", dates: "Club championship", startOn: day, endOn: day, status: "live", configUnlocked: false },
    rounds: [{ type: "Bracket Stage", format: "Match Play", scoringBasis: "gross" }],
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);

    // The fixture makes eight; a ninth fills the third flight.
    const ninth = await prisma.player.create({
      data: { eventId: f.eventId, name: "Quill Anders", email: `zz-status-knockoutflights-9@example.invalid`, handicap: 18, seed: 9, status: "confirmed" },
    });
    const ids = [...f.playerIds, ninth.id];
    const flights = [
      { name: "Flight A", playerIds: ids.slice(0, 3), kind: "winners" },
      { name: "Flight B", playerIds: ids.slice(3, 6), kind: "consolation" },
      { name: "Flight C", playerIds: ids.slice(6, 9), kind: "flight3" },
    ];
    /** A flight of three: seed 2 beats seed 3, then seed 1 (who had the bye) beats seed 2 in the Final. */
    const decide = async (i: number) => {
      const { kind, playerIds } = flights[i];
      await prisma.bracketWinner.createMany({
        data: [
          { eventId: f.eventId, key: `${kind}-0-1`, winnerId: playerIds[1], result: "2&1" },
          { eventId: f.eventId, key: `${kind}-1-0`, winnerId: playerIds[0], result: "3&2" },
        ],
      });
    };

    // Launched with the division not yet made: live, nothing to complete.
    await expectTournamentSays(page, {
      chip: "Live",
      chipDetail: null,
      nextAction: END_EARLY,
      refused: { because: "Nothing has been scored yet", wayOut: { says: "Open Score entry", href: "/entry" } },
    });

    // The division made (after launch, as a qualifying round would): still live, nothing played.
    await prisma.event.update({
      where: { id: f.eventId },
      data: { bracketDraw: JSON.stringify({ v: 2, criterion: "handicap", flights: flights.map(({ name, playerIds }) => ({ name, playerIds })) }) },
    });
    await expectTournamentSays(page, {
      chip: "Live",
      chipDetail: null,
      nextAction: END_EARLY,
      refused: { because: "Nothing has been scored yet", wayOut: { says: "Open Score entry", href: "/entry" } },
    });

    // Flight A decided: one Final of three. Live, and Complete is allowed.
    await decide(0);
    await expectTournamentSays(page, { chip: "Live", chipDetail: null, nextAction: END_EARLY, refused: null });

    // Flights A and B: the third Final is still to play. Still live.
    await decide(1);
    await expectTournamentSays(page, { chip: "Live", chipDetail: null, nextAction: END_EARLY, refused: null });

    // All three Finals: play over, said for every final.
    await decide(2);
    await expectTournamentSays(page, {
      chip: "Play over",
      chipDetail: "Every final decided · results not released",
      nextAction: "Complete tournament",
      refused: null,
    });

    await page.goto(`/dashboard?bust=${Date.now()}`);
    await pressComplete(page);
    await page.getByRole("alertdialog").getByRole("button", { name: /^(Complete tournament|Complete it)$/ }).click();
    await expect.poll(f.status, { timeout: 20_000, message: "Complete did not complete it" }).toBe("completed");
    await expectTournamentSays(page, { chip: "Completed", chipDetail: null, nextAction: "Reopen tournament", refused: null });
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
