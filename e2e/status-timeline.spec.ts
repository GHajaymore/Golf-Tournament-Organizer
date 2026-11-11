import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, cardsIn, dayFromNow, prisma } from "./status-fixture";
import { END_EARLY } from "../src/lib/domain/lifecycle-track";

/**
 * THE "COURSE DAY" TIMELINE SAYS WHAT THE DASHBOARD SAYS, AT EVERY STEP (state machine PR 5c, J16).
 *
 * Owner ruling, 3 Nov: no redesigned screen is switched on until it reads the machine. Rounds &
 * formats as a timeline (`/stages?view=timeline`, switch OFF — Ajay previews it first) draws the
 * machine's chip above the rounds and leads its "Needs you" strip with the machine's one next
 * action. This walks a medal through every step and, at each, asks the dashboard's status card,
 * the context bar AND the timeline the same question (`expectTournamentSays` with `timeline`):
 *
 *   setting up, no dates   Launch refused in place, the reason and the way out to Tournament details
 *   setting up, dated      Launch offered; the round's own line asks for its tee times
 *   live, nothing scored   Complete refused, with the way out to Score entry
 *   play over              "Play over · Every round closed · results not released", Complete offered
 *   completed              the chip; the strip leads with nothing (Reopen is a remedy, not a need)
 *
 * and, in a second club, a tournament whose dates went by unlaunched: still "Setting up" on both,
 * and the machine's own "dates have passed" warning is a line in the strip.
 *
 * WHAT IT CANNOT SEE: the cards are written as rows (approved), not typed — `organizer-medal.spec.ts`
 * types them; the other eight families are held to the dashboard by `timeline-step.test.ts`, family
 * by family, and their own `status-*.spec.ts` walk the dashboard.
 */

test("the timeline says what the dashboard says, at every step of a medal (J16)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "timeline",
    rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }],
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);

    // No dates: Launch is refused on the dashboard AND at the head of the timeline's strip, in the same words.
    await expectTournamentSays(page, {
      chip: "Setting up",
      lock: "open",
      chipDetail: null,
      nextAction: "Launch tournament",
      refused: { because: "This tournament has no dates, so nobody can plan around it.", wayOut: { says: "Open Tournament details", href: "/event" } },
      timeline: true,
    });
    // The refusal is the lead, so the Tournament details step is not said a second time below it.
    const needs = page.getByRole("region", { name: /Needs you/ });
    await expect(needs.locator(".rt-need-rest .rt-need-words").filter({ hasText: /^Tournament details/ })).toHaveCount(0);
    // The one round is not told it has no date: a one-round tournament's day is its dates (D7).
    await expect(needs, "a one-round medal is told its round has no date").not.toContainText("Round 1 has no date");
    // And the round's chip names its first need — the same need its line in the strip names.
    await expect(page.locator(`[id="round-${f.stageIds[0]}"] .tag`).first()).toHaveText("No tee times");
    await expect(needs.locator(".rt-need-words").filter({ hasText: "Round 1 has no tee times" })).toHaveCount(1);
    expect(await f.status(), "reading the timeline changed the tournament").toBe("draft");

    // Dated: Launch is offered on both.
    const day = dayFromNow(10);
    await prisma.event.update({ where: { id: f.eventId }, data: { dates: "Saturday medal", startOn: day, endOn: day } });
    await expectTournamentSays(page, { chip: "Setting up", lock: "open", nextAction: "Launch tournament", refused: null, timeline: true });
    await expect(page.locator(".rt-need-next").getByRole("link", { name: "Launch tournament" })).toHaveAttribute("href", "/dashboard");

    // Launched, nothing scored: Complete refused in place on both, with the way out to Score entry.
    await prisma.event.update({ where: { id: f.eventId }, data: { status: "live", launchedAt: new Date(), configUnlocked: false } });
    await expectTournamentSays(page, {
      chip: "Live",
      lock: "live",
      chipDetail: null,
      nextAction: END_EARLY,
      refused: { because: "Nothing has been scored yet", wayOut: { says: "Open Score entry", href: "/entry" } },
      timeline: true,
    });
    // D8: the round has nothing in, so it is not "In play", whatever its day.
    await expect(page.locator(`[id="round-${f.stageIds[0]}"] .tag`).first()).not.toHaveText("In play");

    // Every card in, the round closed: Play over on both, Complete offered.
    await cardsIn(f, f.stageIds[0]);
    await prisma.stage.update({ where: { id: f.stageIds[0] }, data: { closedAt: new Date() } });
    await expectTournamentSays(page, {
      chip: "Play over",
      lock: "live",
      chipDetail: "Every round closed · results not released",
      nextAction: "Complete tournament",
      refused: null,
      timeline: true,
    });
    await expect(page.locator(`[id="round-${f.stageIds[0]}"] .tag`).first()).toHaveText("Played");

    // Completed: the chip on both; the timeline leads with nothing.
    await prisma.event.update({ where: { id: f.eventId }, data: { status: "completed" } });
    await expectTournamentSays(page, { chip: "Completed", lock: "completed", chipDetail: null, nextAction: "Reopen tournament", refused: null, timeline: true });
    expect(errors).toEqual([]);
  } finally {
    await f.done();
  }
});

test("dates passed and never launched: Setting up on both, and the warning is in the strip", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const past = dayFromNow(-20);
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "timeline-passed",
    event: { dates: "An old medal", startOn: past, endOn: past },
    rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }],
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);
    await expectTournamentSays(page, { chip: "Setting up", lock: "open", nextAction: "Launch tournament", refused: null, timeline: true });
    const needs = page.getByRole("region", { name: /Needs you/ });
    await expect(needs, "the machine's dates-passed warning is not in the strip").toContainText("Its dates have passed and it was never launched.");
    await expect(needs.getByRole("link", { name: /Launch it or change its dates/ })).toHaveAttribute("href", "/event");
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
