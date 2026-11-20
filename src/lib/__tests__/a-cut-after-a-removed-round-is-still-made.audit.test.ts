import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CUT THAT FOLLOWS A REMOVED ROUND IS STILL MADE (G3 of the phase 2
 * technical design, 15 Nov 2026).
 *
 * THE RULES, not the code. A cut is a term of the competition the Committee
 * sets (Committee Procedures, Section 5A): the field of the later round is the top N
 * and ties on the total of the rounds completed when the cut is made. A round
 * abandoned and struck from the competition (rained off, never played) does
 * not strike the cut with it: the cut is then taken on the rounds that WERE
 * completed.
 *
 * The shape: three rounds, "top 8 and ties" into Round 3, so the cut is after
 * Round 2. Round 1 is played and the committee closes it. Round 2 is rained
 * off with no score on any card and the committee removes it. The cut is now
 * after Round 1, and Round 1 is over.
 *
 * What was read on main: a cut is found by position each time, and is MADE
 * only by the press that closes the round before it. Round 1 was closed before
 * the cut was its to make, so nothing ever makes it: all twenty are offered
 * Round 3 while the rules sheet says "top 8".
 *
 * THE FIXTURE, by hand. Twenty players, gross, off scratch so the total IS the
 * score. Round 1 totals, in order of merit:
 *
 *   place   1   2   3   4   5   6   7   8=  8=  10  11  ...  20
 *   total   68  69  70  71  72  73  74  77  77  78  79  ...  88
 *
 * Places 8 and 9 are level on 77 on identical cards, so no countback could
 * part them and "top 8 and ties" is NINE through: the seven better than 77 and
 * both 77s. A bare "top 8" would be eight; the bottom of the field would be
 * 78 and worse. So nine, and WHICH nine, are both asserted.
 *
 * THE CONTROL is the same field in an event that never had a Round 2: closing
 * Round 1 makes the cut there on main, and gives the same nine. So the fixture
 * can express the cut, and the difference between the two is only the order
 * things happened in, which is the axis `docs/claude/knockouts-and-leagues.md`
 * names: what has been arranged against what has happened.
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { setRoundClosed, removeStage, setStageCut, openCorrection } from "@/app/actions/tournament";
import { strokeCutField } from "@/lib/services/stroke-cut";
import { loadEventState } from "@/lib/services/tournament";

const prisma = new PrismaClient();
const TAG = "zz-g3-cut-after-removed";
const PARS = new Array(18).fill(4);
/** 72 is all fours; shots under come off the first holes, shots over go on the last. */
const cardOf = (total: number): number[] => {
  const c = [...PARS];
  let diff = total - 72;
  for (let i = 0; diff < 0; i += 1, diff += 1) c[i] = 3;
  for (let i = 17; diff > 0; i -= 1, diff -= 1) c[i] = 5;
  return c;
};

/** Round 1, in order of merit. Index 7 and 8 are the two 77s. */
const TOTALS = [68, 69, 70, 71, 72, 73, 74, 77, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88];
/** By the Rules: everybody on 77 or better. Player numbers, from 1. */
const THROUGH = [1, 2, 3, 4, 5, 6, 7, 8, 9];

type Built = { eventId: string; r1: string; r2: string | null; r3: string; players: string[] };
let orgId = "";
let adminUser = "";
let removed: Built;
let never: Built;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

