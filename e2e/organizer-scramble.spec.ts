import { test, expect, type Page } from "@playwright/test";
import { seedOrganizer, teardownOrganizer, medalEmail, MEDAL_PARS, MEDAL_COURSE } from "./organizer-fixture.mjs";
import { makeBoardPublic, readPublicBoard } from "./public-board";

/**
 * A FOUR-PERSON TEXAS SCRAMBLE ON NET, RUN FROM NOTHING — the society day and
 * the charity day, which is most of the golf a club's members play as a team.
 *
 * A side plays off a share of its players' course handicaps, lowest first:
 * 25%, 20%, 15% and 10% (the WHS recommended allowance for a four-person
 * scramble; `SCRAMBLE_WEIGHTS_4`), summed and rounded once. The tee is rated
 * 72.0 / 113 over par 72, so a course handicap is the index:
 *
 *   side     indexes          share                         plays off  gross  net
 *   Eagles   0, 2, 4, 6       0 + 0.4 + 0.6 + 0.6 = 1.6         2       62    60
 *   Hackers  18, 22, 26, 30   4.5 + 4.4 + 3.9 + 3.0 = 15.8     16       70    54
 *
 * Net turns gross upside down: the Hackers win. A flat 25% of the combined
 * total plays the sides off 3 and 24, and the shares taken highest-first plays
 * them off 3 and 18 — either prints a different table.
 */

type Side = { name: string; members: { name: string; index: string }[]; playsOff: number; gross: number; net: number };
const SIDES: Side[] = [
  {
    name: "Eagles",
    members: [
      { name: "Ash Quayle", index: "0" },
      { name: "Birch Quayle", index: "2" },
      { name: "Cherry Quayle", index: "4" },
      { name: "Damson Quayle", index: "6" },
    ],
    playsOff: 2,
    gross: 62,
    net: 60,
  },
  {
    name: "Hackers",
    members: [
      { name: "Elder Quayle", index: "18" },
      { name: "Fir Quayle", index: "22" },
      { name: "Gorse Quayle", index: "26" },
      { name: "Hazel Quayle", index: "30" },
    ],
    playsOff: 16,
    gross: 70,
    net: 54,
  },
];
const PAR = MEDAL_PARS.reduce((a: number, b: number) => a + b, 0);
const TOURNAMENT = "Society Day — Texas Scramble";

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

/** A side's card: birdies on the first holes until it is `toPar` under, pars after. */
const card = (toPar: number) => MEDAL_PARS.map((p: number, i: number) => p + (i < Math.abs(toPar) ? Math.sign(toPar) : 0));

