import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CARD WITH HOLES MISSING, IN A ROUND THE COMMITTEE HAS CLOSED, HOLDS NO
 * PLACE ON A STROKE BOARD (G2 of the phase 2 technical design, 15 Nov 2026).
 *
 * THE RULES, not the code. In stroke play a player must hole out at every hole
 * (Rule 3.3c) and the score for the round is the total of all its holes (Rule
 * 3.3a); a hole not completed, and not corrected in time, is disqualification.
 * A 36-hole competition's score is the total of two completed rounds, so a
 * player with twelve holes of Round 2 has no 36-hole total, and no place. The
 * app's own term for "the round is over, nothing more is coming" is the
 * committee CLOSING the round (Ajay, 2026-09-23: never the calendar), which is
 * also what already takes the place of a player with no card at all
 * (`a-closed-round-takes-the-place.audit.test.ts`).
 *
 * What was read on main: the board asked only whether the holes held in a
 * closed round were ZERO. Twelve is not zero, so the short card was ranked on
 * its to-par over the holes it holds, among cards of 36: below, C at four
 * under "thru 30" was drawn FIRST, ahead of the player who won.
 *
 * THE FIXTURE, worked by hand. Par 72 both days (out 36, in 36; holes 1 to 12
 * are par 47). Tees rated 71.4, slope 128. Indexes are decimal so no figure is
 * round. Course handicap is index x slope / 113 + (rating - par) (Rule 6.1);
 * the playing handicap is 95% of the EXACT course handicap, rounded once
 * (Rule 6.2, Appendix C: individual stroke play 95%). Nobody plays off more
 * than 18, so a complete round's net is its gross less the playing handicap.
 *
 *   player  index  course hcp (exact)        x 0.95    plays off
 *   A        4.3   4.8708 - 0.6 =  4.2708     4.0573     4
 *   B       11.7  13.2531 - 0.6 = 12.6531    12.0204    12
 *
 *   player  R1  R2                        gross      net              by the Rules
 *   A       74  75                        149        149 -  8 = 141   gross 1st, net 2nd
 *   B       76  78                        154        154 - 24 = 130   gross 2nd, net 1st
 *   C       70  holes 1-12 in 45 (-2)     no total   no total         NO PLACE
 *   D       80  no card                   no total   no total         no place
 *   E       73  withdrew before R2        WD         WD               WD, no place
 *
 * The order of A and B turns over between gross and net, so a board that
 * ranked the wrong column cannot pass both. C is the row under test: 70 is two
 * under, 45 over holes of par 47 is two under, so the short card reads four
 * under and LEADS until the round is closed, which the control asserts.
 *
 * Stableford is not asserted here and is not changed: a hole not completed
 * scores no points and the player stays in (Rule 21.1), which the points half
 * of `a-closed-round-takes-the-place` already holds.
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
import { setRoundClosed } from "@/app/actions/tournament";
import { loadEventState } from "@/lib/services/tournament";

const prisma = new PrismaClient();
const TAG = "zz-g2-short-card";

const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
const SI = [1, 11, 17, 3, 7, 13, 15, 5, 9, 2, 12, 18, 4, 8, 14, 16, 6, 10];

/** A complete card of `total`: shots under par come off the first holes, shots over go on the last. */
const cardOf = (total: number): (number | null)[] => {
  const c: (number | null)[] = [...PARS];
  let diff = total - 72;
  for (let i = 0; diff < 0; i += 1, diff += 1) c[i] = PARS[i] - 1;
  for (let i = 17; diff > 0; i -= 1, diff -= 1) c[i] = PARS[i] + 1;
  return c;
};
/** Holes 1 to 12 in 45 (birdies at the first two), and nothing after: the player walked in. */
const TWELVE_HOLES: (number | null)[] = PARS.map((p, i) => (i >= 12 ? null : i < 2 ? p - 1 : p));

