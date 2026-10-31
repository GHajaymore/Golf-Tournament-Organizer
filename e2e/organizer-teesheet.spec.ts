import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { seedOrganizer, teardownOrganizer, medalEmail, memberSession, MEDAL_COURSE } from "./organizer-fixture.mjs";

/**
 * THE TEE SHEET, FROM THE SECRETARY'S DRAW TO A MEMBER'S PHONE.
 *
 * "What time am I off, and who with?" is the first question every member
 * asks. This draws a sheet the way a club does — balanced on handicap, threes,
 * a two-tee start — publishes it, and reads it on a member's own screen.
 *
 * "Balanced handicap" sorts the field by index and deals it in a snake
 * (`grouping.ts`), so the groups are known before the draw:
 *
 *   indexes 2, 5, 9, 13, 17, 21 in threes
 *     Group 1   Alder (2), Dune (13), Elm (17)      hole 1   7:30 AM
 *     Group 2   Briar (5), Cedar (9), Fern (21)     hole 10  7:30 AM
 *
 * A split start sends the two groups off the 1st and the 10th at the same
 * time. Fern, the member, must see nothing before it is published, and then
 * her group, her time, the 10th and her two partners — on her own page and on
 * the dashboard.
 */

type Entrant = { name: string; index: string };
const FIELD: Entrant[] = [
  { name: "Elm Quayle", index: "17" },
  { name: "Briar Quayle", index: "5" },
  { name: "Fern Quayle", index: "21" },
  { name: "Alder Quayle", index: "2" },
  { name: "Dune Quayle", index: "13" },
  { name: "Cedar Quayle", index: "9" },
];
const MEMBER = "Fern Quayle";
const TOURNAMENT = "Saturday Medal — Draw Out";

test.beforeAll(async () => {
  const { session } = await seedOrganizer();
  process.env.ORGANIZER_SESSION = session;
});
test.afterAll(async () => {
  await teardownOrganizer();
});

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
}

