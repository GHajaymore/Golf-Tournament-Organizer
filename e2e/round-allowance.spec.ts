import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * A COMMITTEE CHANGES A MEDAL'S ALLOWANCE, AND EVERY NET ON THE BOARD IS THE
 * RULE'S AT THE NEW FIGURE.
 *
 * Rules of Handicapping, Appendix C: individual stroke play and Stableford at
 * 95% for a field of thirty or more, and a committee may play a smaller field at
 * 100%. Until 2026-10-13 no screen could change an individual round's
 * allowance — a team round had the control on its card and a medal had nothing,
 * while the organizer's guide said it could be changed "under Handicaps for
 * this round". `team-allowance.spec.ts` is this walk for a four-ball; this is
 * the one for the round most clubs actually play.
 *
 * The seeded club's April Medal is live, twenty cards in, eight of them
 * complete, with no allowance of the committee's own:
 *
 *   the board                  → every complete card's NET is the Rule's at 95%
 *                                 (and at least one would be different at 100%,
 *                                 or nothing below could fail)
 *   the round's card           → "Handicap allowance 95% — the recommended
 *                                 allowance for this format", with Change
 *   the rules sheet            → says 95% of course handicap, to the organizer
 *                                 and to a player, which it used not to say
 *   setup is locked            → Save is not offered; Unlock setup
 *   Change → "9o", then 0      → refused beside the box, nothing stored
 *   Change → 100 → Save        → ASKED first, with the number of cards at stake;
 *                                 "Keep 95%" stores nothing
 *   … → Change it anyway       → stored; the board, and the board the club
 *                                 sends its members, are the Rule's at 100%;
 *                                 the rules sheet says so and says whose it is
 *   Back to 95%                → asked; the Rules' own again, and the board is
 *                                 back where it began
 *   a gross championship       → its round's card has no allowance line at all
 *
 * The nets are worked out here from the stored cards, each player's index and
 * tees and the hole's stroke index, in whole numbers, sharing nothing with the
 * app: the allowance is taken of the course handicap BEFORE it is rounded
 * (6.2a), and the result rounded once.
 *
 * WHAT IT CANNOT SEE: a card still being played (the board shows it "thru" a
 * hole, and what a part-played card nets is not a Rule), and a Stableford — the
 * points are held to the Rules by `boards-by-the-rules.spec.ts`, and the line is
 * the same component on every individual round.
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
/** An unrounded course handicap in 1,130ths of a stroke. */
const course1130 = (indexTenths: number, tee: Tee) =>
  indexTenths * tee.slopeRating + (Math.round(tee.courseRating * 10) - tee.par * 10) * 113;
const byTheRule = (indexTenths: number, tee: Tee, pct: number) => nearest(course1130(indexTenths, tee) * pct, 113_000);
/** Strokes on a hole of this stroke index off a playing handicap; a plus handicap gives them back on the easiest holes. */
function shotsOn(playing: number, strokeIndex: number) {
  if (playing >= 0) return Math.floor(playing / 18) + (strokeIndex <= playing % 18 ? 1 : 0);
  const given = -playing;
  return -(Math.floor(given / 18) + (strokeIndex > 18 - (given % 18) ? 1 : 0));
}

/** `parStrokes`: Rule 6.2b's difference for tees of a higher par than the field's lowest, added after the allowance. */
type Card = { name: string; indexTenths: number; tee: Tee; strokes: number[]; parStrokes: number };
const totals = (c: Card, strokeIndex: number[], pct: number) => {
  const playing = byTheRule(c.indexTenths, c.tee, pct) + c.parStrokes;
  const gross = c.strokes.reduce((a, b) => a + b, 0);
  return { gross, net: gross - strokeIndex.reduce((n, si) => n + shotsOn(playing, si), 0) };
};

