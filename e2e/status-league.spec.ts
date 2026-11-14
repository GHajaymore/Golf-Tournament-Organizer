import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, cardsIn, dayFromNow, prisma } from "./status-fixture";
import { pressComplete, pressReopen } from "./end-early";
import { END_EARLY } from "../src/lib/domain/lifecycle-track";

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
 * And on through the season (J13): launched with week 1 to play (live, Complete
 * refused), every week closed (Play over), completed, and reopened by the press —
 * with what Rounds & formats says is locked at each (`lock`).
 *
 * Its own throwaway club (`zz-status-league-*`), never the shared league
 * fixture, which every other league spec reads and none may write.
 */

test("a league needs only its next week dated, and a medal of the same rounds is not a league (J08)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(480_000);
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
      lock: "open",
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
      lock: "open",
      nextAction: "Launch tournament",
      refused: null,
      setup: { ready: true, done: 4, of: 5, optional: ["Flights"] },
      home: { text: "ready to launch", action: "Launch tournament" },
      journey: "Launch",
    });
    const rail = page.locator(".card").filter({ hasText: "Ready to launch" });
    await expect(rail.locator("li", { hasText: "Rounds & formats" }), "the Rounds step is still open for later weeks").toContainText(/Done/i);

    // The CONTROL: the same rounds with everyone in every round are a three-round medal.
    await prisma.event.update({ where: { id: f.eventId }, data: { attendanceMode: "everyone" } });
    await expectTournamentSays(page, {
      chip: "Setting up",
      lock: "open",
      nextAction: "Launch tournament",
      refused: null,
      setup: { ready: true, done: 3, of: 5, optional: ["Rounds & formats", "Flights"] },
      home: { text: "ready to launch", action: "Launch tournament" },
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

    // Launched, week 1 still to play (J13): live, locked by the launch, and nothing to complete yet.
    await expectTournamentSays(page, {
      chip: "Live",
      lock: "live",
      chipDetail: null,
      nextAction: END_EARLY,
      refused: { because: "Nothing has been scored yet", wayOut: { says: "Open Score entry", href: "/entry" } },
      home: null,
    });

    // Week 1 played and closed: the next week has no day, so setting it is the next thing to do.
    await cardsIn(f, f.stageIds[0]);
    await prisma.stage.update({ where: { id: f.stageIds[0] }, data: { closedAt: new Date() } });
    await expectTournamentSays(page, { chip: "Live", lock: "live", nextAction: "Set Round 2’s day", refused: null, setup: null });
    // `setup: null` ends that helper on Tournament details (it checks the rail is gone), so the
    // status card's link is read back on the dashboard, where the card is drawn. The card presses the
    // tournament's one job (`tournamentJob`, B03), which opens the round concerned on Rounds & formats.
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await expect(
      page.locator(".card").filter({ has: page.locator(".card-kicker", { hasText: "Tournament status" }) }).getByRole("link", { name: "Set Round 2’s day" }),
    ).toHaveAttribute("href", `/stages?round=${f.stageIds[1]}`);

    // THE REST OF THE SEASON (J13): weeks 2 and 3 given their days, played and closed — every
    // week closed is a league's play over, and Complete is the button.
    for (const [i, days] of [[1, 14], [2, 21]] as const) {
      await prisma.stage.update({ where: { id: f.stageIds[i] }, data: { playedOn: dayFromNow(days) } });
      await cardsIn(f, f.stageIds[i]);
      await prisma.stage.update({ where: { id: f.stageIds[i] }, data: { closedAt: new Date() } });
    }
    const over = {
      chip: "Play over",
      lock: "live",
      chipDetail: "Every round closed · results not released",
      home: { text: "Every round closed · results not released", action: "Complete tournament" },
      nextAction: "Complete tournament",
      refused: null,
    } as const;
    await expectTournamentSays(page, over);

    // Completed, then reopened by the press: the weeks are still closed, so play is over again.
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await pressComplete(page);
    await page.getByRole("alertdialog").getByRole("button", { name: /^(Complete tournament|Complete it)$/ }).click();
    await expect.poll(f.status, { timeout: 20_000, message: "Complete did not complete it" }).toBe("completed");
    await expectTournamentSays(page, { chip: "Completed", lock: "completed", chipDetail: null, nextAction: "Reopen tournament", refused: null, home: null });
    await pressReopen(page);
    await expect.poll(f.status, { timeout: 20_000, message: "Reopen did not reopen it" }).toBe("live");
    await expectTournamentSays(page, over);
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
