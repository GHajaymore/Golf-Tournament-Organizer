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
 *     the difference, 8, on SI 1-8 — holes 1 2 4 6 10 11 13. Six up after 11,
 *     dormie after 12, the 13th won — WHITES WIN 7&5.
 *
 *   The cup: three matches once the singles are lined up, so more than half is
 *   2 — and NOT before, when "more than half" of two matches is a target a
 *   lineup still to be made would change.
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
  await expect(card.getByText(`${blues.join(" & ")} v ${whites.join(" & ")}`)).toBeVisible({ timeout: 20_000 });
}

/** One card, par on each of the first `holes` holes, saved from Score entry. */
async function scorePars(page: Page, who: string, holes: number) {
  const full = page.getByRole("button", { name: "Full card" });
  if (await full.count()) await full.click();
  for (let i = 0; i < holes; i++) {
    // A bounded wait: a card that is not there fails in seconds, not minutes.
    await page.getByLabel(`${who}, hole ${i + 1}, par ${PARS[i]}`, { exact: true }).fill(String(PARS[i]), { timeout: 20_000 });
  }
  const row = page.locator(".card").filter({ has: page.getByLabel(`${who}, hole 1, par ${PARS[0]}`, { exact: true }) }).first();
  await row.getByRole("button", { name: "Save card" }).click();
  await expect(row.getByText(`${holes} holes`)).toBeVisible({ timeout: 20_000 });
}

/** Today's cup card, and one match on it by session. */
const myMatch = (page: Page, session: string) =>
  page.getByRole("region", { name: "Your cup" }).getByRole("listitem", { name: `${session} match` });

test("a team cup, played by its players", async ({ page, baseURL }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));

  await test.step("the captains' lineup for Saturday", async () => {
    await as(page, baseURL!, "organizer");
    await open(page, "/cup");
    await lineUp(page, "Saturday four-balls", ["Ailsa Blue", "Bram Blue"], ["Edda White", "Finn White"]);
    await lineUp(page, "Saturday foursomes", ["Cora Blue", "Dev Blue"], ["Gwen White", "Hal White"]);
  });

  await test.step("a four-ball player opens Today on their cup, not on a side's card", async () => {
    await as(page, baseURL!, "a1");
    await open(page, "/me");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your cup");
    const cup = page.getByRole("region", { name: "Your cup" });
    await expect(cup).toContainText("Blues");
    await expect(cup).toContainText("Your team");
    const m = myMatch(page, "Saturday four-balls");
    await expect(m).toContainText("You & Bram Blue v Edda White & Finn White");
    await expect(m).toContainText("Not started");
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

  await test.step("the foursomes player lands on the foursomes, and a side keeps one card", async () => {
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
    await scorePars(page, "Cora Blue & Dev Blue", 13);
    await as(page, baseURL!, "a4");
    await open(page, "/me");
    await expect(myMatch(page, "Saturday foursomes")).toContainText("Lost 7&5");
  });

  await test.step("two up of two is not the cup while Sunday is still to be lined up", async () => {
    await page.context().clearCookies();
    await open(page, `/live/${f.shareToken}`);
    const board = page.getByRole("region", { name: "The cup" });
    await expect(board).toContainText("2 of 2 matches decided");
    await expect(board).not.toContainText("win the cup");
    await expect(board).toContainText("set once every session is lined up");
    // The cup is the whole board: no pairs table under it.
    await expect(page.getByText(/Match play — 1 point a win/)).toHaveCount(0);
  });

  await test.step("the singles go up, and the cup is won", async () => {
    await as(page, baseURL!, "organizer");
    await open(page, "/cup");
    await lineUp(page, "Sunday singles", ["Ailsa Blue"], ["Edda White"]);
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

  expect(errors, `a screen threw in ${CUP_EVENT}`).toEqual([]);
});
