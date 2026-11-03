import { test, expect, type Browser, type Page, type TestInfo } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { runMark } from "../scripts/run-mark.mjs";
import { seedMySeason, teardownMySeason, PEOPLE } from "./my-season-fixture.mjs";

/**
 * A MEMBER'S SEASON, OPENED THE WAY A MEMBER OPENS IT (2026-10-24).
 *
 * Fenella signs in, taps Events, taps My season — and every place and figure
 * on the screen is held to what that tournament's OWN public board and final
 * report print for her, read signed out from `/live/<token>` and its report,
 * the pages her club sends its members. The fixture (`my-season-fixture.mjs`)
 * holds every state the page words: a shared place, a Stableford, a side, a
 * round scored by hand, results held, entered and not played, a waiting list,
 * a tournament she missed and one from last season.
 *
 * The controls are what make an absence mean anything:
 *
 *   held results     her place and prize at the Autumn Open are hidden — and
 *                    once the club RELEASES its results they appear, so it was
 *                    the hold that hid them and not a page that shows nothing;
 *   another member   Oswin's own season shows the places and prizes hers must
 *                    not, so the check could have seen them;
 *   a stranger       a member of the club with no entries sees the empty state.
 *
 * What it cannot see: a knockout's draw, a cup and a skins night are said as
 * "see the board" and their places are not walked here; the season's window
 * turning over on its last day is `my-season.test.ts`'s, not a browser's.
 */

const RUN = runMark("zz-myseason");
type Seeded = Awaited<ReturnType<typeof seedMySeason>>;
let seeded: Seeded;
const prisma = new PrismaClient();

test.beforeAll(async () => {
  seeded = await seedMySeason(RUN);
});
test.afterAll(async () => {
  try {
    await teardownMySeason(RUN);
  } finally {
    await prisma.$disconnect();
  }
});

const bust = (path: string) => `${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`;

async function signIn(page: Page, baseURL: string, who: "fenella" | "oswin" | "stranger") {
  const c = seeded.cookies[who];
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "ng_session", value: c.session, url: baseURL },
    { name: "ng_active_event", value: c.event, url: baseURL },
  ]);
}

/** Today → Events → My season, by thumb. */
async function tapToSeason(page: Page) {
  await page.goto(bust("/me"));
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).pathname, "not signed in as a member").toBe("/me");
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Events" }).click();
  await page.waitForURL(/\/me\/events$/);
  await page.getByRole("link", { name: /^My season/ }).click();
  await page.waitForURL(/\/me\/season$/);
  await expect(page.getByRole("heading", { level: 1, name: "My season" })).toBeVisible();
}

/** A fresh browser holding no session — how a member opens the club's link from a text. */
async function signedOut(browser: Browser, testInfo: TestInfo, errors: string[]) {
  const ctx = await browser.newContext({ ...testInfo.project.use, storageState: undefined });
  const page = await ctx.newPage();
  watchPageErrors(page, errors, "signed out");
  return { ctx, page };
}

/** The public board's place for a player: the first line of their row. */
async function boardPlace(page: Page, token: string, name: string): Promise<{ place: string; chip: string }> {
  await page.goto(bust(`/live/${token}`));
  await page.waitForLoadState("networkidle");
  const row = page.getByRole("main").locator("li", { hasText: name }).first();
  await expect(row, `${name} is not on the board`).toBeVisible();
  const place = (await row.innerText()).split("\n").map((s) => s.trim()).filter(Boolean)[0];
  // The chip's own words, not as styled: it is drawn upper-case.
  const chip = ((await page.getByRole("main").locator("header > div").first().textContent()) ?? "").trim();
  return { place, chip };
}

/** A side's row on the public team board: its place, gross and net, by column. */
async function boardSide(page: Page, token: string, side: string): Promise<Record<string, string>> {
  await page.goto(bust(`/live/${token}`));
  await page.waitForLoadState("networkidle");
  const table = page.getByRole("main").locator("table").filter({ hasText: side }).first();
  // The headings' own words: a stylesheet may draw them upper-case.
  const heads = (await table.locator("thead th").allTextContents()).map((h) => h.trim());
  const cells = (await table.locator("tbody tr", { hasText: side }).first().locator("td").allInnerTexts()).map((c) => c.trim());
  return Object.fromEntries(heads.map((h, i) => [h, cells[i] ?? ""]));
}

/** The final report's leaderboard row for a player or side, by its columns. */
async function reportRow(page: Page, token: string, name: string): Promise<Record<string, string>> {
  await page.goto(bust(`/live/${token}/report`));
  await page.waitForLoadState("networkidle");
  const table = page.locator("table.fr-board").first();
  const heads = (await table.locator("thead th").allTextContents()).map((h) => h.trim());
  const row = table.locator("tbody tr").filter({ has: page.locator("td", { hasText: name }) }).first();
  await expect(row, `${name} is not in the report`).toBeVisible();
  const cells = (await row.locator("td").allInnerTexts()).map((c) => c.trim());
  return Object.fromEntries(heads.map((h, i) => [h, cells[i] ?? ""]));
}

