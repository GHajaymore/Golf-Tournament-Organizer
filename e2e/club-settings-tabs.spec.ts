import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, saidBeside, type Club } from "./rounds-fixture";
import { openSettingsTab } from "./settings-tabs";

/**
 * CLUB SETTINGS, ONE SECTION AT A TIME (Ajay, 2026-10-21: "go with your
 * recommendations and change the structure as needed").
 *
 * The seven sections were one page, about nine phone screens. They are tabs
 * now, and the reason they were never folded before is the first thing this
 * walks: a section holding an unsaved draft must not lose it because somebody
 * looked at another section. So the tabs HIDE, and never unmount.
 *
 *   a draft      typed in Name & branding, left for Colour and Money, found
 *                again as it was typed, and saved
 *   the hash     `#plan` opens Plan, a hash the page does not know opens the
 *                first section, a changed hash changes the tab, a tapped tab
 *                writes its hash and survives a reload
 *   a link       "Upgrade to keep it" on the dashboard — the door a free club
 *                actually uses — lands on Plan
 *   the keys     Left, Right, Home and End move along the tabs
 *   a refusal    answered after the person moved to another tab: the tab they
 *                left is marked, and opening it brings the refusal into view
 *
 * Each tab is opened as a person opens it, by tapping it. A bookmark is the
 * second test's subject, not a shortcut taken by the others.
 *
 * WHAT IT CANNOT SEE: a link to a section of Club settings placed ON Club
 * settings (none exists today; the screen re-reads the hash after any click
 * for the day one does), and the look of each tab at every width — that is
 * `layout.spec`, which now opens every tab before it measures.
 */

const markFor = (what: string, project: string) => `zz-cst-${what}-${project}`;

