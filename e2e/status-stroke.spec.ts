import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, cardsIn, dayFromNow, prisma } from "./status-fixture";

/**
 * A MEDAL, WALKED THROUGH EVERY STEP OF THE STATE MACHINE (PR 3; proposal 5c,
 * QA 8.4) — every panel asked the same question at every step, through
 * `expectTournamentSays`, as the organizer meets them.
 *
 * One Stroke Play round, six entered, the money answered, NO flights and NO
 * dates — a venue only. Two of the disagreements the machine settles:
 *
 *   D4  named, a venue, no dates: the details step used to tick ("a date or a
 *       venue") while Launch refused "no dates". Now the step holds, the rail
 *       points at it, and Launch is refused in place with the way out to
 *       Tournament details.
 *   D1  a medal with no flights: the rail, the checklist and the journey card
 *       used to say "No flights yet" and setup not done, while Launch worked.
 *       Now one field is a complete setup (Golf Pro, 8.2): Flights is marked
 *       "Optional" on the rail, nothing on the dashboard waits for it, and
 *       the journey says Launch.
 *
 * Then: launched (Complete refused — nothing scored — with the way out to
 * Score entry), every card in and the round closed (Play over · Every round
 * closed · results not released), completed, and Reopen offered.
 *
 * WHAT IT CANNOT SEE: the cards are written as rows (approved), not typed — the
 * typing is `organizer-medal.spec.ts`'s; and a late entrant, which is PR 7's.
 */

test("a medal says the same thing on every panel at every step (D1, D4)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "stroke",
    rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }],
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);

    // D4: a venue and no dates — the details step holds, and Launch is refused in place.
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: { because: "This tournament has no dates, so nobody can plan around it.", wayOut: { says: "Open Tournament details", href: "/event" } },
      setup: { holds: "Tournament details", done: 3, of: 5 },
      journey: "Set up",
    });
    expect(await f.status(), "refusing changed the tournament").toBe("draft");

    // The dates set. D1: nothing else holds — Flights is optional, never "No flights yet".
    const day = dayFromNow(10);
    await prisma.event.update({ where: { id: f.eventId }, data: { dates: "Saturday medal", startOn: day, endOn: day } });
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: null,
      setup: { ready: true, done: 4, of: 5, optional: ["Flights"] },
      journey: "Launch",
    });
    await expect(page.locator("main"), "Tournament details still says flights are missing").not.toContainText("No flights yet");
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await expect(page.locator("main"), "the dashboard still says flights are missing").not.toContainText("No flights yet");

    // Launch: the dialog lists the one field as a choice, not a gap — and the press launches.
    await page.getByRole("button", { name: "Launch tournament" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("region", { name: "Still open" })).toContainText("There are no flights, so the whole field plays as one division.", { timeout: 15_000 });
    await dialog.getByRole("button", { name: "Launch tournament" }).click();
    await expect.poll(f.status, { timeout: 20_000, message: "the press did not launch it" }).toBe("live");

    // Live, nothing scored: Complete is the button, refused in place with the way out.
    await expectTournamentSays(page, {
      chip: "Live",
      chipDetail: null,
      nextAction: "Complete tournament",
      refused: { because: "Nothing has been scored yet", wayOut: { says: "Open Score entry", href: "/entry" } },
      setup: null,
      journey: "Play",
    });

    // Every card in and approved, and the committee closes the round: Play over (2d).
    await cardsIn(f, f.stageIds[0]);
    await prisma.stage.update({ where: { id: f.stageIds[0] }, data: { closedAt: new Date() } });
    await expectTournamentSays(page, {
      chip: "Play over",
      chipDetail: "Every round closed · results not released",
      nextAction: "Complete tournament",
      refused: null,
      // The secretary's home offers the dashboard's own next action, in its words (PR 6).
      home: { text: "Every round closed · results not released", action: "Complete tournament" },
      setup: null,
      journey: "Play",
    });

    // Complete it (the free plan's keeping notice answered if the club is on it). On the
    // dashboard, where the status card draws the button: `setup: null` ended the helper on
    // Tournament details, which has no lifecycle button.
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await page.getByRole("button", { name: "Complete tournament" }).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: /^(Complete tournament|Complete it)$/ }).click();
    await expect.poll(f.status, { timeout: 20_000, message: "Complete did not complete it" }).toBe("completed");
    await expectTournamentSays(page, { chip: "Completed", chipDetail: null, nextAction: "Reopen tournament", refused: null, setup: null, journey: "Finish" });
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
