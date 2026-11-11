import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, dayFromNow, prisma } from "./status-fixture";
import { pressComplete, pressReopen } from "./end-early";
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
 * It starts where a tournament starts: setting up, undated (Launch refused in
 * place), then dated (Ready to launch), then launched by the press — the stages
 * before launch, which the fixture used to skip by being born live.
 *
 * THE DRAW'S OWN LOCK (open after launch, shut by the first result, shut by
 * completion): the Bracket draws the draw scope's banner from `locks.draw` — none
 * while open, "The draw · Locked because this knockout has results." with its way
 * out after the first result, the completed words after completion — and the flights
 * panel's line is picked by the same answer: "Move or add a player" enabled and
 * "until the first result is recorded" while open; the control gone and "Results are
 * in, so the flights are fixed." (or "This tournament is completed, so ...") after.
 * The move itself is `organizer-knockout-flights.spec.ts`'s.
 *
 * Its own throwaway club (`zz-status-knockoutflights-*`), deleted in `finally`.
 */

test("a knockout in flights is over only when all three Finals are decided (J13)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  const day = dayFromNow(10);
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "knockoutflights",
    players: 8,
    // Set up, undated: the fixture's own start. The walk dates it, launches it by the press, then goes on.
    event: { shape: "knockout", bracketMode: "flights" },
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

    // THE DRAW, as the Bracket screen draws it (`BracketFlights`): while it is the organizer's, the
    // "Move or add a player" control is there and enabled, under the line that says it stays open
    // until the first result; once a result is in, the control is gone and the line says the flights
    // are fixed; the draw scope's banner says the same lock, with its way out.
    const expectDraw = async (stage: string, open: boolean, by: "results" | "completed" = "results") => {
      await page.goto(`/bracket?view=draw&bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.locator("main h1").first(), `${stage}: the Bracket did not draw`).toBeVisible({ timeout: 30_000 });
      const mover = page.getByLabel("Move or add a player", { exact: true });
      const line = page.locator("main p").filter({ hasText: /Each is its own knockout\./ });
      // The draw scope's banner (`locks.draw`, the same answer the panel's line is picked by): none while open;
      // by results, the Bracket's own way out; by completion, Reopen. Sentences written by hand.
      const banner = page.getByRole("region", { name: "Locked", exact: true });
      if (open) {
        await expect(banner, `${stage}: the Bracket says the draw is locked while it is open`).toHaveCount(0);
      } else {
        await expect(banner, `${stage}: the Bracket draws no draw-lock banner`).toBeVisible({ timeout: 20_000 });
        const reason = by === "results" ? "Locked because this knockout has results." : "Locked because the tournament is completed.";
        await expect(banner.locator("p").filter({ hasText: "The draw" }), `${stage}: the draw's reason is not said`).toContainText(`The draw · ${reason}`);
        const way = banner.getByRole("link", { name: by === "results" ? "Clear the results on the Bracket" : /^Reopen/ });
        await expect(way, `${stage}: the draw lock has no way out`).toBeVisible();
      }
      if (open) {
        await expect(mover, `${stage}: the draw is shut with no result in`).toBeEnabled({ timeout: 20_000 });
        await expect(line.first(), `${stage}: the draw does not say it is open until the first result`).toContainText("until the first result is recorded");
      } else {
        await expect(line.first(), `${stage}: the draw does not say the flights are fixed`).toContainText(
          by === "results" ? "Results are in, so the flights are fixed." : "This tournament is completed, so the flights are fixed.",
          { timeout: 20_000 },
        );
        await expect(mover, `${stage}: the draw can still be changed with a result in`).toHaveCount(0);
      }
    };

    // Setting up, no dates: refused in place, with the way out (as the knockout walk).
    await expectTournamentSays(page, {
      chip: "Setting up",
      lock: "open",
      nextAction: "Launch tournament",
      refused: { because: "This tournament has no dates", wayOut: { says: "Open Tournament details", href: "/event" } },
    });
    expect(await f.status(), "refusing changed the tournament").toBe("draft");

    // Dated: nothing else holds a flighted knockout (the division is made after launch, by design).
    await prisma.event.update({ where: { id: f.eventId }, data: { dates: "Club championship", startOn: day, endOn: day } });
    await expectTournamentSays(page, { chip: "Setting up", lock: "open", nextAction: "Launch tournament", refused: null });

    // Launched by the press, as the other walks do it.
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await page.getByRole("button", { name: "Launch tournament" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
    await expect.poll(f.status, { timeout: 20_000, message: "the press did not launch it" }).toBe("live");
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
      lock: "live",
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
      lock: "live",
      chipDetail: null,
      nextAction: END_EARLY,
      refused: { because: "Nothing has been scored yet", wayOut: { says: "Open Score entry", href: "/entry" } },
    });

    // Division made, nothing played: the draw is still the organizer's.
    await expectDraw("division made", true);

    // Flight A decided: one Final of three. Live, and Complete is allowed.
    await decide(0);
    await expectTournamentSays(page, { chip: "Live", lock: "live", chipDetail: null, nextAction: END_EARLY, refused: null });
    // The first result shut the draw (the machine's "results" lock): the screen says the flights are fixed.
    await expectDraw("first result in", false);

    // Flights A and B: the third Final is still to play. Still live.
    await decide(1);
    await expectTournamentSays(page, { chip: "Live", lock: "live", chipDetail: null, nextAction: END_EARLY, refused: null });

    // All three Finals: play over, said for every final.
    await decide(2);
    await expectTournamentSays(page, {
      chip: "Play over",
      lock: "live",
      chipDetail: "Every final decided · results not released",
      nextAction: "Complete tournament",
      refused: null,
    });

    await page.goto(`/dashboard?bust=${Date.now()}`);
    await pressComplete(page);
    await page.getByRole("alertdialog").getByRole("button", { name: /^(Complete tournament|Complete it)$/ }).click();
    await expect.poll(f.status, { timeout: 20_000, message: "Complete did not complete it" }).toBe("completed");
    await expectTournamentSays(page, { chip: "Completed", lock: "completed", chipDetail: null, nextAction: "Reopen tournament", refused: null });
    await expectDraw("completed", false, "completed");

    // Reopened by the press: every Final is still decided, so play is over again.
    await pressReopen(page);
    await expect.poll(f.status, { timeout: 20_000, message: "Reopen did not reopen it" }).toBe("live");
    await expectTournamentSays(page, {
      chip: "Play over",
      lock: "live",
      chipDetail: "Every final decided · results not released",
      nextAction: "Complete tournament",
      refused: null,
    });
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
