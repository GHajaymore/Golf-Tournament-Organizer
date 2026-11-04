import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE STATE MACHINE'S ONE READER, AGAINST REAL ROWS (proposal 3 Nov, PR 1).
 *
 * `tournamentFactsFor` answers "has this round been played" ONCE — `hasResult`
 * — and section 2b says it is the widest of today's three spellings,
 * `roundsWithResults`. A value, not a spelling, so it is asserted on rows: a
 * draft stroke round with one card, a draft knockout whose only result is a
 * `BracketWinner` (D2 — the row `resultsIn` cannot see), and a live round robin
 * with one forfeit and one round nobody has touched.
 *
 * PR 2 (the audit the panel made mandatory, 8.4): `hasResult` and
 * `roundsWithResults` are now one function (`roundsWithResultsFrom`), so the
 * equality below holds the two CALLERS' inputs to each other; a knockout in two
 * flights with three qualifiers proves the facts' draws are the bracket
 * screen's, worked by hand from the cards; and the grouped read is held to the
 * single one, tournament by tournament.
 *
 * Throwaway club and events marked `zz-state-facts`, invented names,
 * `@example.invalid`, removed before and after. Development database only.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/tournament-facts.audit.test.ts
 */

vi.mock("@/lib/auth", () => ({ getSession: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { tournamentFactsFor, tournamentFactsForMany } = await import("@/lib/services/tournament-facts");
const { loadEventState } = await import("@/lib/services/tournament");
const { tournamentStatus, drawFacts } = await import("@/lib/domain/tournament-status");
const { bracketDraws } = await import("@/lib/domain/my-tie");

const prisma = new PrismaClient();
const TAG = "zz-state-facts";
const ids = { stroke: "", knockout: "", rr: "", split: "" };
/** The split's six, by seed: P1 … P6. */
const splitField: string[] = [];
const TODAY = "2026-11-03";

async function clean() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function eventWith(orgId: string, name: string, status: string) {
  const ev = await prisma.event.create({
    data: { name: `${TAG} ${name}`, organizationId: orgId, status, dates: "14 Nov 2026", startOn: "2026-11-14", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${name}` },
    select: { id: true },
  });
  return ev.id;
}

async function players(eventId: string, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = await prisma.player.create({
      data: { eventId, name: `Invented Player ${i + 1}`, email: `${TAG}-${eventId.slice(-6)}-${i + 1}@example.invalid`, seed: i + 1, status: "confirmed", handicap: 10 },
      select: { id: true },
    });
    out.push(p.id);
  }
  return out;
}

beforeAll(async () => {
  await clean();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });

  // A medal in draft with one card in.
  ids.stroke = await eventWith(org.id, "medal", "draft");
  const medal = await prisma.stage.create({ data: { eventId: ids.stroke, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 }, select: { id: true } });
  const [m1] = await players(ids.stroke, 3);
  await prisma.scorecard.create({ data: { eventId: ids.stroke, stageId: medal.id, playerId: m1, strokes: JSON.stringify([4, 5, 3]) } });

  // A knockout in draft whose only result is a slot in the draw (D2).
  ids.knockout = await eventWith(org.id, "knockout", "draft");
  await prisma.stage.create({ data: { eventId: ids.knockout, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 } });
  const [k1] = await players(ids.knockout, 4);
  await prisma.bracketWinner.create({ data: { eventId: ids.knockout, key: "winners-0-0", winnerId: k1, result: "3&2" } });

  // A live round robin: round 1 has a forfeit, round 2 a match nobody has touched.
  ids.rr = await eventWith(org.id, "round-robin", "live");
  const r1 = await prisma.stage.create({ data: { eventId: ids.rr, position: 0, type: "Round Robin", format: "Match Play", holes: 18 }, select: { id: true } });
  const r2 = await prisma.stage.create({ data: { eventId: ids.rr, position: 1, type: "Round Robin", format: "Match Play", holes: 18 }, select: { id: true } });
  const [a, b] = await players(ids.rr, 2);
  const flight = await prisma.group.create({ data: { eventId: ids.rr, name: "Flight 1", position: 0 }, select: { id: true } });
  await prisma.player.updateMany({ where: { id: { in: [a, b] } }, data: { groupId: flight.id } });
  await prisma.match.create({ data: { eventId: ids.rr, stageId: r1.id, groupId: flight.id, round: 1, playerAId: a, playerBId: b, holes: "[]", forfeitedBy: b } });
  await prisma.match.create({ data: { eventId: ids.rr, stageId: r2.id, groupId: flight.id, round: 2, playerAId: a, playerBId: b, holes: "[]" } });

  /**
   * A live knockout in TWO FLIGHTS (`split`) fed by a closed medal qualifier,
   * the top THREE through. The cards run opposite to the seeds — P1 shoots 77,
   * P6 shoots 72 — so a draw taken off seed order cannot pass for one taken off
   * the cards. Worked by hand: the qualifiers are P6 (72), P5 (73), P4 (74);
   * `split` puts the top half, rounded up, in Flight A — P6 v P5, a final on
   * its own — and P4 alone in Flight B, a draw of ONE with no tie in it.
   * P6 wins Flight A's final.
   */
  ids.split = (
    await prisma.event.create({
      data: {
        name: `${TAG} split`,
        organizationId: org.id,
        status: "live",
        format: "stroke",
        dates: "14 Nov 2026",
        startOn: "2026-11-14",
        course: "Invented Links",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-split`,
        qualifyMode: "overall",
        qualifyOverall: 3,
        bracketMode: "split",
        customPars: JSON.stringify(Array(18).fill(4)),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
      select: { id: true },
    })
  ).id;
  const qualifier = await prisma.stage.create({
    data: { eventId: ids.split, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross", closedAt: new Date() },
    select: { id: true },
  });
  await prisma.stage.create({ data: { eventId: ids.split, position: 1, type: "Bracket Stage", format: "Match Play", holes: 18 } });
  splitField.push(...(await players(ids.split, 6)));
  for (const [i, id] of splitField.entries()) {
    const over = 5 - i; // P1 77 … P6 72
    await prisma.scorecard.create({
      data: { eventId: ids.split, stageId: qualifier.id, playerId: id, strokes: JSON.stringify(Array.from({ length: 18 }, (_, h) => 4 + (h < over ? 1 : 0))), status: "approved" },
    });
  }
  await prisma.bracketWinner.create({ data: { eventId: ids.split, key: "winners-0-0", winnerId: splitField[5], result: "2&1" } });
}, 120_000);

afterAll(async () => {
  try {
    await clean();
  } finally {
    await prisma.$disconnect();
  }
});

describe("tournamentFactsFor, on real rows", () => {
  it("THE CONTROL: the fixtures are what they say — one card, one slot, one forfeit, nothing else", async () => {
    expect(await prisma.scorecard.count({ where: { eventId: ids.stroke } })).toBe(1);
    expect(await prisma.scorecard.count({ where: { eventId: ids.knockout } })).toBe(0);
    expect(await prisma.match.count({ where: { eventId: ids.knockout } })).toBe(0);
    expect(await prisma.bracketWinner.count({ where: { eventId: ids.knockout } })).toBe(1);
  });

  for (const which of ["stroke", "knockout", "rr", "split"] as const) {
    it(`${which}: hasResult is exactly roundsWithResults`, async () => {
      const facts = await tournamentFactsFor(ids[which], TODAY);
      const state = await loadEventState(ids[which]);
      expect(facts).not.toBeNull();
      const mine = new Set(facts!.rounds.filter((r) => r.hasResult).map((r) => r.id));
      expect([...mine].sort()).toEqual([...state!.roundsWithResults].sort());
      expect(mine.size, "a fixture with no result proves nothing").toBeGreaterThan(0);
      expect(facts!.today).toBe(TODAY);
      expect(facts!.confirmed).toBe(state!.confirmed.length);
    });
  }

  it("D2 on real rows: resultsIn reads the knockout as unplayed; the machine reads it under way", async () => {
    const state = await loadEventState(ids.knockout);
    expect(state!.resultsIn, "today's count of results misses the BracketWinner").toBe(0);
    const st = tournamentStatus((await tournamentFactsFor(ids.knockout, TODAY))!);
    expect(st.family).toBe("knockout");
    expect(st.underWayUnlaunched).toBe(true);
    expect(st.journey).toBe("play");
    expect(st.refusals.play).toBeNull();
  });

  it("the round robin: round 1 played by forfeit, round 2 not started, and the review queue read while live", async () => {
    const facts = (await tournamentFactsFor(ids.rr, TODAY))!;
    expect(facts.rounds.map((r) => [r.label, r.hasResult, r.matches, r.matchesOver])).toEqual([
      ["Round 1", true, 1, 1],
      ["Round 2", false, 1, 0],
    ]);
    const state = await loadEventState(ids.rr);
    expect(facts.review).toEqual({ pendingConfirmations: state!.pendingConfirmations, disputed: state!.reviewing.disputed });
    const st = tournamentStatus(facts);
    expect(st.step).toBe("live");
    expect(st.rounds.map((r) => r.state)).toEqual(["under-way", "not-started"]);
  });

  it("an event that does not exist reads as null", async () => {
    expect(await tournamentFactsFor("zz-state-facts-no-such-event", TODAY)).toBeNull();
  });
});

describe("a knockout in two flights, three qualifiers (PR 2)", () => {
  it("the facts' draws are the ones worked by hand from the cards — Flight A of two, decided; Flight B of one", async () => {
    const facts = (await tournamentFactsFor(ids.split, TODAY))!;
    expect(facts.knockout!.draws).toEqual([
      { label: "Flight A", entrants: 2, finalDecided: true },
      { label: "Flight B", entrants: 1, finalDecided: false },
    ]);
    expect(facts.knockout!.thirdPlace).toEqual({ on: false, decided: false });
  });

  it("and they agree with the bracket screen's own draws (`bracketDraws(state.brackets)`), who is in each included", async () => {
    const state = (await loadEventState(ids.split))!;
    const screen = bracketDraws(state.brackets);
    expect(screen.map(drawFacts)).toEqual((await tournamentFactsFor(ids.split, TODAY))!.knockout!.draws);
    const inDraw = (i: number) =>
      [...new Set(screen[i].view.rounds.flatMap((r) => r.matches.flatMap((m) => [m.a.playerId, m.b.playerId])).filter(Boolean))].sort();
    // P6 and P5 in Flight A, P4 alone in Flight B — the cards' order, not the seeds'.
    expect(inDraw(0)).toEqual([splitField[4], splitField[5]].sort());
    expect(inDraw(1)).toEqual([splitField[3]]);
  });

  it("so play is over: a draw of one is never waited on, and the chip says which fact ended it", async () => {
    const st = tournamentStatus((await tournamentFactsFor(ids.split, TODAY))!);
    expect(st.family).toBe("knockout");
    expect(st.step).toBe("play-over");
    expect(st.chipDetail).toBe("Final decided · results not released");
    expect(st.nextAction!.kind).toBe("complete");
  });
});

describe("the grouped read (PR 2): a club's tournaments in one batch", () => {
  it("answers each tournament exactly as it is answered alone, and leaves out one that does not exist", async () => {
    const all = [ids.stroke, ids.knockout, ids.rr, ids.split];
    const many = await tournamentFactsForMany([...all, "zz-state-facts-no-such-event", ids.rr], TODAY);
    expect([...many.keys()].sort()).toEqual([...all].sort());
    for (const id of all) expect(many.get(id), id).toEqual(await tournamentFactsFor(id, TODAY));
    // THE CONTROL: the four are not alike, so a batch that handed one tournament's rows to another would show.
    const shapes = all.map((id) => JSON.stringify(many.get(id)!.rounds.map((r) => [r.type, r.hasResult, r.matches])));
    expect(new Set(shapes).size).toBe(4);
  });

  it("an empty list is an empty answer", async () => {
    expect((await tournamentFactsForMany([], TODAY)).size).toBe(0);
  });
});
