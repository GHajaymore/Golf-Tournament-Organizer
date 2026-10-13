import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * EVERY INDIVIDUAL BOARD THE SEEDED CLUB HAS, WORKED OUT AGAIN FROM ITS CARDS.
 *
 * The walks open every board and ask whether it drew. `verify-public-boards`
 * asks whether a column can be read downward. Nothing asked whether the FIGURES
 * are the ones the Rules give — and on 2026-10-13 a browser test that did,
 * for one four-ball, found every allowance in the app taken of the rounded
 * course handicap: a stroke out for one player in five, under 11,800 green
 * tests. This is the same question put to every individual round the seeded
 * club holds, so the next fault of that kind is found by the round and not by
 * somebody at a prize-giving.
 *
 * For every stroke-play and Stableford round with cards in, of every seeded
 * tournament, as the secretary:
 *
 *   gross   the strokes on the card, added up
 *   net     gross less the strokes the player receives: the allowance of their
 *           course handicap BEFORE rounding (Rule 6.2a), from their own tees,
 *           spread by the stroke index of the holes actually played
 *   points  Stableford: two for a net par, one more for each stroke better and
 *           one fewer for each worse, never less than nothing
 *
 * each from the stored rows — the card, the index, the tees' rating and slope,
 * the round's course and nine — in whole numbers, and each held against the
 * row the board prints for that player.
 *
 * A nine-hole round halves an eighteen-hole index and plays off half the
 * eighteen's rating and par, which is the app's stated approximation where a
 * club has published no nine-hole rating; its strokes fall by the nine's own
 * stroke index, re-ranked one to nine.
 *
 * WHAT IT CANNOT SEE, and says so in what it prints: a card that is not
 * complete (the board shows it "thru" a hole and ranks nobody on it), a player
 * no longer in the field, a round scored by hand, and every team format — those
 * are `team-allowance.spec.ts` and the scenarios. It reads; it changes nothing.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "desktop") return;
  club = await seed();
});
test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name === "desktop") await teardown();
  await prisma.$disconnect();
});

/** The allowance a format plays at when the committee has set none (Appendix C). */
const USUAL: Record<string, number> = { "Stroke Play": 95, Stableford: 95 };

type Tee = { courseRating: number; slopeRating: number; par: number; courseId: string };
/** Nearest whole number, a half upwards: floor((2n + d) / 2d). */
const nearest = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));
/** An unrounded eighteen-hole course handicap in 1,130ths of a stroke. */
const course1130 = (indexTenths: number, tee: Tee) =>
  indexTenths * tee.slopeRating + (Math.round(tee.courseRating * 10) - tee.par * 10) * 113;
/** Strokes on one hole off a playing handicap, over `n` holes, by the hole's rank among them. */
function shotsOn(playing: number, rank: number, n: number) {
  if (playing >= 0) return Math.floor(playing / n) + (rank <= playing % n ? 1 : 0);
  // A plus handicap gives strokes back, on the easiest holes first.
  const given = -playing;
  return -(Math.floor(given / n) + (rank > n - (given % n) ? 1 : 0));
}
/** A nine's stroke indexes as ranks one to nine, hardest first. */
function ranked(strokeIndex: number[]) {
  const order = strokeIndex.map((value, hole) => ({ value, hole })).sort((a, b) => a.value - b.value || a.hole - b.hole);
  const out = new Array<number>(strokeIndex.length);
  order.forEach((e, i) => (out[e.hole] = i + 1));
  return out;
}

