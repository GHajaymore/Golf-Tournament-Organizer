import { test, expect, type Page } from "@playwright/test";
import { seedOrganizer, teardownOrganizer, medalEmail, MEDAL_PARS, MEDAL_COURSE } from "./organizer-fixture.mjs";
import { makeBoardPublic, readPublicBoard } from "./public-board";

/**
 * A 36-HOLE CLUB CHAMPIONSHIP WITH A CUT, RUN FROM NOTHING.
 *
 * Two rounds of stroke play, gross, with the field cut after the first: the
 * club championship most clubs actually run. The cut is where it goes wrong
 * in front of everybody — a player sent home who should be playing, or one
 * playing who should not.
 *
 * THE RULE is Ajay's of 2026-09-26: top N AND TIES, made when the organizer
 * marks the first round finished (`stroke-cut.ts`, docs/deferred-register.md).
 * A tie is first broken by countback — last 9, 6, 3, last hole — and only
 * players still level after that go through together.
 *
 *     Round 1      Alder 70, Briar 72, Cedar 72, Dune 75, Elm 78
 *     cut          top 2 and ties — Briar and Cedar return IDENTICAL cards,
 *                  hole for hole, so no countback can part them: 3 go through
 *     Round 2      Alder 74, Briar 70, Cedar 73
 *     36 holes     Briar 142, Alder 144, Cedar 145; Dune and Elm unranked,
 *                  "Missed the cut after Round 1"
 *
 * A cut that took exactly two sends Cedar home; one made on entry order or
 * never made leaves Dune ranked; a board summing one round prints 70 for the
 * champion.
 */

type Entrant = { name: string; index: string; r1: number; r2?: number };
const FIELD: Entrant[] = [
  { name: "Alder Quayle", index: "2", r1: -2, r2: 2 },
  { name: "Briar Quayle", index: "4", r1: 0, r2: -2 },
  { name: "Cedar Quayle", index: "6", r1: 0, r2: 1 },
  { name: "Dune Quayle", index: "8", r1: 3 },
  { name: "Elm Quayle", index: "10", r1: 6 },
];
const TOURNAMENT = "Club Championship — 36 Holes";
const PAR = MEDAL_PARS.reduce((a: number, b: number) => a + b, 0);

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
 * A card `toPar` from par: a bogey on each of the first holes when over, a
 * birdie on each when under, par everywhere else. Two players with the same
 * figure return the same card hole for hole — which is the point.
 */
const card = (toPar: number) =>
  MEDAL_PARS.map((par: number, i: number) => par + (i < Math.abs(toPar) ? Math.sign(toPar) : 0));

async function typeCard(page: Page, round: string, name: string, toPar: number) {
  await open(page, "/entry");
  const roundPicker = page.getByLabel("Round to enter scores for");
  await roundPicker.selectOption({ label: round });
  const picker = page.getByLabel("Player", { exact: true });
  const value = await picker.locator("option", { hasText: name }).first().getAttribute("value");
  await picker.selectOption(value!);
  const full = page.getByRole("button", { name: "Full card" });
  if (await full.count()) await full.click();
  for (const [i, strokes] of card(toPar).entries()) {
    await page.getByLabel(`Hole ${i + 1}, par ${MEDAL_PARS[i]}`).fill(String(strokes));
  }
  await page.getByRole("button", { name: /^Save scorecard/ }).click();
  await expect(page.getByText(/Saved/).first()).toBeVisible({ timeout: 20_000 });
}

/** Mark a round finished on Rounds & formats — which, for Round 1, makes the cut. */
async function finish(page: Page, round: string) {
  await open(page, "/stages");
  const header = page.getByRole("button", { name: new RegExp(`^${round} · Stroke Play Round`) });
  const box = page.getByRole("checkbox", { name: /^This round is finished/ });
  if (!(await box.isVisible()) || (await header.getAttribute("aria-expanded")) !== "true") await header.click();
  // Ticked by the server's answer, not the click: one more round says
  // "Closed" when it is done (an earlier round already closed says it too).
  const closedNotes = page.getByText(/Closed\. Untick it/);
  const before = await closedNotes.count();
  await box.click();
  await expect(closedNotes).toHaveCount(before + 1, { timeout: 30_000 });
}

