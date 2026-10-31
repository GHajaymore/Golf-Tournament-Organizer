import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";

/**
 * WHICH ROUNDS HAVE BEEN STARTED — FROM ALL THREE PLACES A RESULT CAN LIVE.
 *
 * `roundStanding` is the rule and is asserted on its own. This is the other
 * half, and it is the half that has now been wrong twice tonight: a correct
 * rule proves nothing about whether the thing feeding it tells the truth.
 *
 * A round's result lives in whichever table its format writes:
 *
 *   medal round      Scorecard rows
 *   match round      Match.holes
 *   knockout         BracketWinner, keyed by SLOT ("winners-0-1") and not by
 *                    stage at all — so a bracket with every semi-final
 *                    recorded holds no Match row and no card
 *
 * The first draft read the first two. Demo Cup's Round 4 then stayed
 * "Upcoming" on a bracket whose final already had two names in it, which is
 * how a rule fixed for one round type goes on being wrong for another.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-STARTED";
let orgId = "";

const flat = (n: number) => JSON.stringify(new Array(18).fill(n));

async function seed() {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${Date.now()}`,
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      status: "live", shape: "series", format: "stroke", formationRule: "balanced",
      shareToken: `audit-started-${Date.now()}-${Math.random()}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  const eventId = event.id;
  const mk = (position: number, type: string, format: string) =>
    prisma.stage.create({
      data: { eventId, position, type, format, holes: 18, scoringBasis: "gross", handicapAllowance: 100 },
    });
  // One of each kind, in the order a real tournament sequences them.
  const rr = await mk(0, "Round Robin", "Match Play");
  const medal = await mk(1, "Stroke Play Round", "Stroke Play");
  const untouched = await mk(2, "Stroke Play Round", "Stroke Play");
  const bracket = await mk(3, "Bracket Stage", "Match Play");

  const flight = (await prisma.group.create({ data: { eventId, name: "A", position: 0 } })).id;
  const players = await Promise.all(
    ["ANN", "BOB"].map((label, i) =>
      prisma.player.create({
        data: {
          eventId, name: `${TAG} ${label}`,
          email: `${TAG.toLowerCase()}-${label}-${Date.now()}-${Math.random()}@example.invalid`,
          handicap: 0, seed: i + 1, status: "confirmed", groupId: flight,
        },
      }),
    ),
  );

  return { eventId, rr, medal, untouched, bracket, players, flight };
}

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  orgId = (await prisma.organization.create({ data: { name: `${TAG} org`, kind: "club" } })).id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("a round counts as started when", () => {
  it("nothing has happened at all — the control", async () => {
    /**
     * Run FIRST and asserted as empty, because every expectation below is "this
     * id is in the set" and a set that was somehow full would satisfy all of
     * them. This is what makes the rest of the file mean something.
     */
    const { eventId } = await seed();
    const state = await loadEventState(eventId);
    expect([...state!.roundsWithResults]).toEqual([]);
  });

  it("a medal round has one card", async () => {
    const { eventId, medal, untouched, players } = await seed();
    await prisma.scorecard.create({
      data: { eventId, stageId: medal.id, playerId: players[0].id, strokes: flat(4) },
    });
    const state = await loadEventState(eventId);
    expect(state!.roundsWithResults.has(medal.id)).toBe(true);
    expect(state!.roundsWithResults.has(untouched.id), "a round nobody has touched").toBe(false);
  });

  // A SIDE'S CARD (2026-10-31): a scramble or best ball files a `TeamScorecard`, the fourth table
  // a round's result can live in, and this set was built without it — a played scramble read as
  // never played. The fixture had no team round, so no case here could reach it.
  it("a scramble round has one side's card, which lives in neither of the individual tables", async () => {
    const { eventId, untouched } = await seed();
    const scramble = await prisma.stage.create({
      data: { eventId, position: 4, type: "Stroke Play Round", format: "Scramble", holes: 18 },
    });
    const side = await prisma.team.create({ data: { eventId, stageId: scramble.id, name: "Side A" } });
    await prisma.teamScorecard.create({
      data: { eventId, stageId: scramble.id, teamId: side.id, strokes: JSON.stringify([4, ...new Array(17).fill(0)]) },
    });
    const state = await loadEventState(eventId);
    expect(state!.roundsWithResults.has(scramble.id), "a scramble with a side's card read as never played").toBe(true);
    expect(state!.roundsWithResults.has(untouched.id), "a round nobody has touched").toBe(false);
  });

  it("a match round has one hole on it", async () => {
    // One hole is the line `playRefusal` draws for "has anybody been out on
    // the course", and it is the right line here: this is not "is it finished".
    const { eventId, rr, untouched, players, flight } = await seed();
    await prisma.match.create({
      data: {
        eventId, stageId: rr.id, groupId: flight, round: 1,
        playerAId: players[0].id, playerBId: players[1].id,
        holes: JSON.stringify(["A", ...new Array(17).fill(null)]),
      },
    });
    const state = await loadEventState(eventId);
    expect(state!.roundsWithResults.has(rr.id)).toBe(true);
    expect(state!.roundsWithResults.has(untouched.id)).toBe(false);
  });

  it("a match round has been conceded rather than played", async () => {
    // A forfeit is a result with no holes on it — the card stays empty.
    const { eventId, rr, players, flight } = await seed();
    await prisma.match.create({
      data: {
        eventId, stageId: rr.id, groupId: flight, round: 1,
        playerAId: players[0].id, playerBId: players[1].id,
        holes: JSON.stringify(new Array(18).fill(null)),
        forfeitedBy: players[1].id,
      },
    });
    const state = await loadEventState(eventId);
    expect(state!.roundsWithResults.has(rr.id)).toBe(true);
  });

  it("a match round is drawn but nobody has teed off", async () => {
    // THE CONTROL for the two above: a fixture existing is not a result, or
    // every round would read as started the moment the draw was published.
    const { eventId, rr, players, flight } = await seed();
    await prisma.match.create({
      data: {
        eventId, stageId: rr.id, groupId: flight, round: 1,
        playerAId: players[0].id, playerBId: players[1].id,
        holes: JSON.stringify(new Array(18).fill(null)),
      },
    });
    const state = await loadEventState(eventId);
    expect(state!.roundsWithResults.has(rr.id), "a published draw is not a result").toBe(false);
  });

  it("a knockout has a winner recorded, which lives in neither other table", async () => {
    const { eventId, bracket, untouched, players } = await seed();
    await prisma.bracketWinner.create({
      data: { eventId, key: "winners-0-0", winnerId: players[0].id, result: "3&2" },
    });
    const state = await loadEventState(eventId);
    expect(state!.roundsWithResults.has(bracket.id), "a bracket keeps its record off the stage").toBe(true);
    expect(
      state!.roundsWithResults.has(untouched.id),
      "and it must not spill onto a round that is not a knockout",
    ).toBe(false);
  });
});
