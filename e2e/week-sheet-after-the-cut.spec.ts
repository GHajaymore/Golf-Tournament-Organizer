import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * THE WEEK SHEET AFTER A CUT: ONLY THE FIELD THAT PLAYED ON, ON ITS TOTALS.
 *
 * The seeded Club Championship is 36 holes gross, twenty-eight entered, cut to
 * sixteen after round 1. Until 2026-10-21 the week sheet's "standings after
 * round 2" added up whatever cards each player held, so the twelve who went
 * home on ONE round's gross headed a table of thirty-six-hole totals — the
 * fewest strokes, because the fewest holes (Rule 3.3a: the winner completes
 * ALL the rounds in the fewest strokes).
 *
 * Nothing here is taken from the app. The expectation is worked from the cards
 * the seed stored:
 *
 *   round 1   every player with a card, on that card's strokes, lowest first
 *   round 2   ONLY the players holding a round-2 card — the cut leaves the
 *             survivors one and nobody else — each on round 1 + round 2,
 *             lowest first; none of the twelve on the screen at all
 *
 * The places beside the totals are the board's (countback on the last round),
 * so this asserts they start at 1 and never go down the page, and that the
 * totals run in order — not which of two level players is placed first.
 *
 * WHAT IT CANNOT SEE: a round still being played, where totals over different
 * holes are ordered by the board's places and carry "thru". The seeded
 * championship is finished; `week-table-holds-only-a-place.audit.test.ts`
 * builds that state.
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

const sum = (strokes: string) => (JSON.parse(strokes) as (number | null)[]).reduce<number>((a, b) => a + (b ?? 0), 0);

/** The table under "Standings after this week", as [place, name, total]. */
async function table(page: Page, stageId: string): Promise<Array<[number, string, number]>> {
  await page.goto(`/week?round=${stageId}&bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const card = page.locator(".card", { has: page.locator(".card-title", { hasText: /^Standings after this week$/ }) });
  await expect(card, "the week sheet has no standings after this week").toBeVisible();
  const rows = card.locator("table tbody tr");
  await expect(rows.first()).toBeVisible();
  return (
    await rows.evaluateAll((trs) =>
      trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim())),
    )
  ).map((c) => [Number(c[0]), c[2], Number.parseInt(c[3], 10)] as [number, string, number]);
}

test("after the cut, the week sheet's table is the sixteen who played on, on 36-hole totals, and none of the twelve", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "two sizes: seeding a club of eleven tournaments a third time proves nothing more");
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");

  const champs = club.events.find((e) => e.slug === "champs")!;
  await context.addCookies([
    { name: "ng_session", value: club.organizer.session, url: baseURL! },
    { name: "ng_active_event", value: sign(champs.id), url: baseURL! },
  ]);

  const [r1, r2] = await prisma.stage.findMany({ where: { eventId: champs.id }, orderBy: { position: "asc" }, select: { id: true } });
  const players = await prisma.player.findMany({ where: { eventId: champs.id }, select: { id: true, name: true } });
  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  const cards = await prisma.scorecard.findMany({ where: { eventId: champs.id }, select: { stageId: true, playerId: true, strokes: true } });
  const r1Total = new Map(cards.filter((c) => c.stageId === r1.id).map((c) => [c.playerId, sum(c.strokes)]));
  const r2Total = new Map(cards.filter((c) => c.stageId === r2.id).map((c) => [c.playerId, sum(c.strokes)]));
  // The fixture can express the fault: there IS a cut, and a missed-cut
  // player's single round is fewer strokes than the best 36-hole total.
  const cut = [...r1Total.keys()].filter((id) => !r2Total.has(id));
  const through2 = new Map([...r2Total].map(([id, t]) => [id, (r1Total.get(id) ?? 0) + t]));
  expect(cut.length, "the seeded championship has nobody cut").toBeGreaterThan(0);
  expect(Math.min(...cut.map((id) => r1Total.get(id)!)), "no cut player's round is below the best 36-hole total — the fixture cannot show the fault").toBeLessThan(Math.min(...through2.values()));

  const inOrder = (rows: Array<[number, string, number]>) => {
    expect(rows[0][0], "the table does not start at 1st").toBe(1);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i][0], `place goes down the page at ${rows[i][1]}`).toBeGreaterThanOrEqual(rows[i - 1][0]);
      expect(rows[i][2], `totals out of order at ${rows[i][1]}`).toBeGreaterThanOrEqual(rows[i - 1][2]);
    }
  };

  // ── round 1: everybody who played it, on their card ─────────────────────
  const one = await table(page, r1.id);
  expect(new Set(one.map((r) => r[1]))).toEqual(new Set([...r1Total.keys()].map((id) => nameOf.get(id))));
  for (const [, name, total] of one) {
    const id = players.find((p) => p.name === name)!.id;
    expect(total, `${name}'s round 1`).toBe(r1Total.get(id));
  }
  inOrder(one);

  // ── round 2: the survivors only, on 36 holes ────────────────────────────
  const two = await table(page, r2.id);
  expect(new Set(two.map((r) => r[1])), "the table after round 2 is not the field that played it").toEqual(
    new Set([...through2.keys()].map((id) => nameOf.get(id))),
  );
  for (const id of cut) expect(two.map((r) => r[1]), `${nameOf.get(id)} missed the cut and is on the table`).not.toContain(nameOf.get(id));
  for (const [, name, total] of two) {
    const id = players.find((p) => p.name === name)!.id;
    expect(total, `${name}'s 36-hole total`).toBe(through2.get(id));
  }
  inOrder(two);

  expect(errors, "the page threw").toEqual([]);
});