type Who = "A" | "B" | "C" | "D" | "E";
const FIELD: { who: Who; index: number; r1: number; r2: (number | null)[] | null }[] = [
  { who: "A", index: 4.3, r1: 74, r2: cardOf(75) },
  { who: "B", index: 11.7, r1: 76, r2: cardOf(78) },
  { who: "C", index: 8.2, r1: 70, r2: TWELVE_HOLES },
  { who: "D", index: 15.4, r1: 80, r2: null },
  { who: "E", index: 6.9, r1: 73, r2: null },
];

type Built = { eventId: string; r1: string; r2: string; id: Record<Who, string> };
let orgId = "";
let adminUser = "";
const built: Partial<Record<"gross" | "net", Built>> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

async function build(basis: "gross" | "net"): Promise<Built> {
  const course = await prisma.course.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${basis} links`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(SI),
    },
    select: { id: true },
  });
  const tee = await prisma.tee.create({
    data: { courseId: course.id, name: "Medal", position: 0, courseRating: 71.4, slopeRating: 128, par: 72 },
    select: { id: true },
  });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} ${basis} championship`,
      organizationId: orgId,
      status: "live",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${basis}-share`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(SI),
      customYards: JSON.stringify(new Array(18).fill(400)),
      defaultTeeId: tee.id,
    },
    select: { id: true },
  });
  await prisma.eventCourse.create({ data: { eventId: ev.id, courseId: course.id } });
  const base = {
    eventId: ev.id,
    type: "Stroke Play Round",
    format: "Individual Stroke Play",
    holes: 18,
    scoringBasis: basis,
    handicapAllowance: 95,
  };
  const r1 = (await prisma.stage.create({ data: { ...base, position: 0, description: "Round 1" }, select: { id: true } })).id;
  const r2 = (await prisma.stage.create({ data: { ...base, position: 1, description: "Round 2" }, select: { id: true } })).id;

  const id = {} as Record<Who, string>;
  for (const [i, f] of FIELD.entries()) {
    const p = await prisma.player.create({
      data: {
        eventId: ev.id,
        name: `${TAG} ${basis} ${f.who}`,
        email: `${TAG}-${basis}-${f.who.toLowerCase()}@example.invalid`,
        seed: i + 1,
        // E withdrew after Round 1: the results stay, the player leaves the field.
        status: f.who === "E" ? "withdrawn" : "confirmed",
        handicap: f.index,
      },
      select: { id: true },
    });
    id[f.who] = p.id;
    await prisma.scorecard.create({
      data: { eventId: ev.id, stageId: r1, playerId: p.id, strokes: JSON.stringify(cardOf(f.r1)), status: "approved" },
    });
    if (f.r2) {
      await prisma.scorecard.create({
        // The short card is never approved: nobody signs twelve holes.
        data: { eventId: ev.id, stageId: r2, playerId: p.id, strokes: JSON.stringify(f.r2), status: f.who === "C" ? "entered" : "approved" },
      });
    }
  }
  await prisma.account.create({ data: { eventId: ev.id, name: `${TAG} Admin`, email: `${TAG}-admin@example.invalid`, role: "admin" } });
  return { eventId: ev.id, r1, r2, id };
}

async function asAdminOf(eventId: string) {
  jar.clear();
  await createSession(adminUser);
  await setActiveEvent(eventId);
}

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } })).id;
  adminUser = (
    await prisma.user.create({
      data: { email: `${TAG}-admin@example.invalid`, name: `${TAG} Admin`, password: "x:unusable", emailVerifiedAt: new Date() },
      select: { id: true },
    })
  ).id;
  built.gross = await build("gross");
  built.net = await build("net");
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/** What the Rules give each board: who is placed, in order, on which total. */
const BY_THE_RULES = {
  gross: [
    { who: "A" as Who, total: 149 },
    { who: "B" as Who, total: 154 },
  ],
  net: [
    { who: "B" as Who, total: 130 },
    { who: "A" as Who, total: 141 },
  ],
};

for (const basis of ["gross", "net"] as const) {
  describe(`a card with holes missing on a ${basis} stroke board`, () => {
    const rowsOf = async () => {
      const b = built[basis]!;
      const state = (await loadEventState(b.eventId))!;
      const who = (playerId: string) => (Object.keys(b.id) as Who[]).find((k) => b.id[k] === playerId)!;
      return { state, b, who, row: (w: Who) => state.strokeStandings.find((s) => s.player.id === b.id[w]) };
    };

    it("THE CONTROL: while Round 2 is open the short card is in play, and leads", async () => {
      // A live board reads "thru 30" and ranks it, as it always has. Without
      // this the cells below would pass on an app that unranked every card
      // that is merely still out on the course.
      const { row } = await rowsOf();
      const c = row("C")!;
      expect(c.ranked, "a card still in play lost its place before the round was closed").toBe(true);
      expect(c.thru).toBe(30);
      // 70 + 45 = 115 over holes of par 72 + 47 = 119.
      expect(c.gross).toBe(115);
      expect(c.toPar).toBe(-4);
      if (basis === "gross") expect(c.rank, "the fixture does not put the short card ahead of the winner").toBe(1);
    });

    it("the committee can close the round over it: asked first, then closed", async () => {
      const b = built[basis]!;
      await asAdminOf(b.eventId);
      const asked = await setRoundClosed(b.r2, true);
      expect(asked.ok).toBe(false);
      expect(asked.needsUnsignedConfirm, "the close was not asked about the card that is not approved").toBe(true);
      const closed = await setRoundClosed(b.r2, true, true);
      expect(closed).toEqual({ ok: true });
      expect((await prisma.stage.findUnique({ where: { id: b.r2 }, select: { closedAt: true } }))?.closedAt).not.toBeNull();
    });

    it("once the round is closed, the places are the two players who completed 36 holes, on their totals", async () => {
      const { state, who } = await rowsOf();
      const placed = state.strokeStandings
        .filter((s) => s.ranked)
        .sort((x, y) => x.rank - y.rank)
        .map((s) => ({ who: who(s.player.id), rank: s.rank, total: basis === "gross" ? s.gross : s.net }));
      expect(placed).toEqual(BY_THE_RULES[basis].map((r, i) => ({ who: r.who, rank: i + 1, total: r.total })));
    });

    it("the short card is still on the sheet, without a place, and the row says how many holes it holds", async () => {
      const { state, row } = await rowsOf();
      const c = row("C");
      expect(c, "the short card vanished from the board").toBeTruthy();
      expect(c!.ranked, "twelve holes of a closed Round 2 kept a place among cards of 36 (Rule 3.3c)").toBe(false);
      expect(c!.rank).toBe(0);
      // Not "didn't play Round 2": the player did play it, twelve holes of it.
      expect(c!.missedRound ?? "").toBe("");
      expect([c!.thru, c!.holesOwed]).toEqual([30, 36]);
      // Beneath everybody who holds a place.
      const order = state.strokeStandings.map((s) => s.ranked);
      expect(order.lastIndexOf(true), "a row without a place is listed above one with a place").toBeLessThan(order.indexOf(false));
    });

    it("and what was right stays right: no card is no place, and a withdrawal is WD over the figures returned", async () => {
      const { state, row, b } = await rowsOf();
      const d = row("D")!;
      expect([d.ranked, d.rank, d.missedRound]).toEqual([false, 0, "Round 2"]);
      expect(row("E"), "a withdrawn player is still in the field the cut and the draw read").toBeUndefined();
      const e = state.withdrawnStandings.find((s) => s.player.id === b.id.E)!;
      expect([e.ranked, e.rank, e.withdrew, e.gross]).toEqual([false, 0, true, 73]);
    });
  });
}
