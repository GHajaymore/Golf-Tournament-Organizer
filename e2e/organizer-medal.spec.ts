import { test, expect, type Page } from "@playwright/test";
import { seedOrganizer, teardownOrganizer, medalEmail, MEDAL_PARS, MEDAL_COURSE } from "./organizer-fixture.mjs";

/**
 * A CLUB MEDAL, RUN FROM NOTHING BY SOMEBODY WHO HAS NEVER USED THE APP.
 *
 * Every other organizer spec starts from the shared fixture, which arrives
 * with the tournament, the course, the field and the cards already in the
 * database. So the path a new club actually walks — the only one that decides
 * whether they stay — was never walked by anything but a person.
 *
 * This walks it the way a competition secretary runs a Saturday medal:
 *
 *   create      a one-round tournament, from the empty first screen
 *   event       its date, the course found by typing, the board made public
 *   field       four players entered with their handicap indexes
 *   round       Round 1, stroke play, decided on NET
 *   launch      entries → ready → launched, which is what unlocks scoring
 *   cards       each returned card typed in from the paper, as the
 *               secretary does in the clubhouse, on the full card
 *   board       the leaderboard, read against the Rules of Golf
 *   public      the link the club sends its members says the same
 *   complete    and the tournament is closed
 *
 * THE FIELD IS BUILT SO THE WRONG BOARD CANNOT PASS. The tee is rated 72.0 over
 * a slope of 113 and a par of 72, so a course handicap is the index itself,
 * and the playing handicap is 95% of it (the WHS allowance for individual
 * stroke play, Appendix C), rounded:
 *
 *     index   course   playing   gross   net
 *       0       0         0       73     73
 *       8       8         8       80     72      (7.6 rounds to 8)
 *      14      14        13       84     71      (13.3 rounds to 13)
 *      20      20        19       89     70
 *
 * Gross and net run in EXACTLY OPPOSITE orders. A board that ranked on gross,
 * printed gross under a net heading, or gave everybody their full index
 * instead of 95% of it, puts a different name on top or a different number in
 * a row — it cannot print this table by accident.
 */

type Entrant = { name: string; index: string; overPar: number; gross: number; net: number };
const FIELD: Entrant[] = [
  { name: "Alder Quayle", index: "0", overPar: 1, gross: 73, net: 73 },
  { name: "Briar Quayle", index: "8", overPar: 8, gross: 80, net: 72 },
  { name: "Cedar Quayle", index: "14", overPar: 12, gross: 84, net: 71 },
  { name: "Dune Quayle", index: "20", overPar: 17, gross: 89, net: 70 },
];
const TOURNAMENT = "Saturday Medal — Spring Meeting";

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

/** A screen read fresh — see CLAUDE.md on reading a change in the browser. */
async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
}

/** One returned card: a bogey on each of the first `overPar` holes, par after. */
const card = (overPar: number) => MEDAL_PARS.map((par, i) => par + (i < overPar ? 1 : 0));

