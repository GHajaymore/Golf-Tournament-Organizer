import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";
import { teamsForStage } from "../services/teams";
import { roundCard } from "../services/course-resolution";
import { holeStrokesReceived } from "../domain/stroke";
import { matchStrokesPerHole } from "../domain/team";
import { matchStrokesGiven } from "../domain/match";
import { holesPlayed } from "../domain/handicap";
import { needsTeams, sharesOneCard } from "../formats";
import { isHeadToHead } from "../stage-types";
import { printKit, savePrintLog, stampWords, START_ROWS_PER_PAGE, type KitPage, type ScorecardPage } from "../services/print-kit";
import { parsePrintLog, strokesByNine, withPrinted } from "../domain/print-kit";

/**
 * PAPER EQUALS SCREEN (decision C1, the QA manager's first test): for every
 * player in every format the Print kit prints, the strokes on each HOLE of the
 * printed card are the dots the score-entry screen draws. Not totals — a
 * player's strokes can sit on the wrong holes and still add up.
 *
 * Two readers, pinned, not merged. The paper is priced in `services/print-kit.ts`
 * (the Tee sheet's old chain: the exact course handicap off the tees being
 * played, the allowance rounded once, the strokes for tees of a higher par, a
 * match off its low). The screen's dots are built here the way
 * `app/(app)/entry/page.tsx` builds them — `state.strokeHandicapFor` and
 * `holeStrokesReceived` for a card of one's own, `teamsForStage`'s `playing`
 * and `matchStrokesPerHole` for a side, `matchHandicapFor` and
 * `matchStrokesGiven` for a singles match — recipes `entry-card-handicaps.test.ts`
 * and `handicap-wiring.test.ts` already hold that screen to.
 *
 * And one row against the RULES by a route neither takes (the lady on the red
 * tees, Rules of Handicapping 6.2a and 6.2b), so two readers agreeing on a
 * wrong answer cannot pass.
 *
 * Then the stamp and the reprint: a sheet printed, a group changed, a code
 * reissued — and the field sizes the decision names, a shotgun of 120 among them.
 *
 *   npx vitest run --config vitest.audit.config.ts print-kit
 */

const prisma = new PrismaClient();
const TAG = "zz-print-audit";
const ORIGIN = "https://tourneyhq.example";

const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
const PAR = PARS.reduce((a, b) => a + b, 0);
const WHITE = { courseRating: 71.3, slopeRating: 128, par: PAR };
const RED = { courseRating: 73.4, slopeRating: 126, par: PAR + 1 };

/** Eight players: a lady who plays the red tees by default, a plus, a 54, and every figure with a decimal. */
const FIELD: Array<{ key: string; index: number; gender?: string }> = [
  { key: "ann", index: 18.2, gender: "female" },
  { key: "bea", index: 9.4 },
  { key: "col", index: 12.7 },
  { key: "dev", index: 3.1 },
  { key: "eve", index: -1.6 },
  { key: "fay", index: 54 },
  { key: "gus", index: 26.3 },
  { key: "hal", index: 7.5 },
];