/** The round's board as drawn: the first line of the player's (or side's) cell → the figures in its row, by heading. */
async function boardRows(page: Page, path: string, who: "player" | "side" = "player") {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const tables = page.locator("main table", { has: page.locator("th", { hasText: /^gross$/i }) });
  const n = await tables.count();
  if (n === 0) return null;
  // The round's own table is the last with a Gross column: a total over several rounds comes first.
  const table = tables.nth(n - 1);
  const heads = (await table.locator("thead th").allInnerTexts()).map((h) => h.trim().toLowerCase());
  const rows = await table.locator("tbody tr").evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll("td, th")].map((td) => ((td as HTMLElement).innerText ?? "").trim().split("\n")[0].trim())),
  );
  const at = (name: string) => heads.findIndex((h) => h === name);
  const out = new Map<string, { gross: string; net: string; pts: string; toPar: string; hcap: string }>();
  for (const r of rows) {
    const name = r[at(who)] ?? "";
    if (!name) continue;
    out.set(name, {
      gross: r[at("gross")] ?? "",
      net: r[at("net")] ?? "",
      pts: r[at("pts")] ?? r[at("points")] ?? "",
      toPar: r[at("to par")] ?? "",
      hcap: r[at("h/cap")] ?? "",
    });
  }
  return { heads, out };
}

/** The card a round is played to: its own course's where it is away, the tournament's otherwise; cut to its nine. */
async function cardOf(
  event: { courseId: string | null; customPars: string; customStrokeIndex: string },
  stage: { courseId: string | null; holes: number; nine: string },
) {
  const away = stage.courseId && stage.courseId !== event.courseId ? await prisma.course.findUnique({ where: { id: stage.courseId } }) : null;
  const home = !away && !event.customPars && event.courseId ? await prisma.course.findUnique({ where: { id: event.courseId } }) : null;
  const from = away ?? home;
  let pars = JSON.parse(from ? from.pars : event.customPars || "[]") as number[];
  let strokeIndex = JSON.parse(from ? from.strokeIndex : event.customStrokeIndex || "[]") as number[];
  const holes = stage.holes === 9 ? 9 : 18;
  if (holes === 9 && pars.length >= 18) {
    const cut = <T,>(a: T[]) => (stage.nine === "back" ? a.slice(9, 18) : a.slice(0, 9));
    pars = cut(pars);
    strokeIndex = ranked(cut(strokeIndex));
  } else if (holes === 9) {
    strokeIndex = ranked(strokeIndex);
  }
  return { pars, strokeIndex, holes };
}

