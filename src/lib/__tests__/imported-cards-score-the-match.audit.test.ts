import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A FILE OF CARDS IMPORTED INTO A MATCH-PLAY ROUND SCORES ITS MATCHES
 * (sweep 1, b14, 2026-10-10).
 *
 * Score import offered "Strokes" for a Match Play round. It took the file,
 * reported every row written, and filed the cards in `Scorecard` — the table a
 * STROKE round files in. A match reads its cards off the fixture
 * (`MatchScorecard`), so no match saw them: a league secretary imported the
 * night's cards, was told sixteen had been written, and every match on the
 * board still read "not played".
 *
 * (CLAUDE.md, testing point 8: "ask which table this round files its result
 * in, before believing any count". This is that, on the way in.)
 *
 * The cards are now filed on the fixture and the match derived from them by
 * the same code a typed card goes through. So the rule pinned here is
 * agreement between the two doors, on the same pair of cards — and by value,
 * against holes worked out by hand.
 *
 * And the shapes a round is offered are the ones it can use: a Nassau is
 * offered who-won-each-hole, which it was not; a file of NET cards is not
 * offered to a match round, because converting net to gross is done per round
 * and a match can be played off its own tees.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-IMPORTMATCH";
const EMAIL = `${TAG}.sec@example.invalid`.toLowerCase();
const session = { email: EMAIL, name: `${TAG} secretary`, eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { importScores, saveMatchScorecard } = await import("@/app/actions/tournament");
const { importShapesFor } = await import("@/lib/domain/score-import");

let orgId = "";
let made = 0;

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } })).id;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

/** Ann: fours throughout. Bea: a five on the 1st, 2nd and 3rd, a three on the 4th, fours after. */
const ANN = new Array(18).fill(4);
const BEA = [5, 5, 5, 3, ...new Array(14).fill(4)];
/** Gross, by hand: Ann wins 1 to 3, Bea wins the 4th, the rest are halved. Ann is 2 up after 18. */
const BY_HAND = ["A", "A", "A", "B", ...new Array(14).fill("H")];

