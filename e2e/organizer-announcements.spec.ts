import { test, expect, type Page } from "@playwright/test";
import { seedOrganizer, teardownOrganizer, medalEmail, memberSession, MEDAL_COURSE } from "./organizer-fixture.mjs";

/**
 * A NOTICE, FROM THE SECRETARY'S KEYBOARD TO A MEMBER'S PHONE.
 *
 * "Frost delay — first tee now 08:40" is the message a club most needs every
 * member to see, and "the halfway house is open" is one they need to see
 * once. So the walk holds both halves of how Today treats them (2026-10-05):
 *
 *   pinned     on top, in full, on every visit — pinning is the secretary
 *              saying this one outranks everything
 *   unpinned   in full the first time this phone shows it, then folded into
 *              "1 earlier message", one tap from the full text
 *   new        a notice posted after that arrives in full, not folded with
 *              the old one
 *
 * And the secretary's own dashboard shows every notice in full, always: it is
 * where they check what they posted.
 */

const FIELD = [
  { name: "Fern Quayle", index: "21" },
  { name: "Alder Quayle", index: "2" },
];
const MEMBER = "Fern Quayle";
const TOURNAMENT = "Midweek Medal — Notices";
const FROST = { title: "Frost delay — first tee now 08:40", body: "Greens staff are clearing the 1st and 10th." };
const HALFWAY = { title: "Halfway house is open", body: "Bacon rolls until 11." };
const CARTS = { title: "Carts on paths only", body: "" };

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

async function post(page: Page, n: { title: string; body: string }, pinned: boolean) {
  await open(page, "/announcements");
  await page.getByLabel("Title", { exact: true }).fill(n.title);
  if (n.body) await page.getByLabel("Message (optional)").fill(n.body);
  if (pinned) await page.getByLabel(/^Pin to the top of players/).check();
  await page.getByRole("button", { name: "Post", exact: true }).click();
  // Read back from the list the post lands in, not the form it came from.
  await expect(page.getByRole("button", { name: `Delete “${n.title}”` })).toBeVisible({ timeout: 20_000 });
}

test("the secretary posts; a member sees the pinned one always and the rest once", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(360_000);
  await page.context().addCookies([{ name: "ng_session", value: process.env.ORGANIZER_SESSION!, url: baseURL! }]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));

  await test.step("a one-round medal with two players, launched", async () => {
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
      await page.getByRole("textbox", { name: /^Mobile · required/ }).fill(`555080${i}`);
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
    for (const step of ["Start taking entries", "Mark ready"]) {
      await page.getByRole("button", { name: step }).click();
      await expect(page.getByRole("button", { name: step })).toHaveCount(0, { timeout: 20_000 });
    }
    await page.getByRole("button", { name: "Launch tournament" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
    await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
  });

  await test.step("the secretary posts a pinned notice and an ordinary one", async () => {
    await post(page, FROST, true);
    await post(page, HALFWAY, false);
  });

  // The member's own phone, signed in as her.
  const memberCtx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  await memberCtx.addCookies([{ name: "ng_session", value: await memberSession(medalEmail(0), MEMBER), url: baseURL! }]);
  const member = await memberCtx.newPage();
  member.on("pageerror", (e) => errors.push(`member ${new URL(member.url()).pathname}: ${String(e)}`));
  const main = member.locator("main");

  try {
    await test.step("first visit: both in full, the pinned one on top", async () => {
      await open(member, "/me");
      for (const text of [FROST.title, FROST.body, HALFWAY.title, HALFWAY.body]) {
        await expect(main.getByText(text, { exact: true })).toBeVisible({ timeout: 20_000 });
      }
      const y = async (t: string) => (await main.getByText(t, { exact: true }).boundingBox())!.y;
      expect(await y(FROST.title), "the pinned notice is not on top").toBeLessThan(await y(HALFWAY.title));
      await expect(main.getByText(/earlier message/)).toHaveCount(0);
    });

    await test.step("next visit: the pinned one as one line, the read one folded", async () => {
      await open(member, "/me");
      // Pinned is never folded away, but once read it is its title, with the
      // text a tap away (the one-screen Today, 2026-10-06).
      await expect(main.getByText(FROST.title, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(main.getByText(FROST.body, { exact: true })).toBeHidden();
      await main.getByText(FROST.title, { exact: true }).click();
      await expect(main.getByText(FROST.body, { exact: true })).toBeVisible();
      const fold = main.getByText("1 earlier message", { exact: true });
      await expect(fold).toBeVisible();
      await expect(main.getByText(HALFWAY.title, { exact: true })).toBeHidden();
      // One tap brings it back, word for word.
      await fold.click();
      await expect(main.getByText(HALFWAY.title, { exact: true })).toBeVisible();
      await expect(main.getByText(HALFWAY.body, { exact: true })).toBeVisible();
    });

    await test.step("a new notice arrives in full; the old one stays folded", async () => {
      await post(page, CARTS, false);
      await open(member, "/me");
      await expect(main.getByText(CARTS.title, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(main.getByText("1 earlier message", { exact: true })).toBeVisible();
      await expect(main.getByText(HALFWAY.title, { exact: true })).toBeHidden();
    });

    await test.step("the secretary's dashboard shows every notice in full", async () => {
      await open(page, "/dashboard");
      const dash = page.locator("main");
      for (const n of [FROST, HALFWAY, CARTS]) {
        await expect(dash.getByText(n.title, { exact: true })).toBeVisible({ timeout: 20_000 });
      }
      await expect(dash.getByText(/earlier message/)).toHaveCount(0);
    });
  } finally {
    await memberCtx.close();
  }
  expect(errors, "a screen threw").toEqual([]);
});
