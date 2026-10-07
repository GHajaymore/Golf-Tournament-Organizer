import { test, expect, type Page } from "@playwright/test";
import { seedCasual, teardownCasual } from "./casual-fixture.mjs";

/**
 * A CASUAL ROUND, PLAYED THE WAY IT IS PLAYED: at the course, on a phone.
 *
 * Every casual-round fault of 2026-10-03/04 was found by walking this by hand:
 * the course search that found nothing, players asked before the format that
 * decides them, a review queue on a friendly, a foursomes side shortened as if
 * it were a person, the match result shown as a points table. Each walk found
 * the next one, and each was a separate fix. This walks it on every push.
 *
 * One test per format, each from the empty setup screen to the result:
 *
 *   set up    format, gross or net, the players, the course found by search
 *   score     every hole on the hole-by-hole card, as the scorer taps it
 *   keep      the card read back after a reload holds all eighteen holes
 *   result    the round's one screen says who won, by what, in golf's words
 *
 * ITS FIRST RUN FOUND TWO FAULTS THE HAND WALKS HAD NOT:
 *
 *   - a match card said "Saved" while most of its taps were still queued, so
 *     leaving the screen on that word kept 12 holes of 18;
 *   - a Modified Stableford round's dashboard said "Nothing to rank here yet"
 *     over two finished cards.
 *
 * THE SCORES ARE CHOSEN SO A WRONG RESULT LOOKS DIFFERENT. Everybody makes par
 * except the first side, which drops a shot on the 3rd and the 6th. So the
 * second side wins every format — a board that read the sides the wrong way
 * round, or never counted a hole, cannot print the right answer.
 *
 * In net the handicaps are EQUAL, so in match play nobody gets a shot off
 * anybody and the net result must equal the gross one. Modified Stableford is
 * the exception that proves the strokes land: the tee is rated 72.0 / 113 over
 * par 72, so a 10 index is 10 shots, on stroke index 1 to 10, and the points
 * below are worked from that card by hand.
 */

const FIRST_SIDE_DROPS_ON = new Set([3, 6]);

/** The run's user owns no club, so the course comes from the search. */
test.beforeAll(async () => {
  const { session } = await seedCasual();
  process.env.CASUAL_SESSION = session;
});
test.afterAll(async () => {
  await teardownCasual();
});

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  // A phone's walk. A desktop opens score entry on the full eighteen-hole
  // grid, by design, and a round at the course is not scored from one.
  test.skip(testInfo.project.name === "desktop", "scored on a phone, hole by hole");
  await context.addCookies([{ name: "ng_session", value: process.env.CASUAL_SESSION!, url: baseURL! }]);
});

const ANN = "Ann Zed";
const BEA = "Bea Zed";
const CAT = "Cat Zed";
const DOT = "Dot Zed";

/** The setup screen, top to bottom, in the order it asks. */
async function setUp(
  page: Page,
  format: string,
  net: boolean,
  names: string[],
  money?: { game: string; stake: string },
) {
  const errors: string[] = [];
  // With the page it came from: "a screen threw" is no use without which one.
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));

  await page.goto("/match/new");
  await page.getByRole("button", { name: new RegExp(`^${format}\\b`) }).click();
  await page.getByRole("button", { name: net ? /off handicaps \(net\)/ : /play level \(gross\)/ }).click();

  if (money) {
    await page.getByRole("button", { name: money.game, exact: true }).click();
    await page.getByLabel("Stake per player").fill(money.stake);
  }

  for (const [i, name] of names.entries()) {
    const box = page.getByRole("combobox", { name: `Player ${i + 1} name` });
    if (!(await box.count())) await page.getByRole("button", { name: /Add a player/ }).click();
    await box.fill(name);
    if (net) await page.getByRole("textbox", { name: `Handicap for ${name}` }).fill("10");
  }

  // Found by typing, the way it is at the course — not picked from a club
  // library this person does not have.
  const course = page.getByRole("combobox", { name: "Where are you playing?" });
  await course.click();
  await course.fill("Fairway Meadows");
  const option = page.locator('#course-picker-list [role="option"]', { hasText: "Fairway Meadows" }).first();
  await expect(option, "the course search found nothing").toBeVisible({ timeout: 20_000 });
  await option.click();
  await expect(course).toHaveValue(/Fairway Meadows/);

  const start = page.getByRole("button", { name: /Start the (round|match)/ });
  await expect(start, "Start is refused with every question answered").toBeEnabled();
  await start.click();
  await page.waitForURL((u) => !u.pathname.startsWith("/match/new"), { timeout: 30_000 });
  expect(errors, "the setup screen threw").toEqual([]);
}

