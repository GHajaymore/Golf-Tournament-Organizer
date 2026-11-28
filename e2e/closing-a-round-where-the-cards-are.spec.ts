import { test, expect } from "./coverage";
import { seedScoreEntryDay, dropScoreEntryDay, withScoreEntry, finishPlay, type ScoreEntryDay } from "./console/scoreEntry";
import { ResultsPage } from "./console/results";
import { statusCard } from "./end-early";
import { prisma } from "./rounds-fixture";

/**
 * @redesign: CLOSING A ROUND WHERE THE CARDS ARE (R12). On the redesigned Score entry the round's close section holds the cards
 * still to come (each with the two answers, No card returned and Withdrew), the tick that closes the round and the scoring window.
 * Every press here writes and is then seen after a RELOAD, on a fresh load of the same screen:
 *
 *   - the tick closes Round 1 with a player's card missing, and the round reads closed afterwards;
 *   - Withdrew (asked twice) takes the player off the list, kept after a reload;
 *   - the scoring window: a play-by date of yesterday AT THE CLUB reads Closed whatever the server's own day is, and Keep it open
 *     is kept.
 *
 * THE WINDOW IS A CLUB DAY, so the club is in Pacific/Auckland (the zone furthest from the server's), its days are asked of
 * that zone (`dayIn`), and no spec here reads the machine's own day. The fixture says who returned a card and who did not
 * (`returned`, `missing`), approved so closing does not stop to ask. Service workers blocked (a save spec's rule). Memory: one
 * browser context and one page at a time, about 150 MB.
 */
const MARK = "zz-rd-closing";
const ZONE = "Pacific/Auckland";

test.describe("@redesign closing a round where the cards are", () => {
  test.describe.configure({ mode: "serial" });
  // The browser is in the club's zone too, as E2E_TZ puts it: the window is a club day, whatever day the machine is on.
  test.use({ timezoneId: ZONE });
  let day: ScoreEntryDay;
  test.beforeEach(async () => {
    day = await seedScoreEntryDay(MARK, ZONE);
  });
  test.afterAll(async () => {
    await dropScoreEntryDay(MARK);
  });

  test("the round is closed with a card missing, and reads closed after a reload", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await withScoreEntry(browser, baseURL!, testInfo, day, async (screen, page) => {
      const section = await screen.openClose();
      // The fixture's missing player is listed with the board's own answer, and the players who returned a card are not.
      const line = screen.missingLine(section, day.missing.id);
      await expect(line).toContainText(day.missing.name);
      await expect(line).toContainText("No card returned: Round 1");
      for (const p of day.returned) await expect(screen.missingLine(section, p.id)).toHaveCount(0);

      await screen.finishedTick(section).click();
      // The tick is the server's answer: it is drawn from the stored round, so it holds only once the close is kept.
      await expect(screen.finishedTick(section)).toBeChecked();

      await page.reload();
      await page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      await expect(screen.closeLine()).toContainText("Round 1 is closed");
      const again = await screen.openClose();
      await expect(screen.finishedTick(again)).toBeChecked();
      await expect(screen.missingLine(again, day.missing.id)).toHaveCount(0);
    });
  });

  test("Withdrew asks twice, takes the player off the list, and is kept after a reload", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await withScoreEntry(browser, baseURL!, testInfo, day, async (screen, page) => {
      const section = await screen.openClose();
      const line = screen.missingLine(section, day.missing.id);
      await line.getByRole("button", { name: "Withdrew" }).click();
      // The first press only arms it: the line is still there, with the other half of the pair.
      await expect(line).toBeVisible();
      await line.getByRole("button", { name: `Yes, ${day.missing.name} withdrew` }).click();
      await expect(screen.missingLine(section, day.missing.id)).toHaveCount(0);

      await page.reload();
      await page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      await expect(screen.closeLine()).toContainText("Cards are in");
      const again = await screen.openClose();
      await expect(screen.missingLine(again, day.missing.id)).toHaveCount(0);
      await expect(again).not.toContainText(day.missing.name);
    });
  });

  test("a play-by date of yesterday at the club reads Closed, and Keep it open is kept after a reload", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await withScoreEntry(browser, baseURL!, testInfo, day, async (screen, page) => {
      const section = await screen.openClose();
      // The fixture's own words: Round 1's play-by date is yesterday in the club's zone, so the window is shut by the date.
      await expect(section).toContainText("Closed — the deadline has passed");
      await section.getByRole("button", { name: "Keep it open" }).click();
      // The label is drawn at once from the press (RoundDeadlineControl sets its own state first), so the screen cannot say the
      // save is kept: the stored override can. `false` is "extended past the date" (setStageDeadlineOverride, tournament.ts).
      await expect
        .poll(async () => (await prisma.stage.findUniqueOrThrow({ where: { id: day.round1 }, select: { deadlineOverride: true } })).deadlineOverride, {
          message: "Keep it open was not stored before the reload",
          timeout: 20_000,
        })
        .toBe(false);

      await page.reload();
      await page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      const again = await screen.openClose();
      await expect(again).toContainText("Extended past the deadline");
      await expect(again.getByRole("button", { name: "Keep it open" })).toBeDisabled();
    });
  });

  test("with play over, Results offers the one verb, the press completes it, and Results reads final after a reload", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    await finishPlay(day);
    await withScoreEntry(browser, baseURL!, testInfo, day, async (_screen, page) => {
      const results = new ResultsPage(page);
      await results.open();
      await expect(results.releaseCard()).toHaveAttribute("data-release-results", "ready");
      // The verb is the machine's own label, the one the Dashboard's button carries.
      await results.releaseVerb().click();
      await page.waitForURL(/\/dashboard/);
      await statusCard(page).getByRole("button", { name: "Make results final" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Make results final" }).click();
      await expect.poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: day.eventId }, select: { status: true } })).status, { timeout: 30_000 }).toBe("completed");

      await results.open();
      await page.reload();
      await expect(results.releaseCard()).toHaveAttribute("data-release-results", "final");
      await expect(results.releaseCard()).toContainText("The results are final");
    });
  });
});