/** A gross match-play night: Ann v Bea, and Cat v Dee, each with one match in the round. */
async function night(name: string) {
  made += 1;
  const event = await prisma.event.create({
    data: {
      organizationId: orgId, name: `${TAG} ${name}`, dates: "", course: "Home", city: "", address: "", regDeadline: "",
      shareToken: `${TAG}-${name}-${process.pid}-${made}`, format: "match", status: "live", scoreEntryBy: "staff",
      customPars: JSON.stringify(new Array(18).fill(4)), customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  session.eventId = event.id;
  await prisma.account.create({ data: { eventId: event.id, email: EMAIL, name: `${TAG} secretary`, role: "admin" } });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Round Robin", format: "Match Play", holes: 18, scoringBasis: "gross", scoreInput: "gross-cards" },
  });
  const group = await prisma.group.create({ data: { eventId: event.id, name: "A", position: 0 } });
  const ids: Record<string, string> = {};
  for (const [i, who] of ["ann", "bea", "cat", "dee"].entries()) {
    ids[who] = (
      await prisma.player.create({ data: { eventId: event.id, groupId: group.id, name: `${TAG} ${who}`, email: "", handicap: 0, seed: i + 1, status: "confirmed" } })
    ).id;
  }
  const blank = JSON.stringify(new Array(18).fill(null));
  const match = (a: string, b: string, round: number) =>
    prisma.match.create({ data: { eventId: event.id, stageId: stage.id, groupId: group.id, round, playerAId: ids[a], playerBId: ids[b], holes: blank } });
  const first = await match("ann", "bea", 1);
  const second = await match("cat", "dee", 1);
  return { eventId: event.id, stageId: stage.id, ids, first, second };
}

const holesOf = async (matchId: string) => JSON.parse((await prisma.match.findUniqueOrThrow({ where: { id: matchId } })).holes) as (string | null)[];

describe("a file of cards on a match-play night", () => {
  it("scores the match — who won each hole, worked out by hand", async () => {
    const n = await night("file");
    const res = await importScores(n.stageId, "strokes", [
      { playerId: n.ids.ann, strokes: ANN },
      { playerId: n.ids.bea, strokes: BEA },
    ]);
    expect(res.ok, res.error ?? (res.problems ?? []).join(" | ")).toBe(true);
    expect(res.written).toBe(2);
    expect(await holesOf(n.first.id), "sixteen cards written and the match still not played").toEqual(BY_HAND);
  });

  it("gives the same result as typing the same two cards", async () => {
    const typed = await night("typed");
    await saveMatchScorecard(typed.first.id, "A", ANN);
    await saveMatchScorecard(typed.first.id, "B", BEA);
    const filed = await night("filed");
    await importScores(filed.stageId, "strokes", [
      { playerId: filed.ids.ann, strokes: ANN },
      { playerId: filed.ids.bea, strokes: BEA },
    ]);
    expect(await holesOf(typed.first.id), "CONTROL: typing the cards scores the match").toEqual(BY_HAND);
    expect(await holesOf(filed.first.id)).toEqual(await holesOf(typed.first.id));
  });

  it("files the cards on the fixture, not in the stroke round's table", async () => {
    const n = await night("table");
    await importScores(n.stageId, "strokes", [
      { playerId: n.ids.ann, strokes: ANN },
      { playerId: n.ids.bea, strokes: BEA },
    ]);
    expect(await prisma.matchScorecard.count({ where: { matchId: n.first.id } })).toBe(2);
    expect(await prisma.scorecard.count({ where: { stageId: n.stageId } }), "cards filed where no match reads them").toBe(0);
  });

  it("leaves a match alone when only one of its cards is in the file — and says nothing is wrong", async () => {
    const n = await night("half");
    const res = await importScores(n.stageId, "strokes", [{ playerId: n.ids.cat, strokes: ANN }]);
    expect(res.ok).toBe(true);
    // One card decides no hole: every hole needs both.
    expect((await holesOf(n.second.id)).every((h) => h === null)).toBe(true);
  });

  it("names a player the round has not drawn in a match, instead of writing a card nobody reads", async () => {
    const n = await night("undrawn");
    const stranger = await prisma.player.create({ data: { eventId: n.eventId, name: `${TAG} eve`, email: "", handicap: 0, seed: 9, status: "confirmed" } });
    const res = await importScores(n.stageId, "strokes", [{ playerId: stranger.id, strokes: ANN }]);
    expect(res.written).toBe(0);
    expect((res.problems ?? []).join(" ")).toMatch(/isn.t drawn in a match/);
  });

  it("refuses a card for somebody with two matches in the round, since a file cannot say which", async () => {
    const n = await night("two");
    await prisma.match.create({
      data: { eventId: n.eventId, stageId: n.stageId, groupId: n.first.groupId, round: 2, playerAId: n.ids.ann, playerBId: n.ids.cat, holes: JSON.stringify(new Array(18).fill(null)) },
    });
    const res = await importScores(n.stageId, "strokes", [{ playerId: n.ids.ann, strokes: ANN }]);
    expect(res.written).toBe(0);
    expect((res.problems ?? []).join(" ")).toMatch(/more than one match/);
  });
});

describe("the shapes a round is offered are the ones it can use", () => {
  it("match play: who won each hole, results, and gross cards", () => {
    expect(importShapesFor("Match Play")).toEqual(["hole-results", "match-results", "strokes"]);
  });

  it("a Nassau: who won each hole and gross cards — never a bare result, which says nothing about the front nine", () => {
    expect(importShapesFor("Nassau")).toEqual(["hole-results", "strokes"]);
  });

  it("CONTROL: a stroke round is still offered gross and net cards and nothing else", () => {
    for (const f of ["Stroke Play", "Stableford", "Modified Stableford", "Skins"]) expect(importShapesFor(f), f).toEqual(["strokes", "net-strokes"]);
  });

  it("and the server refuses a shape the round was not offered", async () => {
    const n = await night("refused");
    const res = await importScores(n.stageId, "net-strokes", [{ playerId: n.ids.ann, strokes: ANN }]);
    expect(res.ok).toBe(false);
    expect(await prisma.matchScorecard.count({ where: { matchId: n.first.id } })).toBe(0);
    expect(await prisma.scorecard.count({ where: { stageId: n.stageId } })).toBe(0);
  });
});
