import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";
import { serializeBracketDraw } from "../domain/bracket";

/**
 * A real staff session, so `setBracketWinner` can be driven as the organizer
 * drives it. The freeze happens inside that action and nowhere else, so a test
 * that wrote `bracketDraw` itself would be asserting its own arithmetic.
 */
let session: { eventId: string; email: string; viewRole: string; name: string; role: string } | null =
  null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { setBracketWinner } = await import("@/app/actions/tournament");

/**
 * A draw is an event, not a query.
 *
 * The knockout was seeded from LIVE standings on every page load, so the draw
 * was never something that had happened — it was recomputed from whatever the
 * standings said at that moment. Correct right up until the first knockout
 * match is played, and destructive one moment later: a withdrawal, or a
 * round-robin score corrected after the quarter-finals, reshuffled every
 * pairing beneath the results already recorded.
 *
 * Needs a live DATABASE_URL:
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-BRACKET-DRAW";
const A_WINS = JSON.stringify(new Array(18).fill("A"));

let orgId = "";

async function seedKnockout() {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${Date.now()}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "draft",
      shape: "series",
      formationRule: "balanced",
      shareToken: `audit-draw-${Date.now()}-${Math.random()}`,
      qualifyMode: "overall",
      qualifyOverall: 4,
      bracketMode: "single",
    },
  });
  const eventId = event.id;
  const rr = await prisma.stage.create({
    data: { eventId, position: 0, type: "Round Robin", format: "Match Play", holes: 18 },
  });
  await prisma.stage.create({
    data: { eventId, position: 1, type: "Bracket Stage", format: "Match Play", holes: 18 },
  });
  const flight = (await prisma.group.create({ data: { eventId, name: "A", position: 0 } })).id;

  // Five players for four places, so there is a bubble to move.
  const ids: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} P${i + 1}`,
        email: `${TAG.toLowerCase()}-${i}-${Date.now()}-${Math.random()}@example.invalid`,
        handicap: 5 + i,
        seed: i + 1,
        status: "confirmed",
        groupId: flight,
      },
    });
    ids.push(p.id);
  }

  // P1..P4 each win one match; P5 loses one and is the odd one out.
  const play = async (aId: string, bId: string, round: number) => {
    await prisma.match.create({
      data: { eventId, stageId: rr.id, groupId: flight, round, playerAId: aId, playerBId: bId, holes: A_WINS },
    });
  };
  await play(ids[0], ids[4], 1);
  await play(ids[1], ids[4], 2);
  await play(ids[2], ids[4], 3);
  await play(ids[3], ids[4], 4);

  session = {
    eventId,
    email: `${TAG.toLowerCase()}-staff@example.invalid`,
    viewRole: "admin",
    name: `${TAG} staff`,
    role: "admin",
  };

  return { eventId, rr: rr.id, flight, ids };
}

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  const org = await prisma.organization.create({ data: { name: `${TAG} org`, kind: "club" } });
  orgId = org.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("a knockout draw survives what happens to the qualifying afterwards", () => {
  it("keeps the pairings, and the played result, when a score is corrected", async () => {
    const { eventId, rr, flight, ids } = await seedKnockout();

    const before = await loadEventState(eventId);
    const drawn = before!.qualifiers.map((p) => p.id);
    expect(drawn).toHaveLength(4);
    expect(drawn).not.toContain(ids[4]); // P5 missed out

    // The organizer records the first quarter-final, which is the moment the
    // draw stops being a query. Written the way the action writes it.
    const firstMatch = before!.brackets.winners.rounds[0].matches[0];
    const recorded = firstMatch.a.playerId!;
    await prisma.event.update({
      where: { id: eventId },
      data: { bracketDraw: serializeBracketDraw(drawn) },
    });
    await prisma.bracketWinner.create({
      data: { eventId, key: firstMatch.key, winnerId: recorded },
    });

    /**
     * Now the qualifying changes underneath it — the ordinary case, not an
     * exotic one. A result was entered against the wrong player and is put
     * right; P5 wins three matches and would now qualify comfortably, and one
     * of the original four would drop out.
     */
    for (let round = 5; round <= 7; round += 1) {
      await prisma.match.create({
        data: {
          eventId,
          stageId: rr,
          groupId: flight,
          round,
          playerAId: ids[4], // P5 now wins
          playerBId: ids[round - 5],
          holes: A_WINS,
        },
      });
    }

    const after = await loadEventState(eventId);

    // Same four players, in the same order. The draw is the draw.
    expect(after!.qualifiers.map((p) => p.id)).toEqual(drawn);
    expect(after!.qualifiers.map((p) => p.id)).not.toContain(ids[4]);

    // And the quarter-final that was played still reads as played, in the same
    // slot, with the same winner. This is the half that made the bug
    // unrecoverable: the result did not merely display wrong, it vanished
    // along with the match it belonged to, so it could not be entered again.
    const sameMatch = after!.brackets.winners.rounds[0].matches[0];
    expect(sameMatch.key).toBe(firstMatch.key);
    expect(sameMatch.a.playerId).toBe(firstMatch.a.playerId);
    expect(sameMatch.b.playerId).toBe(firstMatch.b.playerId);
    expect(sameMatch.winnerId).toBe(recorded);
  });

  it("keeps a player who withdraws after the draw in their slot", async () => {
    /**
     * A withdrawal removes a player from `confirmed`, and the qualifier set is
     * built from confirmed players — so a withdrawal used to pull somebody out
     * of the bracket entirely and pull the next player up into their slot,
     * mid-round. The Rules expect the opponent to advance by walkover from a
     * draw that still names both players, which is also what the sheet pinned
     * to the noticeboard says.
     */
    const { eventId, ids } = await seedKnockout();
    const before = await loadEventState(eventId);
    const drawn = before!.qualifiers.map((p) => p.id);
    await prisma.event.update({
      where: { id: eventId },
      data: { bracketDraw: serializeBracketDraw(drawn) },
    });

    await prisma.player.update({ where: { id: drawn[1] }, data: { status: "withdrawn" } });

    const after = await loadEventState(eventId);
    expect(after!.qualifiers.map((p) => p.id)).toEqual(drawn);
    // Named, not blank — an opponent needs somebody to be given the walkover
    // against.
    const stillNamed = after!.qualifiers.find((p) => p.id === drawn[1]);
    expect(stillNamed?.name).toContain(TAG);
    expect(after!.qualifiers.map((p) => p.id)).not.toContain(ids[4]);
  });

  it("re-seeds freely while the bracket has not started", async () => {
    /**
     * The other half of the rule, and the reason this is not simply "freeze the
     * bracket". Before anybody has played, a late entry or a corrected score
     * SHOULD change who is in the knockout — freezing at creation would lock in
     * a draw made from an empty round robin, which is fault D7 wearing a
     * different hat.
     */
    const { eventId, rr, flight, ids } = await seedKnockout();
    const before = await loadEventState(eventId);
    expect(before!.qualifiers.map((p) => p.id)).not.toContain(ids[4]);

    // No draw stored, because no result has been recorded.
    const row = await prisma.event.findUnique({
      where: { id: eventId },
      select: { bracketDraw: true },
    });
    expect(row!.bracketDraw).toBe("");

    for (let round = 5; round <= 7; round += 1) {
      await prisma.match.create({
        data: {
          eventId,
          stageId: rr,
          groupId: flight,
          round,
          playerAId: ids[4],
          playerBId: ids[round - 5],
          holes: A_WINS,
        },
      });
    }

    const after = await loadEventState(eventId);
    expect(after!.qualifiers.map((p) => p.id)).toContain(ids[4]);
  });
});

