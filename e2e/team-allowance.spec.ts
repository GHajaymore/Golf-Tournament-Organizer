import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * A COMMITTEE CHANGES A FOUR-BALL'S ALLOWANCE, AND THE BOARD IS RE-SCORED BY
 * THE RULES OF HANDICAPPING.
 *
 * `setConfigUnlocked`, `setStageAllowance` and `setStageCountBest` were
 * performed by no browser test (round 4 on the second batch, 2026-10-13). They
 * are the three presses that change what every card in a team round MEANS
 * without touching a stroke on one, on a tournament that is already live.
 *
 * AND WRITING THIS FOUND THE APP TAKING ITS ALLOWANCES WRONG. To hold the board
 * to something other than itself, the net of every side is worked out here from
 * the stored cards, the tees' rating and each player's index, in whole numbers,
 * by the Rule (6.2a): the allowance is taken of the course handicap BEFORE it
 * is rounded, and the result rounded once. The app took it of the rounded
 * figure and rounded again — a stroke too many or too few for about one player
 * in five, in every net round with an allowance. This is the browser form of
 * that finding: the next round can find it again without anybody remembering.
 *
 * AND THEN THE FIGURE ITSELF. A four-ball is 85% at stroke play and 90% in a
 * match (Appendix C). The app offered 90% for both, and the seeded round carried
 * 85% "set by your committee, in place of the usual 90%". The app says 85% for
 * a stroke-play four-ball itself now, and this holds it to that.
 *
 * The seeded club's four-ball is live, its first round scored at stroke play,
 * with no allowance of the committee's own:
 *
 *   the round's board          → every side's NET is the Rule's, at 85%
 *                                 (and at least one side's would be different
 *                                 rounded first — or this proves nothing)
 *   the board the club sends   → the same nets, signed out
 *   setup is locked            → the allowance cannot be changed; Unlock setup
 *   Change → "9o", then 0      → refused beside the box, nothing stored
 *   Change → 100 → Save        → ASKED first, with the number of cards at stake;
 *                                 "Keep 85%" stores nothing
 *   … → Change it anyway       → stored; the board is the Rule's at 100%, which
 *                                 is every player's whole course handicap
 *   Back to 85%                → the Rules' own for a four-ball at stroke play;
 *                                 the board is back where it began
 *   a committee's 90           → asked; the board is the Rule's at 90%
 *   a committee's 85           → said to be the committee's, and the usual figure
 *   Scores that count → best 2 → asked; then both balls count on every hole
 *   the round's handicaps      → say the course handicap, the figure before
 *                                 rounding, and what the player plays off
 *
 * WHAT IT CANNOT SEE: a split (greensomes' 60/40, a scramble's shares) — the
 * seeded four-ball has none to change; `shares-agree.test.ts` holds the
 * arithmetic. And a plus handicap in a four-ball, which the seeded sides do not
 * have: the spec says so rather than guessing how strokes are given back.
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

// ── The Rule, in whole numbers, sharing nothing with the app ────────────────
type Tee = { courseRating: number; slopeRating: number; par: number };
/** Nearest whole number, a half upwards: floor((2n + d) / 2d). */
const nearest = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));
/** An unrounded course handicap in 1,130ths of a stroke: index (tenths) × slope + (rating − par) (tenths) × 113. */
const course1130 = (indexTenths: number, tee: Tee) =>
  indexTenths * tee.slopeRating + (Math.round(tee.courseRating * 10) - tee.par * 10) * 113;
const byTheRule = (indexTenths: number, tee: Tee, pct: number) => nearest(course1130(indexTenths, tee) * pct, 113_000);
const roundedFirst = (indexTenths: number, tee: Tee, pct: number) => nearest(nearest(course1130(indexTenths, tee), 1130) * pct, 100);
/** Strokes received on a hole of this stroke index, off a playing handicap of nought or more. */
const shotsOn = (playing: number, strokeIndex: number) => Math.floor(playing / 18) + (strokeIndex <= playing % 18 ? 1 : 0);

type Ball = { name: string; indexTenths: number; tee: Tee; strokes: (number | null)[] };
type Side = { name: string; balls: Ball[] };

/** A side's gross and net over the round, counting its best `count` balls on each hole. */
function sideTotals(side: Side, strokeIndex: number[], pct: number, count: number, method = byTheRule) {
  let gross = 0;
  let net = 0;
  for (let h = 0; h < strokeIndex.length; h += 1) {
    const holed = side.balls
      .filter((b) => typeof b.strokes[h] === "number")
      .map((b) => {
        const g = b.strokes[h] as number;
        return { gross: g, net: g - shotsOn(method(b.indexTenths, b.tee, pct), strokeIndex[h]) };
      })
      // The lower net counts; on a tie, the lower gross.
      .sort((a, b) => a.net - b.net || a.gross - b.gross)
      .slice(0, count);
    for (const b of holed) {
      gross += b.gross;
      net += b.net;
    }
  }
  return { gross, net };
}

