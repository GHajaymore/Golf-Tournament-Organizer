import { test, expect, type Page } from "@playwright/test";
import { seedOrganizer, teardownOrganizer, medalEmail } from "./organizer-fixture.mjs";

/**
 * A CLUB MATCH-PLAY KNOCKOUT, RUN FROM NOTHING BY A NEW ORGANIZER.
 *
 * The four-player scratch knockout — semi-finals, then a final — is the event
 * every member follows on the bracket: who they drew, who went through, who
 * won. A wrong pairing or a winner who does not move on is seen by everybody.
 *
 *   create   a tournament played as a knockout
 *   field    four players, entered OUT of handicap order
 *   round    one bracket, match play, gross
 *   launch   entries → ready → launched
 *   results  each match decided on the bracket, with its margin
 *   champion on the bracket and on the dashboard
 *
 * THE DRAW. With no qualifying round everyone is on nothing, so the seeding
 * falls to handicap, lowest first — how a scratch knockout is seeded when
 * there is no medal to seed it from. Indexes 0, 8, 14, 20 make Alder 1,
 * Briar 2, Cedar 3, Dune 4, and a four-draw is 1 v 4 and 2 v 3. They are
 * entered in the order 20, 8, 14, 0, so a draw taken from the entry list puts
 * different names together.
 *
 * THE RESULTS. Dune, the bottom seed, beats the top seed 2&1 and then Briar 1
 * up in the final; Briar beats Cedar 4&3. A bracket that advanced the higher
 * seed, or crowned the semi-final's loser, names a different champion.
 */

type Entrant = { name: string; index: string };
// Entry order, deliberately not seed order.
const FIELD: Entrant[] = [
  { name: "Dune Quayle", index: "20" },
  { name: "Briar Quayle", index: "8" },
  { name: "Cedar Quayle", index: "14" },
  { name: "Alder Quayle", index: "0" },
];
const TOURNAMENT = "Club Knockout — Summer Singles";

test.beforeAll(async () => {
  const { session } = await seedOrganizer();
  process.env.ORGANIZER_SESSION = session;
});
test.afterAll(async () => {
  await teardownOrganizer();
});
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "ng_session", value: process.env.ORGANIZER_SESSION!, url: baseURL! }]);
});

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
}

/**
 * Decide a match on the bracket: the winner's name, then the margin.
 *
 * A player who has won a semi-final is on the bracket twice — the semi-final
 * column is drawn first, the final after it — and pressing a winner's name
 * again UNDOES the result. So the name is pressed in the round being decided:
 * the first of it for a semi-final, the last for the final.
 */
async function decide(page: Page, winner: string, loser: string, round: "Semifinals" | "Final", margin: string) {
  const seats = page.getByRole("button", { name: new RegExp(`^${winner}`) });
  await (round === "Final" ? seats.last() : seats.first()).click();
  const pair = [winner, loser];
  const result = page
    .getByRole("textbox", { name: new RegExp(`^Result of (${pair.join("|")}) v (${pair.join("|")}), ${round}$`) });
  await expect(result, `no margin box for ${winner} v ${loser}`).toBeVisible({ timeout: 20_000 });
  await result.fill(margin);
  await result.press("Tab");
}

