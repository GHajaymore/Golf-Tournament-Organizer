import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, cardsIn, dayFromNow, prisma } from "./status-fixture";
import { expectRoundDoors, expectScopeLock, expectTeesDoor, LOCKED_LIVE } from "./expect-tournament-locks";
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
 * AND ON FROM LAUNCH (J13; the rules of state machine PR 5b, 7a and 7b, which no
 * family walk had met), at a course with two rated sets:
 *
 *   launched, no card      The field "Locked because the tournament is live.", the way
 *                          out the committee correction; Round 1's format, holes, venue
 *                          and tees all OPEN — launch shuts none of them
 *   a late entrant         added on Entries with no flight: taken, and FLAGGED by name
 *                          beside the one already in no flight (J04, 7a)
 *   the first card         Round 1's format and holes shut on Rounds & formats, its venue
 *                          and tees shut on Score entry, each with the rounds rule's
 *                          sentence; late entries closed, the way out the Organizer's
 *                          committee correction to the field
 *   every card, closed     Play over · Every round closed · results not released
 *
 * WHAT IT CANNOT SEE: completing and reopening, walked in `status-stroke.spec.ts`
 * (a Stableford completes on the same rule); the late entrant PLACED in a flight
 * (`day-of-field-changes.spec.ts`); a tee change stored on an unscored round
 * (`tees-shut-once-frozen.spec.ts`).
 */

/** Invented, like every name here. */
const LATE = "Idris Calloway";
/** The rounds rule's sentences for a Stableford round with a card in (`round-change.ts`), written out. */
const FORMAT_SHUT = "Round 1 was scored as Stableford; its cards would mean something else. Clear its scores on Score entry first.";
const HOLES_SHUT = "Round 1 has scores; at another length its cards would mean something else. Clear its scores on Score entry first.";
const TEES_FROZEN = "Round 1’s handicaps were frozen off its tees at its first card. Clear Round 1’s scores on Score entry first.";
const LATE_CLOSED =
  "The first card of Round 1 is in, so late entries are closed. To add someone anyway, an Organizer can make a committee correction to the field on the dashboard.";

test("a Stableford says the same thing on every panel through setup and launch (D1, D4, J04)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(480_000);
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

    // ── launched, no card: the field is locked by the launch, the round's own settings are not ──
    // A second rated set at the fixture's course, so Score entry draws a Tees box to be open or shut.
    // Read from the fixture, never assumed: the course the round is played on, and its one set.
    const round1 = f.stageIds[0];
    const { courseId } = await prisma.stage.findUniqueOrThrow({ where: { id: round1 }, select: { courseId: true } });
    expect(courseId, "the fixture's net round has no course").toBeTruthy();
    expect(await prisma.tee.count({ where: { courseId: courseId! } }), "the fixture's course has not one set").toBe(1);
    await prisma.tee.create({ data: { courseId: courseId!, name: "White", gender: "any", courseRating: 69.8, slopeRating: 119, par: 72, position: 1 } });
    await expectTeesDoor(page, round1, null);
    await expectRoundDoors(page, round1, "Round 1", { format: null, holes: null });
    await expectScopeLock(page, "/registration", { scope: "The field", because: LOCKED_LIVE, wayOut: "correction" });

    // ── a late entrant after the flights are made: taken, and flagged in no flight (J04, PR 7a) ──
    const entries = async () => {
      await page.goto(`/registration?bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.getByRole("heading", { name: "Entries" })).toBeVisible();
    };
    // The one the walk left out of the flight, by the name the fixture gave them.
    const leftOut = (await prisma.player.findUniqueOrThrow({ where: { id: f.playerIds[5] }, select: { name: true, groupId: true } }));
    expect(leftOut.groupId, "the fixture's sixth player is in a flight").toBeNull();
    const flag = page.getByTestId("unplaced-flag");
    await expect(flag).toHaveText(new RegExp(`${leftOut.name} is in the field but in no flight\\. Put them in one\\.$`));
    await expect(page.getByText("You can withdraw a player, put one back or add a late entry.", { exact: false }).first()).toBeVisible();
    await page.getByLabel("Player name").fill(LATE);
    // The Add form's own box ("Email · …"), not a row's "Email for …".
    await page.getByLabel(/^Email ·/).fill(`${f.mark}-late@example.invalid`);
    // A flight is OFFERED, never forced, in a Stableford (panel Q3): left at none.
    await expect(page.getByLabel("Flight · optional")).toHaveValue("");
    await page.getByRole("button", { name: "Add late entry" }).click();
    await expect
      .poll(async () => (await prisma.player.findFirst({ where: { eventId: f.eventId, name: LATE }, select: { status: true, groupId: true } })) ?? null, {
        timeout: 20_000,
        message: "the late entry was not taken",
      })
      .toEqual({ status: "confirmed", groupId: null });
    await expect(page.getByRole("status").filter({ hasText: `${LATE} is in the field but in no flight. Put them in one.` })).toBeVisible({ timeout: 20_000 });
    // And for as long as it is true: both of them, by name, on Entries.
    await entries();
    await expect(flag).toContainText(LATE);
    await expect(flag).toContainText(leftOut.name);
    await expect(flag).toContainText("are in the field but in no flight. Put each in one.");
    // Still live, still nothing scored: a late entrant is not a step.
    expect(await f.status()).toBe("live");

    // ── the round's first card: its format, holes, venue and tees shut, each with the reason (PR 7b) ──
    await cardsIn(f, round1, f.playerIds.slice(0, 1));
    await expectTournamentSays(page, { chip: "Live", chipDetail: null, nextAction: END_EARLY, refused: null, setup: null, journey: "Play" });
    await expectRoundDoors(page, round1, "Round 1", { format: FORMAT_SHUT, holes: HOLES_SHUT });
    await expectTeesDoor(page, round1, TEES_FROZEN);
    // Late entries close at the first card (no sheet is published), and the way out is the correction.
    await entries();
    await expect(page.getByRole("button", { name: "Add late entry" }), "a late entry is offered after the first card").toBeDisabled();
    await expect(page.getByText(LATE_CLOSED, { exact: false }).first()).toBeVisible();

    // ── every card in (the late entrant's too) and the round closed: play over ──
    const others = await prisma.player.findMany({ where: { eventId: f.eventId, status: "confirmed", id: { not: f.playerIds[0] } }, select: { id: true } });
    expect(others.length, "the field is not the six and the late entrant").toBe(6);
    await cardsIn(f, round1, others.map((p) => p.id));
    await prisma.stage.update({ where: { id: round1 }, data: { closedAt: new Date() } });
    await expectTournamentSays(page, {
      chip: "Play over",
      chipDetail: "Every round closed · results not released",
      nextAction: "Complete tournament",
      refused: null,
      setup: null,
      journey: "Play",
    });
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