let eventId = "";
let orgId = "";
const player: Record<string, string> = {};
const round: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  const courses = await prisma.course.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  await prisma.tee.deleteMany({ where: { courseId: { in: courses.map((c) => c.id) } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const sheetOf = (groups: string[][], startType = "tee") =>
  JSON.stringify({
    savedAt: "2026-10-23T07:00:00.000Z",
    startType,
    groups: groups.map((ids, i) => ({ name: `Group ${i + 1}`, startHole: startType === "shotgun" ? (i % 18) + 1 : 1, time: `8:${String(i * 10).padStart(2, "0")} AM`, playerIds: ids })),
  });

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club", country: "GB", timeZone: "Pacific/Kiritimati" } });
  orgId = org.id;
  const course = await prisma.course.create({
    data: { organizationId: org.id, name: `${TAG} links`, city: "", pars: JSON.stringify(PARS), yards: JSON.stringify(new Array(18).fill(400)), strokeIndex: JSON.stringify(SI) },
  });
  const white = await prisma.tee.create({ data: { courseId: course.id, name: "White", ...WHITE, position: 0 } });
  await prisma.tee.create({ data: { courseId: course.id, name: "Red", gender: "female", ...RED, position: 1 } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id, name: `${TAG} every format`, dates: "", course: course.name, city: "", address: "", regDeadline: "",
      shareToken: `${TAG}-${process.pid}`, courseId: course.id, defaultTeeId: white.id, playerAccess: "both", leaderboardVisibility: "public",
    },
  });
  eventId = event.id;
  await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });
  for (const [i, p] of FIELD.entries()) {
    const row = await prisma.player.create({
      data: { eventId, name: `${TAG} ${p.key}`, email: `${TAG}.${p.key}@example.invalid`, seed: i + 1, status: "confirmed", handicap: p.index, gender: p.gender ?? "" },
    });
    player[p.key] = row.id;
  }
  const all = FIELD.map((p) => player[p.key]);
  const twoFours = [all.slice(0, 4), all.slice(4, 8)];
  let position = 0;
  const make = async (key: string, data: Record<string, unknown>, sides: string[][] = [], matches: Array<[number, number]> = []) => {
    const stage = await prisma.stage.create({
      data: { eventId, position: position++, type: "Stroke Play Round", holes: 18, scoringBasis: "net", courseId: course.id, teeSheet: sheetOf(twoFours), teeSheetPublished: true, ...data } as never,
    });
    round[key] = stage.id;
    const teamIds: string[] = [];
    for (const [i, ids] of sides.entries()) {
      const t = await prisma.team.create({ data: { eventId, stageId: stage.id, name: `${TAG} ${key} side ${i + 1}`, seed: i + 1 } });
      await prisma.teamMember.createMany({ data: ids.map((playerId, p) => ({ teamId: t.id, playerId, position: p })) });
      teamIds.push(t.id);
    }
    if (matches.length) {
      const carrier = await prisma.group.create({ data: { eventId, stageId: stage.id, isCarrier: true, name: `${key} matches`, position: 50 + position } });
      for (const [r, [a, b]] of matches.entries()) {
        await prisma.match.create({
          data: sides.length
            ? { eventId, stageId: stage.id, groupId: carrier.id, round: r + 1, playerAId: "", playerBId: "", teamAId: teamIds[a], teamBId: teamIds[b] }
            : { eventId, stageId: stage.id, groupId: carrier.id, round: r + 1, playerAId: all[a], playerBId: all[b] },
        });
      }
    }
  };
  const pairs = [[all[0], all[1]], [all[2], all[3]], [all[4], all[5]], [all[6], all[7]]];
  await make("medal", { format: "Stroke Play" });
  await make("gross", { format: "Stroke Play", scoringBasis: "gross" });
  await make("stableford", { format: "Stableford" });
  await make("fourballMedal", { format: "Four-Ball" }, pairs);
  await make("fourballMatch", { format: "Four-Ball", type: "Single Match Stage" }, pairs, [[0, 1], [2, 3]]);
  await make("foursomes", { format: "Foursomes" }, pairs);
  await make("greensomes", { format: "Greensomes" }, pairs);
  await make("scramble", { format: "Scramble" }, twoFours);
  await make("backNine", { format: "Stroke Play", holes: 9, nine: "back" });
  await make("nineHoles", { format: "Stroke Play", holes: 9, nine: "front" });
  await make("singles", { format: "Match Play", type: "Single Match Stage" }, [], [[0, 1], [2, 3], [4, 5], [6, 7]]);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/** Every player's printed strokes per hole, by player id, read off the group cards (every name in its group). */
