import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import {
  prisma,
  makeClub,
  dropClub,
  makeEvent,
  signIn,
  gotoStages,
  openRound,
  openCustomize,
  saidBeside,
  centre,
  addDays,
  dayIn,
} from "./rounds-fixture";

/**
 * TWO PRESSES THAT ANSWER NOTHING (2026-10-21).
 *
 * `setStageDeadline` — the day a round's cards are due, on Rounds & formats —
 * and `setPreviewAction` — "Viewing as", the organizer's look at their own
 * tournament as an assistant or a player sees it. Neither action returns
 * anything, so neither can ever say no.
 *
 *   Cards in by, on a round that is there   → stored (the control)
 *   Cards in by, on a round deleted from another tab
 *                                            → THE RIGHT BEHAVIOUR, ASSERTED:
 *                                              the box says, beside itself, that
 *                                              the date was not saved. It cannot
 *                                              today: `setStageDeadline` writes
 *                                              with `updateMany`, matches no row,
 *                                              and returns nothing, so the screen
 *                                              shows a date nothing holds.
 *   Viewing as: Player                       → the preview is held (its cookie),
 *                                              the console's organizer screens
 *                                              leave the menu and their address
 *                                              does not open them, after a reload;
 *                                              the switch is still there to undo it
 *   Viewing as: Organizer                    → all of it back
 *
 * WHAT IT CANNOT SEE: an assistant's own view (no "Viewing as" is drawn for
 * one, and the preview only ever narrows a real organizer — `getSession`
 * honours it for an admin and nobody else, which `audit-guards.test.ts` pins).
 */

const WALKED = ["desktop", "phone"];
const markFor = (what: string, project: string) => `zz-rdv-${what}-${project}`;

test.describe.configure({ timeout: 150_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-rdv-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

test("Cards in by is stored on a round that is there, and says so beside the box when the round has gone", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("due", testInfo.project.name);
  const club = await makeClub(mark);
  const today = dayIn("");
  try {
    const { event, stages } = await makeEvent(club, "Autumn Medals", { stages: [{}, {}] });
    await signIn(context, baseURL!, club, event.id);

    await test.step("the control: a date on a round that is there is stored", async () => {
      await gotoStages(page);
      const card = await openRound(page, stages[0].id);
      await openCustomize(card);
      await card.getByLabel("Cards in by").fill(addDays(today, 7));
      await expect
        .poll(async () => (await prisma.stage.findUniqueOrThrow({ where: { id: stages[0].id } })).deadline, { message: "the day cards are due was not stored" })
        .toBe(addDays(today, 7));
    });

    await test.step("the round deleted from another tab: the box says the date was not saved", async () => {
      await gotoStages(page);
      const card = await openRound(page, stages[1].id);
      await openCustomize(card);
      const due = card.getByLabel("Cards in by");
      await centre(due);
      // Somebody else, in another tab, removes this round while it is open here.
      await prisma.stage.delete({ where: { id: stages[1].id } });
      await due.fill(addDays(today, 14));
      expect(await prisma.stage.count({ where: { id: stages[1].id } }), "the round came back").toBe(0);
      const said = card.getByRole("alert");
      await expect(
        said,
        "a date for a round that no longer exists was taken without a word: setStageDeadline matched no row and said nothing",
      ).toBeVisible({ timeout: 10_000 });
      await saidBeside(said, due, "a date for a deleted round");
    });
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

/** The "Viewing as" switch on whichever chrome this width draws: the sidebar, or the menu drawer. */
async function viewingAs(page: Page) {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  const select = page.locator('select[aria-label="Viewing as"]:visible');
  await expect(select, "the organizer has no Viewing as switch").toBeVisible();
  return select;
}

/** Whether the menu this width draws offers Rounds & formats. */
async function offersRounds(page: Page): Promise<boolean> {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  const n = await page.locator('a[href="/stages"]:visible').count();
  if (await page.getByRole("button", { name: "Close menu" }).isVisible()) await page.getByRole("button", { name: "Close menu" }).click();
  return n > 0;
}

test("Viewing as a player takes the organizer screens away and keeps the switch to bring them back", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");
  const mark = markFor("view", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event } = await makeEvent(club, "Captain's Day", { stages: [{}] });
    await signIn(context, baseURL!, club, event.id);
    const open = async (path: string) => {
      await page.goto(`${path}?bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
    };
    const preview = async () => (await context.cookies()).find((c) => c.name === "ng_preview_player")?.value ?? null;

    await open("/dashboard");
    expect(await offersRounds(page), "an organizer is not offered Rounds & formats").toBe(true);

    await test.step("Viewing as Player: held, the organizer screens leave the menu and do not open, after a reload", async () => {
      await (await viewingAs(page)).selectOption("player");
      await expect.poll(preview, { message: "the preview was not held" }).toBe("player");
      await open("/dashboard");
      await expect(await viewingAs(page), "the switch does not say whose view this is").toHaveValue("player");
      await open("/dashboard");
      expect(await offersRounds(page), "a player's view still offers Rounds & formats").toBe(false);
      await open("/stages");
      expect(new URL(page.url()).pathname, "a player's view opened Rounds & formats by its address").not.toBe("/stages");
    });

    await test.step("Viewing as Organizer: all of it back", async () => {
      await open("/dashboard");
      await (await viewingAs(page)).selectOption("admin");
      await expect.poll(preview, { message: "the preview was not let go" }).toBeNull();
      await open("/dashboard");
      expect(await offersRounds(page), "Rounds & formats did not come back").toBe(true);
      await open("/stages");
      expect(new URL(page.url()).pathname).toBe("/stages");
    });
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
