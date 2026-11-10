import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, dayFromNow, prisma } from "./status-fixture";
import { END_EARLY } from "../src/lib/domain/lifecycle-track";

/**
 * A STABLEFORD, WALKED THROUGH SETUP AND LAUNCH BY THE STATE MACHINE (PR 3;
 * proposal 5c, QA 8.4), every panel asked the same question at every step.
 *
 * One Stableford round off handicap, six entered, the money answered, a venue
 * and no dates:
 *
 *   D4  the details step holds on the dates, and Launch says so in place.
 *   D1  one field is a complete setup for an individual Stableford (Golf Pro,
 *       8.2; the Rules of Handicapping's Appendix C allowance makes a single
 *       field fair): Flights reads "Optional", nothing waits for it.
 *   J04 once flights ARE made, a player left out of them is said — on the rail
 *       and in the launch dialog — and still never holds launch.
 *
 * WHAT IT CANNOT SEE: play over and completing, walked in `status-stroke.spec.ts`
 * (a Stableford's play is over on the same rule: every round closed).
 */

test("a Stableford says the same thing on every panel through setup and launch (D1, D4, J04)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "stableford",
    rounds: [{ type: "Stroke Play Round", format: "Stableford", scoringBasis: "net" }],
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);

    // D4: no dates — held on Tournament details, refused in place with the way there.
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: { because: "This tournament has no dates", wayOut: { says: "Open Tournament details", href: "/event" } },
      setup: { holds: "Tournament details", done: 3, of: 5 },
      journey: "Set up",
    });

    // D1: dated, one field — ready to launch, Flights optional.
    const day = dayFromNow(12);
    await prisma.event.update({ where: { id: f.eventId }, data: { dates: "Sunday Stableford", startOn: day, endOn: day } });
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: null,
      setup: { ready: true, done: 4, of: 5, optional: ["Flights"] },
      journey: "Launch",
    });
    await expect(page.locator("main")).not.toContainText("No flights yet");

    // J04: one flight of five, the sixth in none — said, never held.
    const flight = await prisma.group.create({ data: { eventId: f.eventId, name: "zz Flight A", position: 0 } });
    await prisma.player.updateMany({ where: { id: { in: f.playerIds.slice(0, 5) } }, data: { groupId: flight.id } });
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: null,
      setup: { ready: true, done: 4, of: 5, optional: ["Flights"] },
      journey: "Launch",
    });
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await page.getByRole("button", { name: "Launch tournament" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("region", { name: "Still open" })).toContainText("1 player is in the field but in no flight.", { timeout: 15_000 });
    await dialog.getByRole("button", { name: "Launch tournament" }).click();
    await expect.poll(f.status, { timeout: 20_000, message: "the press did not launch it" }).toBe("live");

    await expectTournamentSays(page, {
      chip: "Live",
      chipDetail: null,
      nextAction: END_EARLY,
      refused: { because: "Nothing has been scored yet", wayOut: { says: "Open Score entry", href: "/entry" } },
      setup: null,
      journey: "Play",
    });
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