/** The round's board as drawn: side name → the figures in its row, by column heading. */
async function boardRows(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const table = page.locator("main table", { has: page.locator("th", { hasText: /^net$/i }) }).first();
  await expect(table, `no table with a Net column at ${path}`).toBeVisible();
  const heads = (await table.locator("thead th").allInnerTexts()).map((h) => h.trim().toLowerCase());
  // The first LINE of each cell: a side's cell is its name with its two players' names beneath.
  const rows = await table.locator("tbody tr").evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll("td, th")].map((td) => ((td as HTMLElement).innerText ?? "").trim().split("\n")[0].trim())),
  );
  const col = (name: string) => heads.findIndex((h) => h === name);
  expect(col("net"), `the board's headings were ${JSON.stringify(heads)}`).toBeGreaterThanOrEqual(0);
  const out = new Map<string, { gross: number; net: number }>();
  for (const r of rows) {
    const side = r[col("side")] ?? "";
    if (!side) continue;
    out.set(side, { gross: Number(r[col("gross")]), net: Number(r[col("net")]) });
  }
  return out;
}

test("a committee changes a live four-ball's allowance and how many balls count, is asked first each time, and every side's net is the Rule's", async ({ page, context, browser, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "two sizes: seeding a club of eleven tournaments a third time proves nothing more");
  test.setTimeout(300_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");

  const ev = club.events.find((e) => e.slug === "fourball")!;
  const stage = await prisma.stage.findFirstOrThrow({ where: { eventId: ev.id, position: 0 } });
  const event = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
  expect(stage.format, "the seeded round is not a four-ball").toBe("Four-Ball");
  expect(stage.type, "the seeded four-ball is not a stroke-play round").toBe("Stroke Play Round");
  expect(stage.handicapAllowance, "the seeded round carries an allowance of the committee's own").toBe(0);
  expect(event.configUnlocked, "the seeded four-ball's setup is already unlocked").toBe(false);

  // ── The round, read from the rows: tees, card, sides, and each ball's card ──
  const strokeIndex = JSON.parse(event.customStrokeIndex) as number[];
  const pars = JSON.parse(event.customPars) as number[];
  const roundTee = await prisma.tee.findUniqueOrThrow({ where: { id: (stage.teeId ?? event.defaultTeeId)! } });
  const teams = await prisma.team.findMany({
    where: { stageId: stage.id },
    include: { members: { orderBy: { position: "asc" }, include: { player: { include: { group: true } } } } },
  });
  const cards = await prisma.teamScorecard.findMany({ where: { stageId: stage.id } });
  expect(teams.length, "the seeded four-ball has no sides").toBeGreaterThanOrEqual(4);
  const frozen = await prisma.roundHandicap.count({ where: { stageId: stage.id } });
  expect(frozen, "the seeded round holds frozen or overridden handicaps this spec does not model").toBe(0);

  const sides: Side[] = [];
  for (const t of teams) {
    const balls: Ball[] = [];
    for (const m of t.members) {
      const p = m.player;
      expect(p.handicapType, `${p.name} holds a nine-hole index`).not.toBe("9");
      expect(p.handicap, `${p.name} is a plus handicap, which this spec does not model`).toBeGreaterThanOrEqual(0);
      // Their own tees if they are at this course, then their flight's, then the round's.
      const own = p.teeId ? await prisma.tee.findUnique({ where: { id: p.teeId } }) : null;
      const flight = p.group?.teeId ? await prisma.tee.findUnique({ where: { id: p.group.teeId } }) : null;
      const here = (t2: typeof own) => (t2 && t2.courseId === roundTee.courseId ? t2 : null);
      const tee = here(own) ?? here(flight) ?? roundTee;
      const card = cards.find((c) => c.teamId === t.id && c.playerId === p.id);
      balls.push({
        name: p.name,
        indexTenths: Math.round(p.handicap * 10),
        tee: { courseRating: tee.courseRating, slopeRating: tee.slopeRating, par: tee.par },
        strokes: card ? (JSON.parse(card.strokes) as (number | null)[]) : [],
      });
    }
    sides.push({ name: t.name, balls });
  }
  const scored = sides.filter((s) => s.balls.some((b) => b.strokes.some((x) => typeof x === "number")));
  expect(scored.length, "no side has a card in").toBeGreaterThanOrEqual(4);
  const expected = (pct: number, count: number, method = byTheRule) =>
    new Map(scored.map((s) => [s.name, sideTotals(s, strokeIndex, pct, count, method)]));

  // CONTROL: this field can tell the Rule from rounding first — on the board, not only on paper.
  const told = scored.filter((s) => sideTotals(s, strokeIndex, 85, 1).net !== sideTotals(s, strokeIndex, 85, 1, roundedFirst).net);
  expect(
    told.length,
    "no seeded side's net differs between the Rule and rounding first at 85%, so the board check below could not fail",
  ).toBeGreaterThan(0);
  testInfo.annotations.push({ type: "sides that tell the two methods apart", description: told.map((s) => s.name).join("; ") });

  await context.addCookies([
    { name: "ng_session", value: club.organizer.session, url: baseURL! },
    { name: "ng_active_event", value: sign(ev.id), url: baseURL! },
  ]);
  const boardPath = `/leaderboard?round=${stage.id}`;
  const holds = async (pct: number, count: number, what: string) => {
    const drawn = await boardRows(page, boardPath);
    const want = expected(pct, count);
    for (const [name, totals] of want) {
      expect(drawn.get(name), `${what}: ${name} is not on the round's board`).toBeTruthy();
      expect(drawn.get(name), `${what}: ${name}`).toEqual(totals);
    }
    return drawn;
  };

  // ── as it stands: 85%, best ball ───────────────────────────────────────────
  await holds(85, 1, "at stroke play's 85%, which nobody set");
  // Par is on the card, so the figures above are against the right course.
  expect(pars).toHaveLength(strokeIndex.length);

  // ── and the board the club sends its members says the same, signed out ─────
  const visitor = await browser.newContext();
  try {
    const anon = await visitor.newPage();
    const errs: string[] = [];
    watchPageErrors(anon, errs, "visitor");
    const publicRows = await boardRows(anon, `/live/${event.shareToken}?round=${stage.id}`);
    for (const [name, totals] of expected(85, 1)) {
      expect(publicRows.get(name)?.net, `the public board's net for ${name}`).toBe(totals.net);
    }
    expect(errs, errs.join("\n")).toEqual([]);
  } finally {
    await visitor.close();
  }

  // ── the round's card: locked while the tournament is live ──────────────────
  const openRound = async () => {
    await page.goto(`/stages?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const card = page.locator("main .card", { has: page.locator("button", { hasText: /Round 1/ }) }).first();
    await expect(card, "Rounds & formats has no card for Round 1").toBeVisible();
    const allowance = card.locator("p", { hasText: /^Handicap allowance/ });
    if (!(await allowance.isVisible().catch(() => false))) await card.locator("button", { hasText: /Round 1/ }).first().click();
    await expect(allowance, "the round's card does not say its allowance").toBeVisible();
    return { card, allowance };
  };
  let { card, allowance } = await openRound();
  await expect(allowance).toContainText("85%");
  await expect(allowance, "a four-ball at stroke play is not offered the Rules' 85%").toContainText("the recommended allowance for this format");

  // Locked: pressing Change opens the box, and Save is not offered to be pressed.
  /** The line that starts with these words, and the button beside it. */
  const changeBeside = (words: RegExp) =>
    card.locator("div", { has: page.locator("p", { hasText: words }) }).last().getByRole("button", { name: "Change", exact: true });
  await changeBeside(/^Handicap allowance/).click();
  await expect(card.getByLabel("Handicap allowance percent")).toBeVisible();
  await expect(card.getByRole("button", { name: "Save", exact: true }), "Save is offered on a locked round").toBeDisabled();

  await page.getByRole("button", { name: /^Unlock setup$/ }).first().click();
  await expect
    .poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: ev.id } })).configUnlocked, {
      message: "Unlock setup stored nothing",
    })
    .toBe(true);

  // ── refused beside the box ─────────────────────────────────────────────────
  const change = async () => {
    ({ card, allowance } = await openRound());
    await changeBeside(/^Handicap allowance/).click();
    const box = card.getByLabel("Handicap allowance percent");
    await expect(box).toBeVisible();
    return box;
  };
  const stored = async () => (await prisma.stage.findUniqueOrThrow({ where: { id: stage.id } })).handicapAllowance;
  let box = await change();
  await box.fill("9o");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card.getByText("Enter the allowance as a whole percentage from 1 to 100.")).toBeVisible();
  await box.fill("0");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card.getByText(/0% is playing off scratch/)).toBeVisible();
  expect(await stored(), "a refused allowance was stored").toBe(0);

  // ── asked first, with the cards at stake; declining stores nothing ─────────
  const cardsIn = cards.filter((c) => (JSON.parse(c.strokes) as (number | null)[]).some((x) => typeof x === "number")).length;
  await box.fill("100");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  const asked = card.locator("b", { hasText: /This round already has \d+ cards? entered\./ });
  await expect(asked, "the round was not asked about before being re-scored").toBeVisible();
  await expect(asked).toContainText(`This round already has ${cardsIn} cards entered.`);
  await expect(card.getByText(/Changing the allowance re-scores every one of them/)).toBeVisible();
  expect(await stored(), "the allowance was stored before the question was answered").toBe(0);
  await card.getByRole("button", { name: "Keep 85%", exact: true }).click();
  await expect(asked).toBeHidden();
  expect(await stored(), "declining stored the new allowance").toBe(0);
  await holds(85, 1, "after declining");

  // ── and going ahead ────────────────────────────────────────────────────────
  const setTo = async (pct: number) => {
    box = await change();
    await box.fill(String(pct));
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await card.getByRole("button", { name: "Change it anyway", exact: true }).click();
    await expect.poll(stored, { message: `${pct}% was not stored` }).toBe(pct);
  };
  await setTo(100);
  ({ allowance } = await openRound());
  await expect(allowance).toContainText("100%");
  await expect(allowance).toContainText("set by your committee, in place of the usual 85%");
  // At 100% every player plays off their whole course handicap, by either method.
  const full = await holds(100, 1, "at 100%");
  for (const [name, totals] of expected(100, 1, roundedFirst)) expect(full.get(name)).toEqual(totals);

  // ── back to the format's own ───────────────────────────────────────────────
  box = await change();
  await card.getByRole("button", { name: "Back to 85%", exact: true }).click();
  await card.getByRole("button", { name: "Change it anyway", exact: true }).click();
  await expect.poll(stored, { message: "Back to 85% was not stored as no committee figure" }).toBe(0);
  ({ allowance } = await openRound());
  await expect(allowance).toContainText("85%");
  await expect(allowance).toContainText("the recommended allowance for this format");
  await holds(85, 1, "back at stroke play's 85%");

  // ── a committee's own 90, and then its own 85 ──────────────────────────────
  await setTo(90);
  ({ allowance } = await openRound());
  await expect(allowance).toContainText("set by your committee, in place of the usual 85%");
  await holds(90, 1, "at a committee's 90%");

  await setTo(85);
  ({ allowance } = await openRound());
  // Typed, so it is the committee's; and it is also what the Rules give. Not "in place of the usual 85%".
  await expect(allowance).toContainText("set by your committee; it is also the usual figure for this format");
  await holds(85, 1, "at a committee's 85%");

  // ── how many balls count ───────────────────────────────────────────────────
  ({ card } = await openRound());
  const counting = card.locator("p", { hasText: /^Scores that count/ });
  await expect(counting).toContainText("best 1 of 2");
  await changeBeside(/^Scores that count/).click();
  await card.getByLabel("How many scores count on each hole").selectOption({ label: "best 2 of 2" });
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card.getByText(/Changing how many scores count re-scores every one of them/)).toBeVisible();
  expect((await prisma.stage.findUniqueOrThrow({ where: { id: stage.id } })).countBest, "stored before the answer").not.toBe(2);
  await card.getByRole("button", { name: "Change it anyway", exact: true }).click();
  await expect
    .poll(async () => (await prisma.stage.findUniqueOrThrow({ where: { id: stage.id } })).countBest, { message: "best 2 of 2 was not stored" })
    .toBe(2);
  await holds(85, 2, "with both balls counting");

  // ── the round's handicaps say all three figures ────────────────────────────
  ({ card } = await openRound());
  await card.getByRole("button", { name: /Show what it was scored off|Set one for this round/ }).click();
  const all = scored.flatMap((s) => s.balls);
  // Somebody whose course handicap was rounded, and for whom the two methods differ.
  const shown = all.find((b) => course1130(b.indexTenths, b.tee) % 1130 !== 0 && byTheRule(b.indexTenths, b.tee, 85) !== roundedFirst(b.indexTenths, b.tee, 85));
  expect(shown, "no seeded player tells the two methods apart").toBeTruthy();
  const row = card.locator("div", { has: page.locator("span", { hasText: new RegExp(`^${shown!.name}$`) }) }).last();
  await expect(row).toContainText(`course handicap ${nearest(course1130(shown!.indexTenths, shown!.tee), 1130)}`);
  await expect(row).toContainText("before rounding");
  await expect(row).toContainText(`plays off ${byTheRule(shown!.indexTenths, shown!.tee, 85)} at 85%`);

  expect(errors, errors.join("\n")).toEqual([]);
});
