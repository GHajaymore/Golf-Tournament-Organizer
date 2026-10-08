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
  /** Each player's handicap on a net round, in the order typed; 10 for all if not given. */
  handicaps?: number[],
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
    if (net) await page.getByRole("textbox", { name: `Handicap for ${name}` }).fill(String(handicaps?.[i] ?? 10));
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
  // Nor does a table on it hide its last column in a sideways scroll: that
  // column — To par, Points — is the one a row is read for. Clipped at 320px
  // by 9px until 2026-10-07.
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll("main table tr > :last-child")].flatMap((c) => {
      const r = c.getBoundingClientRect();
      const wrap = (c.closest("table")!.parentElement as HTMLElement).getBoundingClientRect();
      const edge = Math.min(wrap.right, window.innerWidth);
      return r.width > 0 && r.right > edge + 0.5 ? [`${c.textContent?.trim()} ends ${Math.round(r.right)} > ${Math.round(edge)}`] : [];
    }),
  );
  expect(cut, "a table's last column is cut off").toEqual([]);
  // A friendly has no reviewer — #773.
  expect(text).not.toMatch(/awaiting review|confirm (the )?card|dispute/i);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The round");
  // A stroke card's steppers, or a gross match's "who won the hole".
  await expect(
    page.getByRole("button", { name: /^One more stroke for|^Hole \d+ (to |halved$)/ }).first(),
    "the card is not on the round screen",
  ).toBeVisible();
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

  test("match play, gross, two players, for a tenner: who won each hole", async ({ page }) => {
    /**
     * A gross match among friends is written down as who won each hole, not
     * strokes — and on the one screen that is one hole at a time, like every
     * other casual card (2026-10-07). It opened on the organizer's 900px grid
     * of eighteen 32px pickers, sideways-scrolling on a phone.
     *
     * Ann wins the 2nd and 4th, Bea the 11th, 13th and 15th, the rest are
     * halved: Bea wins 1 up, and "the match" for $10 is one handover.
     */
    await setUp(page, "Match Play", false, [ANN, BEA], { game: "The match", stake: "10" });
    await page.goto(`/entry?bust=${Date.now()}`);
    const first = page.getByRole("button", { name: `Hole 1 to ${BEA}` });
    await expect(first, "the hole-by-hole result card did not open").toBeVisible({ timeout: 30_000 });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(wide, "the match card scrolls the page sideways").toBeLessThanOrEqual(0);
    const box = (await first.boundingBox())!;
    // Thumb-sized on every phone — the grid's pickers are 32px, for a row of
    // eighteen — and inside the screen rather than in a sideways scroll.
    expect(box.height, "hole 1's answers are not thumb-sized").toBeGreaterThanOrEqual(44);
    expect(box.x + box.width, "hole 1's answers run off the screen").toBeLessThanOrEqual(page.viewportSize()!.width);
    if (page.viewportSize()!.height >= 727) {
      expect(box.y + box.height, "hole 1's answers are below the first screen").toBeLessThanOrEqual(727);
    }

    const winner = (h: number) => ([2, 4].includes(h) ? ANN : [11, 13, 15].includes(h) ? BEA : null);
    for (let h = 1; h <= 18; h += 1) {
      const w = winner(h);
      // The card moves to the next hole by itself: wait for each one rather
      // than tapping ahead of it, as a scorer would.
      const answer = page.getByRole("button", { name: w ? `Hole ${h} to ${w}` : `Hole ${h} halved` });
      await expect(answer).toBeVisible();
      await answer.click();
      await expect(answer).toHaveAttribute("aria-pressed", "true");
      if (h === 9) {
        // At the turn, read fresh: the card reopens on the 10th, the match
        // stands where nine holes put it, and the money waits for the end —
        // in a match's words, since there is no card to wait for.
        await expect(page.getByText("Saving…")).toHaveCount(0, { timeout: 30_000 });
        const turn = await roundScreen(page);
        await expect(page.locator("[data-match-line]")).toHaveText(new RegExp(`^${ANN} 2 up through 9$`));
        expect(turn).toContain("Who pays whom shows here when the match is over.");
        expect(turn, "money settled at the turn").not.toMatch(/ pays [^\n]*\$\d/);
        await expect(page.getByRole("button", { name: "Hole 10 halved" })).toBeVisible();
      }
    }
    await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);
    await expect(page.getByText("Saving…")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText(/\bSaved\b/).first()).toBeVisible({ timeout: 30_000 });

    // Read back past every cache: the result, then the money, on the one screen.
    const text = await roundScreen(page);
    await expect(page.locator("[data-match-line]")).toHaveText(new RegExp(`^${BEA} won 1 up$`, "i"));
    expect(text).toContain(`${ANN} pays ${BEA} $10.00`);
    expect(text.match(/ pays /g)?.length, "more handovers than one bet needs").toBe(1);

    // "The money in full" says the same answer, and says it in full: where
    // each player ends up as well as the handover. It held three stake boxes
    // and never the result for every game but skins (2026-10-07).
    await page.goto(`/group-games?bust=${Date.now()}`);
    const result = page.getByRole("region", { name: "Where the money ends up" });
    await expect(result).toContainText(`${ANN} pays ${BEA} $10.00`);
    const positions = await result.locator("[data-position]").allInnerTexts();
    expect(positions.map((p) => p.replace(/\s+/g, " ").trim()).sort()).toEqual(
      [`${ANN} −$10.00`, `${BEA} +$10.00`].sort(),
    );

    // Only the game being played, then "Add a game" (2026-10-07). An empty
    // skins card and five blank stake boxes beside one $10 bet read, to the
    // owner, as "a bunch of rounds".
    await expect(page.getByText("The match", { exact: true })).toBeVisible();
    for (const idle of ["Low gross", "Birdie pot", "Nassau"]) {
      await expect(page.getByText(idle, { exact: true }), `${idle} is listed though nobody is playing it`).toBeHidden();
    }
    await expect(page.getByText(/Everyone in this round — Skins/)).toBeHidden();
    await page.locator("summary", { hasText: "Add a game" }).click();
    await expect(page.getByText("Low gross", { exact: true })).toBeVisible();
    await expect(page.getByText(/Everyone in this round — Skins/)).toBeVisible();
  });

  test("a hole entered just before leaving the screen is kept", async ({ page }) => {
    /**
     * The card saves itself 600ms after the last tap. Leaving inside that
     * window cleared the timer with the screen, and the hole never went
     * (2026-10-07) — enter the 18th, tap Export, and the round's last hole
     * was gone. Now a waiting save goes the moment the screen does.
     */
    await setUp(page, "Stroke Play", false, [ANN, BEA]);
    await page.goto(`/entry?bust=${Date.now()}`);
    const plus = page.getByRole("button", { name: /^One more stroke for/ });
    await expect(plus.first()).toBeVisible({ timeout: 30_000 });
    // More open first: it is beside the card and changes nothing on it.
    await page.locator("summary", { hasText: /^More:/ }).click();
    const leave = page.getByRole("link", { name: /Export this round/ });
    await expect(leave).toBeVisible();
    // Par for both, and straight out — no wait for "Saved".
    await plus.nth(0).click();
    await plus.nth(1).click();
    await leave.click();
    await page.waitForURL(/\/reports/);

    await expect(async () => {
      await page.goto(`/entry?bust=${Date.now()}`);
      const card = await page.locator("main").innerText();
      expect(card.match(/\bE thru 1\b/g)?.length ?? 0, "the hole entered before leaving was lost").toBe(2);
    }).toPass({ timeout: 20_000 });
  });

  test("a Nassau whose overall is won early still plays the back nine for money", async ({ page }) => {
    /**
     * $10 a bet. Ann wins the 1st-5th and 10th-12th, the rest halved so far:
     * the front is Ann's 5&4 and the overall Ann's 8&6 after the 12th — but
     * the BACK nine is Ann 3 up with six to play, and they play on for it.
     * Bea wins the 13th-18th and takes the back 3 up. Front +10 Ann, overall
     * +10 Ann, back +10 Bea: Bea pays Ann $10.
     *
     * The round's money was called final on the 12th green and said "Bea
     * pays Ann $20.00" for six holes before changing (2026-10-07).
     */
    await setUp(page, "Match Play", false, [ANN, BEA], { game: "Nassau", stake: "10" });
    await page.goto(`/entry?bust=${Date.now()}`);
    const winner = (h: number) => ([1, 2, 3, 4, 5, 10, 11, 12].includes(h) ? ANN : h >= 13 ? BEA : null);
    const play = async (from: number, to: number) => {
      for (let h = from; h <= to; h += 1) {
        const w = winner(h);
        const answer = page.getByRole("button", { name: w ? `Hole ${h} to ${w}` : `Hole ${h} halved` });
        await expect(answer).toBeVisible();
        await answer.click();
        await expect(answer).toHaveAttribute("aria-pressed", "true");
      }
      await expect(page.getByText("Saving…")).toHaveCount(0, { timeout: 30_000 });
    };

    await play(1, 12);
    const atTwelve = await roundScreen(page);
    await expect(page.locator("[data-match-line]")).toHaveText(new RegExp(`^${ANN} won 8&6$`, "i"));
    expect(atTwelve, "money settled with the back nine still being played for").not.toMatch(/ pays [^\n]*\$\d/);
    expect(atTwelve).toContain("Who pays whom shows here when the front, back and overall are all decided.");

    // The card is still open for the back nine: on to the 13th.
    await play(13, 18);
    const done = await roundScreen(page);
    expect(done).toContain(`${BEA} pays ${ANN} $10.00`);
    expect(done.match(/ pays [^\n]*\$\d/g)?.length, "more handovers than the bets need").toBe(1);
  });

  test("a player who leaves at the turn keeps their stake and what they made", async ({ page }) => {
    /**
     * A $10 birdie pot, everyone in. Cat birdies the 3rd and walks off after
     * the 9th; Ann birdies the 12th. Cat's $10 stays in — withdrawing is not a
     * refund — so the $40 pot divides by the two birdies made: Ann +$10, Cat
     * +$10, Bea and Dot -$10.
     *
     * Cat read "square" (2026-10-07): her default stake vanished with her
     * place in the field, and Ann's one birdie took a $30 pot.
     */
    await setUp(page, "Stroke Play", false, [ANN, BEA, CAT, DOT], { game: "Birdie pot", stake: "10" });
    const toPar = (h: number, name: string) => ((h === 3 && name === CAT) || (h === 12 && name === ANN) ? -1 : 0);
    const play = async (from: number, to: number) => {
      await page.goto(`/entry?bust=${Date.now()}`);
      await page.locator(".hole-nav-btn").nth(from - 1).click();
      for (let h = from; h <= to; h += 1) {
        const plus = page.getByRole("button", { name: new RegExp(`^One more stroke for .* on hole ${h}$`) });
        await expect(plus.first()).toBeVisible();
        const names = await plus.evaluateAll((bs) =>
          bs.map((b) => (b.getAttribute("aria-label") ?? "").replace(/^One more stroke for (.*) on hole \d+$/, "$1")),
        );
        for (const name of names) {
          const more = page.getByRole("button", { name: `One more stroke for ${name} on hole ${h}` });
          const fewer = page.getByRole("button", { name: `One fewer stroke for ${name} on hole ${h}` });
          await more.click();
          const d = toPar(h, name);
          for (let k = 0; k < Math.abs(d); k += 1) await (d > 0 ? more : fewer).click();
        }
        if (h < 18) await page.getByRole("button", { name: /^Next/ }).click();
      }
      await expect(page.getByText("Saving…")).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByText(/\bSaved\b/).first()).toBeVisible({ timeout: 30_000 });
    };

    await play(1, 9);
    await page.goto(`/entry?bust=${Date.now()}`);
    await page.locator("summary", { hasText: /^More:/ }).click();
    await page.getByRole("button", { name: `Take ${CAT} out of this round` }).click();
    await page.getByRole("button", { name: "Take them out" }).click();
    await expect(page.getByRole("button", { name: `Take ${CAT} out of this round` })).toHaveCount(0, { timeout: 20_000 });
    await play(10, 18);

    await page.goto(`/group-games?bust=${Date.now()}`);
    const result = page.getByRole("region", { name: "Where the money ends up" });
    const positions = (await result.locator("[data-position]").allInnerTexts()).map((p) => p.replace(/\s+/g, " ").trim()).sort();
    expect(positions, "the leaver's stake was refunded or their birdie lost").toEqual(
      [`${ANN} +$10.00`, `${CAT} +$10.00`, `${BEA} −$10.00`, `${DOT} −$10.00`].sort(),
    );
    // And the pot names who is in it, the leaver included.
    await expect(page.getByText(`${CAT} — left, stake kept`)).toBeVisible();
  });

  test("skins off handicaps: one shot wins a hole, and the carry follows it", async ({ page }) => {
    /**
     * Ann and Bea off 0, Cat off 1 — her one shot on stroke index 1, the 4th.
     * Gross par everywhere but Ann's birdie on the 18th. Holes 1-3 tie and
     * carry; Cat's net 3 on the 4th wins it outright, four skins. Holes 5-17
     * tie and carry into the 18th, which Ann wins: fourteen. $30 over 18
     * skins: Ann $23.33 (+$13.33), Cat $6.67 (-$3.33), Bea -$10.
     *
     * A gross reading pays Cat nothing; a carry that does not carry pays one
     * skin each; dividing by holes rather than skins won leaves $0 behind.
     */
    await setUp(page, "Stroke Play", true, [ANN, BEA, CAT], { game: "Skins", stake: "10" }, [0, 0, 1]);
    await scoreHoles(page, (hole, card) => (hole === 18 && card === 0 ? -1 : 0));
    await page.goto(`/group-games?bust=${Date.now()}`);
    const text = await page.locator("main").innerText();
    expect(text).toMatch(/Skins — net/i);
    const row = (name: string, skins: number, won: string, net: string) =>
      new RegExp(`${name}\\s+${skins}\\s+${won}\\s+${net}\\b`);
    expect(text).toMatch(row(ANN, 14, "23\\.33", "\\+13\\.33"));
    expect(text).toMatch(row(CAT, 4, "6\\.67", "[-−]3\\.33"));
    expect(text).toMatch(row(BEA, 0, "0\\.00", "[-−]10\\.00"));
  });

  test("a game added mid-round is everyone's, and two games settle as one", async ({ page }) => {
    /**
     * A $5 birdie pot set up with the round; a $10 low net added from the
     * money page, the way four friends agree it on the 5th tee. Ann and Bea
     * off 0, Cat and Dot off 4. Ann birdies the 1st (71); Cat and Dot make
     * two bogeys each (74 gross, 70 net); Bea pars round (72).
     *
     *   low net    Cat and Dot tie on 70 and split $40: +$10 each, Ann and
     *              Bea -$10
     *   birdies    Ann's one birdie takes $20: +$15, the rest -$5
     *   together   Ann +$5, Cat +$5, Dot +$5, Bea -$15 — one settle-up
     *
     * A game added later sat at "In the pot (0)" and settled nothing, under a
     * heading saying "Everyone in this round is in" (2026-10-07). Skins
     * started later did the same.
     */
    await setUp(page, "Stroke Play", true, [ANN, BEA, CAT, DOT], { game: "Birdie pot", stake: "5" }, [0, 0, 4, 4]);
    await page.goto(`/group-games?bust=${Date.now()}`);
    const fold = page.locator("details", { has: page.locator("summary", { hasText: "Add a game" }) });
    if (!(await fold.evaluate((d) => (d as HTMLDetailsElement).open))) await page.locator("summary", { hasText: "Add a game" }).click();
    const lowNet = page.locator("div").filter({ has: page.getByText("Low net", { exact: true }) }).last().locator('input[placeholder="0.00"]');
    await lowNet.fill("10");
    await lowNet.press("Tab");
    await expect(async () => {
      await page.goto(`/group-games?bust=${Date.now()}`);
      const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      const at = text.indexOf("Low net");
      expect(text.slice(at, at + 400), "a game added mid-round started with nobody in it").toContain("In the pot (4)");
    }).toPass({ timeout: 20_000 });

    // Skins started later is everyone's too.
    if (!(await fold.evaluate((d) => (d as HTMLDetailsElement).open))) await page.locator("summary", { hasText: "Add a game" }).click();
    await page.getByLabel(/Buy-in/).fill("2");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(async () => {
      await page.goto(`/group-games?bust=${Date.now()}`);
      await expect(page.getByText(/In the pot — 4 players/i)).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    // Take the skins back off, so the figures below are the two games'.
    await page.getByLabel(/Buy-in/).fill("0");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForLoadState("networkidle");

    await scoreHoles(page, (hole, card) =>
      hole === 1 && card === 0 ? -1 : (card === 2 && (hole === 5 || hole === 6)) || (card === 3 && (hole === 7 || hole === 8)) ? 1 : 0,
    );
    await page.goto(`/group-games?bust=${Date.now()}`);
    const positions = (await page.getByRole("region", { name: "Where the money ends up" }).locator("[data-position]").allInnerTexts())
      .map((p) => p.replace(/\s+/g, " ").trim())
      .sort();
    expect(positions).toEqual([`${ANN} +$5.00`, `${BEA} −$15.00`, `${CAT} +$5.00`, `${DOT} +$5.00`].sort());
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
    // Player, skins, won, net. No "in" column: everyone's in is the buy-in,
    // which the pot line states once ("3 × $10.00").
    expect(text).toMatch(/3 × \$10\.00 = \$30\.00/);
    const row = (name: string, skins: number, won: string, net: string) =>
      new RegExp(`${name}\\s+${skins}\\s+${won}(\\.00)?\\s+${net}(\\.00)?\\b`);
    expect(text).toMatch(row(BEA, 7, "21", "\\+11"));
    expect(text).toMatch(row(ANN, 3, "9", "[-−]1"));
    expect(text).toMatch(row(CAT, 0, "0", "[-−]10"));
    // What they actually do on the eighteenth green: two handovers, both to Bea.
    expect(text).toContain(`${CAT} pays ${BEA} $10.00`);
    expect(text).toContain(`${ANN} pays ${BEA} $1.00`);
    // Counted per section: the page's own result card (2026-10-07) and the
    // pot's settling-up say the same two handovers, and neither may add one.
    const result = await page.getByRole("region", { name: "Where the money ends up" }).innerText();
    expect(result.match(/ pays /g)?.length, "more handovers than the pot needs").toBe(2);
    expect(result).toContain(`${CAT} pays ${BEA} $10.00`);
    expect(result).toContain(`${ANN} pays ${BEA} $1.00`);
    expect(text.match(/ pays /g)?.length, "a handover said by only one of the two").toBe(4);
    // Each player's net is the figure they read for, so it is on the phone's
    // screen without scrolling the table sideways: at 393px a fifth column
    // pushed it past the edge (2026-10-07).
    const nets = await page.locator("td[data-net]").evaluateAll((cells) =>
      cells.map((c) => {
        const box = c.getBoundingClientRect();
        const wrap = (c.closest("table")?.parentElement ?? document.body).getBoundingClientRect();
        return { text: c.textContent, right: Math.round(box.right), edge: Math.round(Math.min(wrap.right, innerWidth)) };
      }),
    );
    expect(nets.length, "no net figures on the money page").toBe(3);
    for (const n of nets) expect(n.right, `net ${n.text} is cut off`).toBeLessThanOrEqual(n.edge);

    // The record of what was agreed, as the host reads it back under Export:
    // in dollars, named as the setup named it. It read "Skins at 1000c a head".
    await page.goto(`/reports?bust=${Date.now()}`);
    const log = await page.locator("main").innerText();
    expect(log).toContain("Skins at $10.00 a head, 3 in");
    expect(log, "money in the change log in raw cents").not.toMatch(/\d+c a head/);
    // A finished round kept on the host's phone is IN, the way its money is —
    // it read "Cards in 0/3" and "Nothing returned for this round yet".
    expect(log).toMatch(/cards in\s*3\/3/i);
    expect(log).toContain("Every card is in — this is the result.");
    expect(log).not.toMatch(/Nothing returned/);
    // And none of a tournament's furniture: no flights, nobody advancing.
    expect(log).not.toMatch(/\bflights\b|advancing|flight results|weekly sign-up|tee sheet/i);
    // The table the round's own screen shows: on a level round nobody gets
    // shots, so a Net column only repeats the Gross — and it pushed To par
    // off a 320px phone (2026-10-07).
    await expect(page.getByRole("columnheader", { name: "Net", exact: true })).toHaveCount(0);
    const cutOnExport = await page.evaluate(() =>
      [...document.querySelectorAll("main table tr > :last-child")].flatMap((c) => {
        const r = c.getBoundingClientRect();
        const edge = Math.min((c.closest("table")!.parentElement as HTMLElement).getBoundingClientRect().right, innerWidth);
        return r.width > 0 && r.right > edge + 0.5 ? [`${c.textContent?.trim()} ends ${Math.round(r.right)}`] : [];
      }),
    );
    expect(cutOnExport, "the export's last column is cut off").toEqual([]);

    // And on the round's one screen, under the card, the same two handovers —
    // the money once it is final, without opening the money page.
    const one = await roundScreen(page);
    expect(one).toContain(`${CAT} pays ${BEA} $10.00`);
    expect(one).toContain(`${ANN} pays ${BEA} $1.00`);
  });

  test("the host who plays reads their own money and board as one round's", async ({ page }) => {
    /**
     * The host left in as Player 1, the way the form prefills them, against
     * Bea for $10 gross skins. The host birdies the 3rd, which takes the three
     * skins carried to it; the rest are halved and unclaimed, so the host is
     * +$10 and Bea -$10.
     *
     * Their player screens spoke tournament until 2026-10-07: Money said
     * "You're up over the whole tournament" over a lone "Round 1" line that
     * repeated the total, and Board put "Flight 1" beside both names, a word
     * the round shows nowhere else.
     */
    const HOST = "Casey Fairway";
    await setUp(page, "Stroke Play", false, [HOST, BEA], { game: "Skins", stake: "10" });
    await scoreHoles(page, (hole, card) => (hole === 3 && card === 0 ? -1 : 0));

    await page.goto(`/me/money?bust=${Date.now()}`);
    const money = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    expect(money).toMatch(/You.re up on this round \+\$10\.00/);
    expect(money).not.toMatch(/whole tournament|Round 1/);
    const positionsOn = async (path: string) => {
      await page.goto(`${path}?bust=${Date.now()}`);
      return (await page.locator("main [data-position]").allInnerTexts()).map((p) => p.replace(/\s+/g, " ").trim()).sort();
    };
    const mine = await positionsOn("/me/money");
    expect(mine).toEqual([`${BEA} −$10.00`, `${HOST} +$10.00`]);
    // And word for word what the round's own money page says: the host reads
    // both, and the first draft printed "-$10.00" here against "−$10.00" there.
    expect(mine, "the player's money and the round's money spell one figure two ways").toEqual(await positionsOn("/group-games"));

    await page.goto(`/me/board?bust=${Date.now()}`);
    const board = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    // The control: the board is the round's, with both players on it.
    expect(board).toMatch(new RegExp(`1 ${HOST} F -1 2 ${BEA} F E`));
    expect(board).not.toContain("Flight");
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
    // First in the round screen's More, named there (2026-10-06): most groups
    // keep one card on one phone, so the code is not on the screen all round.
    await page.goto(`/entry?bust=${Date.now()}`);
    const more = page.locator("summary", { hasText: /^More: Friends’ code|^More: Friends' code/ });
    await expect(more, "More does not name the friends' code").toBeVisible();
    await more.click();
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
        // BOGEY ON THE FIRST SCREEN (2026-10-07). The pad's second row — the
        // commonest score in the amateur game — sat below the fold at 393x727
        // under the mic's own row and notes. Measured against 727 on any phone
        // at least that tall; the 568px small-phone cannot hold the pad.
        if (p.viewportSize()!.height >= 727) {
          const bogey = await p.getByRole("button", { name: /Bogey$/ }).boundingBox();
          expect(bogey, "no Bogey on the pad").not.toBeNull();
          expect(bogey!.y + bogey!.height, "Bogey is below the first screen").toBeLessThanOrEqual(727);
        }
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

  test("a friend keeps a gross match on their own phone by the round code", async ({ page, browser, baseURL }, testInfo) => {
    /**
     * Bea joins Ann's match by the code and keeps the match herself, one hole
     * at a time, from HER side: "Me" is Bea and the other answer is Ann
     * (2026-10-07 — it was eighteen tiles of 28px "Me / ½ / Opp" buttons).
     * Bea is the second player, so every result she taps is flipped before it
     * is stored. Ann wins the 2nd and 4th, Bea the 11th, 13th and 15th:
     * Bea wins 1 up on the HOST's screen. A flip that went the wrong way
     * prints Ann.
     */
    await setUp(page, "Match Play", false, [ANN, BEA]);
    await page.goto(`/entry?bust=${Date.now()}`);
    await page.locator("summary", { hasText: /^More: Friends/ }).click();
    const code = (await page.locator("code").filter({ hasText: /^[A-Z0-9-]{6,}$/ }).first().innerText()).trim();

    const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
    try {
      const p = await ctx.newPage();
      await p.goto("/play");
      await p.getByLabel("Round code").fill(code);
      await p.getByRole("button", { name: "Continue" }).click();
      await p.getByRole("button", { name: BEA, exact: true }).click();
      const mine = p.getByRole("button", { name: "Hole 1 to you" });
      await expect(mine, "the friend's match card did not open on hole 1").toBeVisible({ timeout: 30_000 });
      const box = (await mine.boundingBox())!;
      expect(box.height, "the friend's answers are not thumb-sized").toBeGreaterThanOrEqual(44);
      expect(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), "/play scrolls sideways").toBeLessThanOrEqual(0);

      for (let h = 1; h <= 18; h += 1) {
        const name = [2, 4].includes(h) ? `Hole ${h} to ${ANN}` : [11, 13, 15].includes(h) ? `Hole ${h} to you` : `Hole ${h} halved`;
        const answer = p.getByRole("button", { name });
        await expect(answer).toBeVisible();
        await answer.click();
        await expect(answer).toHaveAttribute("aria-pressed", "true");
      }
      await expect(p.getByText("18/18 holes")).toBeVisible();
      await expect(async () => {
        await page.goto(`/entry?bust=${Date.now()}`);
        await expect(page.locator("[data-match-line]")).toHaveText(new RegExp(`^${BEA} won 1 up$`, "i"), { timeout: 1_000 });
      }).toPass({ timeout: 30_000 });
    } finally {
      await ctx.close();
    }
  });

  test("a friend keeping a net match by the code sees who gets a shot, where the host's card does", async ({ page, browser, baseURL }, testInfo) => {
    /**
     * Ann plays off 8 and Bea off 12. The tee is rated 72.0 / 113 over par
     * 72, so those are their course handicaps, and in match play the higher
     * receives the difference: Bea gets four shots, on stroke index 1 to 4 —
     * the 4th, 13th, 2nd and 11th on this card. None on the 1st (SI 7).
     *
     * Bea keeps the match by the code, tapping who won each hole — and that
     * turns on the shots, which her screen did not show (2026-10-07). It must
     * show them on the same holes as the host's own card for the same match,
     * or the two phones disagree about who won.
     */
    await setUp(page, "Match Play", true, [ANN, BEA], undefined, [8, 12]);
    // The host's card: Bea's dot on the 2nd, none on the 1st.
    await page.goto(`/entry?bust=${Date.now()}`);
    const beaRow = (hole: number) =>
      // The match card names its two players by first name.
      page.getByRole("button", { name: new RegExp(`^One more stroke for Bea( Zed)? on hole ${hole}$`) }).locator("xpath=..");
    await expect(beaRow(1)).toBeVisible({ timeout: 30_000 });
    await expect(beaRow(1), "the host's card gives Bea a shot on SI 7").not.toContainText("•");
    await page.getByRole("button", { name: /^Next/ }).click();
    await expect(beaRow(2), "the host's card gives Bea no shot on SI 3").toContainText("•");

    await page.locator("summary", { hasText: /^More: Friends/ }).click();
    const code = (await page.locator("code").filter({ hasText: /^[A-Z0-9-]{6,}$/ }).first().innerText()).trim();
    const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
    try {
      const p = await ctx.newPage();
      await p.goto("/play");
      await p.getByLabel("Round code").fill(code);
      await p.getByRole("button", { name: "Continue" }).click();
      await p.getByRole("button", { name: BEA, exact: true }).click();
      // Hole 1 (SI 7): nobody gets a shot. Exact names — a substring match
      // would accept ", who gets a shot" on the end and prove nothing.
      await expect(p.getByRole("button", { name: "Hole 1 to you", exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(p.getByRole("button", { name: `Hole 1 to ${ANN}`, exact: true })).toBeVisible();
      await p.getByRole("button", { name: "Hole 1 halved" }).click();
      // Hole 2 (SI 3): Bea's shot, on her own answer and not on Ann's.
      const mine2 = p.getByRole("button", { name: "Hole 2 to you, who gets a shot", exact: true });
      await expect(mine2, "the friend's screen gives Bea no shot where the host's card does").toBeVisible();
      await expect(mine2).toContainText("•");
      await expect(p.getByRole("button", { name: `Hole 2 to ${ANN}`, exact: true })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("a handicap corrected after the first hole is the one the round plays off", async ({ page }) => {
    /**
     * Both typed as 10 on the first tee; Bea is really a 20. The tee is rated
     * 72.0 / 113 over par 72, so a 10 gets a shot on stroke index 1-10 and a
     * 20 on every hole, two on SI 1-2. The 5th is SI 15: no shot for a 10,
     * one for a 20.
     *
     * The round froze both at 10 when the first hole went in, and the
     * correction in More saved to the roster and was ignored by the round —
     * the panel read 20 and the card still gave Bea a 10's shots (2026-10-07).
     */
    await setUp(page, "Stroke Play", true, [ANN, BEA]);
    await page.goto(`/entry?bust=${Date.now()}`);
    const plus = page.getByRole("button", { name: /^One more stroke for/ });
    await expect(plus.first()).toBeVisible({ timeout: 30_000 });
    await plus.nth(0).click();
    await plus.nth(1).click();
    await expect(page.getByText(/\bSaved\b/).first()).toBeVisible({ timeout: 30_000 });

    const beaDotsOn = async (hole: number) => {
      await page.goto(`/entry?bust=${Date.now()}`);
      await page.locator(".hole-nav-btn").nth(hole - 1).click();
      const row = page.getByRole("button", { name: `One more stroke for ${BEA} on hole ${hole}` }).locator("xpath=..");
      await expect(row).toBeVisible();
      return ((await row.innerText()).match(/•/g) ?? []).length;
    };
    expect(await beaDotsOn(5), "a 10 gets a shot on SI 15").toBe(0);

    await page.goto(`/entry?bust=${Date.now()}`);
    await page.locator("summary", { hasText: /^More:/ }).click();
    const box = page.getByRole("textbox", { name: `${BEA}'s handicap` });
    await box.fill("20");
    await box.press("Tab");
    await expect(async () => {
      expect(await beaDotsOn(5), "the round still plays Bea off the 10 typed on the first tee").toBe(1);
    }).toPass({ timeout: 20_000 });
    expect(await beaDotsOn(4), "a 20 gets two shots on SI 1").toBe(2);
  });

  test("switching to off handicaps after the first hole asks, then does it", async ({ page }) => {
    /**
     * The group starts level and decides on the 2nd tee to play off
     * handicaps. Both switches in More re-score the cards already in, so the
     * action answers "confirm first" once a card exists — and the panel threw
     * that answer away: after the first hole the buttons did nothing, under a
     * promise that nothing is locked (2026-10-07).
     */
    await setUp(page, "Stroke Play", false, [ANN, BEA]);
    await page.goto(`/entry?bust=${Date.now()}`);
    const plus = page.getByRole("button", { name: /^One more stroke for/ });
    await expect(plus.first()).toBeVisible({ timeout: 30_000 });
    await plus.nth(0).click();
    await plus.nth(1).click();
    await expect(page.getByText(/\bSaved\b/).first()).toBeVisible({ timeout: 30_000 });

    await page.goto(`/entry?bust=${Date.now()}`);
    await expect(page.locator("main")).toContainText("· level");
    await page.locator("summary", { hasText: /^More:/ }).click();
    await page.getByRole("button", { name: "Off handicaps" }).click();
    const ask = page.getByRole("alert").filter({ hasText: "re-scores" });
    await expect(ask, "the switch did nothing and said nothing").toContainText(
      "2 cards already have scores. Playing off handicaps re-scores them",
    );
    await ask.getByRole("button", { name: "Change it" }).click();
    await expect(ask).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Off handicaps" })).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    // And the round itself says so, read fresh.
    await page.goto(`/entry?bust=${Date.now()}`);
    await expect(page.locator("main")).toContainText("· off handicaps");
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
    // A side's round is kept on one phone, so More offers no friends' code:
    // the code's surface has no side's card, and its promise would be false.
    const more = page.locator("summary", { hasText: /^More:/ });
    await expect(more).toBeVisible();
    await expect(more, "a four-ball offers a code nobody can score with").not.toContainText("Friends");
  });

  test("a four-ball played for $10 a man settles man to man", async ({ page }) => {
    /**
     * Ann & Bea drop a shot each on the 3rd and 6th; everything else is par.
     * Cat & Dot win those two holes and halve the rest: 2 up with one to
     * play after the 17th, so won 2&1. "The match" at $10 a man: each loser
     * pays a winner $10 — Ann -$10, Bea -$10, Cat +$10, Dot +$10.
     */
    await setUp(page, "Four-Ball", false, [ANN, BEA, CAT, DOT], { game: "The match", stake: "10" });
    await scoreEveryHole(page, 2);
    await roundScreen(page);
    await expect(page.locator("[data-match-line]")).toHaveText(`${CAT} & ${DOT} won 2&1`);
    await page.goto(`/group-games?bust=${Date.now()}`);
    const positions = (await page.getByRole("region", { name: "Where the money ends up" }).locator("[data-position]").allInnerTexts())
      .map((p) => p.replace(/\s+/g, " ").trim())
      .sort();
    expect(positions).toEqual([`${ANN} −$10.00`, `${BEA} −$10.00`, `${CAT} +$10.00`, `${DOT} +$10.00`].sort());
  });

  test("foursomes, gross, four players", async ({ page }) => {
    await setUp(page, "Foursomes", false, [ANN, BEA, CAT, DOT]);
    await scoreEveryHole(page, 1);
    await roundScreen(page);
    await expect(page.locator("[data-match-line]")).toHaveText(`${CAT} & ${DOT} won 2&1`);
  });
});
