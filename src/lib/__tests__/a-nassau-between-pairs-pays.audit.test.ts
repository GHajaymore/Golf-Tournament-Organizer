import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { moneyFor } from "../services/expenses";

/**
 * A NASSAU BETWEEN PAIRS PAYS (sweep 1, b4, 2026-10-10).
 *
 * The casual-round form offers a Nassau on every head-to-head round — a
 * four-ball and a foursomes included, which is how most Nassaus are actually
 * played — and `saveSideGame` accepts it on any match round. The settle-up
 * then kept only matches with a player on each side:
 *
 *     .filter((m) => m.stageId === game.stageId && m.playerAId && m.playerBId …
 *
 * A pairs match holds its sides as TEAMS and leaves the player columns empty
 * (see the schema's note on `Match`), so every one was dropped. The stake was
 * recorded, the match was played and finished, and nobody owed anybody
 * anything, for ever. "The match" bet on the same round, next branch down,
 * read the sides off the roster and paid.
 *
 * A Nassau is three match bets on one card — front, back and the eighteen —
 * so it is settled the way the match bet is: per PLAYER, each winner taking a
 * stake from their opposite number, for each segment that is decided.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PAIRSNASSAU";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

/** Side A wins every hole: the front, the back and the eighteen. */
const ALL_A = JSON.stringify(new Array(18).fill("A"));
/** Side A takes the front 5&4; nothing on the back has been played. */
const FRONT_ONLY = JSON.stringify([...new Array(9).fill("A"), ...new Array(9).fill(null)]);

let organizationId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  organizationId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } })).id;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

/** A four-ball match, two a side, with one bet of `kind` at 500 on it. */
async function fourBall(name: string, kind: "nassau" | "match", holes: string) {
  const event = await prisma.event.create({
    data: {
      organizationId, name: `${TAG} ${name}`, dates: "", course: "", city: "", address: "", regDeadline: "",
      shareToken: `${TAG}-${name}-${process.pid}`.slice(0, 60), moneyMode: "split", status: "live", shape: "single", format: "match",
    },
    select: { id: true },
  });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Round Robin", format: "Four-Ball", holes: 18, nine: "full", scoringBasis: "gross" },
    select: { id: true },
  });
  const group = await prisma.group.create({ data: { eventId: event.id, name: "A", position: 0 }, select: { id: true } });

  const side = async (label: string, seed: number) => {
    const team = await prisma.team.create({ data: { eventId: event.id, stageId: stage.id, name: `${TAG} ${label}`, seed }, select: { id: true } });
    for (const n of [1, 2]) {
      const p = await prisma.player.create({
        data: {
          eventId: event.id, groupId: group.id, name: `${TAG} ${label}${n}`, email: at(`${name}.${label}${n}`),
          handicap: 0, handicapType: "18", status: "confirmed", seed: seed * 2 + n,
        },
        select: { id: true },
      });
      await prisma.teamMember.create({ data: { teamId: team.id, playerId: p.id, position: n } });
    }
    return team.id;
  };
  const teamAId = await side("won", 0);
  const teamBId = await side("lost", 1);

  await prisma.match.create({
    data: { eventId: event.id, stageId: stage.id, groupId: group.id, round: 1, playerAId: "", playerBId: "", teamAId, teamBId, holes },
  });
  await prisma.sideGame.create({ data: { eventId: event.id, stageId: stage.id, kind, buyInCents: 500, entryMode: "opt-out" } });

  const cents = async (who: string) => (await moneyFor(event.id, at(`${name}.${who}`))).gamesCents;
  return { won1: await cents("won1"), won2: await cents("won2"), lost1: await cents("lost1"), lost2: await cents("lost2") };
}

describe("a Nassau on a four-ball match", () => {
  it("CONTROL: the match bet on the same fixture pays — so the sides are on the roster to be found", async () => {
    expect(await fourBall("control", "match", ALL_A)).toEqual({ won1: 500, won2: 500, lost1: -500, lost2: -500 });
  });

  it("pays all three bets, each player against their opposite number", async () => {
    // By value, and both directions: a wiring failure pays nobody, and four
    // zeroes sum to zero just as well.
    expect(await fourBall("swept", "nassau", ALL_A)).toEqual({ won1: 1500, won2: 1500, lost1: -1500, lost2: -1500 });
  });

  it("pays the front nine alone while the back is still to play", async () => {
    // A decided segment is settled; the eighteen is not decided by nine holes.
    expect(await fourBall("front", "nassau", FRONT_ONLY)).toEqual({ won1: 500, won2: 500, lost1: -500, lost2: -500 });
  });
});