/** What the season page says about one tournament. */
async function seasonLine(page: Page, eventId: string) {
  const card = page.locator(`[data-season-event="${eventId}"]`);
  await expect(card, "the tournament is not on the season").toHaveCount(1);
  const place = card.locator("[data-place]");
  return {
    card,
    place: (await place.count()) ? (await place.innerText()).trim() : "",
    state: (await card.locator("[data-state]").count()) ? (await card.locator("[data-state]").innerText()).trim() : "",
    figures: (await card.locator("[data-figures]").count()) ? (await card.locator("[data-figures]").innerText()).trim() : "",
    text: (await card.innerText()).trim(),
  };
}

const fig = (figures: string, label: string) => new RegExp(`${label} (\\d+)`).exec(figures)?.[1] ?? "";

async function tile(page: Page, name: string): Promise<string> {
  return (await page.locator(`[data-tile="${name}"] [data-figure]`).innerText()).trim();
}

test("a member's season: every place and figure is the one her tournaments' own boards give", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "Fenella");
  const E = seeded.events;
  await signIn(page, baseURL!, "fenella");
  await tapToSeason(page);

  // ── What the screen says, read once, before any board is opened ──────────
  const spring = await seasonLine(page, E.spring.id);
  const summer = await seasonLine(page, E.summer.id);
  const pairs = await seasonLine(page, E.pairs.id);
  const shield = await seasonLine(page, E.shield.id);
  const autumn = await seasonLine(page, E.autumn.id);
  const winter = await seasonLine(page, E.winter.id);
  const foursomes = await seasonLine(page, E.foursomes.id);
  const whole = await page.getByRole("main").innerText();
  const bests = {
    gross: await tile(page, "best-gross"),
    net: await tile(page, "best-net"),
    points: await tile(page, "best-points"),
  };
  const counts = { tournaments: await tile(page, "tournaments"), rounds: await tile(page, "rounds"), prizes: await tile(page, "prizes") };

  if (testInfo.project.name === "phone") {
    await page.screenshot({ path: testInfo.outputPath("my-season-phone.png"), fullPage: true });
    await page.screenshot({ path: "test-results/my-season-phone.png", fullPage: true });
  }

  await test.step("a number and a word, side by side, and nothing wider than the phone", async () => {
    // Where the tiles SIT, not what the CSS says: the first build declared a
    // three-column grid and a phone rule in globals.css stacked it anyway.
    const tops: number[] = [];
    const lefts: number[] = [];
    for (const name of ["tournaments", "rounds", "prizes"]) {
      const box = (await page.locator(`[data-tile="${name}"]`).boundingBox())!;
      tops.push(Math.round(box.y));
      lefts.push(Math.round(box.x));
    }
    expect(new Set(tops).size, `the three numbers stacked: tops ${tops}`).toBe(1);
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
    expect(new Set(lefts).size).toBe(3);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `the season scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
  });

  await test.step("the season and its tournaments: the ones she is in, this season, newest first", async () => {
    const key = Number(seeded.seasonOpened.slice(0, 4));
    const wraps = seeded.seasonEndsOn < seeded.seasonStartsOn;
    const label = wraps ? `${key}–${String((key + 1) % 100).padStart(2, "0")}` : String(key);
    await expect(page.locator("[data-season-label]")).toHaveText(`${label} season`);
    const ids = await page.locator("[data-season-event]").evaluateAll((els) => els.map((e) => e.getAttribute("data-season-event")));
    expect(ids).toEqual([E.foursomes.id, E.winter.id, E.autumn.id, E.shield.id, E.pairs.id, E.summer.id, E.spring.id]);
    // The one she missed, and last season's, are not hers this season.
    expect(whole).not.toContain(E.captain.name);
    expect(whole).not.toContain(E.last.name);
    expect(counts).toEqual({ tournaments: "6", rounds: "5", prizes: "3" });
  });

  const out = await signedOut(browser, testInfo, errors);
  try {
    await test.step("Spring Medal: the board's shared place, the report's gross and net", async () => {
      const board = await boardPlace(out.page, E.spring.shareToken, PEOPLE.fenella);
      expect(board.place, "the fixture shares her second place").toBe("T2");
      expect(spring.place).toBe(board.place);
      expect(spring.state).toBe(board.chip);
      const report = await reportRow(out.page, E.spring.shareToken, PEOPLE.fenella);
      expect(report.Pos).toBe(spring.place);
      expect(fig(spring.figures, "Gross")).toBe(report.Gross);
      expect(fig(spring.figures, "Net")).toBe(report.Net);
      expect(spring.text).toContain("Best net");
    });

    await test.step("Summer Stableford: her points, her title", async () => {
      const board = await boardPlace(out.page, E.summer.shareToken, PEOPLE.fenella);
      expect(summer.place).toBe(board.place);
      const report = await reportRow(out.page, E.summer.shareToken, PEOPLE.fenella);
      expect(fig(summer.figures, "Points")).toBe(report.Points);
      expect(fig(summer.figures, "Gross")).toBe(report.Gross);
      expect(summer.text).toContain("Champion");
      expect(summer.text).toContain("Longest drive, 12th");
    });

    await test.step("Pairs Better Ball: her SIDE's place, said as the side's", async () => {
      const side = `${PEOPLE.fenella} & ${PEOPLE.ula}`;
      const board = await boardSide(out.page, E.pairs.shareToken, side);
      expect(pairs.place).toBe(board["#"]);
      expect(pairs.figures).toContain(`Your side: ${side}`);
      expect(fig(pairs.figures, "Gross")).toBe(board.Gross);
      expect(fig(pairs.figures, "Net")).toBe(board.Net);
    });

    await test.step("the best scores are her own complete cards, as their reports print them", async () => {
      const springReport = await reportRow(out.page, E.spring.shareToken, PEOPLE.fenella);
      const summerReport = await reportRow(out.page, E.summer.shareToken, PEOPLE.fenella);
      expect(bests.gross).toBe(String(Math.min(Number(springReport.Gross), Number(summerReport.Gross))));
      expect(bests.net).toBe(springReport.Net);
      expect(bests.points).toBe(summerReport.Points);
      // Not the side's 66, nor the 70 at the held Autumn Open.
      expect(bests.gross).not.toBe(fig(pairs.figures, "Gross"));
      expect(bests.gross).not.toBe("70");
    });
  } finally {
    await out.ctx.close();
  }

  await test.step("no rank for a round scored by hand; nothing of a held result; never 'not entered'", async () => {
    expect(shield.place).toBe("");
    expect(shield.text).toContain("Scored by hand · no place");
    expect(autumn.place).toBe("");
    expect(autumn.figures).toBe("");
    expect(autumn.text).toContain("Results not published yet");
    expect(whole).not.toContain("Autumn champion");
    expect(winter.text).toContain("Entered · nothing played yet");
    expect(foursomes.text).toContain("On the waiting list");
    expect(whole).not.toMatch(/not entered|aren.t entered/i);
  });

  await test.step("nothing of Oswin's is on her page", async () => {
    for (const his of [PEOPLE.oswin, "Winner", "Nearest the pin", "Captains prize"]) {
      expect(whole, `${his} is on Fenella's season`).not.toContain(his);
    }
  });

  await test.step("CONTROL: once the club releases the Autumn Open, her place and prize appear", async () => {
    await prisma.event.update({ where: { id: E.autumn.id }, data: { leaderboardVisibility: "participants" } });
    try {
      await page.goto(bust("/me/season"));
      await page.waitForLoadState("networkidle");
      const released = await seasonLine(page, E.autumn.id);
      expect(released.place, "released, the place shows").toBe("1");
      expect(released.text).toContain("Autumn champion");
      expect(await tile(page, "best-gross"), "and her 70 is now her best").toBe("70");
    } finally {
      await prisma.event.update({ where: { id: E.autumn.id }, data: { leaderboardVisibility: "staff" } });
    }
  });

  expect(errors, "a screen threw").toEqual([]);
});

