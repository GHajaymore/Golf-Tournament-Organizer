import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CARD WITH HOLES MISSING IS JUDGED BY THE RULES OF ITS OWN FORMAT.
 *
 * "Every hole must be holed out, or no place" is Rule 3.3c, and it is a rule
 * of INDIVIDUAL STROKE PLAY. `a-short-card-in-a-closed-round-holds-no-place`
 * holds it there. This file holds the three places the same card must be
 * judged differently, or by the same rule on another screen, each worked from
 * the Rules and not from the code:
 *
 *   FOUR-BALL (Rule 23.2b). A side's score for a hole is the lower of the two
 *   partners' scores, and only ONE partner need hole out. A partner who picks
 *   up has broken no rule and completed the round. So a blank hole on a
 *   partner's own card in a closed four-ball round takes nothing from them:
 *   whatever standing they had before the round was closed, they keep.
 *
 *   STABLEFORD (Rule 21.1b, 21.1c). A player who does not hole out "gets zero
 *   points for the hole" and is not disqualified; the Rule itself encourages
 *   picking up when no point can be scored. So a short card COUNTS, for the
 *   points on it, and holes not played are worth nothing. Twelve pars are 24
 *   points; that is third behind 36 and 34, not level with the 36 on "points
 *   per hole played". A rate is a live board's way of comparing players who
 *   are different distances round; once the committee has closed the round
 *   nobody is still out, and the competition is on points (Rule 21.1a: "the
 *   player ... with the most points" wins).
 *
 *   THE WEEK SHEET'S "THIS WEEK" (Rule 3.3c again, on the other screen that
 *   places a field). A closed week of individual stroke play placed twelve
 *   holes in 45 first, above every card of eighteen, on raw strokes.
 *
 * Scratch handicaps throughout, par 4 on every hole, so a figure is its own
 * arithmetic: 18 pars are 72 strokes and 36 points.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { loadEventState } from "@/lib/services/tournament";
import { weekViewFor } from "@/lib/services/week-view";

const prisma = new PrismaClient();
const TAG = "zz-short-card-formats";
const PARS: number[] = new Array(18).fill(4);

/** Eighteen holes: pars, with a bogey on each of the last `over` holes. */
const full = (over = 0): (number | null)[] => PARS.map((p, i) => (i >= 18 - over ? p + 1 : p));
/** Twelve pars and nothing after. */
const TWELVE: (number | null)[] = PARS.map((p, i) => (i < 12 ? p : null));
/** Eighteen pars but for the 7th, picked up. */
const PICKED_UP_AT_7: (number | null)[] = PARS.map((p, i) => (i === 6 ? null : p));

let orgId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

type Built = { eventId: string; stageId: string; id: Record<string, string> };

async function build(
  name: string,
  round: { format: string; scoringBasis: string },
  cards: Record<string, (number | null)[]>,
  sides?: string[][],
): Promise<Built> {
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} ${name}`,
      organizationId: orgId,
      status: "live",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-share`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
  const stageId = (
    await prisma.stage.create({
      data: { eventId: ev.id, position: 0, description: "Round 1", type: "Stroke Play Round", holes: 18, ...round },
      select: { id: true },
    })
  ).id;
  const id: Record<string, string> = {};
  for (const [i, who] of Object.keys(cards).entries()) {
    id[who] = (
      await prisma.player.create({
        data: {
          eventId: ev.id,
          name: `${TAG} ${name} ${who}`,
          email: `${TAG}-${name}-${who.toLowerCase()}@example.invalid`,
          seed: i + 1,
          status: "confirmed",
          handicap: 0,
        },
        select: { id: true },
      })
    ).id;
    await prisma.scorecard.create({
      data: { eventId: ev.id, stageId, playerId: id[who], strokes: JSON.stringify(cards[who]), status: "approved" },
    });
  }
  for (const [n, side] of (sides ?? []).entries()) {
    await prisma.team.create({
      data: {
        eventId: ev.id,
        stageId,
        name: `${TAG} ${name} side ${n + 1}`,
        members: { create: side.map((who) => ({ playerId: id[who] })) },
      },
    });
  }
  return { eventId: ev.id, stageId, id };
}