test("every stroke-play and Stableford board the seeded club has prints the gross, net and points the Rules give", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one size: the figures do not depend on the width of the screen");
  test.setTimeout(420_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await context.addCookies([{ name: "ng_session", value: club.organizer.session, url: baseURL! }]);

  const said: string[] = [];
  const wrong: string[] = [];
  let checked = 0;
  let tellApart = 0;
  const rounds: string[] = [];

  const tees = await prisma.tee.findMany();
  const teeOf = (id: string | null | undefined) => (id ? (tees.find((t) => t.id === id) ?? null) : null);

  for (const ev of club.events) {
    const event = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
    const stages = (await prisma.stage.findMany({ where: { eventId: ev.id }, orderBy: { position: "asc" } })).filter(
      (s) => s.format in USUAL && s.type === "Stroke Play Round",
    );
    if (stages.length === 0) continue;
    const players = await prisma.player.findMany({ where: { eventId: ev.id }, include: { group: true } });

    /**
     * THE BOARD OF AN INDIVIDUAL TOURNAMENT IS ITS TOTAL: one row a player, over
     * every round they have a card in. So the figures are added up here the
     * same way, round by round, and a player is held to the board only if every
     * card they have is complete — a card "thru" twelve is on the board with
     * twelve holes' strokes, and what a part-played card nets is not a Rule.
     */
    type Sum = { gross: number; net: number; pts: number; cards: number; broken: boolean; tells: boolean; off: number[] };
    const sums = new Map<string, Sum>();
    let anyCard = false;
    let allNet = true;
    let stableford = false;
    let left = false;

    for (const stage of stages) {
      const cards = await prisma.scorecard.findMany({ where: { stageId: stage.id } });
      if (cards.length === 0) continue;
      anyCard = true;
      const { pars, strokeIndex, holes } = await cardOf(event, stage);
      if (pars.length !== holes || strokeIndex.length !== holes) {
        said.push(`${ev.slug} round ${stage.position + 1}: NOT CHECKED — its card has ${pars.length} pars for a round of ${holes}`);
        left = true;
        continue;
      }
      const roundTee = teeOf(stage.teeId) ?? teeOf(event.defaultTeeId);
      const said4 = await prisma.roundHandicap.findMany({ where: { stageId: stage.id } });
      const pct = stage.handicapAllowance > 0 ? stage.handicapAllowance : USUAL[stage.format];
      const net = stage.scoringBasis.trim().toLowerCase() !== "gross";
      if (!net) allNet = false;
      if (stage.format === "Stableford") stableford = true;

      for (const c of cards) {
        const p = players.find((x) => x.id === c.playerId);
        if (!p) continue;
        const sum = sums.get(p.id) ?? { gross: 0, net: 0, pts: 0, cards: 0, broken: false, tells: false, off: [] };
        sums.set(p.id, sum);
        const strokes = JSON.parse(c.strokes) as (number | null)[];
        const played = strokes.slice(0, holes).filter((s) => typeof s === "number" && s > 0).length;
        if (played === 0) continue; // a card nobody has written on is not a round
        if (played < holes || p.status !== "confirmed") {
          sum.broken = true;
          continue;
        }
        const gross = (strokes.slice(0, holes) as number[]).reduce((a, b) => a + b, 0);

        // The player's own tees if they are at this course, then their flight's, then the round's.
        const here2 = (t: (typeof tees)[number] | null) => (t && roundTee && t.courseId === roundTee.courseId ? t : null);
        const tee =
          event.teePolicy === "one"
            ? roundTee
            : event.teePolicy === "flight"
              ? (here2(teeOf(p.group?.teeId)) ?? roundTee)
              : (here2(teeOf(p.teeId)) ?? here2(teeOf(p.group?.teeId)) ?? roundTee);

        // ── what they play off ───────────────────────────────────────────────
        const row = said4.find((r) => r.playerId === p.id);
        const indexTenths = Math.round(p.handicap * 10);
        // In 1,130ths for eighteen holes. A nine halves an eighteen-hole index and the tee's rating
        // and par, which is exactly half of this; a nine-hole index is already a nine's.
        const n18 = tee ? course1130(indexTenths, tee) : indexTenths * 113;
        const unit = holes === 9 && p.handicapType !== "9" ? 2260 : 1130;
        let playing: number;
        let first: number;
        if (typeof row?.override === "number" && row.frozen == null) {
          playing = nearest(row.override * pct, 100);
          first = playing;
        } else if (typeof row?.frozen === "number" && row.frozenExact == null) {
          playing = nearest(row.frozen * pct, 100);
          first = playing;
        } else if (typeof row?.frozenExact === "number") {
          playing = Math.round((row.frozenExact * pct) / 100 + 1e-9);
          first = nearest((row.frozen ?? 0) * pct, 100);
        } else {
          playing = nearest(n18 * pct, unit * 100);
          first = nearest(nearest(n18, unit) * pct, 100);
        }

        const shots = strokeIndex.map((rank) => shotsOn(playing, rank, holes));
        sum.gross += gross;
        sum.net += gross - shots.reduce((a, b) => a + b, 0);
        sum.pts += (strokes.slice(0, holes) as number[]).reduce((n, s, h) => n + Math.max(0, 2 - (s - shots[h] - pars[h])), 0);
        sum.cards += 1;
        sum.off.push(playing);
        if (first !== playing) sum.tells = true;
      }
    }
    if (!anyCard || left) continue;

    await context.addCookies([{ name: "ng_active_event", value: sign(ev.id), url: baseURL! }]);
    const board = await boardRows(page, "/leaderboard");
    if (!board) {
      said.push(`${ev.slug}: NOT CHECKED — the board drew no table with a Gross column`);
      continue;
    }

    let here = 0;
    for (const [id, sum] of sums) {
      if (sum.broken || sum.cards === 0) continue;
      const p = players.find((x) => x.id === id)!;
      const where = `${ev.slug} (${stages.map((s) => s.format).filter((f, i, a) => a.indexOf(f) === i).join(", ")}, ${sum.cards} card${sum.cards === 1 ? "" : "s"}, plays off ${sum.off.join(" and ")}) · ${p.name}`;
      const drawn = board.out.get(p.name);
      if (!drawn) {
        wrong.push(`${where}: has ${sum.cards === 1 ? "a complete card" : "complete cards"} and is not on the board`);
        continue;
      }
      here += 1;
      if (drawn.gross !== String(sum.gross)) wrong.push(`${where}: gross ${drawn.gross}, the cards add up to ${sum.gross}`);
      if (stableford) {
        if (board.heads.includes("pts") && drawn.pts !== String(sum.pts)) wrong.push(`${where}: ${drawn.pts} points, the Rules give ${sum.pts}`);
      } else if (board.heads.includes("net")) {
        // A gross competition prints a net column too, off the same handicaps; it is held to the same sum.
        if (drawn.net !== String(sum.net)) wrong.push(`${where}: net ${drawn.net}, the Rules give ${sum.net} (gross ${sum.gross}${allNet ? "" : "; a gross competition"})`);
      }
      if (sum.tells) tellApart += 1;
    }
    checked += here;
    rounds.push(`${ev.slug}: ${here}`);
  }

  testInfo.annotations.push({ type: "boards", description: rounds.join("; ") });
  testInfo.annotations.push({ type: "left out", description: said.join("; ") || "nothing" });
  console.log(`[boards-by-the-rules] ${checked} players on ${rounds.length} individual boards (${rounds.join("; ")}); ${tellApart} of them play off a different handicap rounded first; ${wrong.length} wrong${said.length ? `; ${said.join("; ")}` : ""}`);

  expect(said, "a round could not be checked").toEqual([]);
  // CONTROLS: the field is big enough to mean something, and can tell the Rule from rounding first.
  expect(rounds.length, "almost no seeded round was checked").toBeGreaterThanOrEqual(4);
  expect(checked, "almost no card was checked").toBeGreaterThanOrEqual(40);
  expect(tellApart, "no checked player plays off a different handicap rounded first, so a wrong allowance could not show").toBeGreaterThan(0);
  expect(wrong, `${wrong.length} figures on a board are not the Rules'`).toEqual([]);
  expect(errors, errors.join("\n")).toEqual([]);
});