/**
 * Every hole, every card on it: one tap makes par, a second drops a shot.
 * The first side's cards come first on the hole, in the order they were typed.
 *
 * Then the card is READ BACK from a reload, which is the only proof it was
 * kept. The screen's own "Saved" is what the scorer goes by, so that is what
 * this waits for — no extra grace period a person would not give it.
 */
async function scoreEveryHole(page: Page, firstSideCards: number) {
  await scoreHoles(page, (hole, card) => (FIRST_SIDE_DROPS_ON.has(hole) && card < firstSideCards ? 1 : 0));
}

/**
 * Every hole, every card on it, at par plus `toPar(hole, card)`: one tap makes
 * par, then one more per shot dropped or one fewer per shot saved. Cards come
 * on the hole in the order the players were typed.
 */
async function scoreHoles(page: Page, toPar: (hole: number, card: number) => number) {
  await page.goto("/entry");
  const plus = page.getByRole("button", { name: /^One more stroke for/ });
  const minus = page.getByRole("button", { name: /^One fewer stroke for/ });
  await expect(plus.first(), "the hole-by-hole card did not open").toBeVisible({ timeout: 30_000 });

  // ONE SCREEN (2026-10-06): on the first tee every player on the card is on
  // the phone without scrolling — measured at 393x727, where the fourth row
  // first ended at 808. A phone shorter than that (the 568px small-phone
  // project) cannot hold four rows of 44px targets, and is not asked to.
  const tall = page.viewportSize()!.height >= 727;
  if (tall) {
    const last = await plus.last().boundingBox();
    expect(last!.y + last!.height, "the last player on hole 1 is below the first screen").toBeLessThanOrEqual(727);
  }

  for (let hole = 1; hole <= 18; hole += 1) {
    const n = await plus.count();
    for (let i = 0; i < n; i += 1) {
      await plus.nth(i).click();
      const d = toPar(hole, i);
      for (let k = 0; k < Math.abs(d); k += 1) await (d > 0 ? plus : minus).nth(i).click();
    }
    if (hole < 18) await page.getByRole("button", { name: /^Next/ }).click();
  }

  // Every casual card keeps itself since 2026-10-06 — there is no Save button
  // to press, and the test must not find one: a card that needs one is a
  // round lost the day somebody walks off the 18th without pressing it.
  await expect(page.getByRole("button", { name: /^Save (scorecard|scores)/ })).toHaveCount(0);
  await expect(page.getByText("Saving…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/\bSaved\b/).first()).toBeVisible({ timeout: 30_000 });

  await page.goto(`/entry?bust=${Date.now()}`);
  await expect(plus.first()).toBeVisible({ timeout: 30_000 });
  const thru = [...(await page.locator("main").innerText()).matchAll(/thru (\d+)/g)].map((m) => Number(m[1]));
  expect(thru.length, "the card shows nobody's progress").toBeGreaterThan(0);
  expect(thru, "the card lost holes once the screen said Saved").toEqual(thru.map(() => 18));
}

/**
 * THE ROUND'S ONE SCREEN (2026-10-06), read fresh, past any cache — reached
 * the way a host reaches it from anywhere else in the app, through the
 * dashboard, which sends a casual round there.
 *
 * It must be ONE screen: the card, where the round stands and the money on
 * it, with no console tab bar or sidebar offering other doors to the same
 * facts.
 */
async function roundScreen(page: Page) {
  await page.goto(`/dashboard?bust=${Date.now()}`);
  await page.waitForURL(/\/entry/, { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  const text = await page.locator("main").innerText();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wide, "the round screen scrolls sideways").toBeLessThanOrEqual(0);
  // A friendly has no reviewer — #773.
  expect(text).not.toMatch(/awaiting review|confirm (the )?card|dispute/i);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The round");
  await expect(page.getByRole("button", { name: /^One more stroke for/ }).first(), "the card is not on the round screen").toBeVisible();
  await expect(page.locator(".m-tabbar"), "a console tab bar beside the one screen").toHaveCount(0);
  await expect(page.locator(".app-sidebar"), "a console sidebar beside the one screen").toHaveCount(0);
  return text;
}

test.describe("a casual round at the course", () => {
  test.describe.configure({ timeout: 180_000 });

  test("match play, net, two players", async ({ page }) => {
    await setUp(page, "Match Play", true, [ANN, BEA]);
    await scoreEveryHole(page, 1);
    await roundScreen(page);
    // Two down after the 6th and halved from there: over with one to play.
    await expect(page.locator("[data-match-line]")).toHaveText(`${BEA} won 2&1`);
  });

  test("stroke play, gross, three players", async ({ page }) => {
    await setUp(page, "Stroke Play", false, [ANN, BEA, CAT]);
    await scoreEveryHole(page, 1);
    const text = await roundScreen(page);
    const bea = text.search(new RegExp(`${BEA}\\s+72\\s+E\\b`));
    const cat = text.search(new RegExp(`${CAT}\\s+72\\s+E\\b`));
    const ann = text.search(new RegExp(`${ANN}\\s+74\\s+\\+2\\b`));
    expect([bea, cat, ann], "a row is missing or wrong").not.toContain(-1);
    expect(ann, "the dropped shots are not last").toBeGreaterThan(Math.max(bea, cat));
  });

  test("a skins game for money, gross, three players", async ({ page }) => {
    /**
     * Ten dollars each, so a thirty-dollar pot. Everybody pars every hole but
     * two: Ann birdies the 3rd, taking it and the two tied holes carried into
     * it — 3 skins — and Bea birdies the 10th, taking holes 4 to 10 — 7 skins.
     * Holes 11 to 18 are all tied, so nobody wins them.
     *
     * The pot divides by the skins actually WON (skins-pot.ts), ten of them:
     * Ann 3/10 of $30 = $9, Bea 7/10 = $21, Cat nothing. Net: Ann -$1, Bea
     * +$11, Cat -$10, which sums to nothing — money is moved between players,
     * never made or lost.
     *
     * A carry that did not carry gives Ann 1 skin and Bea 1; a pot divided by
     * all eighteen holes pays Bea $11.67; a game read as net from a gross
     * round, or the local currency lost, prints different words. None of them
     * prints this table.
     */
    await setUp(page, "Stroke Play", false, [ANN, BEA, CAT], { game: "Skins", stake: "10" });
    await scoreHoles(page, (hole, card) => ((hole === 3 && card === 0) || (hole === 10 && card === 1) ? -1 : 0));

    await page.goto(`/group-games?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle");
    const text = await page.locator("main").innerText();
    expect(text, "the pot is still provisional with every card in").not.toMatch(/Provisional/);
    // Headings are capitals on screen — CSS, which innerText reports.
    expect(text, "the money is not in the local currency").toMatch(/Won \(\$\)/i);
    expect(text).toMatch(/10 skins actually won/);
    const row = (name: string, skins: number, won: string, net: string) =>
      new RegExp(`${name}\\s+${skins}\\s+${won}(\\.00)?\\s+10(\\.00)?\\s+${net}(\\.00)?\\b`);
    expect(text).toMatch(row(BEA, 7, "21", "\\+11"));
    expect(text).toMatch(row(ANN, 3, "9", "[-−]1"));
    expect(text).toMatch(row(CAT, 0, "0", "[-−]10"));
    // What they actually do on the eighteenth green: two handovers, both to Bea.
    expect(text).toContain(`${CAT} pays ${BEA} $10.00`);
    expect(text).toContain(`${ANN} pays ${BEA} $1.00`);
    expect(text.match(/ pays /g)?.length, "more handovers than the pot needs").toBe(2);

    // And on the round's one screen, under the card, the same two handovers —
    // the money once it is final, without opening the money page.
    const one = await roundScreen(page);
    expect(one).toContain(`${CAT} pays ${BEA} $10.00`);
    expect(one).toContain(`${ANN} pays ${BEA} $1.00`);
  });

  test("two friends score their own cards by the round code, on their own phones", async ({ page, browser, baseURL }, testInfo) => {
    /**
     * The round is set up on one phone and the code read out on the first
     * tee. Each friend opens the app with NO ACCOUNT, types the code, taps
     * their own name and keeps their own card — the one-player pad that moves
     * to the next hole by itself.
     *
     * Ann pars every hole: 72. Bea birdies the 5th: 71. So Bea leads by a
     * shot on the host's own screen, gross. A card that never reached the
     * server, a score filed under the other friend, or a hole the pad skipped
     * past prints something else.
     */
    await setUp(page, "Stroke Play", false, [ANN, BEA]);
    // Above the card, where the first tee is looking (2026-10-06).
    await page.goto(`/entry?bust=${Date.now()}`);
    const code = (await page.locator("code").filter({ hasText: /^[A-Z0-9-]{6,}$/ }).first().innerText()).trim();
    expect(code, "the round screen shows no round code").toMatch(/^[A-Z0-9-]{6,}$/);

    const phone = async (name: string, birdieOn: number | null) => {
      const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
      try {
        const p = await ctx.newPage();
        await p.goto("/play");
        await p.getByLabel("Round code").fill(code);
        await p.getByRole("button", { name: "Continue" }).click();
        await p.getByRole("button", { name, exact: true }).click();
        await expect(p.getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 30_000 });
        for (let hole = 1; hole <= 18; hole += 1) {
          // The pad moves on by itself; the hole on screen is the proof it did.
          await expect(p.getByLabel(`Strokes on hole ${hole}`)).toBeVisible();
          await p.getByRole("button", { name: hole === birdieOn ? /Birdie$/ : /Par$/ }).click();
        }
        await expect(p.getByText("18/18 holes")).toBeVisible();
        // Reached the host AS PLAYED, before anybody signs anything — the
        // round is followed hole by hole. (Certifying saves the card too, so
        // without this a phone that never sent a hole would still pass.)
        await expect(async () => {
          await page.goto(`/entry?bust=${Date.now()}`);
          const host = await page.locator("main").innerText();
          expect(host).toMatch(new RegExp(`${name.split(" ")[0]}\\n[^\\n]*thru 18`));
        }).toPass({ timeout: 30_000 });
        await p.getByRole("button", { name: /Certify my card/ }).click();
        await expect(p.getByRole("button", { name: /Certified/ })).toBeVisible({ timeout: 20_000 });
        // A friendly: the card is final the moment it is signed.
        await expect(p.getByText(/nobody else has to accept it/)).toBeVisible();
      } finally {
        await ctx.close();
      }
    };
    await phone(ANN, null);
    await phone(BEA, 5);

    const text = await roundScreen(page);
    const bea = text.search(new RegExp(`${BEA}\\s+71\\s+[-−]1\\b`));
    const ann = text.search(new RegExp(`${ANN}\\s+72\\s+E\\b`));
    expect([bea, ann], `a friend's card did not reach the host's screen:\n${text}`).not.toContain(-1);
    expect(ann, "the shot saved is not in front").toBeGreaterThan(bea);
  });

  test("modified stableford, net, two players", async ({ page }) => {
    await setUp(page, "Modified Stableford", true, [ANN, BEA]);
    await scoreEveryHole(page, 1);
    const text = await roundScreen(page);
    // Ten shots on stroke index 1 to 10. Bea pars everything: ten net birdies
    // at 2 points, 20. Ann loses a point on the 3rd (index 11, no shot) and
    // holds net par on the 6th (index 5, a shot): nine net birdies less one, 17.
    // Columns on the round screen: gross, points — the handicaps are behind
    // More and the holes are on the card (2026-10-06).
    expect(text).not.toMatch(/Nothing to rank here yet/);
    const bea = text.search(new RegExp(`${BEA}\\s+72\\s+20\\b`));
    const ann = text.search(new RegExp(`${ANN}\\s+74\\s+17\\b`));
    expect([bea, ann], "a row is missing or wrong").not.toContain(-1);
    expect(ann, "fewer points ranked first").toBeGreaterThan(bea);
    // The figure the table is RANKED on must be on the phone, not past its
    // edge behind a sideways scroll — the first walk found it there.
    const points = await page.getByRole("columnheader", { name: "Points" }).boundingBox();
    const width = page.viewportSize()!.width;
    expect(points, "no Points column").not.toBeNull();
    expect(points!.x + points!.width, "Points is off the edge of the phone").toBeLessThanOrEqual(width);
  });

  test("four-ball, net, four players", async ({ page }) => {
    await setUp(page, "Four-Ball", true, [ANN, BEA, CAT, DOT]);
    await scoreEveryHole(page, 2);
    await roundScreen(page);
    await expect(page.locator("[data-match-line]")).toHaveText(`${CAT} & ${DOT} won 2&1`);
  });

  test("foursomes, gross, four players", async ({ page }) => {
    await setUp(page, "Foursomes", false, [ANN, BEA, CAT, DOT]);
    await scoreEveryHole(page, 1);
    await roundScreen(page);
    await expect(page.locator("[data-match-line]")).toHaveText(`${CAT} & ${DOT} won 2&1`);
  });
});
