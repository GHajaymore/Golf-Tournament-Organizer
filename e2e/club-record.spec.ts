import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * THE HONOURS BOARD: A CHAMPION PUT ON IT, AND TAKEN OFF.
 *
 * The board is the club's permanent record, and the one list in the app that
 * is deliberately NOT a calculation: the standings propose a name, a person
 * confirms it, and from then on it is whatever was written. `confirmChampion`
 * and `removeFromHonours` were performed by no browser test (round 1 on the
 * frozen app, 2026-10-13): every walk opened the board and none put a name on
 * it.
 *
 * The seeded club has one finished tournament, its 36-hole championship:
 *
 *   the board                       → open, and the championship is listed as
 *                                      finished and not yet on it
 *   "Standings say A, then B and C" → the board the club sends its members puts
 *                                      A above B above C (two screens, one fact)
 *   Put on the board                → stored; A is on the board against the
 *                                      championship, with who confirmed it, and
 *                                      the tournament is no longer waiting
 *   taken off — asked first         → gone from the board, and waiting again
 *   a NEW club on the free plan     → the board says it is locked and offers
 *                                      nothing to press
 *   a club that predates the terms  → on the free plan, and the board is open:
 *                                      it keeps what it had (the control — and
 *                                      the first draft of this test had it
 *                                      wrong, and expected a lock here)
 *
 * WHAT IT CANNOT SEE: a tie at the top, which the committee settles by picking
 * a name. `honours.test.ts` holds that refusal; the seeded club has no tie.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const WALKED = ["desktop", "phone"];

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;
test.beforeAll(async ({}, testInfo) => {
  if (!WALKED.includes(testInfo.project.name)) return;
  club = await seed();
});
test.afterAll(async ({}, testInfo) => {
  if (WALKED.includes(testInfo.project.name)) await teardown();
  await prisma.$disconnect();
});