/** The board as drawn: the first line of the player's cell → gross and net. */
async function boardRows(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const table = page.locator("main table", { has: page.locator("th", { hasText: /^net$/i }) }).first();
  await expect(table, `no table with a Net column at ${path}`).toBeVisible();
  const heads = (await table.locator("thead th").allInnerTexts()).map((h) => h.trim().toLowerCase());
  const rows = await table.locator("tbody tr").evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll("td, th")].map((td) => ((td as HTMLElement).innerText ?? "").trim().split("\n")[0].trim())),
  );
  const col = (name: string) => heads.findIndex((h) => h === name);
  expect(col("net"), `the board's headings were ${JSON.stringify(heads)}`).toBeGreaterThanOrEqual(0);
  expect(col("player"), `the board's headings were ${JSON.stringify(heads)}`).toBeGreaterThanOrEqual(0);
  const out = new Map<string, { gross: number; net: number }>();
  for (const r of rows) {
    const name = r[col("player")] ?? "";
    if (name) out.set(name, { gross: Number(r[col("gross")]), net: Number(r[col("net")]) });
  }
  return out;
}

/**
 * The board the club sends its members: a list, one row a player, ending in the
 * figure it is ranked on — net against par. Read by ROW, taking the last thing
 * on each: a finishing place is a bare figure too.
 */