/**
 * AND EVERY TEAM BOARD: A SIDE'S GROSS AND NET, FROM ITS CARDS AND ITS PLAYERS.
 *
 * The figure a format plays at is the app's own statement of it (the round's
 * card prints it): 85% for a four-ball at stroke play, for best ball and for a
 * shamble; half the pair for foursomes and alternate shot; 60% of the lower
 * handicap and 40% of the higher for greensomes and Chapman; 25, 20, 15 and 10
 * for a scramble of four, lowest first, and 35 and 15 for one of two. What is
 * held to the Rules here is the ARITHMETIC under those figures: each share is
 * taken of a player's course handicap BEFORE it is rounded, the shares are
 * added, and the total is rounded once (6.2a, and the committee procedures for
 * formats with one team handicap).
 *
 * Whether 85% is the right figure for best ball in sides of FOUR is a separate
 * question, and the answer in Appendix C is no (best 1 of 4 is 75%). That is
 * written down in `docs/deferred-register.md` and not judged here.
 */
const SHARES: Record<string, Record<number, number[]>> = {
  "Chapman / Pinehurst": { 2: [60, 40] },
  Greensomes: { 2: [60, 40] },
  Scramble: { 2: [35, 15], 3: [25, 20, 15], 4: [25, 20, 15, 10] },
  "Texas Scramble": { 2: [35, 15], 3: [25, 20, 15], 4: [25, 20, 15, 10] },
};
const HALF_THE_PAIR = new Set(["Foursomes", "Alternate Shot"]);
const OWN_BALL: Record<string, number> = { "Four-Ball": 85, "Best Ball": 85, Shamble: 85 };

