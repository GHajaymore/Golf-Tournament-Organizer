import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { seedCutAhead, teardownCutAhead } from "./cut-ahead-fixture.mjs";

/**
 * WHILE ROUND 1 IS PLAYED, THE RULES SHEET SAYS WHAT IT IS PLAYED FOR.
 *
 * A cut belongs to the round it feeds. Until 2026-10-14 both rules screens read
 * the round being played's own cut setting, so with the field out on round 1 of
 * a medal cut to the top 8 and ties the sheet printed NO cut at all — and once
 * round 2 began it promised one that had already been made. It also left out
 * "and ties", so a ninth player level on the line read as going home.
 *
 * Read in the browser by the two people who read it: the organizer at /rules,
 * and a player at /me/rules. (The Rounds screen's "Into Round 2: cuts to top 8
 * in each flight" summary, reworded the same day, is drawn for round robins
 * only — a stroke round shows its cut as a control — and is worded by
 * `cutRuleWords`, which `bracket-not-generated.test.ts` holds.)
 *
 * WHAT IT CANNOT SEE: round 2's own sheet after the cut is made, which needs
 * every round 1 card approved and the round closed; the cut itself is held by
 * `a-cut-is-made-once-for-every-reader.audit.test.ts`.
 */
test.beforeAll(async () => {
  const { organizer, player } = await seedCutAhead();
  process.env.CUT_AHEAD_ORGANIZER = organizer;
  process.env.CUT_AHEAD_PLAYER = player;
});
test.afterAll(async () => {
  await teardownCutAhead();
});

const SAID = "Top 8 and ties advance to the next round";

test("the organizer's and the player's rules sheet both state the cut round 1 is played for", async ({ browser, baseURL }, testInfo) => {
  const errors: string[] = [];
  const device = testInfo.project.use;
  const asOrganizer = await browser.newContext({ ...device, baseURL });
  const asPlayer = await browser.newContext({ ...device, baseURL });
  await asOrganizer.addCookies([{ name: "ng_session", value: process.env.CUT_AHEAD_ORGANIZER!, url: baseURL! }]);
  await asPlayer.addCookies([{ name: "ng_session", value: process.env.CUT_AHEAD_PLAYER!, url: baseURL! }]);
  try {
    const desk = await asOrganizer.newPage();
    const phone = await asPlayer.newPage();
    watchPageErrors(desk, errors, "organizer");
    watchPageErrors(phone, errors, "player");

    const response = await desk.goto(`/rules?bust=${Date.now()}`);
    expect(response?.status(), "the organizer is signed in").toBe(200);
    const sheet = desk.locator("main");
    await expect(sheet, "the organizer's sheet states no cut while round 1 is played").toContainText(SAID);

    const mine = await phone.goto(`/me/rules?bust=${Date.now()}`);
    expect(mine?.status(), "the player is signed in").toBe(200);
    await expect(phone.locator("main"), "the player is not told what round 1 is played for").toContainText(SAID);
    // CONTROL: the one the sheet used to print, with no ties, is nowhere.
    expect(await phone.locator("main").innerText()).not.toMatch(/Top 8 advance/);

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await asOrganizer.close();
    await asPlayer.close();
  }
});