test("the secretary draws and publishes the tee sheet; a member sees their time and partners", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(360_000);
  await page.context().addCookies([{ name: "ng_session", value: process.env.ORGANIZER_SESSION!, url: baseURL! }]);
  const errors: string[] = [];
  watchPageErrors(page, errors);

  await test.step("a one-round medal with six players, launched", async () => {
    await open(page, "/choose");
    await page.getByLabel("Tournament name").fill(TOURNAMENT);
    await page.getByRole("button", { name: /^A single round/ }).click();
    await page.getByRole("button", { name: "Create tournament" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

    await open(page, "/event");
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel("Tournament dates, first day").fill(today);
    await page.getByLabel("Tournament dates, last day").fill(today);
    const course = page.getByRole("combobox", { name: "Golf course" });
    await course.click();
    await course.fill("Kingsbarn Heath");
    await page.locator('#course-picker-list [role="option"]', { hasText: "Dayton" }).first().click();
    await page.locator("button.btn-primary", { hasText: /Save event|Adding the course/ }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(course).toHaveValue(MEDAL_COURSE);

    await open(page, "/registration");
    for (const [i, p] of FIELD.entries()) {
      await page.getByLabel("Player name", { exact: true }).fill(p.name);
      await page.getByRole("textbox", { name: /^Email · required/ }).fill(medalEmail(i));
      // A new club is on Par, which since 2026-10-21 (A7) asks no mobile unless the organizer does.
      await expect(page.getByRole("textbox", { name: /^Mobile · required/ }), "Par still demands a mobile").toHaveCount(0);
      await page.getByLabel("Handicap", { exact: true }).fill(p.index);
      await page.getByRole("button", { name: "Add to field" }).click();
      await expect(page.getByText(p.name).first()).toBeVisible({ timeout: 20_000 });
    }

    await open(page, "/stages");
    await page.getByRole("button", { name: /^Stroke play round/ }).click();
    await page.getByLabel("Format for every round added").selectOption("Stroke Play");
    await page.getByRole("button", { name: /^Add stroke play round/ }).click();
    await expect(page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ })).toBeVisible({ timeout: 20_000 });

    await open(page, "/dashboard");
    await page.getByRole("button", { name: "Launch tournament" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
    await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
  });

  // The member's own phone, signed in as her.
  const memberCtx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  const fernIndex = FIELD.findIndex((p) => p.name === MEMBER);
  await memberCtx.addCookies([{ name: "ng_session", value: await memberSession(medalEmail(fernIndex), MEMBER), url: baseURL! }]);
  const member = await memberCtx.newPage();
  watchPageErrors(member, errors, "member");

  try {
    await test.step("before it is published, the member sees no tee time", async () => {
      // Signed in as her: her Board tab marks her own row. Not Today's leaders
      // tiles — before anybody has a place Today hangs no leaders at all
      // (2026-10-10), so they cannot prove whose phone this is.
      await open(member, "/me/board");
      await expect(member.locator("main")).toContainText(/Quayle/i);
      await open(member, "/me");
      expect(await member.locator("main").innerText()).not.toMatch(/Group \d+ · \d/);
    });

    await test.step("the secretary draws threes, balanced on handicap, off two tees, and saves a draft", async () => {
      await open(page, "/foursomes");
      await expect(page.getByRole("heading", { level: 1, name: "Tee sheet" })).toBeVisible();
      await page.getByRole("button", { name: /^Balanced handicap/ }).click();
      await page.locator("label.seg-opt", { hasText: /^\s*3\s*$/ }).click();
      await page.locator("label.seg-opt", { hasText: /^\s*Split\s*$/ }).click();
      await page.getByLabel("First tee").fill("07:30");
      await page.getByRole("button", { name: /^Save sheet/ }).click();
      await expect(async () => {
        await open(page, "/foursomes");
        await expect(page.getByText("Saved as a draft — this is the sheet you saved.")).toBeVisible();
      }).toPass({ timeout: 20_000 });
      // A draft is the secretary's: the member still sees nothing.
      await open(member, "/me");
      expect(await member.locator("main").innerText()).not.toMatch(/Group \d+ · \d/);
    });

    /**
     * THE NIGHT BEFORE, AS IT HAPPENED (2026-10-17). The draft is right; the
     * secretary comes back to publish it. A re-draw used to reopen at 8:00, and
     * "Save & publish" publishes what is ON SCREEN — so publishing a saved
     * draft meant rebuilding it by hand. Now a re-draw starts from the saved
     * times, and the draft is published as it stands.
     */
    await test.step("a re-draw starts from the saved times, and the saved draft is published as it stands", async () => {
      await page.getByRole("button", { name: /^Re-draw this sheet/ }).click();
      await expect(page.getByLabel("First tee")).toHaveValue("07:30");
      await page.getByRole("button", { name: "Close the draw controls" }).click();

      await page.getByRole("button", { name: /^Publish this sheet/ }).click();
      await page.getByRole("button", { name: "Publish the tee sheet" }).click();
      await expect(page.getByText("Published to players — this is the sheet they have.")).toBeVisible({ timeout: 20_000 });
      // Never the contradiction it used to print straight after publishing.
      await expect(page.getByText(/new draw/)).toHaveCount(0);

      await expect(async () => {
        await open(page, "/foursomes");
        await expect(page.getByText(/Published to players — this is the sheet they have/)).toBeVisible();
      }).toPass({ timeout: 20_000 });

      // The draw the secretary sees, group by group.
      const group = (n: number) => page.locator(".card", { hasText: `Group ${n}` }).filter({ hasText: /Hole \d+ · / }).first();
      await expect(group(1)).toContainText("Hole 1 · 7:30 AM");
      for (const name of ["Alder Quayle", "Dune Quayle", "Elm Quayle"]) await expect(group(1)).toContainText(name);
      await expect(group(2)).toContainText("Hole 10 · 7:30 AM");
      for (const name of ["Briar Quayle", "Cedar Quayle", MEMBER]) await expect(group(2)).toContainText(name);
    });

    await test.step("the member sees their group, time, tee and partners", async () => {
      await open(member, "/me");
      const me = await member.locator("main").innerText();
      expect(me, `the member's page does not give their tee time:\n${me}`).toMatch(/Group 2 · 7:30 AM/);
      expect(me).toMatch(/With Briar Quayle, Cedar Quayle/);
      expect(me).toMatch(/starting on hole 10/);

      await open(member, "/dashboard");
      const dash = await member.locator("main").innerText();
      expect(dash, `the member's dashboard does not place them:\n${dash}`).toMatch(/You're in Group 2 — hole 10 at 7:30 AM\./);
    });

    await test.step("the prizes she is playing for are on her Board", async () => {
      // Ajay, 2026-10-05: players see the prizes of the tournament they are in.
      await open(page, "/prizes");
      for (const [category, amount] of [["Winner", "50"], ["Nearest the pin", "15"]] as const) {
        await page.getByLabel("Category").fill(category);
        // The add form's box ("Amount ($)"), not a prize already in the list.
        await page.getByRole("spinbutton", { name: /^Amount \(/ }).fill(amount);
        await page.getByRole("button", { name: "Add", exact: true }).click();
        // The visible copy: Prizes draws a table on a desktop and stacked rows
        // on a phone, with the same labelled box in both, and the stacked one
        // comes first in the page — hidden at 1280px. `.first()` alone waited
        // on that hidden box and failed every desktop run of #793.
        await expect(page.getByLabel(`Amount for ${category}`).filter({ visible: true }).first()).toBeVisible({
          timeout: 20_000,
        });
      }

      await open(member, "/me/board");
      const prizes = member.locator("section", { has: member.getByRole("heading", { name: /Prizes/ }) });
      await expect(prizes, "the member cannot see what she is playing for").toBeVisible();
      await expect(prizes).toContainText(/Winner\s*\$50\.00/);
      await expect(prizes).toContainText(/Nearest the pin\s*\$15\.00/);
    });
  } finally {
    await memberCtx.close();
  }
  expect(errors, "a screen threw").toEqual([]);
});
