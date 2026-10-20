import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { seedCup, teardownCup, PARS, CUP_EVENT } from "./cup-fixture.mjs";

/**
 * A TEAM CUP, PLAYED BY ITS PLAYERS — the Ryder Cup shape a golf trip runs,
 * walked from the lineup to the cup being won, as the people in it.
 *
 * Ajay, 2026-10-05: "test it and make sure the players side is ready for it".
 * Walked by hand first, and the player side was not: a four-ball player was
 * shown "Your side · not started" with no opponent and a request to pick a
 * playing partner; the foursomes player was told the organizer enters a score
 * the players keep, and Score entry opened the wrong session for them. This
 * spec is the walk, so it stays walked.
 *
 * And his three decisions of 2026-10-06, walked the same way: a lineup is
 * hidden until the organizer ANNOUNCES it, session by session; a concession is
 * the ORGANIZER's to record; and a side that PICKS UP has conceded the hole.
 *
 * THE FIGURES, BY HAND. The tee is rated 71.0 / 113 over par 71, so a course
 * handicap IS the index. Everybody makes par on every hole, so every hole is
 * decided by handicap strokes alone — scratch, every match would be halved.
 *
 *   Four-ball (WHS: 90% each, strokes off the lowest of the four)
 *     Ailsa 2 → 2, Bram 4 → 4, Edda 8 → 7, Finn 12 → 11; off Ailsa's 2:
 *     0, 2, 5, 9. Finn's nine fall on SI 1-9, Bram's two on SI 1-2, so the
 *     Whites win every SI 3-9 hole and the SI 1-2 holes are halved.
 *     Holes 1 2 6 8 10 11 to the Whites: 6 up after 11, dormie after 12,
 *     and the 13th halved — WHITES WIN 6&5.
 *
 *   Foursomes (WHS: 50% of the side's combined handicaps)
 *     Blues (6 + 10) / 2 = 8, Whites (14 + 18) / 2 = 16: the Whites receive
 *     the difference, 8, on SI 1-8 — holes 1 2 4 6 10 11 13. And the Blues
 *     PICK UP on the 3rd (SI 11), a hole pars would halve: conceded, so the
 *     Whites take it too. 1 2 3 4 6 10 to the Whites is six up after 10, the
 *     11th makes it seven with seven to play (dormie), the 12th halved —
 *     WHITES WIN 7&6. Without the pick-up it would be 7&5, so the result
 *     itself says whether the pick-up counted.
 *
 *   The cup: three matches once the singles are lined up AND announced, so
 *   more than half is 2 — and NOT before, when "more than half" of two
 *   matches is a target a lineup still to come would change.
 *
 *   The singles is then CONCEDED by the Whites, recorded by the organizer: a
 *   point to the Blues, Whites 2 – 1, and the cup still the Whites'.
 */

test.describe.configure({ mode: "serial" });

let f: Awaited<ReturnType<typeof seedCup>>;
test.beforeAll(async () => {
  f = await seedCup();
});
test.afterAll(async () => {
  await teardownCup();
});

/** Become somebody: their two cookies, nobody else's. */
async function as(page: Page, baseURL: string, who: string) {
  // Keyed by player key ("a1") and "organizer" — see `seedCup`.
  const c = (f.cookies as unknown as Record<string, { session: string; event: string }>)[who];
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "ng_session", value: c.session, url: baseURL },
    { name: "ng_active_event", value: c.event, url: baseURL },
  ]);
}

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
}

/**
 * Nothing on the screen wider than the screen. `layout.spec` sweeps every
 * route, but on a fixture with no cup — so the lineup controls, the concession
 * buttons and the picked-up toggle are only ever drawn, at 320px, here.
 */
