import { test, expect } from "./coverage";
import { ScoreEntryPage } from "./console/scoreEntry";
import { statusCard } from "./end-early";
import { consoleUrl } from "../src/lib/console-url";
import { prisma, makeClub, dropClub, makeEvent, returnCard, signIn, dayIn } from "./rounds-fixture";

/**
 * CLOSING A ROUND FROM THE DASHBOARD'S STATUS CARD, WHILE SCORE ENTRY IS SHOWN (B106, from the PE re-check of R12). The card's
 * "Close Round 1" used to open Rounds & formats, where the redesigned screen no longer draws the tick. While Score entry is
 * shown the card sends the secretary to Score entry's "Close Round 1" section at the same round, in the same preview; with it
 * not shown, the card still opens Rounds & formats (`lifecycle-stepper.spec.ts`, the control). Walked as the secretary does:
 * every card is in, press the card's link, tick the round finished there, and see the dashboard again on a fresh load.
 *
 * One club, `zz-rd-card-close`, with invented names and `@example.invalid` addresses, dropped afterwards. The club has its own
 * zone, read from the fixture. Service workers blocked. Memory: one browser context and one page, about 150 MB.
 */

const MARK = "zz-rd-card-close";
const ZONE = "UTC";

const closedAt = async (id: string) => (await prisma.stage.findUniqueOrThrow({ where: { id }, select: { closedAt: true } })).closedAt;

test.describe("@redesign the status card closes a round on Score entry", () => {
  let eventId: string;
  let stageId: string;
  let club: Awaited<ReturnType<typeof makeClub>>;

  test.beforeAll(async () => {
    await dropClub(MARK);
    club = await makeClub(MARK, { timeZone: ZONE });
    const made = await makeEvent(club, "Monthly Medal", { status: "live", stages: [{ playedOn: dayIn(ZONE) }], players: 4 });
    eventId = made.event.id;
    stageId = made.stages[0].id;
    // Every card is in and approved, so the card's one job is to close the round.
    for (const p of made.players) await returnCard(eventId, stageId, p.id);
    await prisma.scorecard.updateMany({ where: { stageId }, data: { status: "approved", approvedBy: "zz", approvedAt: new Date() } });
  });
  test.afterAll(async () => {
    await dropClub(MARK);
  });

  test("the card's Close Round 1 opens Score entry at that round, the tick closes it, and the dashboard reads it closed after a reload", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    const context = await browser.newContext({ ...testInfo.project.use, baseURL: baseURL!, serviceWorkers: "block" });
    try {
      await signIn(context, baseURL!, club, eventId);
      const page = await context.newPage();
      await page.goto(consoleUrl("/dashboard", "build"));
      const press = statusCard(page).getByRole("link", { name: /Close Round 1/ });
      await expect(press).toBeVisible();
      // Where the press leads is read from the page, never assumed: Score entry, at this round, inside the preview.
      await expect(press).toHaveAttribute("href", new RegExp(`^/entry\\?.*round=${stageId}`));
      await expect(press).toHaveAttribute("href", /build=1/);
      expect(await closedAt(stageId)).toBeNull();

      await press.click();
      const screen = new ScoreEntryPage(page);
      await page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      expect(new URL(page.url()).searchParams.get("round"), "the press opened another round").toBe(stageId);
      const section = await screen.openClose();
      await expect(screen.finishedTick(section)).not.toBeChecked();
      await screen.finishedTick(section).click();
      await expect(screen.finishedTick(section)).toBeChecked();
      await expect.poll(() => closedAt(stageId), { message: "the tick did not close the round" }).not.toBeNull();

      // Seen again on a fresh load: the round reads closed, and the dashboard's card no longer offers to close it.
      await page.reload();
      await page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      await expect(screen.closeLine()).toContainText("is closed");
      await page.goto(consoleUrl("/dashboard", "build"));
      await expect(statusCard(page)).toBeVisible();
      await expect(statusCard(page).getByRole("link", { name: /Close Round 1/ })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
