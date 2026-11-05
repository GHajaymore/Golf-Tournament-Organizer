import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { statusFixture, cardsIn, prisma } from "./status-fixture";

/**
 * A CASUAL ROUND, AS THE STATE MACHINE TREATS IT (J13; the casual family).
 *
 * A round among friends is created live, in one step, with its setup open. It
 * is never launched, never completed and never reopened — it is kept or
 * deleted — so the machine gives it NO next action, no setup rail, no lock and
 * no "play over", however many cards come in and whether or not the round is
 * closed. The organizer's dashboard is the scoring screen: `/dashboard` sends a
 * casual round to `/entry`.
 *
 * So the browser walks the stages that could tempt the app into offering a
 * lifecycle button — just created, a card in, the round closed — and at each
 * asserts (1) the dashboard lands on Score entry, (2) no Launch, Complete or
 * Reopen button is drawn on it or on Tournament details, and (3) no setup rail
 * ("Ready to launch", "N of M done") is offered.
 *
 * WHAT IT CANNOT SEE: the play of a casual round (`casual-round.spec.ts`), and
 * the machine's own answer for it, held in `tournament-status-by-family.test.ts`
 * (no next action, nothing locked, live for ever).
 *
 * Its own throwaway club (`zz-status-casual-*`), deleted in `finally`.
 */

const LIFECYCLE_BUTTON = /^(Launch|Complete|Reopen) tournament/;

test("a casual round is never offered Launch, Complete or Reopen, at any stage (J13)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "casual",
    players: 4,
    event: { shape: "match", status: "live", configUnlocked: true },
    rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }],
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);

    const expectNoLifecycle = async (stage: string) => {
      await page.goto(`/dashboard?bust=${Date.now()}`);
      await expect(page, `${stage}: the dashboard did not send a casual round to Score entry`).toHaveURL(/\/entry/, { timeout: 30_000 });
      await expect(page.getByRole("button", { name: LIFECYCLE_BUTTON }), `${stage}: a lifecycle button on Score entry`).toHaveCount(0);
      await expect(page.getByRole("link", { name: LIFECYCLE_BUTTON }), `${stage}: a lifecycle link on Score entry`).toHaveCount(0);
      await page.goto(`/event?bust=${Date.now()}`);
      await expect(page.locator("main"), `${stage}: Tournament details offers launching`).not.toContainText("Ready to launch");
      await expect(page.getByRole("button", { name: LIFECYCLE_BUTTON }), `${stage}: a lifecycle button on Tournament details`).toHaveCount(0);
      expect(await f.status(), `${stage}: something changed the casual round's status`).toBe("live");
    };

    await expectNoLifecycle("just created");

    // A card in, approved: still a round being played, still nothing to press.
    await cardsIn(f, f.stageIds[0]);
    await expectNoLifecycle("a card in");

    // The round closed: there is no result to release, so still no Complete.
    await prisma.stage.update({ where: { id: f.stageIds[0] }, data: { closedAt: new Date() } });
    await expectNoLifecycle("the round closed");
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
