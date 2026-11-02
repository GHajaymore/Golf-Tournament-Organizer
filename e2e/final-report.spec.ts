import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { MARK } from "./fixture.mjs";
import { seedReport, teardownReport } from "./report-fixture.mjs";

/**
 * THE TOURNAMENT'S CONCLUSION, OPENED THE WAY AN ORGANIZER OPENS IT (2026-10-21).
 *
 * Ajay: the report "should come from real app" and be "available in the report
 * section". So the organizer goes to Reports & export and presses the report —
 * on a finished two-round medal with a skins pot, a birdie pot, a closest to
 * the pin, a prize, a shared cost and a second club tournament taking entries
 * (`report-fixture.mjs`, worked out by hand in its header) — and every section
 * the tournament used is on the page. Then the PUBLIC link, signed out: the
 * winners are named and no amount appears anywhere. Then one of the field,
 * signed in, on that same link: their own settle-up line first.
 *
 * What it cannot see: that each figure is the reader's figure — that is
 * `final-report-reads-the-readers.audit.test.ts`; and the formats the fixture
 * does not hold (a knockout's draw, flights, a team round) — those sections
 * are drawn only when the tournament has them, and this one does not.
 */

const RUN = `${MARK}-report`;
type Seeded = Awaited<ReturnType<typeof seedReport>>;
let seeded: Seeded;

test.beforeAll(async () => {
  seeded = await seedReport(RUN);
});
test.afterAll(async () => {
  await teardownReport(RUN);
});

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
}

const SECTIONS = [
  // Since 2026-10-23 the report leads with its prize list and one picture.
  "The prize list",
  "Place after each round",
  "Twos and contests",
  "How it was won",
  "Format and field",
  "The leaderboard",
  "Each round",
  "Prize winners",
  "Highlights",
  "In numbers",
  "Side games",
  "Entry fees and costs",
  "Settle up",
  "Coming up",
];

test("the organizer opens the conclusion from Reports; the public link names winners without amounts", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await page.context().addCookies([
    { name: "ng_session", value: seeded.organizer.session, url: baseURL! },
    { name: "ng_active_event", value: seeded.organizer.event, url: baseURL! },
  ]);
  const name = (who: string) => `${who} Example`;

  await test.step("Reports → Open the final report", async () => {
    await open(page, "/reports");
    await expect(page.getByText("The tournament on one page")).toBeVisible();
    await page.getByRole("link", { name: "Open the final report", exact: true }).click();
    await page.waitForURL(/\/reports\/final$/);
  });

  const report = page.locator(".fr");

  await test.step("every section the tournament used is there, with the amounts", async () => {
    await expect(report.getByRole("heading", { level: 1 })).toHaveText(`${RUN} Two-Day Medal`);
    await expect(report.getByRole("group", { name: "Winner" })).toContainText(name("Bob"));
    await expect(report.getByRole("group", { name: "Winner" })).toContainText("gross 141");
    for (const s of SECTIONS) await expect(report.getByRole("heading", { level: 2, name: s, exact: true }), s).toBeVisible();

    const section = (h: string) => report.locator("section", { has: page.getByRole("heading", { level: 2, name: h, exact: true }) });
    await expect(section("How it was won")).toContainText(`${name("Ann")} led after Round 1 on gross 70.`);
    await expect(section("How it was won")).toContainText(`${name("Bob")} went top after Round 2 on gross 141, up from 2nd.`);
    await expect(section("Highlights")).toContainText("Eagle");
    await expect(section("Highlights")).toContainText("2 on the par-4 hole 5, Round 2");
    await expect(section("Side games")).toContainText("Skins (Gross), Round 1");
    await expect(section("Side games")).toContainText(`${name("Ann")} · holes 1 and 2`);
    // Amounts, in the club's money: the prize, the pot, the settle-up.
    await expect(section("Prize winners")).toContainText(/Winner.*\$50/);
    await expect(section("Side games")).toContainText(/\$5(\.00)? each, 4 in/);
    await expect(section("Settle up")).toContainText("Recorded by TourneyHQ. Settle between yourselves.");
    await expect(section("Settle up")).toContainText(/pays .*\$\d/);
    await expect(section("Settle up")).toContainText("Where everybody ends up");
    await expect(section("Coming up")).toContainText(`Entries close for ${RUN} Autumn Foursomes; it is played on`);
    await expect(section("Coming up")).toContainText("Prize giving in the clubhouse");

    // Nothing sideways, and the height said beside the result.
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `the report scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
    const height = await report.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    testInfo.annotations.push({ type: "report height", description: `${height}px at ${page.viewportSize()?.width}px wide` });
  });

  await test.step("the public link, signed out: winners, and no money anywhere", async () => {
    const outsider = await browser.newContext({ ...testInfo.project.use, storageState: undefined });
    try {
      const pub = await outsider.newPage();
      watchPageErrors(pub, errors, "public");
      await open(pub, `/live/${seeded.shareToken}/report`);
      const main = pub.getByRole("main");
      await expect(main.getByRole("group", { name: "Winner" })).toContainText(name("Bob"));
      await expect(main).toContainText(`${name("Ann")} · holes 1 and 2`);
      await expect(main.getByRole("heading", { level: 2, name: "Highlights" })).toBeVisible();
      for (const gone of ["Settle up", "Entry fees and costs"]) {
        await expect(main.getByRole("heading", { level: 2, name: gone, exact: true }), gone).toHaveCount(0);
      }
      const text = await main.innerText();
      expect(text, "an amount on the public report").not.toMatch(/\$/);
      expect(text).not.toContain("Prize giving in the clubhouse");
    } finally {
      await outsider.close();
    }
  });

  await test.step("one of the field, signed in on that link: their own line first", async () => {
    const phone = await browser.newContext({ ...testInfo.project.use, storageState: undefined });
    try {
      await phone.addCookies([{ name: "ng_session", value: seeded.cat.session, url: baseURL! }]);
      const cat = await phone.newPage();
      watchPageErrors(cat, errors, "cat");
      await open(cat, `/live/${seeded.shareToken}/report`);
      const main = cat.getByRole("main");
      await expect(main.getByRole("status")).toContainText(/^You pay \$/);
      await expect(main.getByRole("heading", { level: 2, name: "Settle up", exact: true })).toBeVisible();
    } finally {
      await phone.close();
    }
  });

  expect(errors, "a screen threw").toEqual([]);
});