test("a new organizer runs a 36-hole championship with a cut", async ({ page, baseURL }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  // With the page it came from: "a screen threw" is no use without which one.
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));

  await test.step("create the tournament: a series of rounds", async () => {
    await open(page, "/choose");
    await page.getByLabel("Tournament name").fill(TOURNAMENT);
    await page.getByRole("button", { name: /^A series of rounds/ }).click();
    await page.getByRole("button", { name: "Create tournament" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  });

  await test.step("date and course", async () => {
    await open(page, "/event");
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel("Tournament dates, first day").fill(today);
    await page.getByLabel("Tournament dates, last day").fill(today);
    const course = page.getByRole("combobox", { name: "Golf course" });
    await course.click();
    await course.fill("Kingsbarn Heath");
    await page.locator('#course-picker-list [role="option"]', { hasText: "Dayton" }).first().click();
    await page.locator("button.btn-primary", { hasText: /Save event|Adding the course/ }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(course).toHaveValue(MEDAL_COURSE);
  });

  await test.step("enter the field", async () => {
    await open(page, "/registration");
    for (const [i, p] of FIELD.entries()) {
      await page.getByLabel("Player name", { exact: true }).fill(p.name);
      await page.getByRole("textbox", { name: /^Email · required/ }).fill(medalEmail(i));
      await page.getByRole("textbox", { name: /^Mobile · required/ }).fill(`555030${i}`);
      await page.getByLabel("Handicap", { exact: true }).fill(p.index);
      await page.getByRole("button", { name: "Add to field" }).click();
      await expect(page.getByText(p.name).first()).toBeVisible({ timeout: 20_000 });
    }
  });

  await test.step("two rounds of stroke play, cut to the top 2 and ties", async () => {
    await open(page, "/stages");
    await page.getByRole("button", { name: /^Stroke play round/ }).click();
    await page.getByLabel("How many rounds to add").fill("2");
    await page.getByLabel("Format for every round added").selectOption("Stroke Play");
    await page.getByRole("button", { name: /^Add 2 stroke play rounds/ }).click();
    await expect(page.getByRole("button", { name: /^Round 2 · Stroke Play Round/ })).toBeVisible({ timeout: 20_000 });

    // Set on Round 1, where the round that decides it is.
    const cutBox = page.getByRole("checkbox", { name: "Cut the field for Round 2" });
    await expect(cutBox, "no cut offered on a stroke round with a round after it").toBeVisible();
    await cutBox.check();
    const n = page.getByLabel("Players who make the cut for Round 2");
    await n.fill("2");
    await n.press("Tab");
    await expect(page.getByText("2 and ties of 5 advance into Round 2.")).toBeVisible();
    // Kept: read back from a fresh load.
    await expect(async () => {
      await open(page, "/stages");
      await expect(page.getByRole("checkbox", { name: "Cut the field for Round 2" })).toBeChecked();
      await expect(page.getByLabel("Players who make the cut for Round 2")).toHaveValue("2");
    }).toPass({ timeout: 20_000 });
  });

  await test.step("launch", async () => {
    await makeBoardPublic(page);
    await open(page, "/dashboard");
    for (const step of ["Start taking entries", "Mark ready"]) {
      await page.getByRole("button", { name: step }).click();
      await expect(page.getByRole("button", { name: step })).toHaveCount(0, { timeout: 20_000 });
    }
    await page.getByRole("button", { name: "Launch tournament" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
    await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
  });

  await test.step("round 1 cards", async () => {
    for (const p of FIELD) await typeCard(page, "Round 1", p.name, p.r1);
    // The board before the cut is made says what the cut WILL do: Briar and
    // Cedar both through on the tie, not a play-off nobody is going to hold.
    // It said "Tied for the last place — play-off to decide" beside both and
    // quoted the last place on NET in a gross championship, until 2026-10-04.
    await open(page, "/leaderboard");
    const before = await page.locator("main").innerText();
    expect(before, `the board promises a play-off the cut will not hold:\n${before}`).not.toMatch(/play-off/i);
    expect(before).toMatch(/Cedar Quayle holds the final qualifying spot at 72\./);
    expect(before, "a gross championship quoted on net").not.toMatch(/qualifying spot at net/);
  });

  await test.step("no cut on cards the committee has not approved", async () => {
    // Ajay, 2026-10-05: "Cut can't be final unless organizer approve all cards
    // and approve the Cut." The organizer typed these five in, so they are
    // entered, not approved: closing Round 1 — which makes the cut — is refused
    // and says why, and the dashboard does not ask for the cut yet.
    await open(page, "/stages");
    const header = page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ });
    const box = page.getByRole("checkbox", { name: /^This round is finished/ });
    if (!(await box.isVisible()) || (await header.getAttribute("aria-expanded")) !== "true") await header.click();
    await box.click();
    await expect(page.getByText(/5 cards need your approval\. Closing Round 1 makes the cut/)).toBeVisible({ timeout: 20_000 });
    await expect(box).not.toBeChecked();
    await open(page, "/dashboard");
    await expect(page.getByRole("region", { name: "The cut is ready" })).toHaveCount(0);
  });

  await test.step("the organizer approves every round 1 card", async () => {
    await open(page, "/entry");
    await page.getByLabel("Round to enter scores for").selectOption({ label: "Round 1" });
    const anyway = page.getByRole("button", { name: "Approve anyway" });
    await expect(anyway).toHaveCount(FIELD.length, { timeout: 20_000 });
    for (let left = FIELD.length; left > 0; left -= 1) {
      await anyway.first().click();
      await expect(anyway).toHaveCount(left - 1, { timeout: 20_000 });
    }
  });

  await test.step("the dashboard asks for the cut; the organizer approves it — ties go through", async () => {
    await open(page, "/dashboard");
    const cut = page.getByRole("region", { name: "The cut is ready" });
    await expect(cut).toContainText("All Round 1 cards are approved — approve the cut.");
    // Briar and Cedar level on the second place: top 2 AND TIES is three.
    await expect(cut).toContainText("Top 2 and ties: 3 players go through to Round 2, 2 miss the cut.");
    await cut.getByRole("button", { name: /Approve the cut/ }).click();
    await cut.getByRole("button", { name: /Make the cut/ }).click();
    await expect(async () => {
      await open(page, "/dashboard");
      await expect(page.getByRole("region", { name: "The cut is ready" })).toHaveCount(0);
    }).toPass({ timeout: 20_000 });
  });

  await test.step("round 2 cards, for those who made it", async () => {
    for (const p of FIELD.filter((f) => f.r2 !== undefined)) await typeCard(page, "Round 2", p.name, p.r2!);
    await finish(page, "Round 2");
  });

  await test.step("the 36-hole board", async () => {
    await open(page, "/leaderboard");
    const board = await page.locator("main").innerText();
    const made = FIELD.filter((f) => f.r2 !== undefined)
      .map((f) => ({ ...f, total: 2 * PAR + f.r1 + f.r2! }))
      .sort((a, b) => a.total - b.total);
    expect(made.map((f) => f.total)).toEqual([142, 144, 145]);
    const at = made.map((f) => board.search(new RegExp(`${f.name}\\s+36\\s+${f.total}\\b`)));
    expect(at, `a player who made the cut is missing or carries the wrong 36-hole total:\n${board}`).not.toContain(-1);
    expect([...at].sort((a, b) => a - b), "the board is not in 36-hole order").toEqual(at);
    for (const cut of FIELD.filter((f) => f.r2 === undefined)) {
      const i = board.indexOf(cut.name);
      expect(i, `${cut.name} is missing from the board`).toBeGreaterThan(-1);
      expect(i, `${cut.name} missed the cut and is ranked among those who played 36`).toBeGreaterThan(Math.max(...at));
    }
    expect(board.match(/Missed the cut after Round 1/g)?.length, "missed-cut players are not captioned").toBe(2);
    // Not as a no-show: they did not play round 2 because the cut sent them home.
    expect(board).not.toMatch(/didn't play Round 2/);
  });

  await test.step("the link the club sends its members says the same", async () => {
    const pub = await readPublicBoard(page, baseURL!);
    expect(pub).toMatch(/Ranked by gross strokes/i);
    // The round named as a round — this board's own reader (`live-board.ts`)
    // printed the type's description here until 2026-10-04.
    expect(pub).toMatch(/Round 2 · Stroke Play/);
    expect(pub).not.toMatch(/The field plays the round and returns cards/);
    // Place, name, F, the 36-hole score to par: 142, 144, 145 on two par 72s.
    const rows = [
      /1\s+Briar Quayle\s+F\s+[-−]2\b/,
      /2\s+Alder Quayle\s+F\s+E\b/,
      /3\s+Cedar Quayle\s+F\s+\+1\b/,
    ];
    const at = rows.map((r) => pub.search(r));
    expect(at, `a player who made the cut is missing or wrong on the public board:\n${pub}`).not.toContain(-1);
    expect([...at].sort((a, b) => a - b), "the public board is not in 36-hole order").toEqual(at);
    // The cut, said to members as it is said to the committee — and below the field.
    for (const name of ["Dune Quayle", "Elm Quayle"]) {
      const i = pub.search(new RegExp(`${name}\\s+F · missed the cut`));
      expect(i, `${name} is not shown as missing the cut on the public board`).toBeGreaterThan(Math.max(...at));
    }
  });

  expect(errors, "a screen threw").toEqual([]);
});