/**
 * Who writes the draw down, and when.
 *
 * Driven through the real action rather than by writing the column, because
 * the decision — first result freezes, last removal re-opens — lives there and
 * nowhere else.
 */
describe("the draw is written by the first result and released by the last", () => {
  const drawOf = async (eventId: string) =>
    (await prisma.event.findUnique({ where: { id: eventId }, select: { bracketDraw: true } }))!
      .bracketDraw;

  it("records the draw the organizer was looking at, on the first result", async () => {
    const { eventId } = await seedKnockout();
    const state = await loadEventState(eventId);
    const expected = state!.qualifiers.map((p) => p.id);
    const first = state!.brackets.winners.rounds[0].matches[0];

    expect(await drawOf(eventId)).toBe("");

    await setBracketWinner(first.key, first.a.playerId!);

    expect(await drawOf(eventId)).toBe(serializeBracketDraw(expected));
  });

  it("does not move the draw when a later result is recorded", async () => {
    // Only the FIRST result freezes it. A second write that re-froze would
    // re-seed from whatever the standings had become in between, which is the
    // original bug with an extra step.
    const { eventId, rr, flight, ids } = await seedKnockout();
    const state = await loadEventState(eventId);
    const first = state!.brackets.winners.rounds[0].matches[0];
    const second = state!.brackets.winners.rounds[0].matches[1];
    await setBracketWinner(first.key, first.a.playerId!);
    const frozen = await drawOf(eventId);

    // Standings change, then another quarter-final goes in.
    for (let round = 5; round <= 7; round += 1) {
      await prisma.match.create({
        data: { eventId, stageId: rr, groupId: flight, round, playerAId: ids[4], playerBId: ids[round - 5], holes: A_WINS },
      });
    }
    await setBracketWinner(second.key, second.a.playerId!);

    expect(await drawOf(eventId)).toBe(frozen);
  });

  it("does not shorten the draw when a drawn player is deleted outright", async () => {
    /**
     * Why the write is guarded on there being no result yet, rather than left
     * to be idempotent.
     *
     * Re-freezing normally rewrites the identical string, because the frozen
     * draw is what `loadEventState` now reads back — a withdrawal included,
     * since the lookup covers the whole field. A player REMOVED from the
     * event is the exception: there is no row to find, so they drop out of
     * the round trip. An unguarded re-freeze would then write a draw one
     * player shorter, and that slot would be gone for good, taking the
     * pairings after it along with it.
     */
    const { eventId } = await seedKnockout();
    const state = await loadEventState(eventId);
    const first = state!.brackets.winners.rounds[0].matches[0];
    const second = state!.brackets.winners.rounds[0].matches[1];

    await setBracketWinner(first.key, first.a.playerId!);
    const frozen = await drawOf(eventId);
    expect(JSON.parse(frozen)).toHaveLength(4);

    // An organizer removes a signup that is already in the draw.
    await prisma.player.delete({ where: { id: second.b.playerId! } });
    await setBracketWinner(second.key, second.a.playerId!);

    expect(await drawOf(eventId)).toBe(frozen);
    expect(JSON.parse(await drawOf(eventId))).toHaveLength(4);
  });

  it("releases the draw when the last result is taken back", async () => {
    /**
     * Otherwise the freeze is a one-way door: an organizer who records a
     * result by mistake, undoes it, and then fixes the qualifying scores would
     * be stuck with a bracket seeded from standings they have since corrected,
     * with nothing in the UI to say so. A bracket with no results has not
     * started, so there is no draw to protect.
     */
    const { eventId } = await seedKnockout();
    const state = await loadEventState(eventId);
    const first = state!.brackets.winners.rounds[0].matches[0];

    await setBracketWinner(first.key, first.a.playerId!);
    expect(await drawOf(eventId)).not.toBe("");

    // Clicking the same slot again is how the UI clears a result.
    await setBracketWinner(first.key, first.a.playerId!);

    expect(await drawOf(eventId)).toBe("");
    expect(await prisma.bracketWinner.count({ where: { eventId } })).toBe(0);
  });

  it("holds the draw while any other result still stands", async () => {
    const { eventId } = await seedKnockout();
    const state = await loadEventState(eventId);
    const first = state!.brackets.winners.rounds[0].matches[0];
    const second = state!.brackets.winners.rounds[0].matches[1];

    await setBracketWinner(first.key, first.a.playerId!);
    await setBracketWinner(second.key, second.a.playerId!);
    const frozen = await drawOf(eventId);

    await setBracketWinner(first.key, first.a.playerId!); // take one back

    expect(await drawOf(eventId)).toBe(frozen);
  });
});
