import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, centre, saidBeside } from "./rounds-fixture";

/**
 * ONE NAME IN PLAY PER CLUB, AS THE SECRETARY MEETS IT (Ajay, 2026-11-01: "year may not solve.
 * what if they run same tournament twice a year?").
 *
 * A club with last year's Spring Medal (completed) and this year's (setting up), walked on
 * "Your tournaments" and the screens a secretary uses:
 *
 *   the list      the two Spring Medals are told apart by their dates
 *   create        a new "SPRING  medal" is refused beside Create, naming the one holding it and
 *                 offering a free name; nothing is made, and the typed name stays in the box
 *   copy          copying last year's under its own name is refused the same way; the free name
 *                 the refusal offered is then accepted
 *   rename        renaming that copy to the held name is refused beside Save event
 *   reopen        reopening last year's is refused while this year's holds the name, and it
 *                 stays completed
 *
 * WHAT IT CANNOT SEE: two presses in the same instant (the database's backstop, A036), which is
 * `one-name-in-play-per-club.audit.test.ts`.
 */

const WALKED = ["desktop", "phone"];
const markFor = (project: string) => `zz-onename-${project}`;

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-onename-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function open(page: Page, path: string) {
  await page.goto(`${path}?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(new URL(page.url()).pathname, `sent away from ${path} — not signed in?`).toBe(path);
}

test("a name in play is the club's once: create, copy, rename and reopen are refused in words", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor(testInfo.project.name);
  const club = await makeClub(mark);
  try {
    // Calendar dates only, and no typed label: the year on the list is `tellApart`'s, not the row's own.
    const dated = (day: string) => ({ startOn: day, endOn: day, dates: "" });
    const last = await makeEvent(club, "Spring Medal", { status: "completed", configUnlocked: true, stages: [{}], players: 0, event: dated("2025-04-12") });
    const now = await makeEvent(club, "Spring Medal", { status: "registration", configUnlocked: true, stages: [{}], players: 0, event: dated("2026-04-11") });
    const held = now.event.name;
    await signIn(context, baseURL!, club, now.event.id);
    const spring = () => prisma.event.count({ where: { organizationId: club.orgId, name: { equals: held, mode: "insensitive" } } });

    await test.step("the list tells the two Spring Medals apart by their dates", async () => {
      await open(page, "/tournaments");
      const rows = page.locator("tbody tr").filter({ hasText: held });
      await expect(rows).toHaveCount(2);
      const texts = (await rows.allInnerTexts()).join("\n");
      expect(texts, "last year's row does not carry its year").toMatch(/2025/);
      expect(texts, "this year's row does not carry its year").toMatch(/2026/);
    });

    const create = page.getByRole("button", { name: "Create tournament" });
    const box = page.getByLabel("Create a new tournament", { exact: true });
    const refused = page.locator(".form-error").filter({ hasText: /\S/ });

    await test.step("create: the same name in other case and spacing is refused beside Create", async () => {
      const typed = `${mark.toUpperCase()} SPRING  medal`;
      await box.fill(typed);
      await page.getByLabel("How is it played?", { exact: true }).selectOption("single");
      await centre(create);
      await create.click();
      await expect(refused, "a clashing name was not refused in words").toBeVisible({ timeout: 20_000 });
      await expect(refused).toContainText(`“${held}” (setting up)`);
      await expect(refused).toContainText(/is free/);
      await saidBeside(refused, create, "a clashing name at Create");
      expect(new URL(page.url()).pathname, "a refused name still moved the secretary on").toBe("/tournaments");
      await expect(box, "the refused name was wiped from the box").toHaveValue(typed);
      expect(await spring(), "the refused tournament was made anyway").toBe(2);
    });

    let free = "";
    await test.step("copy: last year's under its own name is refused, and the offered free name is taken", async () => {
      await open(page, "/tournaments");
      await box.fill(held);
      const from = page.getByLabel("Start from", { exact: true });
      await from.selectOption(`copy:${last.event.id}`);
      await centre(create);
      await create.click();
      await expect(refused, "a copy under a held name was not refused").toBeVisible({ timeout: 20_000 });
      await expect(refused).toContainText(`“${held}” (setting up)`);
      free = /Choose another — “([^”]+)” is free/.exec((await refused.innerText()) ?? "")?.[1] ?? "";
      expect(free, "the refusal offered no free name").not.toBe("");
      expect(await spring(), "the refused copy was made anyway").toBe(2);
      await box.fill(free);
      await from.selectOption(`copy:${last.event.id}`);
      await create.click();
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
      expect(await prisma.event.count({ where: { organizationId: club.orgId, name: free, status: "draft" } }), "the free name was not taken").toBe(1);
    });

    await test.step("rename: the copy renamed to the held name is refused beside Save event", async () => {
      await open(page, "/event");
      const name = page.getByLabel(/^Tournament name/);
      await expect(name).toHaveValue(free);
      await name.fill(`  ${held.toLowerCase()} `);
      const save = page.locator("button.btn-primary", { hasText: /Save event/ });
      await centre(save);
      await save.click();
      const said = page.locator(".form-error").filter({ hasText: /\S/ });
      await expect(said, "a rename onto a held name was not refused").toBeVisible({ timeout: 20_000 });
      await expect(said).toContainText(`“${held}” (setting up)`);
      expect(await prisma.event.count({ where: { organizationId: club.orgId, name: free } }), "the copy lost its own name").toBe(1);
    });

    await test.step("reopen: last year's is refused while this year's holds the name", async () => {
      await open(page, "/tournaments");
      const lastRow = page.locator("tbody tr").filter({ hasText: held }).filter({ hasText: /2025/ });
      const manage = lastRow.getByRole("button", { name: `Manage ${held}`, exact: true });
      await centre(manage);
      await manage.click();
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
      await page.getByRole("button", { name: "Reopen tournament" }).first().click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await dialog.getByRole("button", { name: "Reopen tournament" }).click();
      await expect(page.getByText(/can’t be reopened under its name/).first(), "reopening onto a held name was not refused in words").toBeVisible({ timeout: 20_000 });
      expect((await prisma.event.findUnique({ where: { id: last.event.id }, select: { status: true } }))?.status, "it was reopened anyway").toBe("completed");
    });
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