const close = (b: Built, closed = true) =>
  prisma.stage.update({ where: { id: b.stageId }, data: { closedAt: closed ? new Date() : null } });

const boardOf = async (b: Built) => {
  const state = (await loadEventState(b.eventId))!;
  const who = (playerId: string) => Object.keys(b.id).find((k) => b.id[k] === playerId)!;
  return state.strokeStandings.map((s) => ({ who: who(s.player.id), ranked: s.ranked, rank: s.rank, points: s.points, thru: s.thru }));
};

let fourBall: Built;
let stableford: Built;
let week: Built;

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } })).id;
  fourBall = await build(
    "four-ball",
    { format: "Four-Ball", scoringBasis: "gross" },
    { A1: PICKED_UP_AT_7, A2: full(), B1: full(1), B2: full(2) },
    [
      ["A1", "A2"],
      ["B1", "B2"],
    ],
  );
  stableford = await build("stableford", { format: "Stableford", scoringBasis: "net" }, { X: TWELVE, Y: full(2), Z: full() });
  week = await build("medal-week", { format: "Individual Stroke Play", scoringBasis: "gross" }, { P: full(), Q: full(3), S: TWELVE });
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("four-ball: a partner who picked up has completed the round (Rule 23.2b)", () => {
  it("closing the round changes nobody's standing: what each partner held open, they hold closed", async () => {
    await close(fourBall, false);
    const open = await boardOf(fourBall);
    // The fixture is the case: A1's own card holds seventeen holes of eighteen.
    expect(open.find((r) => r.who === "A1")!.thru).toBe(17);
    await close(fourBall);
    const closed = await boardOf(fourBall);
    expect(closed).toEqual(open);
    // And it is a standing worth keeping: every partner had one. Without this,
    // "unchanged" would pass on a board that never placed anybody.
    expect(closed.map((r) => r.ranked)).toEqual([true, true, true, true]);
  });
});

describe("Stableford, one round: a short card counts its points, and a hole not played scores none (Rule 21.1)", () => {
  it("THE CONTROL: with the round open the twelve-hole card is in play and holds a place", async () => {
    await close(stableford, false);
    const x = (await boardOf(stableford)).find((r) => r.who === "X")!;
    expect([x.ranked, x.points, x.thru]).toEqual([true, 24, 12]);
  });

  it("once the round is closed the order is the points: 36, then 34, then the 24 over twelve holes", async () => {
    await close(stableford);
    const rows = (await boardOf(stableford)).sort((a, b) => a.rank - b.rank);
    expect(rows.map((r) => [r.who, r.rank, r.points])).toEqual([
      ["Z", 1, 36],
      ["Y", 2, 34],
      ["X", 3, 24],
    ]);
    // Not disqualified, not unranked: Rule 21.1c gives zero for the hole and no more.
    expect(rows.every((r) => r.ranked)).toBe(true);
  });
});

describe("the week sheet's This week: a closed week of stroke play places only completed cards (Rule 3.3c)", () => {
  const thisWeek = async () =>
    (await weekViewFor(week.eventId, week.stageId))!.results.map((r) => ({
      who: Object.keys(week.id).find((k) => week.id[k] === r.playerId)!,
      position: r.position,
      gross: r.gross,
      thru: r.thru,
    }));

  it("THE CONTROL: with the week open the short card is on the sheet, thru 12, with a place", async () => {
    await close(week, false);
    const s = (await thisWeek()).find((r) => r.who === "S")!;
    expect(s.thru).toBe(12);
    expect(s.position, "a card still in play has no place on an open week").not.toBeNull();
  });

  it("once the week is closed: 72 is first, 75 second, and the twelve holes are listed beneath without a place", async () => {
    await close(week);
    expect(await thisWeek()).toEqual([
      { who: "P", position: 1, gross: 72, thru: 18 },
      { who: "Q", position: 2, gross: 75, thru: 18 },
      { who: "S", position: null, gross: 48, thru: 12 },
    ]);
  });

  it("and the board agrees with the sheet about who holds a place", async () => {
    const placed = (await boardOf(week)).filter((r) => r.ranked).sort((a, b) => a.rank - b.rank).map((r) => r.who);
    expect(placed).toEqual(["P", "Q"]);
  });
});