test("a new organizer runs a four-person scramble on net", async ({ page, baseURL }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));

  await test.step("create, date and course", async () => {
    await open(page, "/choose");
    await page.getByLabel("Tournament name").fill(TOURNAMENT);
    await page.getByRole("button", { name: /^A single round/ }).click();
    await page.getByRole("button", { name: "Create tournament" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

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

  await test.step("enter the eight players", async () => {
    await open(page, "/registration");
    const everyone = SIDES.flatMap((s) => s.members);
    for (const [i, p] of everyone.entries()) {
      await page.getByLabel("Player name", { exact: true }).fill(p.name);
      await page.getByRole("textbox", { name: /^Email · required/ }).fill(medalEmail(i));
      await page.getByRole("textbox", { name: /^Mobile · required/ }).fill(`555060${i}`);
      await page.getByLabel("Handicap", { exact: true }).fill(p.index);
      await page.getByRole("button", { name: "Add to field" }).click();
      await expect(page.getByText(p.name).first()).toBeVisible({ timeout: 20_000 });
    }
  });

  await test.step("one Texas Scramble round, on net", async () => {
    await open(page, "/stages");
    await page.getByRole("button", { name: /^Stroke play round/ }).click();
    await page.getByLabel("Format for every round added").selectOption("Texas Scramble");
    await page.getByRole("button", { name: /^Add stroke play round/ }).click();
    const customize = page.getByRole("button", { name: /^Customize this round/ });
    await expect(customize).toBeVisible({ timeout: 20_000 });
    await customize.click();
    await page.locator("label.seg-opt", { hasText: /^\s*Net\s*$/ }).click();
    await expect(async () => {
      await open(page, "/stages");
      await expect(page.getByRole("button", { name: /^Customize this round/ })).toContainText(/Net/);
    }).toPass({ timeout: 20_000 });
  });

  await test.step("the two sides, picked by the committee", async () => {
    await open(page, "/teams");
    for (const side of SIDES) {
      await page.getByLabel("Add a team").fill(side.name);
      await page.getByRole("button", { name: "Add team" }).click();
      await expect(page.getByLabel(`Name of ${side.name}`)).toBeVisible({ timeout: 20_000 });
    }
    for (const side of SIDES) {
      const cardEl = page.locator(".card", { has: page.getByLabel(`Name of ${side.name}`) });
      for (const m of side.members) {
        await cardEl.getByRole("button", { name: "Add player" }).click();
        const pick = page.getByLabel(`Add a player to ${side.name}`);
        const value = await pick.locator("option", { hasText: m.name }).getAttribute("value");
        await pick.selectOption(value!);
        await expect(cardEl.getByText(m.name)).toBeVisible({ timeout: 20_000 });
      }
      // The share of handicaps the side plays off, worked by hand above.
      await expect(cardEl.getByText(`Plays off ${side.playsOff}`), `${side.name} plays off the wrong handicap`).toBeVisible();
    }
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

  await test.step("each side's card", async () => {
    for (const side of SIDES) {
      await open(page, "/entry");
      const full = page.getByRole("button", { name: "Full card" });
      if (await full.count()) await full.click();
      for (const [i, strokes] of card(side.gross - PAR).entries()) {
        await page.getByLabel(`${side.name}, hole ${i + 1}, par ${MEDAL_PARS[i]}`).fill(String(strokes));
      }
      const cardEl = page.locator(".card", { hasText: side.name }).filter({ has: page.getByRole("button", { name: /Save card/ }) }).first();
      await cardEl.getByRole("button", { name: /Save card/ }).click();
      await expect(cardEl.getByText(`${side.gross} gross · ${side.net} net · 18 holes`)).toBeVisible({ timeout: 20_000 });
    }
  });

  await test.step("the team board, on net", async () => {
    await open(page, "/leaderboard");
    const board = await page.locator("main").innerText();
    expect(board).toMatch(/Texas Scramble · 2 sides · lowest net wins/);
    // A row: side, its players, plays off, holes, gross, net.
    const order = [...SIDES].sort((a, b) => a.net - b.net);
    const at = order.map((s) =>
      board.search(new RegExp(`${s.name}\\s*\\n[^\\n]*\\s+${s.playsOff}\\s+18\\s+${s.gross}\\s+${s.net}\\b`)),
    );
    expect(at, `a side is missing or carries the wrong figures:\n${board}`).not.toContain(-1);
    expect([...at].sort((a, b) => a - b), "the board is not in net order").toEqual(at);
  });

  await test.step("the link the club sends its members says the same", async () => {
    const pub = await readPublicBoard(page, baseURL!);
    expect(pub).toMatch(/Texas Scramble · 2 sides · lowest net wins/);
    // A row: the side, its players, plays off, holes, gross, net, net to par.
    const order = [...SIDES].sort((a, b) => a.net - b.net);
    const at = order.map((s) =>
      pub.search(new RegExp(`${s.name}\\s*\\n[^\\n]*\\s+${s.playsOff}\\s+18\\s+${s.gross}\\s+${s.net}\\s+[-−]${PAR - s.net}\\b`)),
    );
    expect(at, `a side is missing or carries the wrong figures on the public board:\n${pub}`).not.toContain(-1);
    expect([...at].sort((a, b) => a - b), "the public board is not in net order").toEqual(at);
  });

  expect(errors, "a screen threw").toEqual([]);
});