test.describe.configure({ timeout: 150_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-cst-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function openSettings(page: Page, hash = "") {
  await page.goto(`/organization?bust=${Date.now()}${hash}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(new URL(page.url()).pathname, "sent away from Club settings — not signed in?").toBe("/organization");
  await expect(page.locator("main h1")).toBeVisible();
}

const tab = (page: Page, label: string) =>
  page.locator("main").getByRole("tab", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) });

/** The one section on the screen, by its id. Exactly one, always. */
async function shownSection(page: Page): Promise<string> {
  const shown = page.locator('main [role="tabpanel"]:visible');
  await expect(shown, "not exactly one section of Club settings is on the screen").toHaveCount(1);
  return (await shown.getAttribute("id")) ?? "";
}

async function withClub(project: string, what: string, opts: Parameters<typeof makeClub>[1], body: (club: Club, eventId: string) => Promise<void>) {
  const mark = markFor(what, project);
  const club = await makeClub(mark, { timeZone: "Europe/London", ...opts });
  try {
    const { event } = await makeEvent(club, "Spring Medal", { stages: [{}] });
    await body(club, event.id);
  } finally {
    await dropClub(mark);
  }
}

test("a draft typed in one section is still there after visiting two others, and saves", async ({ page, context, baseURL }, testInfo) => {
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await withClub(testInfo.project.name, "draft", {}, async (club, eventId) => {
    await signIn(context, baseURL!, club, eventId);
    await openSettings(page);
    expect(await shownSection(page), "Club settings does not open on Name & branding").toBe("identity");

    const short = page.getByLabel(/^Short name/);
    await short.fill("Invented Hollow");
    const save = page.getByRole("button", { name: "Save changes" });
    await expect(save, "CONTROL: the typed name is not a draft — Save is not offered").toBeEnabled();

    await openSettingsTab(page, "Colour");
    expect(await shownSection(page)).toBe("theme");
    await expect(short, "the draft's section is still on the screen behind Colour").toBeHidden();
    await openSettingsTab(page, "Money");
    expect(await shownSection(page)).toBe("money");

    await openSettingsTab(page, "Name & branding");
    await expect(short, "the draft was thrown away by looking at two other sections").toHaveValue("Invented Hollow");
    await expect(save).toBeEnabled();
    await save.click();
    await expect
      .poll(async () => (await prisma.organization.findUniqueOrThrow({ where: { id: club.orgId } })).shortName, {
        timeout: 20_000,
        message: "the draft was kept on the screen and not saved",
      })
      .toBe("Invented Hollow");
  });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the hash picks the section, a hash it does not know is the first, and a tapped tab is kept over a reload", async ({ page, context, baseURL }, testInfo) => {
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await withClub(testInfo.project.name, "hash", {}, async (club, eventId) => {
    await signIn(context, baseURL!, club, eventId);

    // The address every other screen links to.
    await openSettings(page, "#plan");
    await expect(tab(page, "Plan")).toHaveAttribute("aria-selected", "true");
    expect(await shownSection(page), "#plan did not open Plan").toBe("plan");
    // The heading is above the tabs, so it is on every one of them.
    await expect(page.locator("main h1")).toBeVisible();

    // An address it does not know: the first section, never an empty screen.
    await openSettings(page, "#no-such-section");
    expect(await shownSection(page), "an unknown hash did not fall back to the first section").toBe("identity");
    await expect(tab(page, "Name & branding")).toHaveAttribute("aria-selected", "true");

    // The hash changed under the page: the tab follows it.
    await page.evaluate(() => {
      window.location.hash = "#money";
    });
    await expect(tab(page, "Money"), "a changed hash did not change the tab").toHaveAttribute("aria-selected", "true");
    expect(await shownSection(page)).toBe("money");

    // A tapped tab writes its hash, so a reload — or a copied address — keeps it.
    await openSettingsTab(page, "Handicaps");
    await expect.poll(() => new URL(page.url()).hash, { message: "tapping a tab did not put it in the address" }).toBe("#handicaps");
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(await shownSection(page), "a reload lost the tab").toBe("handicaps");
  });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("'Upgrade to keep it' on the dashboard lands on Plan", async ({ page, context, baseURL }, testInfo) => {
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  // Par, under the terms that delete a completed tournament: the club the link is drawn for.
  await withClub(testInfo.project.name, "upgrade", { plan: "free", planTermsApply: true }, async (club, eventId) => {
    await signIn(context, baseURL!, club, eventId);
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const upgrade = page.getByRole("link", { name: "Upgrade to keep it" }).first();
    await expect(upgrade, "CONTROL: the dashboard does not offer this club the upgrade link").toBeVisible();
    await upgrade.click();
    await page.waitForURL(/\/organization#plan$/);
    await expect(tab(page, "Plan"), "the link did not open Plan").toHaveAttribute("aria-selected", "true");
    expect(await shownSection(page)).toBe("plan");
    await expect(page.getByText(/You.re on/).first(), "Plan is open and says nothing about the plan").toBeVisible();
  });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the arrow keys, Home and End move along the tabs", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "a keyboard is a desk's");
  await withClub(testInfo.project.name, "keys", {}, async (club, eventId) => {
    await signIn(context, baseURL!, club, eventId);
    await openSettings(page);
    const first = tab(page, "Name & branding");
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "Colour")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "Colour")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(tab(page, "Staff & access"), "Left from the first tab does not wrap to the last").toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tab(page, "Staff & access")).toBeFocused();
    expect(await shownSection(page)).toBe("access");
    // One stop in the Tab order for the row: only the chosen tab takes the focus from Tab.
    await expect(page.locator('main [role="tab"][tabindex="0"]')).toHaveCount(1);
  });
});

test("a refusal that comes back after you moved to another tab marks the tab, and is in view when you open it", async ({ page, context, baseURL }, testInfo) => {
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await withClub(testInfo.project.name, "refused", {}, async (club, eventId) => {
    await signIn(context, baseURL!, club, eventId);
    await openSettings(page);
    const name = page.getByLabel("Organization name");
    await name.fill("");
    const save = page.getByRole("button", { name: "Save changes" });

    // The answer is held back, as a slow signal holds it, so the person is
    // somewhere else when it arrives.
    let held = 0;
    await page.route("**/organization**", async (route) => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
        held += 1;
        await new Promise((r) => setTimeout(r, 2_500));
      }
      await route.continue();
    });
    await save.click();
    await openSettingsTab(page, "Colour");
    const left = tab(page, "Name & branding");
    await expect(left, "the refusal arrived in a hidden section and its tab says nothing").toHaveAttribute("data-refused", "", { timeout: 20_000 });
    expect(held, "CONTROL: the save was never sent, so nothing was refused").toBeGreaterThan(0);
    await expect(left, "the mark is not said in words").toContainText("has a message for you");

    await left.click();
    const refused = page.getByText("Enter an organization name.");
    await expect(refused).toBeVisible();
    await saidBeside(refused, save, "a refusal answered after the person moved to another tab", 260);
    await expect(left, "the mark stayed after the refusal was seen").not.toHaveAttribute("data-refused", "");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: club.orgId } })).name, "a refused save changed the name").toBe(`${club.mark} Golf Society`);
  });
  expect(errors, errors.join("\n")).toEqual([]);
});
