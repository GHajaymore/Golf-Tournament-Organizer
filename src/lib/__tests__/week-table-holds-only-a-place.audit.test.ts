import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

import { weekViewFor } from "@/lib/services/week-view";

/**
 * THE TABLE AFTER A ROUND HOLDS ONLY THE PLAYERS WHO HOLD A PLACE, ON THE
 * ROUNDS THEY WERE REQUIRED TO PLAY.
 *
 * Rules of Golf, Rule 3.3a: in stroke play the winner is the player who
 * completes all the rounds in the fewest total strokes. A cut is a term of the
 * competition (Committee Procedures 5A); those it leaves out play no more
 * rounds, so they hold no place in a total of them.
 *
 * The week sheet's stroke table added up whatever cards each player held and
 * ranked the totals, so after round 2 of a championship cut after round 1 the
 * players who went home on ONE round's strokes headed it — the seeded Club
 * Championship's "standings after round 2" named twelve of them above the
 * sixteen who played on (found building the tournament report, 2026-10-21). A
 * stroke league member who skipped a week went top the same way. The board
 * never did either, and now the sheet reads the board (`standingsThroughRound`).
 *
 * EVERY EXPECTED FIGURE BELOW IS WORKED BY HAND from the cards, on par 4 for
 * every hole, and none is read from the app: a test that asks the board what
 * the board says agrees with the board whether or not it is right.
 *
 * THE FIXTURE IS BUILT TO TURN THE WRONG ANSWER UPSIDE DOWN: the players with
 * fewer rounds have the smaller totals, so a table that sums cards puts them
 * on top. Uneven attendance is the axis — a cut, a player who entered and never
 * played, a league member who missed a CLOSED week and one who missed an OPEN
 * one — and a round still being played, where the totals are over different
 * numbers of holes and only the place says who leads.
 *
 *   npx vitest run --config vitest.audit.config.ts week-table-holds-only-a-place
 */

const prisma = new PrismaClient();
const TAG = "zz-week-place";
const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

/** An eighteen-hole card on par 4s, `over` strokes over par spread from hole 1. */
function card(total: number): number[] {
  const over = total - 72;
  // One stroke more (or fewer) on each of the first |over| holes.
  return PARS.map((p, i) => (i < Math.abs(over) ? p + Math.sign(over) : p));
}

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

let orgId = "";
let courseId = "";

async function makeEvent(name: string): Promise<string> {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      shape: "series",
      format: "stroke",
      status: "live",
      dates: "",
      course: `${TAG} links`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name.replace(/\W/g, "")}-${Date.now()}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(SI),
      customYards: JSON.stringify(new Array(18).fill(380)),
      courseId,
    },
    select: { id: true },
  });
  await prisma.eventCourse.create({ data: { eventId: event.id, courseId } });
  return event.id;
}

async function round(
  eventId: string,
  position: number,
  scoringBasis: "gross" | "net",
  extra: { closed?: boolean; cutAfterTop?: number } = {},
): Promise<string> {
  const s = await prisma.stage.create({
    data: {
      eventId,
      position,
      description: `Round ${position + 1}`,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      nine: "full",
      scoringBasis,
      handicapAllowance: 100,
      courseId,
      closedAt: extra.closed ? new Date() : null,
      // The cut belongs to the round it FEEDS, and is made when its survivors
      // hold cards for it — exactly as `applyStrokeCut` leaves it.
      ...(extra.cutAfterTop
        ? { cutEnabled: true, cutScope: "overall", cutMode: "count", cutCount: extra.cutAfterTop, cutMadeAt: new Date() }
        : {}),
    },
    select: { id: true },
  });
  return s.id;
}

async function player(eventId: string, who: string, seed: number, handicap = 0): Promise<string> {
  const p = await prisma.player.create({
    data: {
      eventId,
      name: `${TAG} ${who}`,
      email: `${TAG}-${eventId.slice(-6)}-${who}@example.invalid`.toLowerCase(),
      seed,
      status: "confirmed",
      handicap,
      handicapType: "18",
    },
    select: { id: true },
  });
  return p.id;
}

