import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { seedTeeTimesDay, dropTeeTimesDay, withTeeTimes, type TeeTimesDay } from "./console/teeTimes";

/**
 * FIND A PLAYER, AS THE STARTER ON A PHONE (R9a). On the day a player asks "where do I go?" and the
 * secretary at the desk has a phone in her hand: one press and the name, the answer under the box, above
 * the keyboard. Four of the seven states are pressed here, as the person who would:
 *
 *   a name on a published sheet   → a row "Name · Round 1 · Group 1 · 8:00 · Tee 1", of 48px or more; pressing it opens that round
 *   entered, on no published sheet→ says so, and offers the round whose sheet is not out
 *   a player who withdrew         → "… withdrew." and a way to Entries (not a stale name on the sheet)
 *   nobody by that name           → says the name typed, and a way to Entries
 *
 * The one-letter and many-rows states are worked in `find-a-player.test.ts`. The fixture is read, never
 * assumed: the names, the groups and the times come from `seedTeeTimesDay`.
 *
 * Service workers blocked (the save specs' rule). Memory: one browser context and one page, about 150 MB.
 */

const MARK = "zz-findaplayer";
let day: TeeTimesDay;

test.beforeAll(async () => {
  day = await seedTeeTimesDay(MARK);
});
test.afterAll(async () => {
  await dropTeeTimesDay(MARK);
});

test("the secretary finds where a player goes, who is not on a sheet yet, who withdrew, and who nobody has", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await withTeeTimes(
    browser,
    baseURL!,
    testInfo,
    day,
    async (screen, page) => {
      watchPageErrors(page, errors, "secretary");
      const box = screen.findBox();
      const answer = screen.findAnswer();
      const first = day.placed[0].name;

      await test.step("a name on a published sheet gives its row, tall enough to press, and pressing it opens that round", async () => {
        await box.fill(first);
        const row = answer.getByRole("link").filter({ hasText: `${first} · Round 1 · Group 1 · 8:00 · Tee 1` });
        await expect(row).toBeVisible();
        expect((await row.boundingBox())?.height ?? 0, "the row is shorter than 48px").toBeGreaterThanOrEqual(47.5);
        await row.click();
        await expect(page).toHaveURL(new RegExp(`round=${day.round1}`));
        await expect(page).toHaveURL(/#group-1$/);
        // It opens AT the group: the card with that anchor is on the page, and it holds the player.
        await expect(page.locator("#group-1")).toContainText(first);
        await expect(page).toHaveURL(/stepper=1/);
        await expect(page.getByRole("heading", { level: 1, name: "Tee times & draw" })).toBeVisible();
      });

      await test.step("a player entered but on no published sheet is told so, with the sheet to open", async () => {
        await box.fill(day.unplaced.name);
        await expect(answer.getByText(`${day.unplaced.name} is entered but not on a published sheet yet.`)).toBeVisible();
        await expect(answer.getByRole("link", { name: /^Open Round 2.s sheet$/ })).toBeVisible();
      });

      await test.step("a player who withdrew is said to have withdrawn, with a way to Entries", async () => {
        await box.fill(day.withdrew.name);
        await expect(answer.getByText(`${day.withdrew.name} withdrew.`)).toBeVisible();
        await expect(answer.getByRole("link", { name: "See Entries" })).toBeVisible();
      });

      await test.step("a name nobody has says the name typed, and goes to Entries", async () => {
        await box.fill("Zzyzx");
        await expect(answer.getByText("Nobody called ‘Zzyzx’ is in this event.")).toBeVisible();
        await expect(answer.getByRole("link", { name: "See Entries" })).toBeVisible();
      });
    },
    { width: 375, height: 812 },
  );
  expect(errors, "the screen threw while a name was typed").toEqual([]);
});