test("CONTROL: another member's season carries what Fenella's must not", async ({ page, baseURL }) => {
  const errors: string[] = [];
  watchPageErrors(page, errors, "Oswin");
  await signIn(page, baseURL!, "oswin");
  await tapToSeason(page);
  const spring = await seasonLine(page, seeded.events.spring.id);
  expect(spring.place, "he won the Spring Medal").toBe("1");
  expect(spring.text).toContain("Winner");
  expect(spring.text).toContain("Nearest the pin, 7th");
  await expect(page.locator(`[data-season-event="${seeded.events.captain.id}"]`), "he played the Captain's Prize").toHaveCount(1);
  // Her prize is hers: it is not on his line for the same tournament.
  expect(spring.text).not.toContain("Best net");
  expect(errors).toEqual([]);
});

test("a member of the club with no entries sees the empty state", async ({ page, baseURL }) => {
  const errors: string[] = [];
  watchPageErrors(page, errors, "stranger");
  await signIn(page, baseURL!, "stranger");
  await tapToSeason(page);
  await expect(page.locator("[data-season-empty]")).toBeVisible();
  await expect(page.locator("[data-season-empty]")).toContainText("Nothing yet this season");
  await expect(page.locator("[data-season-event]")).toHaveCount(0);
  // The club is still named: an empty season, not a page that failed to find one.
  await expect(page.getByRole("main").locator(".page-kicker")).toHaveText(`${RUN} Golf Club`);
  expect(errors).toEqual([]);
});