async function score(eventId: string, stageId: string, playerId: string, strokes: (number | null)[]) {
  await prisma.scorecard.create({ data: { eventId, stageId, playerId, strokes: JSON.stringify(strokes) } });
}

/** The table, as [short name, place, total, holes] — what a member reads. */
async function table(eventId: string, stageId: string) {
  const view = await weekViewFor(eventId, stageId);
  expect(view, "the week sheet did not build").toBeTruthy();
  expect(view!.stageId, "the sheet opened a different round").toBe(stageId);
  return view!.standings.map((r) => [r.name.replace(`${TAG} `, ""), r.position, r.value, r.holes]);
}
async function moves(eventId: string, stageId: string) {
  const view = await weekViewFor(eventId, stageId);
  return Object.fromEntries(view!.standings.map((r) => [r.name.replace(`${TAG} `, ""), r.change]));
}

/* ------------------------------------------------------------------------ */
/*  A 54-hole gross championship, cut to three after round 1                */
/* ------------------------------------------------------------------------ */

const champ = { eventId: "", r1: "", r2: "", r3: "" };

/* ------------------------------------------------------------------------ */
/*  A net stroke league, two weeks, uneven attendance                        */
/* ------------------------------------------------------------------------ */

const league = { eventId: "", w1: "", w2: "" };

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  orgId = org.id;
  const course = await prisma.course.create({
    data: {
      organizationId: orgId,
      name: `${TAG} links`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(380)),
      strokeIndex: JSON.stringify(SI),
    },
    select: { id: true },
  });
  courseId = course.id;

  // ── The championship ────────────────────────────────────────────────────
  //
  //   R1 (closed)   Avery 70  Cass 71  Blair 73 | Dana 75  Ellis 76  Flynn 80
  //                 Gale entered and returned no card
  //   cut: top 3 -> Avery, Cass, Blair play on
  //   R2 (closed)   Avery 76  Cass 72  Blair 71
  //   R3 (live)     Cass out in 33 (nine holes, three under), Blair 72, Avery
  //                 not yet out
  champ.eventId = await makeEvent("championship");
  champ.r1 = await round(champ.eventId, 0, "gross", { closed: true });
  champ.r2 = await round(champ.eventId, 1, "gross", { closed: true, cutAfterTop: 3 });
  champ.r3 = await round(champ.eventId, 2, "gross");
  const r1: Record<string, number> = { Avery: 70, Cass: 71, Blair: 73, Dana: 75, Ellis: 76, Flynn: 80 };
  const ids: Record<string, string> = {};
  for (const [i, who] of ["Avery", "Blair", "Cass", "Dana", "Ellis", "Flynn", "Gale"].entries()) {
    ids[who] = await player(champ.eventId, who, i + 1);
  }
  for (const [who, total] of Object.entries(r1)) await score(champ.eventId, champ.r1, ids[who], card(total));
  await score(champ.eventId, champ.r2, ids.Avery, card(76));
  await score(champ.eventId, champ.r2, ids.Cass, card(72));
  await score(champ.eventId, champ.r2, ids.Blair, card(71));
  await score(champ.eventId, champ.r3, ids.Cass, [3, 3, 3, 4, 4, 4, 4, 4, 4, ...new Array(9).fill(null)]);
  await score(champ.eventId, champ.r3, ids.Blair, card(72));

  // ── The league ──────────────────────────────────────────────────────────
  //
  // Net at 100%, on a course with no rating, so a course handicap is the
  // index and net is gross less it.
  //
  //   W1 (closed)   Pat 82-10=72   Quinn 75-4=71   Sol 74-0=74   Rory absent
  //   W2 (open)     Pat 80-10=70   Quinn 78-4=74   Rory 88-20=68  Sol not yet
  league.eventId = await makeEvent("league");
  league.w1 = await round(league.eventId, 0, "net", { closed: true });
  league.w2 = await round(league.eventId, 1, "net");
  const pat = await player(league.eventId, "Pat", 1, 10);
  const quinn = await player(league.eventId, "Quinn", 2, 4);
  const rory = await player(league.eventId, "Rory", 3, 20);
  const sol = await player(league.eventId, "Sol", 4, 0);
  await score(league.eventId, league.w1, pat, card(82));
  await score(league.eventId, league.w1, quinn, card(75));
  await score(league.eventId, league.w1, sol, card(74));
  await score(league.eventId, league.w2, pat, card(80));
  await score(league.eventId, league.w2, quinn, card(78));
  await score(league.eventId, league.w2, rory, card(88));
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a championship with a cut", () => {
  it("after round 1, the whole field that played, on one round", async () => {
    // Nobody has missed anything yet; Gale, with no card, is on no table.
    expect(await table(champ.eventId, champ.r1)).toEqual([
      ["Avery", 1, 70, 18],
      ["Cass", 2, 71, 18],
      ["Blair", 3, 73, 18],
      ["Dana", 4, 75, 18],
      ["Ellis", 5, 76, 18],
      ["Flynn", 6, 80, 18],
    ]);
  });

  it("after round 2, the three who made the cut, on thirty-six holes — and nobody else", async () => {
    // Cass 71+72 = 143, Blair 73+71 = 144, Avery 70+76 = 146. Dana, Ellis and
    // Flynn hold one round each (75, 76, 80) — fewer strokes than anybody who
    // played on, which is exactly why a table of summed cards put them first.
    expect(await table(champ.eventId, champ.r2)).toEqual([
      ["Cass", 1, 143, 36],
      ["Blair", 2, 144, 36],
      ["Avery", 3, 146, 36],
    ]);
  });

  it("and the movement is against round 1's table", async () => {
    // Cass 2nd -> 1st, Blair 3rd -> 2nd, Avery 1st -> 3rd.
    expect(await moves(champ.eventId, champ.r2)).toEqual({ Cass: 1, Blair: 1, Avery: -2 });
  });

  it("while round 3 is out, the place leads and the total says its holes", async () => {
    // Against par for the holes played, as every scoreboard reads a live round:
    //   Cass   143 + 33 = 176 over 45 holes, par 180   -> 4 under
    //   Blair  144 + 72 = 216 over 54 holes, par 216   -> level
    //   Avery  146      over 36 holes, par 144          -> 2 over
    // The totals run 176, 216, 146 down the page — so the ORDER is the places,
    // not the figures, and each figure carries the holes it is over.
    expect(await table(champ.eventId, champ.r3)).toEqual([
      ["Cass", 1, 176, 45],
      ["Blair", 2, 216, 54],
      ["Avery", 3, 146, 36],
    ]);
  });
});

