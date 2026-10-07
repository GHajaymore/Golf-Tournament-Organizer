import { test, expect, type Page } from "@playwright/test";
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
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));

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
    // Nothing announced, so nothing to see: no button to an empty list.
    await expect(cupCard(page).getByRole("link", { name: /See every match/ })).toHaveCount(0);
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
    // Announced: now there is a board of matches to go to, and the button says so.
    await expect(cupCard(page).getByRole("link", { name: /See every match/ })).toBeVisible();
    // What it replaced — none of these belong to a cup.
    await expect(page.getByText("Your side · not started")).toHaveCount(0);
    await expect(page.getByText(/Who would you like to play with/)).toHaveCount(0);
  });

  await test.step("Score this match opens their own session, with par and stroke index", async () => {
    await myMatch(page, "Saturday four-balls").getByRole("link", { name: /Score this match/ }).click();
    await page.waitForURL(/\/entry\?round=/);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Saturday four-balls · Four-Ball/).first()).toBeVisible();
    // Only the card this player may save — not their partner's.
    await page.getByRole("button", { name: "Full card" }).click();
    await expect(page.getByLabel(`Ailsa Blue, hole 1, par ${PARS[0]}`, { exact: true })).toBeVisible();
    await expect(page.getByLabel(`Bram Blue, hole 1, par ${PARS[0]}`, { exact: true })).toHaveCount(0);
    await scorePars(page, "Ailsa Blue", 13);
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
    await myMatch(page, "Saturday foursomes").getByRole("link", { name: /Score this match/ }).click();
    await page.waitForURL(/\/entry\?round=/);
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
    await page.waitForURL(/\/entry\?round=/);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("navigation", { name: "Cup sessions" }).getByRole("link", { name: /Sunday singles/ })).toHaveAttribute("aria-current", "page");
    // The match by both its names — never "—" v "—", which is how a pair
    // session read on this screen.
    await expect(page.getByText("Ailsa Blue").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("Edda White").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("— v —")).toHaveCount(0);
    // Match by match only — a stroke card here is one nothing reads.
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

  expect(errors, `a screen threw in ${CUP_EVENT}`).toEqual([]);
});