test("every team board the seeded club has prints the gross and net its cards and its players' handicaps give", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one size: the figures do not depend on the width of the screen");
  test.setTimeout(420_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await context.addCookies([{ name: "ng_session", value: club.organizer.session, url: baseURL! }]);

  const said: string[] = [];
  const wrong: string[] = [];
  const rounds: string[] = [];
  let checked = 0;
  let tellApart = 0;
  const tees = await prisma.tee.findMany();
  const teeOf = (id: string | null | undefined) => (id ? (tees.find((t) => t.id === id) ?? null) : null);

  for (const ev of club.events) {
    const event = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
    const stages = await prisma.stage.findMany({ where: { eventId: ev.id }, orderBy: { position: "asc" } });
    for (const stage of stages) {
      const shared = HALF_THE_PAIR.has(stage.format) || stage.format in SHARES;
      if (!shared && !(stage.format in OWN_BALL)) continue;
      if (stage.type !== "Stroke Play Round") continue; // a match is decided hole by hole off the low handicap: not this test
      const cards = await prisma.teamScorecard.findMany({ where: { stageId: stage.id } });
      if (cards.length === 0) continue;
      const { pars, strokeIndex, holes } = await cardOf(event, stage);
      const label = `${ev.slug} round ${stage.position + 1} (${stage.format}, ${holes} holes)`;
      if (pars.length !== holes || strokeIndex.length !== holes) {
        said.push(`${label}: NOT CHECKED — its card has ${pars.length} pars for a round of ${holes}`);
        continue;
      }
      if ((await prisma.roundHandicap.count({ where: { stageId: stage.id } })) > 0) {
        said.push(`${label}: NOT CHECKED — it holds frozen or committee handicaps, which this test does not model for a side`);
        continue;
      }
      const net = stage.scoringBasis.trim().toLowerCase() !== "gross";
      const roundTee = teeOf(stage.teeId) ?? teeOf(event.defaultTeeId);
      const teams = await prisma.team.findMany({
        where: { stageId: stage.id },
        include: { members: { orderBy: { position: "asc" }, include: { player: { include: { group: true } } } } },
      });

      await context.addCookies([{ name: "ng_active_event", value: sign(ev.id), url: baseURL! }]);
      const board = await boardRows(page, `/leaderboard?round=${stage.id}`, "side");
      if (!board) {
        said.push(`${label}: NOT CHECKED — the board drew no table with a Gross column`);
        continue;
      }

      let here = 0;
      for (const t of teams) {
        const playing = t.members.filter((m) => m.player.status === "confirmed");
        if (playing.length !== t.members.length || playing.length === 0) continue; // a side short of a player: not this test
        if (playing.some((m) => m.player.handicapType === "9")) continue;
        // Each member's unrounded course handicap, in 1,130ths (a nine halves it: 2,260ths).
        const n18 = playing.map((m) => {
          const p = m.player;
          const here2 = (x: (typeof tees)[number] | null) => (x && roundTee && x.courseId === roundTee.courseId ? x : null);
          const tee =
            event.teePolicy === "one"
              ? roundTee
              : event.teePolicy === "flight"
                ? (here2(teeOf(p.group?.teeId)) ?? roundTee)
                : (here2(teeOf(p.teeId)) ?? here2(teeOf(p.group?.teeId)) ?? roundTee);
          const tenths = Math.round(p.handicap * 10);
          return tee ? course1130(tenths, tee) : tenths * 113;
        });
        const unit = holes === 9 ? 2260 : 1130;
        const where = `${label} · ${t.name}`;
        const drawn = board.out.get(t.name);

        let gross = 0;
        let netTotal = 0;
        let complete = true;
        let differs = false;

        if (shared) {
          const card = cards.find((c) => c.teamId === t.id && c.playerId === "");
          const strokes = card ? (JSON.parse(card.strokes) as (number | null)[]) : [];
          if (strokes.length < holes || strokes.slice(0, holes).some((s) => typeof s !== "number" || s <= 0)) continue;
          // The side's one handicap: each share of an UNROUNDED handicap, added, rounded once.
          const sorted = [...n18].sort((a, b) => a - b);
          const committee = stage.allowanceWeights.length === playing.length ? stage.allowanceWeights : null;
          const shares = committee ?? (stage.handicapAllowance > 0 ? null : SHARES[stage.format]?.[playing.length]) ?? null;
          const flat = stage.handicapAllowance > 0 ? stage.handicapAllowance : 50;
          let side: number;
          let first: number;
          if (shares) {
            side = nearest(sorted.reduce((sum, n, i) => sum + n * (shares[i] ?? 0), 0), unit * 100);
            first = nearest(sorted.reduce((sum, n, i) => sum + nearest(n, unit) * (shares[i] ?? 0), 0), 100);
          } else if (HALF_THE_PAIR.has(stage.format) || stage.handicapAllowance > 0) {
            side = nearest(sorted.reduce((a, b) => a + b, 0) * flat, unit * 100);
            first = nearest(sorted.reduce((a, b) => a + nearest(b, unit), 0) * flat, 100);
          } else {
            said.push(`${where}: NOT CHECKED — no shares are published for a side of ${playing.length}`);
            continue;
          }
          differs = side !== first;
          if (!net) side = 0;
          gross = (strokes.slice(0, holes) as number[]).reduce((a, b) => a + b, 0);
          netTotal = gross - strokeIndex.reduce((sum, rank) => sum + shotsOn(side, rank, holes), 0);
          if (drawn && net && drawn.hcap !== String(side)) wrong.push(`${where}: plays off ${drawn.hcap}, the Rules give ${side} (rounded first it is ${first})`);
        } else {
          const pct = stage.handicapAllowance > 0 ? stage.handicapAllowance : OWN_BALL[stage.format];
          const count = stage.countBest > 0 ? Math.min(stage.countBest, playing.length) : 1;
          const balls = playing.map((m, i) => {
            const card = cards.find((c) => c.teamId === t.id && c.playerId === m.player.id);
            const own = net ? nearest(n18[i] * pct, unit * 100) : 0;
            if (net && own !== nearest(nearest(n18[i], unit) * pct, 100)) differs = true;
            return { strokes: card ? (JSON.parse(card.strokes) as (number | null)[]) : [], own };
          });
          for (let h = 0; h < holes; h += 1) {
            const holed = balls
              .filter((b) => typeof b.strokes[h] === "number" && (b.strokes[h] as number) > 0)
              .map((b) => ({ gross: b.strokes[h] as number, net: (b.strokes[h] as number) - shotsOn(b.own, strokeIndex[h], holes) }))
              .sort((a, b) => (net ? a.net - b.net || a.gross - b.gross : a.gross - b.gross || a.net - b.net))
              .slice(0, count);
            if (holed.length < count) complete = false;
            for (const b of holed) {
              gross += b.gross;
              netTotal += b.net;
            }
          }
          if (!complete) continue;
        }

        if (!drawn) {
          wrong.push(`${where}: has a complete card and is not on the round's board`);
          continue;
        }
        here += 1;
        if (differs) tellApart += 1;
        if (drawn.gross !== String(gross)) wrong.push(`${where}: gross ${drawn.gross}, the cards give ${gross}`);
        if (net && board.heads.includes("net") && drawn.net !== String(netTotal)) wrong.push(`${where}: net ${drawn.net}, the Rules give ${netTotal} (gross ${gross})`);
      }
      checked += here;
      rounds.push(`${ev.slug} r${stage.position + 1} ${stage.format}: ${here}`);
    }
  }

  testInfo.annotations.push({ type: "boards", description: rounds.join("; ") });
  testInfo.annotations.push({ type: "left out", description: said.join("; ") || "nothing" });
  console.log(`[boards-by-the-rules] ${checked} sides on ${rounds.length} team boards (${rounds.join("; ")}); ${tellApart} of them play off a different handicap rounded first; ${wrong.length} wrong${said.length ? `; ${said.join("; ")}` : ""}`);

  expect(said, "a round or a side could not be checked").toEqual([]);
  expect(rounds.length, "almost no seeded team round was checked").toBeGreaterThanOrEqual(6);
  expect(checked, "almost no side was checked").toBeGreaterThanOrEqual(30);
  expect(tellApart, "no checked side plays off a different handicap rounded first, so a wrong allowance could not show").toBeGreaterThan(0);
  expect(wrong, `${wrong.length} figures on a team board are not the Rules'`).toEqual([]);
  expect(errors, errors.join("\n")).toEqual([]);
});