async function paperShots(stageId: string): Promise<{ byName: Map<string, number[]>; sides: Map<string, number[]>; pages: KitPage[]; signs: Map<string, string>; firstHole: number }> {
  // One card per group (an individual format) or per side (a team one): every name in its group, as before.
  const kit = await printKit(eventId, { stageId, origin: ORIGIN, cardsBy: "group" });
  const pages = kit.docs.flatMap((d) => d.pages);
  const groupCards = pages.filter((p): p is ScorecardPage => p.doc === "cards");
  // A match prints no scorecard (the ruling of 30 Oct: a result slip): its strokes are on the {cart} signs.
  const signs = new Map<string, string>();
  for (const p of pages) if (p.doc === "signs") for (const x of p.sign.players) signs.set(x.name, JSON.stringify(x.strokes));
  expect(groupCards.length + signs.size, "CONTROL: the kit printed no cards and no signs for this round").toBeGreaterThan(0);
  const byName = new Map<string, number[]>();
  for (const p of groupCards) for (const pl of p.group.players) byName.set(pl.name, pl.shots ?? []);
  const sides = new Map((kit.card?.sides ?? []).map((s) => [s.name, s.shots]));
  return { byName, sides, pages, signs, firstHole: kit.card?.firstHole ?? 1 };
}

/** The dots the score-entry screen draws for each player (or side), built as that screen builds them. */
async function screenShots(stageId: string): Promise<{ byName: Map<string, number[]>; sides: Map<string, number[]> }> {
  const state = (await loadEventState(eventId))!;
  const stage = state.stages.find((s) => s.id === stageId)!;
  const venue = stage.courseId ? await prisma.course.findUnique({ where: { id: stage.courseId } }) : null;
  const card = roundCard(stage, state.event, venue);
  const holes = holesPlayed(stage.holes);
  const nameOf = new Map(state.confirmed.map((p) => [p.id, p.name]));
  const byName = new Map<string, number[]>();
  const sides = new Map<string, number[]>();
  const matches = state.matches.filter((m) => m.stageId === stageId);

  if (needsTeams(stage.format)) {
    const teams = await teamsForStage(eventId, stageId, stage.format, stage.handicapAllowance, holes, stage.allowanceWeights);
    const byId = new Map(teams.map((t) => [t.id, t]));
    const shared = sharesOneCard(stage.format);
    // entry/page.tsx `lowInMatch`: zero on a medal; in a match the lowest of its sides or players.
    const lowOf = (teamId: string): number => {
      if (!isHeadToHead(stage.type)) return 0;
      const m = matches.find((x) => x.teamAId === teamId || x.teamBId === teamId);
      if (!m) return 0;
      const a = byId.get(m.teamAId)!;
      const b = byId.get(m.teamBId)!;
      const figures = shared ? [a.playingHandicap, b.playingHandicap] : [...a.members, ...b.members].map((x) => x.playing ?? 0);
      return Math.min(...figures.map((n) => Math.round(n)));
    };
    for (const t of teams) {
      const low = lowOf(t.id);
      if (shared) sides.set(t.name, matchStrokesPerHole(t.playingHandicap, low, card.strokeIndex));
      else for (const m of t.members) byName.set(m.name, matchStrokesPerHole(m.playing ?? 0, low, card.strokeIndex));
    }
  } else if (isHeadToHead(stage.type)) {
    // The player's match screen: `matchHandicapFor` and `matchStrokesGiven`.
    for (const m of matches) {
      const given = matchStrokesGiven(state.matchHandicapFor(m.playerAId, m.id), state.matchHandicapFor(m.playerBId, m.id), card.strokeIndex);
      byName.set(nameOf.get(m.playerAId)!, given.toA);
      byName.set(nameOf.get(m.playerBId)!, given.toB);
    }
  } else {
    // entry/page.tsx `shotsByPlayer`.
    for (const p of state.confirmed) {
      const playing = state.strokeHandicapFor(p.id, stageId);
      byName.set(p.name, Array.from({ length: holes }, (_, h) => holeStrokesReceived(playing, card.strokeIndex[h] ?? 18, holes)));
    }
  }
  return { byName, sides };
}

