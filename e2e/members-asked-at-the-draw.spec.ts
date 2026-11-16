import { test, expect, type Page } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";

/**
 * EVENT-FIRST: THE MEMBERS LIST IS ASKED FOR WHERE IT IS USED (Cut A, Ajay 15 Nov 2026).
 *
 * A new club creates its first tournament straight after sign-up (the journeys J1 and J2 walk that,
 * in `secretary-first-event.spec.ts`). Its members list is never a step before it. It is asked for at
 * the DRAW, and offered on ENTRIES; whatever comes in lands on Members, so nothing is typed twice.
 * As the club's secretary meets it, on a first tournament with nobody entered and an empty list:
 *
 *   Tee sheet          → "The draw needs players: add your members", with Import members and
 *                        Add a player (to Entries)
 *   Import members     → a CSV of three members: "3 added"; they are on the club's Members
 *   the Tee sheet again→ no longer asks (the club has a list): the same card says to pick who is
 *                        playing on Entries, and the draw's own line still says the field is empty
 *   Entries, the list emptied again
 *                      → "Add from the club roster" offers Import members; two imported there are
 *                        at once in the list to tick, and on Members
 *
 * Desktop only: a secretary sets a draw up at a desk; the layout sweeps measure the screens at
 * every size. Invented names, `@example.invalid`, a `zz-` club deleted in a `finally`. Memory: one
 * browser context and one page, about 150 MB.
 *
 * WHAT IT CANNOT SEE: a club whose list is imported on the Members screen itself (`members.spec.ts`).
 */

const MARK = "zz-askdraw";
let club: Club;
let eventId = "";

const csv = (rows: Array<[string, string]>) =>
  ["name,email,handicap", ...rows.map(([name, tag], i) => `${name},${MARK}-${tag}@example.invalid,${(8 + i * 3.5).toFixed(1)}`)].join("\n");

/** Presses Import members and gives it the file, as the person picks one from their computer. */
async function importMembers(page: Page, scope: ReturnType<Page["locator"]>, rows: Array<[string, string]>) {
  const chooser = page.waitForEvent("filechooser");
  await scope.getByRole("button", { name: "Import members" }).click();
  await (await chooser).setFiles({ name: "members.csv", mimeType: "text/csv", buffer: Buffer.from(csv(rows), "utf8") });
}

const membersOnTheList = () => prisma.member.count({ where: { organizationId: club.orgId } });

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "a draw is set up at a desk: walked at laptop size");
});

test("a first tournament asks for the members at the draw and offers them on Entries", async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  club = await makeClub(MARK);
  try {
    // A first tournament, one round, nobody entered, and nobody on the club's list.
    const made = await makeEvent(club, "Opening Medal", { stages: [{}], players: 0 });
    eventId = made.event.id;
    expect(await membersOnTheList(), "the fixture's club already has members").toBe(0);
    await signIn(context, baseURL!, club, eventId);

    await test.step("the Tee sheet asks for the members, with Import and Add a player", async () => {
      await page.goto(`/foursomes?bust=${Date.now()}`);
      const ask = page.getByRole("region", { name: "Your members" });
      await expect(ask).toBeVisible({ timeout: 30_000 });
      await expect(ask).toContainText("The draw needs players");
      await expect(ask.getByRole("link", { name: "Add a player" })).toHaveAttribute("href", "/registration");

      await importMembers(page, ask, [
        ["Tamsin Okonedo-Reeve", "a"],
        ["Hallam Bricknell", "b"],
        ["Odile Farquharson", "c"],
      ]);
      await expect(page.getByRole("status").filter({ hasText: "3 added" })).toBeVisible({ timeout: 30_000 });
      // On the club's Members, where the Members screen reads them.
      await expect.poll(membersOnTheList, { timeout: 20_000, message: "the import did not reach Members" }).toBe(3);
    });

    await test.step("with a list, the Tee sheet stops asking and sends them to Entries to pick", async () => {
      await page.goto(`/foursomes?bust=${Date.now()}`);
      await expect(page.getByRole("heading", { level: 1, name: "Tee sheet" })).toBeVisible({ timeout: 30_000 });
      const card = page.getByRole("region", { name: "Your members" });
      await expect(card).toContainText("pick who is playing", { timeout: 30_000 });
      await expect(card).not.toContainText("add your members");
      await expect(card).toContainText("has 3 members");
      await expect(card.getByRole("link", { name: "Pick who is playing" })).toHaveAttribute("href", "/registration");
      // And the draw's own line still says why it cannot be drawn yet.
      await expect(page.getByRole("link", { name: "Add players to the field" })).toBeVisible();
    });

    await test.step("Members shows them", async () => {
      await page.goto(`/roster?bust=${Date.now()}`);
      await expect(page.locator("main")).toContainText("Hallam Bricknell", { timeout: 30_000 });
    });

    await test.step("Entries, with the list empty, offers Import members in the club roster card", async () => {
      await prisma.member.deleteMany({ where: { organizationId: club.orgId } });
      await page.goto(`/registration?bust=${Date.now()}`);
      // The roster card itself, by its own title (the nearest card around it).
      const card = page.getByText("Add from the club roster", { exact: true }).locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' card ')][1]");
      await expect(card).toContainText("The roster is empty", { timeout: 30_000 });
      // CONTROL: the field's own CSV box is still the only file box drawn on the screen.
      await expect(page.locator('input[type="file"][accept*="csv"]')).toHaveCount(1);
      await importMembers(page, card, [
        ["Wilhelmina Strachey", "d"],
        ["Ambrose Kettleby", "e"],
      ]);
      await expect(page.getByRole("status").filter({ hasText: "2 added" })).toBeVisible({ timeout: 30_000 });
      // There to tick at once, and on Members.
      await expect(card.getByLabel("Search members")).toHaveAttribute("placeholder", /Search 2 members/, { timeout: 30_000 });
      await expect(card).toContainText("Ambrose Kettleby");
      expect(await membersOnTheList()).toBe(2);
    });
  } finally {
    await dropClub(MARK);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
