import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { meFor } from "@/lib/services/me";
import { loadEventState, standingRows } from "@/lib/services/tournament";

/**
 * What a player is told about their own position, against what every other
 * screen says.
 *
 * Both faults here are `/me` disagreeing with the board beside it, which is
 * this codebase's oldest bug shape — and the player's screen is the one that
 * gets quoted in the bar.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ME-POSITION";

let orgId = "";

/**
 * `format` is the ROUND's; `eventFormat` is the tournament's, and it is what
 * decides which board `standingRows` builds. They have to agree or the fixture
 * tests the wrong branch — a "Stroke Play" round inside a match-play event
 * takes the match branch and reports every player as having played nothing.
 */
async function seedEvent(format: string, eventFormat: "stroke" | "match") {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      format: eventFormat,
      name: `${TAG} ${format} ${Date.now()}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "active",
      shape: "series",
      formationRule: "balanced",
      shareToken: `audit-me-${Date.now()}-${Math.random()}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Round Robin", format, holes: 18 },
  });
  const group = await prisma.group.create({
    data: { eventId: event.id, name: "A", position: 0 },
  });
  const mk = async (label: string, seed: number) => {
    const email = `${TAG.toLowerCase()}-${label}-${Date.now()}-${Math.random()}@example.invalid`;
    const p = await prisma.player.create({
      data: {
        eventId: event.id,
        name: `${TAG} ${label}`,
        email,
        handicap: 8,
        seed,
        status: "confirmed",
        groupId: group.id,
      },
    });
    return { id: p.id, email };
  };
  return { eventId: event.id, stageId: stage.id, groupId: group.id, mk };
}

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

/**
 * A match-play round keeps its results on the matches, so `thru` — holes on a
 * returned CARD — is zero for everybody in one. `/me` read that as "has not
 * started", so a player 3-0-0 and top of their flight was shown "Not started"
 * and a position of "–" while the console and their own Board tab had them
 * first.
 */
describe("a match-play player who is winning their flight", () => {
  it("is told the position the board is showing", async () => {
    const { eventId, stageId, groupId, mk } = await seedEvent("Match Play", "match");
    const winner = await mk("WINNER", 1);
    const a = await mk("A", 2);
    const b = await mk("B", 3);

    // Three wins, nothing conceded: a real 3-0-0 record.
    const allA = JSON.stringify(new Array(18).fill("A"));
    let round = 1;
    for (const opponent of [a, b]) {
      await prisma.match.create({
        data: {
          eventId,
          stageId,
          groupId,
          round: round++,
          playerAId: winner.id,
          playerBId: opponent.id,
          holes: allA,
        },
      });
    }
    await prisma.match.create({
      data: { eventId, stageId, groupId, round: round++, playerAId: a.id, playerBId: b.id, holes: allA },
    });

    const state = await loadEventState(eventId);
    const board = standingRows(state!);
    const boardRow = board.find((r) => r.id === winner.id)!;

    // The board has them first — the fixture has to earn that, or the
    // assertion below passes for a player who is not actually winning.
    expect(boardRow.rank).toBe(1);
    expect(boardRow.thru).toBe(0); // no card exists; this is the whole trap

    const me = await meFor((await loadEventState(eventId))!, winner.email);

    expect(me?.standing).not.toBeNull();
    expect(me!.standing!.rank).toBe(1);
    // The number the player reads. It was "".
    expect(me!.standing!.position).toBe("1");
  });

  it("still says nothing to a player who has played no matches", async () => {
    const { eventId, stageId, groupId, mk } = await seedEvent("Match Play", "match");
    const played = await mk("PLAYED", 1);
    const other = await mk("OTHER", 2);
    const absent = await mk("ABSENT", 3);
    await prisma.match.create({
      data: {
        eventId,
        stageId,
        groupId,
        round: 1,
        playerAId: played.id,
        playerBId: other.id,
        holes: JSON.stringify(new Array(18).fill("A")),
      },
    });

    const me = await meFor((await loadEventState(eventId))!, absent.email);
    expect(me?.standing?.position ?? "").toBe("");
  });
});

/**
 * A skins round pays holes, not places. Every board in the product refuses to
 * rank one; `/me` handed the player a stroke-play position in forty-point type.
 */
describe("a player in a round that has no finishing order", () => {
  it("is given no position for a skins round", async () => {
    const { eventId, stageId, mk } = await seedEvent("Skins", "stroke");
    const p = await mk("SKINS", 1);
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId,
        playerId: p.id,
        strokes: JSON.stringify(new Array(18).fill(4)),
      },
    });

    const me = await meFor((await loadEventState(eventId))!, p.email);

    // A returned card, and still no position — because the round has none to
    // give, which is exactly what the leaderboard says about it.
    expect(me?.round?.stageId).toBe(stageId);
    expect(me?.standing ?? null).toBeNull();
  });

  it("is given one for an ordinary stroke round, so the guard is not too wide", async () => {
    const { eventId, stageId, mk } = await seedEvent("Stroke Play", "stroke");
    const p = await mk("STROKE", 1);
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId,
        playerId: p.id,
        strokes: JSON.stringify(new Array(18).fill(4)),
      },
    });

    const me = await meFor((await loadEventState(eventId))!, p.email);

    expect(me?.standing).not.toBeNull();
    expect(me!.standing!.position).toBe("1");
  });
});