describe("the strokes printed on every hole are the dots the score-entry screen draws", () => {
  for (const key of ["medal", "gross", "stableford", "fourballMedal", "fourballMatch", "foursomes", "greensomes", "scramble", "backNine", "nineHoles", "singles"]) {
    it(key, async () => {
      const paper = await paperShots(round[key]);
      const screen = await screenShots(round[key]);
      const compared = screen.sides.size + screen.byName.size;
      expect(compared, "CONTROL: nothing was compared").toBeGreaterThan(0);
      if (screen.sides.size) {
        for (const [name, dots] of screen.sides) expect(paper.sides.get(name), `${key}: ${name}`).toEqual(dots);
      } else {
        for (const [name, dots] of screen.byName) {
          if (paper.byName.has(name)) expect(paper.byName.get(name), `${key}: ${name}`).toEqual(dots);
          else expect(paper.signs.get(name), `${key}: ${name}, on the sign`).toBe(JSON.stringify(strokesByNine(dots, paper.firstHole)));
        }
      }
      // A fixture that gives nobody a stroke cannot tell a right answer from a wrong one.
      const anyStroke = [...screen.byName.values(), ...screen.sides.values()].some((d) => d.some((n) => n !== 0));
      if (key !== "gross") expect(anyStroke, `${key}: the fixture gives nobody a stroke`).toBe(true);
    });
  }
});

describe("and against the Rules, by a route neither reader takes", () => {
  /** Rule 6.2a in whole numbers (113,000ths of a stroke), then 6.2b. */
  const byTheRules = (index: number, t: { courseRating: number; slopeRating: number; par: number }, pct: number, parStrokes: number) => {
    const tenths = Math.round(index * 10);
    const n = (tenths * t.slopeRating + (Math.round(t.courseRating * 10) - t.par * 10) * 113) * pct;
    return Math.floor((2 * n + 113_000) / (2 * 113_000)) + parStrokes;
  };
  /** Appendix E: a stroke on each hole whose index is within the figure, once round for every 18. */
  const spread = (strokes: number, si: number[]) => si.map((s) => Math.floor(strokes / 18) + (s <= strokes % 18 ? 1 : 0));

  it("the lady on the red tees gets her allowance of the exact figure, and the stroke for the higher par, on the right holes", async () => {
    const paper = await paperShots(round.medal);
    const ann = byTheRules(18.2, RED, 95, RED.par - WHITE.par);
    expect(paper.byName.get(`${TAG} ann`)).toEqual(spread(ann, SI));
    // CONTROL: without the stroke for the par the answer differs, so the fixture can see it.
    expect(spread(ann - 1, SI)).not.toEqual(spread(ann, SI));
  });

  it("a back nine is allocated on the nine, on the holes that are hardest of the nine", async () => {
    const paper = await paperShots(round.backNine);
    const bea = paper.byName.get(`${TAG} bea`)!;
    expect(bea).toHaveLength(9);
    // The back nine's indexes are 8,4,12,2,16,6,18,10,14 — ranked 1..9 as 3,2,6,1,8,4,9,5,7.
    const strokes = bea.reduce((a, b) => a + b, 0);
    const ranked = [3, 2, 6, 1, 8, 4, 9, 5, 7];
    expect(bea).toEqual(ranked.map((r) => Math.floor(strokes / 9) + (r <= strokes % 9 ? 1 : 0)));
    expect(strokes, "CONTROL: a nine gives roughly half the strokes").toBeGreaterThan(0);
  });
});