test("a new organizer runs a four-player knockout to a champion", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await test.step("create the tournament as a knockout", async () => {
    await open(page, "/choose");
    await page.getByLabel("Tournament name").fill(TOURNAMENT);
    await page.getByRole("button", { name: /^A knockout/ }).click();
    await page.getByRole("button", { name: "Create tournament" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  });

  await test.step("the date", async () => {
    await open(page, "/event");
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel("Tournament dates, first day").fill(today);
    await page.getByLabel("Tournament dates, last day").fill(today);
    await page.getByRole("button", { name: "Save event" }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 20_000 });
  });

  await test.step("enter the field, out of handicap order", async () => {
    await open(page, "/registration");
    for (const [i, p] of FIELD.entries()) {
      await page.getByLabel("Player name", { exact: true }).fill(p.name);
      await page.getByRole("textbox", { name: /^Email · required/ }).fill(medalEmail(i));
      await page.getByRole("textbox", { name: /^Mobile · required/ }).fill(`555020${i}`);
      await page.getByLabel("Handicap", { exact: true }).fill(p.index);
      await page.getByRole("button", { name: "Add to field" }).click();
      await expect(page.getByText(p.name).first()).toBeVisible({ timeout: 20_000 });
    }
  });

  await test.step("one bracket, match play", async () => {
    await open(page, "/stages");
    await page.getByRole("button", { name: /^Bracket/ }).click();
    await page.getByLabel("Format for every round added").selectOption("Match Play");
    await page.getByRole("button", { name: /^Add bracket/ }).click();
    await expect(page.getByRole("button", { name: /^Round 1 · Bracket Stage/ })).toBeVisible({ timeout: 20_000 });
  });

  await test.step("launch", async () => {
    await open(page, "/dashboard");
    for (const step of ["Start taking entries", "Mark ready"]) {
      await page.getByRole("button", { name: step }).click();
      await expect(page.getByRole("button", { name: step })).toHaveCount(0, { timeout: 20_000 });
    }
    await page.getByRole("button", { name: "Launch tournament" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
    await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
  });

  await test.step("the draw is seeded on handicap: 1 v 4, 2 v 3", async () => {
    await open(page, "/bracket");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Bracket manager/);
    // Each pairing has its own margin box once decided; before that the draw
    // is read off the names in order down the first column.
    const text = await page.locator("main").innerText();
    const at = (n: string) => text.indexOf(n);
    expect([at("Alder Quayle"), at("Dune Quayle"), at("Briar Quayle"), at("Cedar Quayle")], `the draw is not 1 v 4, 2 v 3:\n${text}`)
      .toEqual([...[at("Alder Quayle"), at("Dune Quayle"), at("Briar Quayle"), at("Cedar Quayle")]].sort((a, b) => a - b));
  });

  await test.step("the semi-finals, with an upset", async () => {
    await decide(page, "Dune Quayle", "Alder Quayle", "Semifinals", "2&1");
    await decide(page, "Briar Quayle", "Cedar Quayle", "Semifinals", "4&3");
  });

  await test.step("the final", async () => {
    await open(page, "/bracket");
    await decide(page, "Dune Quayle", "Briar Quayle", "Final", "1 UP");
  });

  await test.step("the champion, on the bracket and the dashboard", async () => {
    await open(page, "/bracket");
    const bracket = await page.locator("main").innerText();
    expect(bracket, `no champion on the bracket:\n${bracket}`).toMatch(/CHAMPION[\s\S]{0,40}Dune Quayle/i);
    for (const margin of ["2&1", "4&3", "1 UP"]) {
      expect(await page.getByRole("textbox", { name: /^Result of / }).evaluateAll(
        (els, m) => els.some((e) => (e as HTMLInputElement).value === m), margin,
      ), `the margin ${margin} was not kept`).toBe(true);
    }

    await open(page, "/dashboard");
    const dash = await page.locator("main").innerText();
    const tile = dash.slice(dash.indexOf("Bracket status"), dash.indexOf("Open the bracket"));
    expect(tile, `the dashboard does not name the champion:\n${tile}`).toMatch(/Main draw\s+Dune Quayle/);
    // One bracket, lose and you're out: there is no second draw to report.
    // The card read "Consolation · 1 match" here until 2026-10-04.
    expect(tile).not.toMatch(/Consolation|Plate|Flight B/);
    // And no row of any name still counting matches: the only draw is decided.
    expect(tile, `a second draw is still reported:\n${tile}`).not.toMatch(/\d+ match/);
  });

  expect(errors, "a screen threw").toEqual([]);
});
