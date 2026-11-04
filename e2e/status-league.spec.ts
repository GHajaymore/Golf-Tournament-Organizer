import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, cardsIn, dayFromNow, prisma } from "./status-fixture";

/**
 * A LEAGUE'S WEEKS, AS THE STATE MACHINE READS THEM (PR 3: J08, and a league
 * by its KIND).
 *
 * Golf Pro Q4: only the NEXT unplayed week needs a day or a deadline. Inter-club
 * weeks are arranged by captains within a window, so a league with Week 1
 * dated and the rest to come is set up — its Rounds step used to stay open
 * until every week had a day. Later weeks are named in the launch dialog, and
 * once the season is live the next undated week is the next thing to do.
 *
 * A league by its kind: this one asks a weekly sign-up (attendance "In unless
 * they opt out" — weekly-league attendance). The CONTROL is the same three
 * rounds with everyone playing every round: a three-round medal, not a league,
 * whose undated rounds are open on the rail (a 54-hole championship with an
 * undated Round 2 is not set up) and only warn.
 *
 * Its own throwaway club (`zz-status-league-*`), never the shared league
 * fixture, which every other league spec reads and none may write.
 */

test("a league needs only its next week dated, and a medal of the same rounds is not a league (J08)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const start = dayFromNow(7);
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "league",
    event: { dates: "Autumn league", startOn: start, endOn: dayFromNow(21), attendanceMode: "opt-out" },
    rounds: [
      { type: "Stroke Play Round", format: "Stroke Play", playedOn: "" },
      { type: "Stroke Play Round", format: "Stroke Play", playedOn: "" },
      { type: "Stroke Play Round", format: "Stroke Play", playedOn: "" },
    ],
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);

    // The next week has no day: that holds — the one date a league must have.
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: {
        because: "Round 1 has no day and no deadline, so nobody knows when to play it.",
        wayOut: { says: "Open Rounds & formats", href: "/stages" },
      },
      setup: { holds: "Rounds & formats", done: 3, of: 5 },
      journey: "Set up",
    });

    // Week 1 dated, weeks 2 and 3 not: the Rounds step is DONE, and nothing holds (J08).
    await prisma.stage.update({ where: { id: f.stageIds[0] }, data: { playedOn: start } });
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: null,
      setup: { ready: true, done: 4, of: 5, optional: ["Flights"] },
      journey: "Launch",
    });
    const rail = page.locator(".card").filter({ hasText: "Ready to launch" });
    await expect(rail.locator("li", { hasText: "Rounds & formats" }), "the Rounds step is still open for later weeks").toContainText(/Done/i);

    // The CONTROL: the same rounds with everyone in every round are a three-round medal.
    await prisma.event.update({ where: { id: f.eventId }, data: { attendanceMode: "everyone" } });
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: null,
      setup: { ready: true, done: 3, of: 5, optional: ["Rounds & formats", "Flights"] },
      journey: "Launch",
    });
    await prisma.event.update({ where: { id: f.eventId }, data: { attendanceMode: "opt-out" } });

    // The launch dialog names the later weeks — never "some rounds" — and launching is not held.
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await page.getByRole("button", { name: "Launch tournament" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("region", { name: "Still open" })).toContainText(
      "Round 2 and Round 3 have no day or deadline yet. Only the next week needs one now; give the others theirs as the season goes.",
      { timeout: 15_000 },
    );
    await dialog.getByRole("button", { name: "Launch tournament" }).click();
    await expect.poll(f.status, { timeout: 20_000, message: "the press did not launch it" }).toBe("live");

    // Week 1 played and closed: the next week has no day, so setting it is the next thing to do.
    await cardsIn(f, f.stageIds[0]);
    await prisma.stage.update({ where: { id: f.stageIds[0] }, data: { closedAt: new Date() } });
    await expectTournamentSays(page, { chip: "Live", nextAction: "Set Round 2’s day", refused: null, setup: null });
    await expect(
      page.locator(".card").filter({ has: page.locator(".card-kicker", { hasText: "Tournament status" }) }).getByRole("link", { name: "Set Round 2’s day" }),
    ).toHaveAttribute("href", "/stages");
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
