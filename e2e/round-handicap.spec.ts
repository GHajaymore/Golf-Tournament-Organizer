import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * WHAT ONE PLAYER PLAYS OFF IN ONE ROUND, SET BY HAND.
 *
 * The round's own handicap editor (Rounds → a round → "Set one for this round")
 * had never been pressed by any spec: the walk opens the screen and the control
 * crawl has no box of its own to fill. Reading it on 2026-10-13 found that it
 * read its box as ARITHMETIC — and to arithmetic "+2" is two. The screen says
 * "plays off +2" for a plus-two player; an organizer who typed that figure back
 * into the box beside it saved a player RECEIVING two strokes, four out, in that
 * round only. The box also opened on "-2", the stored number.
 *
 * So this is the secretary, on a week of the seeded league nobody has played
 * yet, doing what an organizer does there:
 *
 *   set       a plus handicap, typed with its plus — and the round then says
 *             "+2", which it can only say of a player who gives strokes
 *   reopen    the box opens on the figure the sentence shows
 *   refuse    an index (12.4), an empty box and a figure past the range, each
 *             in words, none of them saved
 *   scratch   the word the screen prints is a figure it reads
 *   undo      back to the roster, and the round says everybody is on it again
 *
 * One project: nothing here is about width.
 */

const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "desktop") return;
  club = await seed();
});
test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "desktop") return;
  await teardown();
});

/** The Rounds screen, with the first round nobody has played opened to its list of players. */
async function openEditor(page: Page) {
  await page.goto(`/stages?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  // A round is a row until it is opened; the league's weeks still to come are marked "Upcoming".
  const round = page.getByRole("button", { name: /Upcoming/ }).first();
  await expect(round, "the seeded league has no round still to be played").toBeVisible({ timeout: 20_000 });
  if ((await round.getAttribute("aria-expanded")) !== "true") await round.click();
  const opener = page.getByRole("button", { name: "Set one for this round" }).first();
  await expect(opener, "an unplayed round does not offer to set a handicap").toBeVisible({ timeout: 20_000 });
  await opener.click();
}

test("the secretary sets one player's handicap for one round, and a plus handicap is typed with its plus", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one project: nothing here is about width");
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const league = club.events.find((e) => e.slug === "league");
  expect(league, "the seeded club has no league").toBeTruthy();
  await context.addCookies([
    { name: "ng_session", value: club.organizer.session, url: baseURL! },
    { name: "ng_active_event", value: sign(league!.id), url: baseURL! },
  ]);

  await openEditor(page);
  // Whoever is first on the list: the test is about the box, not the person.
  const firstSet = page.getByRole("button", { name: "Set", exact: true }).first();
  await expect(firstSet).toBeVisible();
  const name = (await firstSet.locator("xpath=..").locator("span").first().innerText()).trim();
  expect(name.length, "the row has no name on it").toBeGreaterThan(1);
  const line = () => page.locator("div").filter({ has: page.locator("span", { hasText: name }) }).filter({ hasText: "plays off" }).last();
  /**
   * THE ROW SAYS TWO FIGURES ON A ROUND WITH AN ALLOWANCE (2026-10-13), and the
   * box edits the first of them. The league plays Stableford at 95%, so the row
   * reads "course handicap 9 (9.39 before rounding) · plays off 9 at 95%": what
   * the player is told, and what their card is scored off. The allowance is
   * taken of the figure before rounding (Rule 6.2a), so the two can differ.
   */
  await expect(line(), "the row does not say what the allowance is taken of").toContainText(/course handicap \S+.* · plays off \S+ at 95%/);
  const roster = ((await line().innerText()).match(/course handicap\s+(\S+)/) ?? [])[1];
  expect(roster, "the row does not say the player's course handicap").toBeTruthy();
  const box = page.getByLabel(`Handicap for ${name} in this round`);

  await test.step("a plus handicap, typed with its plus, is a player who GIVES strokes", async () => {
    await firstSet.click();
    await expect(box, "the box opens on the figure the sentence shows").toHaveValue(roster!);
    await box.fill("+2");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // "+2" is what this screen prints for minus two, and for nothing else: plain two reads "2".
    // And a committee's figure is a whole number, so 95% is taken of it as given: plus 1.9, which is plus 2.
    await expect(line()).toContainText(`course handicap +2 · plays off +2 at 95% — set for this round, in place of ${roster}`, { timeout: 20_000 });
    await openEditor(page);
    await expect(line(), "kept after a reload").toContainText("course handicap +2 · plays off +2 at 95% — set for this round");
  });

  await test.step("opened again, the box says what the sentence says", async () => {
    await line().getByRole("button", { name: "Change", exact: true }).click();
    await expect(box).toHaveValue("+2");
  });

  await test.step("an index, an empty box and a figure past the range are each refused in words", async () => {
    await box.fill("12.4");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("A round's handicap is whole strokes — 12, not 12.4. The index stays on the roster.")).toBeVisible();
    await box.fill("");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Enter the strokes as a whole number, like 12 — or +2 for a plus handicap.")).toBeVisible();
    await box.fill("77");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("A handicap runs from +10 to 54.")).toBeVisible();
    await openEditor(page);
    await expect(line(), "none of the three saved anything").toContainText("course handicap +2 · plays off +2 at 95% — set for this round");
  });

  await test.step("the word the screen prints for nought is a figure it reads", async () => {
    await line().getByRole("button", { name: "Change", exact: true }).click();
    await box.fill("scratch");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(line()).toContainText("course handicap scratch · plays off scratch at 95% — set for this round", { timeout: 20_000 });
  });

  await test.step("back to the roster, and the round says everybody is on it again", async () => {
    await line().getByRole("button", { name: "Back to roster", exact: true }).click();
    await expect(line()).toContainText(`course handicap ${roster}`, { timeout: 20_000 });
    await expect(line()).not.toContainText("set for this round");
    await openEditor(page);
    await expect(line()).not.toContainText("set for this round");
  });

  expect(errors, "a screen threw").toEqual([]);
});