test("a new organizer runs a net medal from nothing to a finished board", async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await test.step("create the tournament", async () => {
    await open(page, "/choose");
    await page.getByLabel("Tournament name").fill(TOURNAMENT);
    await page.getByRole("button", { name: /^A single round/ }).click();
    await page.getByRole("button", { name: "Create tournament" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  await test.step("date, course and a public board", async () => {
    await open(page, "/event");
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel("Tournament dates, first day").fill(today);
    await page.getByLabel("Tournament dates, last day").fill(today);
    const course = page.getByRole("combobox", { name: "Golf course" });
    await course.click();
    await course.fill("Kingsbarn Heath");
    // The catalogue's row, which carries the town — not the "use what you
    // typed" row beside it, which carries the same words.
    const option = page.locator('#course-picker-list [role="option"]', { hasText: "Dayton" }).first();
    await expect(option, "the course search found nothing").toBeVisible({ timeout: 20_000 });
    await option.click();
    // Save pressed the moment the course is picked, as somebody in a hurry
    // does. Adding it from the search takes a moment, and a save in that
    // moment went without it — so Save waits ("Adding the course…") until
    // the course is in. The round step below proves it arrived.
    await page.locator("button.btn-primary", { hasText: /Save event|Adding the course/ }).click();
    // The button's own word for done: "Save event" becomes "Saved".
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(course).toHaveValue(MEDAL_COURSE);

    // The link the club sends its members — off until somebody says so.
    await open(page, "/event");
    await page.getByRole("radio", { name: /Anyone with the link/ }).check();
    const saveSettings = page.getByRole("button", { name: "Save settings" });
    await saveSettings.click();
    await expect(saveSettings).toHaveCount(0, { timeout: 20_000 });
  });

  await test.step("enter the field", async () => {
    await open(page, "/registration");
    for (const [i, p] of FIELD.entries()) {
      await page.getByLabel("Player name", { exact: true }).fill(p.name);
      await page.getByRole("textbox", { name: /^Email · required/ }).fill(medalEmail(i));
      await page.getByRole("textbox", { name: /^Mobile · required/ }).fill(`555010${i}`);
      await page.getByLabel("Handicap", { exact: true }).fill(p.index);
      await page.getByRole("button", { name: "Add to field" }).click();
      await expect(page.getByText(p.name).first()).toBeVisible({ timeout: 20_000 });
    }
  });

  await test.step("round 1: stroke play, on net", async () => {
    await open(page, "/stages");
    await page.getByRole("button", { name: /^Stroke play round/ }).click();
    await page.getByLabel("Format for every round added").selectOption("Stroke Play");
    await page.getByRole("button", { name: /^Add stroke play round/ }).click();
    // The round just added is opened and brought on screen — it used to land
    // closed, above the builder, off the top of a phone.
    const customize = page.getByRole("button", { name: /^Customize this round/ });
    await expect(customize, "the new round did not open").toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ })).toBeInViewport();
    // The course chosen on the event screen is the round's card — #779.
    await expect(page.getByText(/A course card is missing/)).toHaveCount(0);
    await customize.click();
    // The radio itself is drawn at nothing behind its label, so it is the
    // word that is tapped — as a person does.
    await page.locator("label.seg-opt", { hasText: /^\s*Net\s*$/ }).click();
    // Read back from what was stored, not from the radio just clicked.
    await expect(async () => {
      await open(page, "/stages");
      await expect(page.getByRole("button", { name: /^Customize this round/ })).toContainText(/Net/);
    }).toPass({ timeout: 20_000 });
  });

  await test.step("launch", async () => {
    await open(page, "/dashboard");
    for (const step of ["Start taking entries", "Mark ready"]) {
      await page.getByRole("button", { name: step }).click();
      await expect(page.getByRole("button", { name: step })).toHaveCount(0, { timeout: 20_000 });
    }
    await page.getByRole("button", { name: "Launch tournament" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Launch tournament" }).click();
    await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
  });

  await test.step("type in each returned card", async () => {
    for (const p of FIELD) {
      await open(page, "/entry");
      // Options read "Name (hcp X)", so the player is found by name.
      const picker = page.getByLabel("Player", { exact: true });
      const value = await picker.locator("option", { hasText: p.name }).first().getAttribute("value");
      await picker.selectOption(value!);
      const full = page.getByRole("button", { name: "Full card" });
      if (await full.count()) await full.click();
      for (const [i, strokes] of card(p.overPar).entries()) {
        await page.getByLabel(`Hole ${i + 1}, par ${MEDAL_PARS[i]}`).fill(String(strokes));
      }
      await page.getByRole("button", { name: /^Save scorecard/ }).click();
      await expect(page.getByText(/Saved/).first()).toBeVisible({ timeout: 20_000 });
    }
  });

  let board = "";
  await test.step("the leaderboard, read against the Rules", async () => {
    await open(page, "/leaderboard");
    board = await page.locator("main").innerText();
    const rows = FIELD.map((p) => board.search(new RegExp(`${p.name}\\s+18\\s+${p.gross}\\s+${p.net}\\b`)));
    expect(rows, `a row is missing or carries the wrong figures:\n${board}`).not.toContain(-1);
    // Net decides it: lowest net first, which is the reverse of the gross order.
    expect([...rows].sort((a, b) => b - a), "the board is not in net order").toEqual(rows);
  });

  await test.step("the public board says the same", async () => {
    await open(page, "/event");
    const link = (await page.locator("code", { hasText: "/live/" }).first().innerText()).trim();
    const path = new URL(link, "http://x").pathname;
    const outsider = await page.context().browser()!.newContext();
    try {
      const pub = await outsider.newPage();
      await pub.goto(`${path}?bust=${Date.now()}`, { waitUntil: "networkidle" });
      const text = await pub.locator("body").innerText();
      const at = FIELD.map((p) => text.indexOf(p.name));
      expect(at, "a player is missing from the public board").not.toContain(-1);
      expect([...at].sort((a, b) => b - a), "the public board is not in net order").toEqual(at);
    } finally {
      await outsider.close();
    }
  });

  await test.step("complete", async () => {
    await open(page, "/dashboard");
    await page.getByRole("button", { name: "Complete tournament" }).click();
    const confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: /^Complete/ }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/dashboard"), { timeout: 30_000 });
  });

  expect(errors, "a screen threw").toEqual([]);
});