async function publicToPar(page: Page, path: string) {
  await page.goto(`${path}?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByText("Ranked by net strokes"), `the public board at ${path} is not ranked on net`).toBeVisible();
  const rows = await page.locator("main li").evaluateAll((els) =>
    els.map((el) => ((el as HTMLElement).innerText ?? "").split("\n").join(" ").split(" ").filter(Boolean)),
  );
  return (name: string) => {
    const row = rows.find((words) => words.join(" ").includes(name));
    if (!row) return null;
    const last = row[row.length - 1] ?? "";
    // "· F" is a card that is finished; "· thru 12" is one still out.
    const finished = row[row.length - 2] === "F";
    return { finished, toPar: last === "E" ? 0 : Number(last.replace("−", "-")) };
  };
}

test("a committee plays a live medal at 100% and back at 95%, is asked first each time, and every net on the board is the Rule's", async ({ page, context, browser, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "two sizes: seeding a club of fifteen tournaments a third time proves nothing more");
  test.setTimeout(300_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");

  const ev = club.events.find((e) => e.slug === "medal")!;
  const stage = await prisma.stage.findFirstOrThrow({ where: { eventId: ev.id, position: 0 } });
  const event = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
  expect(stage.format, "the seeded round is not a medal").toBe("Stroke Play");
  expect(stage.type).toBe("Stroke Play Round");
  expect(stage.scoringBasis, "the seeded medal is not a net competition").toBe("net");
  expect(stage.handicapAllowance, "the seeded medal carries an allowance of the committee's own").toBe(0);
  expect(event.configUnlocked, "the seeded medal's setup is already unlocked").toBe(false);
  expect(await prisma.roundHandicap.count({ where: { stageId: stage.id } }), "the seeded round holds frozen or overridden handicaps this spec does not model").toBe(0);

  // ── the round, read from the rows ──────────────────────────────────────────
  const strokeIndex = JSON.parse(event.customStrokeIndex) as number[];
  expect(strokeIndex).toHaveLength(18);
  const roundTee = await prisma.tee.findUniqueOrThrow({ where: { id: (stage.teeId ?? event.defaultTeeId)! } });
  const players = await prisma.player.findMany({ where: { eventId: ev.id }, include: { group: true } });
  const stored = await prisma.scorecard.findMany({ where: { stageId: stage.id } });
  const cardsIn = stored.filter((c) => (JSON.parse(c.strokes) as (number | null)[]).some((x) => typeof x === "number")).length;
  // The tees one player is held to, in the organizer's order: their own if they are at this course,
  // then their flight's, then — for a woman nobody has placed — the course's ladies' set (the women's
  // set with the lowest course rating, a tie to the one further down the card), then the round's.
  const courseTees = await prisma.tee.findMany({ where: { courseId: roundTee.courseId }, orderBy: { position: "asc" } });
  const WOMAN = /^(f|w|female|woman|women|lady|ladies|girl|girls)$/i;
  const ladies = courseTees.reduce<(typeof courseTees)[number] | null>(
    (best, t) => (WOMAN.test(t.gender.trim()) && (!best || t.courseRating <= best.courseRating) ? t : best),
    null,
  );
  expect(event.teePolicy, "the seeded medal is not played from each player's own tees").toBe("own");
  const teeOf = async (p: (typeof players)[number]) => {
    const own = p.teeId ? await prisma.tee.findUnique({ where: { id: p.teeId } }) : null;
    const flight = p.group?.teeId ? await prisma.tee.findUnique({ where: { id: p.group.teeId } }) : null;
    const here = (t: typeof own) => (t && t.courseId === roundTee.courseId ? t : null);
    return here(own) ?? here(flight) ?? (WOMAN.test((p.gender ?? "").trim()) ? ladies : null) ?? roundTee;
  };
  // Rule 6.2b: the lowest par the FIELD is playing, and the difference to anybody above it — a medal
  // counted in strokes, over eighteen holes, so it applies.
  const lowestPar = Math.min(...(await Promise.all(players.filter((p) => p.status === "confirmed").map(teeOf))).map((t) => t.par));
  const complete: Card[] = [];
  for (const c of stored) {
    const strokes = JSON.parse(c.strokes) as (number | null)[];
    if (strokes.length !== 18 || strokes.some((s) => typeof s !== "number" || s <= 0)) continue;
    const p = players.find((x) => x.id === c.playerId);
    if (!p || p.status !== "confirmed") continue;
    expect(p.handicapType, `${p.name} holds a nine-hole index`).not.toBe("9");
    const tee = await teeOf(p);
    complete.push({
      name: p.name,
      indexTenths: Math.round(p.handicap * 10),
      tee: { courseRating: tee.courseRating, slopeRating: tee.slopeRating, par: tee.par },
      strokes: strokes as number[],
      parStrokes: Math.max(0, tee.par - lowestPar),
    });
  }
  // CONTROL: somebody checked is on tees of a higher par, or a board that left out 6.2b would pass.
  expect(complete.filter((c) => c.parStrokes > 0).length, "no checked card is on tees of a higher par than the field's lowest").toBeGreaterThan(0);
  expect(complete.length, "almost no seeded card is complete").toBeGreaterThanOrEqual(6);
  const expected = (pct: number) => new Map(complete.map((c) => [c.name, totals(c, strokeIndex, pct)]));

  // CONTROL: the two figures give different nets on this field, so a board that ignored the change would be caught.
  const moved = complete.filter((c) => totals(c, strokeIndex, 95).net !== totals(c, strokeIndex, 100).net);
  expect(moved.length, "no seeded net differs between 95% and 100%, so the board check below could not fail").toBeGreaterThan(0);
  testInfo.annotations.push({ type: "nets that move between 95% and 100%", description: `${moved.length} of ${complete.length}: ${moved.map((c) => c.name).join("; ")}` });

  await context.addCookies([
    { name: "ng_session", value: club.organizer.session, url: baseURL! },
    { name: "ng_active_event", value: sign(ev.id), url: baseURL! },
  ]);
  const holdsOn = async (p: Page, path: string, pct: number, what: string) => {
    const drawn = await boardRows(p, path);
    for (const [name, want] of expected(pct)) {
      expect(drawn.get(name), `${what}: ${name} has a complete card and is not on the board`).toBeTruthy();
      expect(drawn.get(name), `${what}: ${name}`).toEqual(want);
    }
  };
  const holds = (pct: number, what: string) => holdsOn(page, "/leaderboard", pct, what);
  const par = (JSON.parse(event.customPars) as number[]).reduce((a, b) => a + b, 0);
  const publicHolds = async (p: Page, pct: number, what: string) => {
    const read = await publicToPar(p, `/live/${event.shareToken}`);
    for (const [name, want] of expected(pct)) {
      const row = read(name);
      expect(row, `${what}: ${name} has a complete card and is not on the public board`).toBeTruthy();
      expect(row!.finished, `${what}: ${name}'s complete card is not shown as finished`).toBe(true);
      expect(row!.toPar, `${what}: ${name}, net ${want.net} against a par of ${par}`).toBe(want.net - par);
    }
  };

  // The board the club sends its members, signed out.
  const visitor = await browser.newContext();
  const anon = await visitor.newPage();
  const anonErrors: string[] = [];
  watchPageErrors(anon, anonErrors, "visitor");
  // A player in the field, for the rules sheet a player reads.
  const member = await browser.newContext();
  await member.addCookies([
    { name: "ng_session", value: club.player.session, url: baseURL! },
    { name: "ng_active_event", value: sign(ev.id), url: baseURL! },
  ]);
  const theirs = await member.newPage();
  const memberErrors: string[] = [];
  watchPageErrors(theirs, memberErrors, "member");

  /** The "Handicap allowance" line of a rules sheet. */
  const sheetSays = async (p: Page, path: string, words: string, who: string) => {
    await p.goto(`${path}?bust=${Date.now()}`);
    const line = p.locator("main div", { has: p.locator("span", { hasText: /^Handicap allowance$/ }) }).last();
    await expect(line, `${who}'s rules sheet has no Handicap allowance line`).toBeVisible();
    await expect(line, `${who}'s rules sheet`).toContainText(words);
    return line;
  };

  try {
    // ── as it stands: the Rules' 95% ─────────────────────────────────────────
    await holds(95, "at the Rules' 95%, which nobody set");
    await publicHolds(anon, 95, "the public board at 95%");
    const before = await sheetSays(page, "/rules", "95% of course handicap", "the organizer");
    await expect(before, "95% is the Rules' and is said to be the committee's").not.toContainText("set by the committee");
    await sheetSays(theirs, "/me/rules", "95% of course handicap", "a player");

    // ── the round's card ─────────────────────────────────────────────────────
    const openRound = async () => {
      await page.goto(`/stages?bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      const card = page.locator("main .card", { has: page.locator("button", { hasText: /Round 1/ }) }).first();
      await expect(card, "Rounds & formats has no card for Round 1").toBeVisible();
      const allowance = card.locator("p", { hasText: /^Handicap allowance/ });
      if (!(await allowance.isVisible().catch(() => false))) await card.locator("button", { hasText: /Round 1/ }).first().click();
      await expect(allowance, "the medal's card does not say its allowance").toBeVisible();
      return { card, allowance };
    };
    let { card, allowance } = await openRound();
    await expect(allowance).toContainText("95%");
    await expect(allowance).toContainText("the recommended allowance for this format");
    const changeButton = () =>
      card.locator("div", { has: page.locator("p", { hasText: /^Handicap allowance/ }) }).last().getByRole("button", { name: "Change", exact: true });

    // Locked: the box opens, and Save is not offered to be pressed.
    await changeButton().click();
    await expect(card.getByLabel("Handicap allowance percent")).toBeVisible();
    await expect(card.getByRole("button", { name: "Save", exact: true }), "Save is offered on a locked round").toBeDisabled();
    await page.getByRole("button", { name: /^Unlock setup$/ }).first().click();
    await expect
      .poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: ev.id } })).configUnlocked, { message: "Unlock setup stored nothing" })
      .toBe(true);

    // ── refused beside the box ───────────────────────────────────────────────
    const change = async () => {
      ({ card, allowance } = await openRound());
      await changeButton().click();
      const box = card.getByLabel("Handicap allowance percent");
      await expect(box).toBeVisible();
      return box;
    };
    const storedNow = async () => (await prisma.stage.findUniqueOrThrow({ where: { id: stage.id } })).handicapAllowance;
    let box = await change();
    await expect(box, "the box does not open on the figure in force").toHaveValue("95");
    await box.fill("9o");
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await expect(card.getByText("Enter the allowance as a whole percentage from 1 to 100.")).toBeVisible();
    await box.fill("0");
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await expect(card.getByText(/0% is playing off scratch/)).toBeVisible();
    expect(await storedNow(), "a refused allowance was stored").toBe(0);

    // ── asked first, with the cards at stake; declining stores nothing ───────
    await box.fill("100");
    await card.getByRole("button", { name: "Save", exact: true }).click();
    const asked = card.locator("b", { hasText: /This round already has \d+ cards? entered\./ });
    await expect(asked, "the round was not asked about before being re-scored").toBeVisible();
    await expect(asked).toContainText(`This round already has ${cardsIn} cards entered.`);
    await expect(card.getByText(/Each player receives a different number of strokes/)).toBeVisible();
    expect(await storedNow(), "the allowance was stored before the question was answered").toBe(0);
    await card.getByRole("button", { name: "Keep 95%", exact: true }).click();
    await expect(asked).toBeHidden();
    expect(await storedNow(), "declining stored the new allowance").toBe(0);
    await holds(95, "after declining");

    // ── and going ahead: a small field at 100% ───────────────────────────────
    box = await change();
    await box.fill("100");
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await card.getByRole("button", { name: "Change it anyway", exact: true }).click();
    await expect.poll(storedNow, { message: "100% was not stored" }).toBe(100);
    ({ card, allowance } = await openRound());
    await expect(allowance).toContainText("100%");
    await expect(allowance).toContainText("set by your committee, in place of the usual 95%");
    await holds(100, "at a committee's 100%");
    await publicHolds(anon, 100, "the public board at 100%");
    await sheetSays(page, "/rules", "100% of course handicap, set by the committee", "the organizer");
    await sheetSays(theirs, "/me/rules", "100% of course handicap, set by the committee", "a player");

    // ── back to the Rules' own ───────────────────────────────────────────────
    box = await change();
    await card.getByRole("button", { name: "Back to 95%", exact: true }).click();
    await expect(card.locator("b", { hasText: /This round already has \d+ cards? entered\./ }), "going back was not asked about").toBeVisible();
    expect(await storedNow(), "going back was stored before the question was answered").toBe(100);
    await card.getByRole("button", { name: "Change it anyway", exact: true }).click();
    await expect.poll(storedNow, { message: "Back to 95% was not stored as no committee figure" }).toBe(0);
    ({ card, allowance } = await openRound());
    await expect(allowance).toContainText("95%");
    await expect(allowance).toContainText("the recommended allowance for this format");
    await holds(95, "back at the Rules' 95%");
    await publicHolds(anon, 95, "the public board back at 95%");

    // ── and a gross championship has no such line ────────────────────────────
    const champs = club.events.find((e) => e.slug === "champs")!;
    const grossRound = await prisma.stage.findFirstOrThrow({ where: { eventId: champs.id, position: 0 } });
    expect(grossRound.scoringBasis, "the seeded championship is not gross").toBe("gross");
    await context.addCookies([{ name: "ng_active_event", value: sign(champs.id), url: baseURL! }]);
    await page.goto(`/stages?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const grossCard = page.locator("main .card", { has: page.locator("button", { hasText: /Round 1/ }) }).first();
    await expect(grossCard).toBeVisible();
    // Opened, so that an absent line is absent from an open card.
    const opened = grossCard.getByText("Handicaps for this round");
    if (!(await opened.isVisible().catch(() => false))) await grossCard.locator("button", { hasText: /Round 1/ }).first().click();
    await expect(opened, "the gross round's card did not open").toBeVisible();
    await expect(grossCard.locator("p", { hasText: /^Handicap allowance/ }), "a gross round is offered an allowance").toHaveCount(0);
  } finally {
    await visitor.close();
    await member.close();
  }

  expect(anonErrors, anonErrors.join("\n")).toEqual([]);
  expect(memberErrors, memberErrors.join("\n")).toEqual([]);
  expect(errors, errors.join("\n")).toEqual([]);
});
