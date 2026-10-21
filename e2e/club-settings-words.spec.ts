import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, centre } from "./rounds-fixture";

/**
 * WHAT A SOCIETY CALLS ITSELF, AND WHEN ITS SEASON RUNS — set on Club settings
 * as its secretary sets them, and read back from the database, from the screen
 * after a reload, and from the screens that use them.
 *
 * `saveOrganizationNoun` and `saveOrganizationSeason` were performed by no
 * browser test (the reach baseline, 2026-10-21):
 *
 *   the noun     a society that calls itself a league: stored, and the console
 *                says "League settings" and "League" — and "Follow our country"
 *                puts the country's word back, stored as nothing
 *   the season   April to March crosses the new year: stored as month and day
 *                only (the year in the picker is a scratch year), worded
 *                "2026–27", and a member's list of the club's tournaments files
 *                a March round in the season BEFORE an April one — which is the
 *                whole point of having a season that is not the calendar year
 *
 * WHAT IT CANNOT SEE: a refusal from either. The noun is a list of the words the
 * server accepts, and a date picker cannot hold a day that does not exist, so
 * neither screen can send what the actions refuse; the every-action sweep calls
 * both as a stranger, and `club-season.test.ts` holds the window arithmetic.
 */

const WALKED = ["desktop", "phone"];
const markFor = (what: string, project: string) => `zz-csw-${what}-${project}`;

test.describe.configure({ timeout: 150_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-csw-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function openSettings(page: Page) {
  await page.goto(`/organization?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(new URL(page.url()).pathname, "sent away from Club settings — not signed in?").toBe("/organization");
  await expect(page.locator("main h1")).toBeVisible();
}

test("a society calls itself a league, and the console says so; following the country puts its word back", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("noun", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    // A society: the only kind whose word travels badly, and the only kind asked.
    await prisma.organization.update({ where: { id: club.orgId }, data: { kind: "community", country: "GB" } });
    const { event } = await makeEvent(club, "Spring Outing", { stages: [{}] });
    await signIn(context, baseURL!, club, event.id);
    const stored = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: club.orgId } })).communityNoun;
    expect(await stored()).toBe("");

    await openSettings(page);
    // A society in Britain, until it says otherwise.
    await expect(page.locator("main h1")).toHaveText("Society settings");
    const card = page.locator("section.card", { has: page.getByText("What we are called", { exact: true }) });
    const word = card.locator("select");
    await expect(word.locator("option:checked")).toHaveText("Follow our country — society");

    await centre(word);
    await word.selectOption("league");
    await expect.poll(stored, { message: "League was not stored as what the society calls itself" }).toBe("league");
    await expect(card.getByText("Saved", { exact: true })).toBeVisible();
    await expect(card.getByText(/The sidebar reads League, this page is called League settings/)).toBeVisible();

    // After a reload the CONSOLE says it, not just the picker.
    await openSettings(page);
    await expect(page.locator("main h1"), "the settings page is not called League settings").toHaveText("League settings");
    await expect(card.locator("select option:checked")).toHaveText("league");
    await page.goto(`/roster?bust=${Date.now()}`);
    await expect(page.locator("main .page-kicker").first(), "Members is not headed by the league's own word").toHaveText("League");

    // Back to the country's word: stored as NOTHING, so a later change of country moves it.
    await openSettings(page);
    await centre(card.locator("select"));
    await card.locator("select").selectOption("");
    await expect.poll(stored, { message: "Follow our country did not clear the stored word" }).toBe("");
    await openSettings(page);
    await expect(page.locator("main h1")).toHaveText("Society settings");
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a season from April to March is kept as month and day, worded 2026–27, and files a March round in the season before", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("season", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    // Two tournaments a calendar year would put in ONE season (2026), and an
    // April-to-March season puts in two: March belongs to the season that
    // began the April before.
    const { event } = await makeEvent(club, "Spring Foursomes", { stages: [{ playedOn: "2026-03-14" }], players: 2 });
    await makeEvent(club, "Captain's Day", { stages: [{ playedOn: "2026-05-09" }], players: 2 });
    await signIn(context, baseURL!, club, event.id);
    const stored = async () => {
      const o = await prisma.organization.findUniqueOrThrow({ where: { id: club.orgId } });
      return { starts: o.seasonStartsOn, ends: o.seasonEndsOn };
    };
    expect(await stored()).toEqual({ starts: "", ends: "" });

    await openSettings(page);
    const starts = page.getByLabel("Season starts", { exact: true });
    const ends = page.getByLabel("Season ends", { exact: true });
    await expect(page.getByText(/The calendar year\. Tournaments group as 2026, 2027/)).toBeVisible();

    await centre(starts);
    await starts.fill("2026-04-01");
    await expect.poll(stored, { message: "the season's first day was not stored as month and day" }).toEqual({ starts: "04-01", ends: "" });
    await ends.fill("2026-03-31");
    await expect.poll(stored, { message: "the season's last day was not stored as month and day" }).toEqual({ starts: "04-01", ends: "03-31" });
    await expect(page.getByText(/Crosses the new year, so this season is written 2026–27\./)).toBeVisible();

    await openSettings(page);
    await expect(page.getByLabel("Season starts", { exact: true }), "the season's start did not survive a reload").toHaveValue("2026-04-01");
    await expect(page.getByLabel("Season ends", { exact: true })).toHaveValue("2026-03-31");
    await expect(page.getByText(/Crosses the new year, so this season is written 2026–27\./)).toBeVisible();

    // What the season is FOR: the club's list of tournaments, grouped by it.
    await page.goto(`/me/events?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const thisSeason = page.getByText("2026–27 · this season");
    await expect(thisSeason, "the club's list is not grouped into the 2026–27 season").toBeVisible();
    await expect(page.getByText("2025–26", { exact: false }).first(), "the March round was not filed in the season before").toBeVisible();

    // Cleared, the club is back on the calendar year.
    await openSettings(page);
    await centre(page.getByLabel("Season starts", { exact: true }));
    await page.getByLabel("Season starts", { exact: true }).fill("");
    await expect.poll(stored).toEqual({ starts: "", ends: "03-31" });
    await page.getByLabel("Season ends", { exact: true }).fill("");
    await expect.poll(stored, { message: "clearing both did not return the club to the calendar year" }).toEqual({ starts: "", ends: "" });
    await openSettings(page);
    await expect(page.getByText(/The calendar year\. Tournaments group as 2026, 2027/)).toBeVisible();
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