async function build(name: string, withRoundTwo: boolean): Promise<Built> {
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
  const base = { eventId: ev.id, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" };
  const cut = { cutEnabled: true, cutScope: "overall", cutMode: "count", cutCount: 8 };
  const r1 = (await prisma.stage.create({ data: { ...base, position: 0, description: "Round 1" }, select: { id: true } })).id;
  const r2 = withRoundTwo
    ? (await prisma.stage.create({ data: { ...base, position: 1, description: "Round 2" }, select: { id: true } })).id
    : null;
  const r3 = (await prisma.stage.create({ data: { ...base, ...cut, position: 2, description: "Round 3" }, select: { id: true } })).id;

  const players: string[] = [];
  // Entered in REVERSE order of merit, so a field that came through on entry
  // order (the first nine created) would be the nine worst, not the nine best.
  for (const n of [...TOTALS.keys()].reverse()) {
    const p = await prisma.player.create({
      data: {
        eventId: ev.id,
        name: `${TAG} ${name} P${n + 1}`,
        email: `${TAG}-${name}-p${n + 1}@example.invalid`,
        seed: TOTALS.length - n,
        status: "confirmed",
        handicap: 0,
      },
      select: { id: true },
    });
    players[n] = p.id;
    await prisma.scorecard.create({
      data: { eventId: ev.id, stageId: r1, playerId: p.id, strokes: JSON.stringify(cardOf(TOTALS[n])), status: "approved" },
    });
  }
  await prisma.account.create({ data: { eventId: ev.id, name: `${TAG} Admin`, email: `${TAG}-admin@example.invalid`, role: "admin" } });
  return { eventId: ev.id, r1, r2, r3, players };
}

async function asAdminOf(eventId: string) {
  jar.clear();
  await createSession(adminUser);
  await setActiveEvent(eventId);
}

/** Who holds a Round 3 card, as player numbers from 1, in order. */
const holders = async (b: Built) =>
  (await prisma.scorecard.findMany({ where: { stageId: b.r3 }, select: { playerId: true } }))
    .map((c) => b.players.indexOf(c.playerId) + 1)
    .sort((x, y) => x - y);
/** Who may play Round 3, the same way, or null when it is open to the whole field. */
const field = async (b: Built) => {
  const f = await strokeCutField(b.eventId, b.r3);
  return f ? [...f].map((id) => b.players.indexOf(id) + 1).sort((x, y) => x - y) : null;
};

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } })).id;
  adminUser = (
    await prisma.user.create({
      data: { email: `${TAG}-admin@example.invalid`, name: `${TAG} Admin`, password: "x:unusable", emailVerifiedAt: new Date() },
      select: { id: true },
    })
  ).id;
  removed = await build("rained-off", true);
  never = await build("two-rounds", false);
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a cut after a round that is removed", () => {
  it("THE FIXTURE: the two 77s are level for the eighth place", async () => {
    const state = (await loadEventState(removed.eventId))!;
    const rank = (n: number) => state.strokeStandings.find((s) => s.player.id === removed.players[n - 1])!.rank;
    expect([rank(7), rank(8), rank(9), rank(10)]).toEqual([7, 8, 8, 10]);
  });

  it("THE CONTROL: with no round between, closing Round 1 makes the cut: nine through, the nine on 77 or better", async () => {
    await asAdminOf(never.eventId);
    expect(await field(never), "Round 3 has a field before Round 1 is closed").toBeNull();
    expect(await setRoundClosed(never.r1, true)).toEqual({ ok: true });
    expect(await holders(never)).toEqual(THROUGH);
    expect(await field(never)).toEqual(THROUGH);
  });

  it("Round 1 closes with Round 2 still to play: no cut yet, rightly, since the cut is after Round 2", async () => {
    await asAdminOf(removed.eventId);
    expect(await setRoundClosed(removed.r1, true)).toEqual({ ok: true });
    expect(await field(removed)).toBeNull();
    expect(await holders(removed)).toEqual([]);
  });

  it("Round 2 is rained off and removed: one press, since it holds no score and no draw", async () => {
    await asAdminOf(removed.eventId);
    expect(await removeStage(removed.r2!)).toEqual({ ok: true });
    expect(await prisma.stage.findUnique({ where: { id: removed.r2! } })).toBeNull();
    // Round 1 is still closed and Round 3 still carries the cut: the cut is now after Round 1.
    expect((await prisma.stage.findUnique({ where: { id: removed.r1 }, select: { closedAt: true } }))?.closedAt).not.toBeNull();
    expect((await prisma.stage.findUnique({ where: { id: removed.r3 }, select: { cutEnabled: true } }))?.cutEnabled).toBe(true);
  });

  it("and the cut is made on the round that was completed: the same nine, and nobody else, may play Round 3", async () => {
    expect(await holders(removed), "nobody was given a Round 3 card: the cut was never made").toEqual(THROUGH);
    expect(await field(removed), "Round 3 is open to all twenty while the rules sheet says top 8").toEqual(THROUGH);
  });

  /**
   * THE SAME CUT LEFT OWING THROUGH ANOTHER DOOR (the Rules review of #1162,
   * G3b): the committee closes Round 1 and only then sets "top 8 and ties" on
   * the round after it. The term is the Committee's to set (Committee
   * Procedures 5A), the round it is taken on is over, and the press that would
   * have made it is in the past. Same field, same nine.
   */
  it("a cut switched on after the round before it was closed is made there and then", async () => {
    const late = await build("cut-set-late", false);
    await prisma.stage.update({ where: { id: late.r3 }, data: { cutEnabled: false } });
    await asAdminOf(late.eventId);
    expect(await setRoundClosed(late.r1, true)).toEqual({ ok: true });
    expect(await holders(late), "a round with no cut was given a field").toEqual([]);

    // The cut is locked at launch; the way through is the one the refusal
    // names, a committee correction on the rounds (Rule 20.2d).
    expect((await setStageCut(late.r3, true, "count", 8, 50)).error).toMatch(/Make a committee correction to change the cut/);
    expect(await openCorrection("rounds", "The cut was left off the rules sheet in error")).toEqual({ ok: true });
    expect(await setStageCut(late.r3, true, "count", 8, 50)).toEqual({ ok: true });
    expect(await holders(late), "the cut was set and never made").toEqual(THROUGH);
    expect(await field(late)).toEqual(THROUGH);
  });

  it("and the board says who missed it", async () => {
    const state = (await loadEventState(removed.eventId))!;
    const missed = state.strokeStandings
      .filter((s) => s.missedCut)
      .map((s) => removed.players.indexOf(s.player.id) + 1)
      .sort((x, y) => x - y);
    expect(missed).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });
});