describe("a member nobody has claimed an index for", () => {
  it("is printed as to be confirmed, with no strokes", async () => {
    const id = (await prisma.player.create({
      data: { eventId, name: `${TAG} ivy`, email: `${TAG}.ivy@example.invalid`, seed: 20, status: "confirmed", handicap: 0, handicapSource: "none" },
    })).id;
    try {
      await prisma.stage.update({ where: { id: round.medal }, data: { teeSheet: sheetOf([[id, player.ann]]) } });
      const kit = await printKit(eventId, { stageId: round.medal, origin: ORIGIN });
      const card = kit.docs.find((d) => d.kind === "cards")!.pages.find((p) => p.key === `cards:${id}`) as ScorecardPage;
      expect(card.group.players[0].unconfirmed).toBe(true);
      expect(card.group.players[0].shots?.every((n) => n === 0)).toBe(true);
      const start = kit.docs.find((d) => d.kind === "start")!.pages[0] as Extract<KitPage, { doc: "start" }>;
      expect(start.start.rows.find((r) => r.name.endsWith("ivy"))?.playing).toBe("to be confirmed");
      // CONTROL: the claimed figure beside it is a number.
      expect(start.start.rows.find((r) => r.name.endsWith("ann"))?.playing).toMatch(/^\+?\d+$/);
    } finally {
      await prisma.player.delete({ where: { id } });
      await prisma.stage.update({ where: { id: round.medal }, data: { teeSheet: sheetOf([FIELD.slice(0, 4).map((p) => player[p.key]), FIELD.slice(4).map((p) => player[p.key])]) } });
    }
  });
});

describe("stamped, and reprinted only where it changed (decision D)", () => {
  it("a moved group makes its own sheets out of date, and only those", async () => {
    const before = await printKit(eventId, { stageId: round.medal, origin: ORIGIN });
    expect(before.statuses.every((s) => s.state === "unprinted")).toBe(true);
    await savePrintLog(eventId, round.medal, withPrinted(parsePrintLog(""), before.sheets, new Date()));
    const printed = await printKit(eventId, { stageId: round.medal, origin: ORIGIN });
    expect(printed.statuses.every((s) => s.state === "current"), "CONTROL: nothing changed, nothing is stale").toBe(true);

    // Group 2's 8:10 becomes 8:20. Group 1 is untouched.
    const stage = await prisma.stage.findUniqueOrThrow({ where: { id: round.medal } });
    const sheet = JSON.parse(stage.teeSheet);
    sheet.groups[1].time = "8:20 AM";
    await prisma.stage.update({ where: { id: round.medal }, data: { teeSheet: JSON.stringify(sheet) } });
    const after = await printKit(eventId, { stageId: round.medal, origin: ORIGIN });
    const stale = after.statuses.filter((s) => s.state === "stale").map((s) => s.key).sort();
    const group2 = FIELD.slice(4).map((p) => `cards:${player[p.key]}`);
    expect(stale).toEqual(
      // Its four cards, its two carts' signs, and the one starting sheet (the ruling of 30 Oct: one copy).
      [...group2, "signs:Group 2:A", "signs:Group 2:B", "start:1"].sort(),
    );
    expect(after.statuses.find((s) => s.key === `cards:${player.ann}`)?.state, "a card in the untouched group went stale").toBe("current");
    expect(after.statuses.find((s) => s.key === "signs:Group 2:A")?.nextVersion).toBe(2);
  });

  it("a reissued round code makes the printed signs out of date", async () => {
    const kit = await printKit(eventId, { stageId: round.stableford, origin: ORIGIN });
    expect(kit.sheets.some((s) => s.doc === "spare"), "CONTROL: no code, no sign").toBe(false);
    await prisma.stage.update({ where: { id: round.stableford }, data: { accessCode: "ZZPQ2346" } });
    try {
      const withCode = await printKit(eventId, { stageId: round.stableford, origin: ORIGIN });
      await savePrintLog(eventId, round.stableford, withPrinted(parsePrintLog(""), withCode.sheets, new Date()));
      await prisma.stage.update({ where: { id: round.stableford }, data: { accessCode: "ZZPQ2347" } });
      const reissued = await printKit(eventId, { stageId: round.stableford, origin: ORIGIN });
      const stale = new Set(reissued.statuses.filter((s) => s.state === "stale").map((s) => s.doc));
      expect([...stale].sort()).toEqual(["signs", "spare"]);
    } finally {
      await prisma.stage.update({ where: { id: round.stableford }, data: { accessCode: "" } });
    }
  });
});