async function fits(page: Page, where: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `${where} scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
}

/** The captains' lineup for one session, entered on the Team cup screen. */
async function lineUp(page: Page, session: string, blues: string[], whites: string[]) {
  const card = page.getByRole("region", { name: `${session} lineup` });
  for (const [i, name] of blues.entries()) {
    await card.getByLabel(`Blues player ${i + 1}, ${session}`).selectOption({ label: name });
  }
  for (const [i, name] of whites.entries()) {
    await card.getByLabel(`Whites player ${i + 1}, ${session}`).selectOption({ label: name });
  }
  await card.getByRole("button", { name: "Add match" }).click();
  await expect(card.getByRole("listitem", { name: `${blues.join(" & ")} v ${whites.join(" & ")}` })).toBeVisible({ timeout: 20_000 });
}

/** Announce one session's lineup, from the Team cup screen. Two taps, as built. */
async function announce(page: Page, session: string) {
  const card = page.getByRole("region", { name: `${session} lineup` });
  await card.getByRole("button", { name: "Announce lineup" }).click();
  await card.getByRole("button", { name: "Announce to everyone" }).click();
  await expect(card.getByText("Announced", { exact: true })).toBeVisible({ timeout: 20_000 });
}

/**
 * One card, par on each of the first `holes` holes, saved from Score entry —
 * with an "X" (picked up) typed on any hole listed in `pickUps`, as it is
 * written on a paper card.
 */
async function scorePars(page: Page, who: string, holes: number, pickUps: number[] = []) {
  const full = page.getByRole("button", { name: "Full card" });
  if (await full.count()) await full.click();
  for (let i = 0; i < holes; i++) {
    // A bounded wait: a card that is not there fails in seconds, not minutes.
    const cell = page.getByLabel(`${who}, hole ${i + 1}, par ${PARS[i]}`, { exact: true });
    await cell.fill(pickUps.includes(i + 1) ? "X" : String(PARS[i]), { timeout: 20_000 });
  }
  for (const h of pickUps) {
    await expect(page.getByLabel(`${who}, hole ${h}, par ${PARS[h - 1]}`, { exact: true })).toHaveValue("X");
  }
  const row = page.locator(".card").filter({ has: page.getByLabel(`${who}, hole 1, par ${PARS[0]}`, { exact: true }) }).first();
  await row.getByRole("button", { name: "Save card" }).click();
  // A hole picked up has no score on it, so it is not among the holes played.
  await expect(row.getByText(`${holes - pickUps.length} holes`)).toBeVisible({ timeout: 20_000 });
  /**
   * AND PROVE THIS CARD WAS STORED, not merely that the side shows 13 holes.
   * That figure is the SIDE's, so in a four-ball the partner's card had already
   * made it true: CI went on (2026-10-06) while Finn's save was still in
   * flight, and read the four-ball as it stood without him — "3 down thru 13",
   * exactly the match off Edda's card alone. Reload and read the last hole
   * back from the server.
   */
  const last = holes;
  const expectLast = pickUps.includes(last) ? "X" : String(PARS[last - 1]);
  await expect(async () => {
    await page.reload();
    await page.waitForLoadState("networkidle");
    const full2 = page.getByRole("button", { name: "Full card" });
    if (await full2.count()) await full2.click();
    await expect(page.getByLabel(`${who}, hole ${last}, par ${PARS[last - 1]}`, { exact: true })).toHaveValue(expectLast, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** Today's cup card, and one match on it by session. */
const cupCard = (page: Page) => page.getByRole("region", { name: "Your cup" });
const myMatch = (page: Page, session: string) => cupCard(page).getByRole("listitem", { name: `${session} match` });

test("a team cup, played by its players", async ({ page, baseURL }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);

  await test.step("the captains' lineup for Saturday, still a draft", async () => {
    await as(page, baseURL!, "organizer");
    await open(page, "/cup");
    await lineUp(page, "Saturday four-balls", ["Ailsa Blue", "Bram Blue"], ["Edda White", "Finn White"]);
    await lineUp(page, "Saturday foursomes", ["Cora Blue", "Dev Blue"], ["Gwen White", "Hal White"]);
    await expect(page.getByRole("region", { name: "Saturday four-balls lineup" })).toContainText("Only staff can see this lineup");
  });

  await test.step("a player sees nothing of a draft — only that it is coming", async () => {
    await as(page, baseURL!, "a1");
    await open(page, "/me");
    await expect(cupCard(page)).toContainText("Still to be announced: Saturday four-balls, Saturday foursomes, Sunday singles.");
    await expect(cupCard(page)).not.toContainText("Bram Blue");
    await page.context().clearCookies();
    await open(page, `/live/${f.shareToken}`);
    // Not Edda, who is on the board anyway as the Whites' captain.
    const pub = page.getByRole("region", { name: "The cup" });
    await expect(pub).not.toContainText("Finn White");
    await expect(pub).toContainText("No lineup has been announced yet.");
  });

  await test.step("the organizer announces Saturday, both teams' pairings at once", async () => {
    await as(page, baseURL!, "organizer");
    await open(page, "/cup");
    await announce(page, "Saturday four-balls");
    await announce(page, "Saturday foursomes");
    // Announced lineups carry the concession buttons on every match.
    await fits(page, "/cup with two announced sessions");
  });

  await test.step("a four-ball player opens Today on their cup, not on a side's card", async () => {
    await as(page, baseURL!, "a1");
    await open(page, "/me");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your cup");
    await expect(cupCard(page)).toContainText("Blues");
    await expect(cupCard(page)).toContainText("Your team");
    await expect(cupCard(page)).toContainText("Still to be announced: Sunday singles.");
    const m = myMatch(page, "Saturday four-balls");
    await expect(m).toContainText("You & Bram Blue v Edda White & Finn White");
    await expect(m).toContainText("Not started");
    // What it replaced — none of these belong to a cup.
    await expect(page.getByText("Your side · not started")).toHaveCount(0);
    await expect(page.getByText(/Who would you like to play with/)).toHaveCount(0);
  });

  await test.step("Score this match opens her own stroke card — Saturday is kept on cards", async () => {
    // How the organizer set Saturday up (`matchKeptBy`, seeded as chosen
    // before launch — the choice itself is walked in match-kept-by.spec): on
    // stroke cards, so the four-ball is decided off the low, below. Sunday's
    // singles keep the cup-day tap card, walked further down. Ajay,
    // 2026-10-19: "provide both options for organizer to decide".
    await myMatch(page, "Saturday four-balls").getByRole("link", { name: /Score this match/ }).click();
    await page.waitForURL(/\/me\/match\?m=/);
    await expect(page.getByText(/Your own card, hole by hole/)).toBeVisible({ timeout: 20_000 });
    // Never the tap card on a round kept on cards — the two cannot share a match.
    await expect(page.getByRole("group", { name: "Who won hole 1" })).toHaveCount(0);
    for (let hole = 1; hole <= 13; hole += 1) {
      // The pad moves on by itself; the hole on screen is the proof it did.
      await expect(page.getByLabel(`Strokes on hole ${hole}`)).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: /Par$/ }).click();
    }
    await expect(page.getByText("13/18 holes")).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
    // And the side's cards are on Score entry too: only the card she may save.
    await open(page, `/entry?round=${(f.sessions as Record<string, string>).fourball}`);
    await expect(page.getByText(/Saturday four-balls · Four-Ball/).first()).toBeVisible();
    await page.getByRole("button", { name: "Full card" }).click();
    await expect(page.getByLabel(`Ailsa Blue, hole 13, par ${PARS[12]}`, { exact: true }), "her card, kept in the app, is not the card on Score entry").toHaveValue(String(PARS[12]), { timeout: 20_000 });
    await expect(page.getByLabel(`Bram Blue, hole 1, par ${PARS[0]}`, { exact: true })).toHaveCount(0);
  });

  await test.step("the other three four-ball players return their own cards", async () => {
    for (const [who, name] of [["a2", "Bram Blue"], ["b1", "Edda White"], ["b2", "Finn White"]] as const) {
      await as(page, baseURL!, who);
      await open(page, "/entry");
      await scorePars(page, name, 13);
    }
  });

  await test.step("the four-ball is decided off the low — Whites 6&5, told from each side", async () => {
    await as(page, baseURL!, "a1");
    await open(page, "/me");
    await expect(myMatch(page, "Saturday four-balls")).toContainText("Lost 6&5");
    await as(page, baseURL!, "b2");
    await open(page, "/me");
    await expect(myMatch(page, "Saturday four-balls")).toContainText("Won 6&5");
  });

  await test.step("the foursomes: one card a side, and the Blues pick up on the 3rd", async () => {
    // FIRST, straight to Score entry with no session named — while the
    // four-ball is still the tournament's active round. Opening the active
    // round is what put this player in front of "No sides drawn yet".
    await as(page, baseURL!, "b4");
    await open(page, "/entry");
    await scorePars(page, "Gwen White & Hal White", 13);
    await as(page, baseURL!, "a3");
    await open(page, "/me");
    await expect(myMatch(page, "Saturday foursomes")).toContainText("You & Dev Blue v Gwen White & Hal White");
    // The side's one card, on Score entry with the session named (see above).
    await open(page, `/entry?round=${(f.sessions as Record<string, string>).foursomes}`);
    await page.waitForLoadState("networkidle");
    // The hole-by-hole card offers "Picked up" on a match — and fits.
    const byHole = page.getByRole("button", { name: "Hole by hole" });
    await byHole.click();
    await expect(page.getByRole("button", { name: /picked up on hole 1/ })).toBeVisible();
    await fits(page, "the foursomes card, hole by hole");
    await scorePars(page, "Cora Blue & Dev Blue", 13, [3]);
    await as(page, baseURL!, "a4");
    await open(page, "/me");
    // 7&6, not the 7&5 pars alone would give: the conceded 3rd counted.
    await expect(myMatch(page, "Saturday foursomes")).toContainText("Lost 7&6");
  });

  await test.step("two up of two is not the cup while Sunday is still to come", async () => {
    await page.context().clearCookies();
    await open(page, `/live/${f.shareToken}`);
    const board = page.getByRole("region", { name: "The cup" });
    await expect(board).toContainText("2 of 2 matches decided");
    await expect(board).not.toContainText("win the cup");
    await expect(board).toContainText("Points to win: set once every lineup is out.");
    // The cup is the whole board: no pairs table under it.
    await expect(page.getByText(/Match play — 1 point a win/)).toHaveCount(0);
  });

  await test.step("the singles go up as a draft — still not the cup — then are announced, and it is won", async () => {
    await as(page, baseURL!, "organizer");
    await open(page, "/cup");
    await lineUp(page, "Sunday singles", ["Ailsa Blue"], ["Edda White"]);
    await page.context().clearCookies();
    await open(page, `/live/${f.shareToken}`);
    await expect(page.getByRole("region", { name: "The cup" })).not.toContainText("win the cup");

    await as(page, baseURL!, "organizer");
    await open(page, "/cup");
    await announce(page, "Sunday singles");
    // The organizer's own leaderboard is the same board the members read.
    await open(page, "/leaderboard");
    await expect(page.getByRole("region", { name: "The cup" })).toContainText("Whites win the cup.");
    await expect(page.getByText(/Match play — 1 point a win/)).toHaveCount(0);
    await page.context().clearCookies();
    await open(page, `/live/${f.shareToken}`);
    await expect(page.getByRole("region", { name: "The cup" })).toContainText("Whites win the cup.");
  });

  await test.step("Sunday's singles player is sent to their singles match, not a pairs card", async () => {
    await as(page, baseURL!, "a1");
    await open(page, "/me");
    const m = myMatch(page, "Sunday singles");
    await expect(m).toContainText("You v Edda White");
    await m.getByRole("link", { name: /Score this match/ }).click();
    // The one match card (2026-10-18), on THIS match: the singles, by both
    // its names — never "—" v "—", which is how a pair session once read.
    await page.waitForURL(/\/me\/match\?m=/);
    await expect(page.getByRole("heading", { name: /Ailsa Blue\s*vs\s*Edda White/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("— v —")).toHaveCount(0);
    // Hole by hole, who won it — no stroke card, which here is one nothing reads.
    const hole1 = page.getByRole("group", { name: "Who won hole 1" });
    await expect(hole1.getByRole("button", { name: /^Hole 1 to Ailsa Blue/ })).toBeVisible();
    await expect(hole1.getByRole("button", { name: /^Hole 1 to Edda White/ })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "How to enter the scores" })).toHaveCount(0);
  });

  await test.step("the Whites concede the singles — the organizer records it", async () => {
    await as(page, baseURL!, "organizer");
    await open(page, "/cup");
    const match = page
      .getByRole("region", { name: "Sunday singles lineup" })
      .getByRole("listitem", { name: "Ailsa Blue v Edda White" });
    await match.getByRole("button", { name: "Whites concede" }).click();
    await match.getByRole("button", { name: "Whites conceded" }).click();
    await expect(match).toContainText("Conceded by Whites", { timeout: 20_000 });
    await fits(page, "/cup with a concession recorded");

    await as(page, baseURL!, "a1");
    await open(page, "/me");
    await expect(myMatch(page, "Sunday singles")).toContainText("Won — conceded");
    // Decided, so nothing left to score.
    await expect(myMatch(page, "Sunday singles").getByRole("link", { name: /Score this match|Carry on scoring/ })).toHaveCount(0);
    await as(page, baseURL!, "b1");
    await open(page, "/me");
    await expect(myMatch(page, "Sunday singles")).toContainText("Lost — conceded");
    // A point to the Blues, and the cup still the Whites'.
    await expect(cupCard(page)).toContainText("Whites win the cup.");
  });

  /**
   * A POINT OUTSIDE THE MATCHES (2026-10-19). The first real cup had a
   * sixteenth point for the lower team net total, which CDG won and the app had
   * nowhere to put. Worked by hand: three matches and one more point is four in
   * play, so 2½ to win — the Whites' 2 is no longer enough, and the cup is open
   * again until the point is given.
   */
  await test.step("the organizer adds a team net total point, and the cup waits for it", async () => {
    await as(page, baseURL!, "organizer");
    await open(page, "/cup");
    const other = page.getByRole("region", { name: "Other points" });
    await other.getByLabel("Add a point").fill("Team net total");
    await other.getByLabel("Worth").fill("1");
    await other.getByRole("button", { name: "Add point" }).click();
    await expect(other.getByText("Team net total · 1 point")).toBeVisible({ timeout: 20_000 });
    await fits(page, "/cup with a point outside the matches");

    await page.context().clearCookies();
    await open(page, `/live/${f.shareToken}`);
    const board = page.getByRole("region", { name: "The cup" });
    await expect(board.getByRole("list", { name: "Other points" })).toContainText("Team net total");
    await expect(board.getByRole("list", { name: "Other points" })).toContainText("To be decided");
    await expect(board).toContainText("2½ to win · Blues need 1½, Whites need ½.");
    // Still a sentence about matches.
    await expect(board).toContainText("3 of 3 matches decided");
  });

  /**
   * A point added by mistake comes off again, and the cup's total with it:
   * five in play would be 3 to win, and taking the fifth away puts it back
   * to 2½. Two presses, because removing a point can change who has the cup.
   */
  await test.step("a point added by mistake is removed, and the target goes back", async () => {
    await as(page, baseURL!, "organizer");
    await open(page, "/cup");
    const other = page.getByRole("region", { name: "Other points" });
    await other.getByLabel("Add a point").fill("Longest drive");
    await other.getByLabel("Worth").fill("1");
    await other.getByRole("button", { name: "Add point" }).click();
    const extra = other.getByRole("listitem").filter({ hasText: "Longest drive" });
    await expect(extra).toContainText("Longest drive · 1 point", { timeout: 20_000 });

    await page.context().clearCookies();
    await open(page, `/live/${f.shareToken}`);
    await expect(page.getByRole("region", { name: "The cup" })).toContainText("3 to win");

    await as(page, baseURL!, "organizer");
    await open(page, "/cup");
    const row = page.getByRole("region", { name: "Other points" }).getByRole("listitem").filter({ hasText: "Longest drive" });
    await row.getByRole("button", { name: "Remove", exact: true }).click();
    await row.getByRole("button", { name: "Remove Longest drive" }).click();
    await expect(page.getByRole("region", { name: "Other points" })).not.toContainText("Longest drive", { timeout: 20_000 });

    await page.context().clearCookies();
    await open(page, `/live/${f.shareToken}`);
    const board = page.getByRole("region", { name: "The cup" });
    await expect(board).toContainText("2½ to win · Blues need 1½, Whites need ½.");
    await expect(board.getByRole("list", { name: "Other points" })).not.toContainText("Longest drive");
  });

  await test.step("given to the Whites, it wins them the cup", async () => {
    await as(page, baseURL!, "organizer");
    await open(page, "/cup");
    await page.getByRole("radiogroup", { name: "Who has Team net total" }).getByRole("radio", { name: "Whites" }).check();
    await expect(async () => {
      await page.context().clearCookies();
      await open(page, `/live/${f.shareToken}`);
      const board = page.getByRole("region", { name: "The cup" });
      await expect(board).toContainText("Whites win the cup.", { timeout: 2_000 });
      await expect(board.getByRole("list", { name: "Other points" })).toContainText("Whites", { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  });

  /**
   * THE FINAL REPORT (2026-10-19), worked by hand from the cup above: the
   * four-ball to the Whites 6&5, the foursomes to the Whites 7&6, the singles
   * to the Blues on a concession, and the team net total to the Whites — so
   * Blues 1, Whites 3. Nobody played two matches and won both, so there are
   * no stars; no match went to the last hole. Edda White and Ailsa Blue each
   * played two and won one, which is what "of two" counts against.
   */
  await test.step("the final report tells the whole cup, from the board's own link", async () => {
    await page.context().clearCookies();
    await open(page, `/live/${f.shareToken}`);
    // Above the cup board, where a member who opened the link looks first.
    const toReport = page.getByRole("link", { name: "Read the final report" });
    const [linkBox, boardBox] = await Promise.all([
      toReport.boundingBox(),
      page.getByRole("region", { name: "The cup" }).boundingBox(),
    ]);
    expect(linkBox!.y, "the report's button sits above the cup board").toBeLessThan(boardBox!.y);
    await toReport.click();
    await page.waitForURL(/\/live\/[^/]+\/report$/);
    const report = page.getByRole("main");
    await expect(report.getByRole("heading", { level: 1 })).toHaveText(CUP_EVENT);
    await expect(report.getByRole("group", { name: "Score: Blues 1, Whites 3" })).toBeVisible();
    await expect(report).toContainText("Whites win the cup");
    const story = report.getByRole("region", { name: "The story" });
    await expect(story).toContainText(
      "Whites won the cup 3 – 1. Whites took Saturday four-balls 1 – 0 and Saturday foursomes 1 – 0, " +
        "and Blues took Sunday singles 1 – 0.",
    );
    // The points track is ONE row at every width: on a phone the app stacks
    // inline grids, which once drew its four points as eight stripes.
    const cellTops = await report.locator(".fr-track i").evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top)),
    );
    expect(cellTops.length, "the track has a cell for every half point").toBe(8);
    expect(new Set(cellTops).size, `the track's cells sit in one row: ${cellTops.join(", ")}`).toBe(1);
    await expect(story).toContainText("The team net total went to Whites.");
    await expect(story).not.toContainText("last hole");
    await expect(report).toContainText("Team match play, three sessions");
    await expect(report).toContainText("8 players, 4 a side");
    await expect(report).toContainText("Hole by hole, and from stroke cards");
    await expect(report).toContainText("Ailsa Blue (Blues) and Edda White (Whites)");
    await expect(report.getByRole("heading", { name: "Won every match" })).toHaveCount(0);
    await expect(report.getByRole("heading", { name: "Points won, of two" })).toBeVisible();
    // The report states results, never how the committee came to record them.
    await expect(report).not.toContainText(/committee|amended|recorded/i);
    await fits(page, "the final report");
  });

  await test.step("the organizer writes the story, and the report carries their words", async () => {
    await as(page, baseURL!, "organizer");
    await open(page, "/cup");
    await page.getByRole("link", { name: "Final report", exact: true }).click();
    await page.waitForURL(/\/cup\/report$/);
    await page.getByRole("textbox", { name: "The story" }).fill("A cold start at Bushwood.\n\nThe Whites never trailed.");
    await page.getByRole("button", { name: "Save the story" }).click();
    await expect(page.getByText("Story saved.")).toBeVisible({ timeout: 20_000 });
    await page.context().clearCookies();
    await open(page, `/live/${f.shareToken}/report?bust=1`);
    const story = page.getByRole("region", { name: "The story" });
    await expect(story.locator("p")).toHaveText(["The story", "A cold start at Bushwood.", "The Whites never trailed."]);
  });

  /**
   * A SESSION IS NAMED ON THE TEAM CUP SCREEN (2026-10-20). Until now a
   * session had whatever its template wrote, with no way to change it, and the
   * name is what the board and the final report call it. Last, so no step
   * after it looks for the old name.
   */
  await test.step("the organizer names a session, and the board and the report call it that", async () => {
    await as(page, baseURL!, "organizer");
    await open(page, "/cup");
    await page.getByRole("button", { name: "Rename Sunday singles" }).click();
    await page.getByRole("textbox", { name: "Session name" }).fill("Final day singles");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("region", { name: "Final day singles lineup" })).toBeVisible({ timeout: 20_000 });

    await page.context().clearCookies();
    await open(page, `/live/${f.shareToken}`);
    await expect(page.getByRole("region", { name: "The cup" })).toContainText("Final day singles");
    await open(page, `/live/${f.shareToken}/report`);
    await expect(page.getByRole("main").getByRole("heading", { name: "Final day singles" })).toBeVisible();
  });

  expect(errors, `a screen threw in ${CUP_EVENT}`).toEqual([]);
});