async function open(page: Page) {
  await page.goto(`/series?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  // "Honors board" to a US club (or one with no country), "Honours board" in Britain — golf-terms.ts.
  const board = page.locator(".card", { has: page.locator(".card-title", { hasText: /^Honou?rs board$/ }) }).last();
  await expect(board, "the season screen has no honours board").toBeVisible();
  return board;
}

test("a champion is put on the honours board from the standings and taken off again, and only a new club on the free plan finds the board locked", async ({ page, context, browser, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "two sizes: seeding a club of eleven tournaments a third time proves nothing more");
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const champs = club.events.find((e) => e.slug === "champs")!;
  expect(champs.status, "the seeded club's championship is not finished").toBe("completed");
  await context.addCookies([
    { name: "ng_session", value: club.organizer.session, url: baseURL! },
    { name: "ng_active_event", value: sign(champs.id), url: baseURL! },
  ]);
  const entries = () => prisma.honoursEntry.findMany({ where: { organizationId: club.org.id } });

  // ── open, and the championship is waiting ─────────────────────────────────
  let board = await open(page);
  await expect(board, "CONTROL: the board is locked on a plan that includes it").not.toContainText("comes with");
  const waiting = () => board.locator("div", { hasText: champs.name }).filter({ has: page.getByRole("button", { name: "Put on the board" }) }).last();
  await expect(waiting(), "the finished championship is not offered for the board").toBeVisible();
  const said = (await waiting().innerText()).replace(/\s+/g, " ");
  const read = said.match(/Standings say (.+?), then (.+?) and (.+?) Put on the board/);
  expect(read, `the board does not say who the standings point at: "${said}"`).not.toBeNull();
  const [, first, second, third] = read!;

  // ── the board the club sends its members agrees about the order ───────────
  const outsider = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const pub = await outsider.newPage();
    await pub.goto(`/live/${club.shareTokens.champs}?bust=${Date.now()}`, { waitUntil: "networkidle" });
    const text = await pub.locator("main, body").first().innerText();
    const at = [first, second, third].map((name) => text.indexOf(name));
    expect(at.every((i) => i >= 0), `the public board does not name the three the honours board does (${first}, ${second}, ${third})`).toBe(true);
    expect(at[0] < at[1] && at[1] < at[2], `the public board does not have ${first} above ${second} above ${third}`).toBe(true);
  } finally {
    await outsider.close();
  }

  // ── put on the board ──────────────────────────────────────────────────────
  expect(await entries(), "the board holds a name nobody confirmed").toEqual([]);
  await waiting().getByRole("button", { name: "Put on the board" }).click();
  await expect.poll(async () => (await entries()).map((e) => [e.eventId, e.championName]), { timeout: 20_000, message: "the champion was not stored" }).toEqual([[champs.id, first]]);
  board = await open(page);
  const line = board.locator("div", { has: page.locator("b", { hasText: first }) }).filter({ hasText: champs.name }).last();
  await expect(line, "the champion is not on the board against the championship").toBeVisible();
  await expect(line, "the board does not say who confirmed it").toContainText("confirmed by");
  await expect(board.getByRole("button", { name: "Put on the board" }), "a tournament with its champion confirmed is still waiting").toHaveCount(0);

  // ── taken off: asked first ────────────────────────────────────────────────
  await board.getByRole("button", { name: `Take ${first} off the board for ${champs.name}` }).click();
  expect((await entries()).length, "one press took a champion off the board without asking").toBe(1);
  await board.getByRole("button", { name: "Take them off" }).click();
  await expect.poll(async () => (await entries()).length, { timeout: 20_000, message: "the name was not taken off" }).toBe(0);
  board = await open(page);
  await expect(waiting(), "a tournament whose champion was taken off is not offered again").toBeVisible();

  // ── a new club on the free plan: locked, and nothing to press ─────────────
  const paid = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: club.org.id } });
  expect(paid.plan, "the seeded club is not on a plan that includes the board").toBe("society");
  const onPlan = (plan: string, planTermsApply: boolean) => prisma.subscription.update({ where: { organizationId: club.org.id }, data: { plan, planTermsApply } });
  try {
    await onPlan("free", true);
    board = await open(page);
    await expect(board, "a new club on the free plan is not told the board is locked").toContainText(/The hono(u)?rs board comes with/);
    await expect(board.getByRole("button", { name: "Put on the board" }), "a locked board still offers to put a name on it").toHaveCount(0);

    // ── and a club that predates the terms keeps its board ──────────────────
    await onPlan("free", false);
    board = await open(page);
    await expect(board, "CONTROL: a club from before the plan terms lost its honours board").not.toContainText(/The hono(u)?rs board comes with/);
    await expect(waiting(), "a club from before the plan terms is not offered its champion").toBeVisible();
  } finally {
    await onPlan(paid.plan, paid.planTermsApply);
  }

  expect(errors, "a screen threw").toEqual([]);
});

/**
 * THE SEASON TABLE, WITH A REAL CHAMPIONSHIP IN IT.
 *
 * The seeded club's Order of Merit holds its finished championship — twenty-
 * eight entered, a cut to sixteen — and its medal, which is still being played.
 * Nothing had ever drawn this table with a row in it: on both clubs the suite
 * walks it was locked. Drawn for the first time (2026-10-13) it read:
 *
 *     12 entries have no roster record, so they aren't tracked across the season
 *
 * over a field entered whole from the roster. The twelve were the members who
 * missed the cut. Everybody the season does not score was counted under the
 * roster's name.
 *
 *   the table                       → the sixteen who finished, and nobody else
 *   its order                       → the order the club's own board has them in
 *   its points                      → the season's table, by finishing place:
 *                                      50, 40, 32 … and nothing past tenth,
 *                                      because this season's table stops there
 *   the twelve who missed the cut   → said to hold no finishing place, and NOT
 *                                      said to have no roster record
 *   one finisher's roster link cut  → fifteen rows, and now ONE entry is said to
 *                                      have no roster record (the control: the
 *                                      sentence still appears when it is true)
 *   the medal                       → named as not finished, and not counted
 *
 * WHAT IT CANNOT SEE: whether a member who missed a cut should count as having
 * PLAYED that tournament towards "rounds to qualify". Today they do not, and
 * `docs/deferred-register.md` says why that is a decision and not a slip.
 */
const POINTS = [50, 40, 32, 26, 22, 18, 15, 12, 10, 8];

test("the season table holds who finished, in the board's order, on the season's points — and says why the rest are not in it", async ({ page, context, browser, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "two sizes: seeding a club of eleven tournaments a third time proves nothing more");
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const champs = club.events.find((e) => e.slug === "champs")!;
  const medal = club.events.find((e) => e.slug === "medal")!;
  await context.addCookies([
    { name: "ng_session", value: club.organizer.session, url: baseURL! },
    { name: "ng_active_event", value: sign(champs.id), url: baseURL! },
  ]);
  const entered = await prisma.player.count({ where: { eventId: champs.id, status: "confirmed" } });
  expect(entered, "the seeded championship no longer has a field of twenty-eight").toBe(28);

  /** The table as drawn: place, name, tournaments played, points. */
  const table = async () => {
    await page.goto(`/series?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const main = page.locator("main");
    await expect(main.locator(".card-title", { hasText: club.season.name }), "the seeded club's season is not on the screen").toBeVisible();
    const rows = await main.locator("table tbody tr").evaluateAll((trs) =>
      trs.map((tr) => [...tr.querySelectorAll("td")].slice(0, 4).map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim())),
    );
    return { main, rows: rows.map(([place, name, played, points]) => ({ place: Number(place), name, played: Number(played), points: Number(points) })) };
  };

  // ── who finished, and nobody else ─────────────────────────────────────────
  let { main, rows } = await table();
  expect(rows.length, "the season table does not hold the sixteen who finished the championship").toBe(16);
  expect(rows.map((r) => r.played), "somebody is credited with a tournament that is not finished").toEqual(rows.map(() => 1));
  await expect(main).toContainText("1 of 2 rounds counted");
  await expect(main, "the medal is not said to be waiting to finish").toContainText(`${medal.name} — not finished yet, so it doesn't count`);

  // ── the season's points, by finishing place ───────────────────────────────
  expect(rows.map((r) => r.place), "the places do not run from first to sixteenth").toEqual(rows.map((_, i) => i + 1));
  expect(rows.map((r) => r.points), "a finishing place is not worth what the season's table says").toEqual(rows.map((_, i) => POINTS[i] ?? 0));

  // ── the order the club's own board has them in ────────────────────────────
  const outsider = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const pub = await outsider.newPage();
    await pub.goto(`/live/${club.shareTokens.champs}?bust=${Date.now()}`, { waitUntil: "networkidle" });
    const text = await pub.locator("body").innerText();
    const at = rows.map((r) => text.indexOf(r.name));
    expect(at.every((i) => i >= 0), "somebody in the season table is not on the championship's board").toBe(true);
    expect(at, "the season table and the championship's board have the finishers in different orders").toEqual([...at].sort((a, b) => a - b));
  } finally {
    await outsider.close();
  }

  // ── the twelve who missed the cut are not the roster's fault ──────────────
  await expect(main, "the members who missed the cut are not accounted for").toContainText("12 entries hold no finishing place");
  await expect(main, "members who missed the cut are said to have no roster record").not.toContainText("no roster record");

  // ── and an entry that really has no roster record is said to have none ────
  const last = await prisma.player.findFirstOrThrow({ where: { eventId: champs.id, name: rows[15].name }, select: { id: true, memberId: true } });
  expect(last.memberId, "the seeded field is not linked to the roster").not.toBeNull();
  await prisma.player.update({ where: { id: last.id }, data: { memberId: null } });
  try {
    ({ main, rows } = await table());
    expect(rows.length, "an entry with no roster record is still in the season table").toBe(15);
    await expect(main, "CONTROL: an entry that placed and has no roster record is not said to have none").toContainText("1 entry has no roster record");
    await expect(main, "the twelve who missed the cut changed when a roster link did").toContainText("12 entries hold no finishing place");
  } finally {
    await prisma.player.update({ where: { id: last.id }, data: { memberId: last.memberId } });
  }

  expect(errors, "a screen threw").toEqual([]);
});