describe("on the club's clock (decision D's stamp)", () => {
  it("writes the moment in the club's zone, not the server's", () => {
    // 11:30 on the 23rd in London is 01:30 on the 24th at Kiritimati (UTC+14).
    const at = new Date("2026-10-23T11:30:00Z");
    // The hour as the club's own words write it (`date-words.ts`); the zone is the point.
    expect(stampWords(at, "en-GB", "Pacific/Kiritimati")).toMatch(/^0?1:30, 24 Oct 2026$/);
    expect(stampWords(at, "en-GB", "Pacific/Pago_Pago")).toMatch(/^0?0:30, 23 Oct 2026$/);
    expect(stampWords(at, "en-US", "America/New_York")).toBe("7:30 AM, Oct 23, 2026");
  });
  it("the kit stamps its pages from the club's own zone", async () => {
    const kit = await printKit(eventId, { stageId: round.medal, origin: ORIGIN, now: new Date("2026-10-23T11:30:00Z") });
    expect(kit.nowWords).toContain("24, 2026");
  });
});

describe("one sheet per player, group or match, at the sizes the decision names", () => {
  for (const n of [1, 2, 3, 5, 10, 20, 120]) {
    it(`${n} player${n === 1 ? "" : "s"}${n === 120 ? ", off a shotgun" : ""}`, async () => {
      const ev = await prisma.event.create({
        data: { organizationId: orgId, name: `${TAG} field of ${n}`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-n${n}-${process.pid}`, playerAccess: "both" },
      });
      await prisma.player.createMany({
        data: Array.from({ length: n }, (_, i) => ({ eventId: ev.id, name: `${TAG} n${n} p${i + 1}`, email: `${TAG}.n${n}.${i}@example.invalid`, seed: i + 1, status: "confirmed", handicap: (i * 2.3) % 30 })),
      });
      const ids = (await prisma.player.findMany({ where: { eventId: ev.id }, orderBy: { seed: "asc" }, select: { id: true } })).map((p) => p.id);
      const size = n === 120 ? 4 : 3;
      const groups = Array.from({ length: Math.ceil(n / size) }, (_, g) => ids.slice(g * size, g * size + size));
      const stage = await prisma.stage.create({
        data: { eventId: ev.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "net", accessCode: n === 120 ? "ZZPR2346" : "", teeSheet: sheetOf(groups, n === 120 ? "shotgun" : "tee"), teeSheetPublished: true },
      });
      const kit = await printKit(ev.id, { stageId: stage.id, origin: ORIGIN });
      const count = (doc: string) => kit.docs.find((d) => d.kind === doc)!.pages.length;
      expect(count("cards")).toBe(n);
      // One sign per cart: a group split in pairs, a three giving a two and a one.
      expect(count("signs")).toBe(groups.reduce((s, g) => s + Math.ceil(g.length / 2), 0));
      // Whole groups to a page — never one split across a break — and one copy (print as many as needed).
      expect(count("start")).toBe(Math.ceil(groups.length / Math.floor(START_ROWS_PER_PAGE / size)));
      expect(new Set(kit.sheets.map((s) => s.key)).size, "two sheets share a key").toBe(kit.sheets.length);
      // Every card of a medal of threes and fours is the normal card: no fold-out here.
      expect(kit.docs.flatMap((d) => d.pages).filter((p) => p.format === "fold-out")).toEqual([]);
      if (n === 120) {
        expect(groups.length).toBe(30);
        // Two spare signs: the first tee and the clubhouse.
        expect(count("spare")).toBe(2);
        // Every group of the shotgun says the hole it starts on.
        const starts = kit.docs.find((d) => d.kind === "signs")!.pages.map((p) => (p as Extract<KitPage, { doc: "signs" }>).sign.start);
        expect(new Set(starts).size).toBe(18);
        expect(starts.every((s) => /^Hole \d+/.test(s))).toBe(true);
      }
    });
  }
});