describe("a stroke league with uneven attendance", () => {
  it("after week 1, the three who played it", async () => {
    expect(await table(league.eventId, league.w1)).toEqual([
      ["Quinn", 1, 71, 18],
      ["Pat", 2, 72, 18],
      ["Sol", 3, 74, 18],
    ]);
  });

  it("after week 2, a member who missed the CLOSED week holds no place", async () => {
    // Rory's 68 is the lowest net of anybody's single round and the smallest
    // total in the league — the table that summed cards put Rory top. Week 1
    // is closed and Rory has no card for it, so Rory has not played the
    // competition. Sol missed week 2, which is still OPEN, so is shown on the
    // one round, against par for it (74 is 2 over) and thru 18:
    //   Pat 72+70 = 142 (2 under)   Quinn 71+74 = 145 (1 over)   Sol 74 (2 over)
    expect(await table(league.eventId, league.w2)).toEqual([
      ["Pat", 1, 142, 36],
      ["Quinn", 2, 145, 36],
      ["Sol", 3, 74, 18],
    ]);
    expect(await moves(league.eventId, league.w2)).toEqual({ Pat: 1, Quinn: -1, Sol: 0 });
  });

  it("and once week 2 is closed, the member who missed it holds none either", async () => {
    await prisma.stage.update({ where: { id: league.w2 }, data: { closedAt: new Date() } });
    try {
      expect(await table(league.eventId, league.w2)).toEqual([
        ["Pat", 1, 142, 36],
        ["Quinn", 2, 145, 36],
      ]);
    } finally {
      await prisma.stage.update({ where: { id: league.w2 }, data: { closedAt: null } });
    }
  });
});
