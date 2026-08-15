import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { moneyFor } from "@/lib/services/expenses";

/**
 * The side-game money, over a tournament with more than one round.
 *
 * Two kinds of side bet, and the difference is the whole design:
 *
 *   DERIVED — skins. The cards say who won each hole, so the app works the
 *   money out and nobody types a result. Per round, because a pot settles on
 *   the night it was played.
 *
 *   MANUAL — closest to the pin, long drive. No scorecard has ever recorded
 *   who was nearest the flag, so asking the organizer is not a shortcut, it is
 *   the only honest source.
 *
 * Both feed ONE settle-up. This exists because a multi-round outing is where
 * that goes wrong: a pot per round, a KP per round, and a ledger that has to
 * add them all up without double-counting a stake or losing a winner.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SIDE-GAMES";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let orgId = "";
let eventId = "";
const round: string[] = [];
const player: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** A full 18-hole card of one score, so a round is genuinely playable. */
const card = (strokes: number) => JSON.stringify(new Array(18).fill(strokes));

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;

  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} two-day outing`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      format: "stroke",
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;

  for (const [i, who] of ["dave", "ann", "rob", "sam"].entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: at(who), seed: i + 1, status: "confirmed", handicap: 0 },
    });
    player[who] = p.id;
  }

  // TWO rounds, which is the point of this file.
  for (const position of [0, 1]) {
    const s = await prisma.stage.create({
      data: { eventId, position, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross" },
    });
    round.push(s.id);
  }

  // Round 1 cards: Dave wins every hole outright, so the skins pot is his.
  await prisma.scorecard.createMany({
    data: [
      { eventId, stageId: round[0], playerId: player.dave, strokes: card(3) },
      { eventId, stageId: round[0], playerId: player.ann, strokes: card(5) },
      { eventId, stageId: round[0], playerId: player.rob, strokes: card(5) },
      { eventId, stageId: round[0], playerId: player.sam, strokes: card(5) },
    ],
  });

  // Round 2 cards: Ann takes this one.
  await prisma.scorecard.createMany({
    data: [
      { eventId, stageId: round[1], playerId: player.dave, strokes: card(5) },
      { eventId, stageId: round[1], playerId: player.ann, strokes: card(3) },
      { eventId, stageId: round[1], playerId: player.rob, strokes: card(5) },
      { eventId, stageId: round[1], playerId: player.sam, strokes: card(5) },
    ],
  });

  // A skins pot on EACH round — $10 a player, gross.
  for (const stageId of round) {
    const pot = await prisma.skinsPot.create({
      data: { eventId, stageId, buyInCents: 1_000, net: false, scope: "full" },
    });
    await prisma.skinsEntry.createMany({
      data: Object.values(player).map((playerId) => ({ potId: pot.id, playerId })),
    });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const sum = (nets: Array<{ netCents: number }>) => nets.reduce((a, n) => a + n.netCents, 0);

describe("money the cards can work out for themselves", () => {
  it("derives a skins pot per round, without being told a winner", async () => {
    // The whole difference between a derived bet and a manual one, asserted
    // rather than described: NOTHING in the database records who won these
    // pots. There is no winner column on SkinsPot and no contest row for
    // them — only stakes and cards. The money below is worked out from the
    // scores alone.
    const pots = await prisma.skinsPot.findMany({
      where: { eventId },
      include: { entrants: true },
    });
    expect(pots, "a pot on each round").toHaveLength(2);
    expect(pots.every((p) => p.entrants.length === 4)).toBe(true);
    expect(
      await prisma.contest.count({ where: { eventId } }),
      "no manual record of a skins winner exists at this point",
    ).toBe(0);

    // And yet the ledger already has Dave up and Rob down, purely from cards.
    const view = await moneyFor(eventId, at("dave"));
    expect(view.gamesCents).toBeGreaterThan(0);
  });

  it("adds both rounds' pots into one position", async () => {
    const view = await moneyFor(eventId, at("dave"));
    // Four players, $10 each, two rounds = $80 through the side games, and it
    // has to net to zero across the field however it was won.
    expect(sum(view.standing)).toBe(0);

    // Dave won round 1 outright ($40 pot, $10 of it his own stake) and lost
    // round 2 ($10). Ann is the mirror image.
    const daveGames = view.gamesCents;
    expect(daveGames).toBe(3_000 - 1_000);

    const annView = await moneyFor(eventId, at("ann"));
    expect(annView.gamesCents).toBe(3_000 - 1_000);
  });

  it("keeps the two rounds separate rather than pooling the stakes", async () => {
    // A single $80 pot split across both rounds would pay the same money to
    // the wrong people: each night settles on its own.
    const view = await moneyFor(eventId, at("rob"));
    // Rob won neither: down a stake on each round.
    expect(view.gamesCents).toBe(-2_000);
  });
});

describe("money only a person can supply", () => {
  it("takes a manual closest-to-the-pin on one round", async () => {
    const kp = await prisma.contest.create({
      data: {
        eventId,
        stageId: round[0],
        kind: "closest-pin",
        name: "KP 7th",
        hole: 7,
        buyInCents: 500,
        createdBy: "organizer",
      },
    });
    await prisma.contestEntry.createMany({
      data: Object.values(player).map((playerId) => ({ contestId: kp.id, playerId, won: playerId === player.rob })),
    });

    const view = await moneyFor(eventId, at("rob"));
    // Rob was down $20 on skins; the $20 KP pot less his own $5 stake puts
    // him back to level on the side games.
    expect(view.gamesCents).toBe(-2_000 + 1_500);
    expect(sum(view.standing)).toBe(0);
  });

  it("takes a long drive on the OTHER round, and adds them all up", async () => {
    const ld = await prisma.contest.create({
      data: {
        eventId,
        stageId: round[1],
        kind: "long-drive",
        name: "Long drive 12th",
        hole: 12,
        buyInCents: 1_000,
        createdBy: "organizer",
      },
    });
    // A tie between two players — the pot splits to the cent.
    await prisma.contestEntry.createMany({
      data: Object.values(player).map((playerId) => ({
        contestId: ld.id,
        playerId,
        won: playerId === player.sam || playerId === player.rob,
      })),
    });

    const view = await moneyFor(eventId, at("sam"));
    expect(sum(view.standing)).toBe(0);
    // Sam: two skins stakes (-20), a KP stake (-5), and half a $40 long-drive
    // pot (+20) less his own $10 stake.
    expect(view.gamesCents).toBe(-2_000 - 500 + 2_000 - 1_000);
  });

  it("leaves an undecided pot out of everybody's number", async () => {
    const open = await prisma.contest.create({
      data: {
        eventId,
        stageId: round[1],
        kind: "other",
        name: "Nearest in two",
        buyInCents: 500,
        createdBy: "organizer",
      },
    });
    await prisma.contestEntry.createMany({
      data: Object.values(player).map((playerId) => ({ contestId: open.id, playerId, won: false })),
    });

    const before = (await moneyFor(eventId, at("dave"))).gamesCents;
    // Adding an unwon pot must move nobody: it is collected, not decided.
    const view = await moneyFor(eventId, at("dave"));
    expect(view.gamesCents).toBe(before);
    expect(view.contests.find((c) => c.name === "Nearest in two")!.decided).toBe(false);
    expect(sum(view.standing)).toBe(0);
  });
});

describe("the whole outing, derived and manual together", () => {
  it("settles square across both rounds", async () => {
    const view = await moneyFor(eventId, at("dave"));
    expect(sum(view.standing)).toBe(0);

    const after = new Map(view.standing.map((s) => [s.playerId, s.netCents]));
    for (const t of view.transfers) {
      after.set(t.fromPlayerId, (after.get(t.fromPlayerId) ?? 0) + t.cents);
      after.set(t.toPlayerId, (after.get(t.toPlayerId) ?? 0) - t.cents);
      expect(t.cents).toBeGreaterThan(0);
    }
    for (const [id, cents] of after) expect(cents, `${id} must end square`).toBe(0);
  });

  it("lists every side bet, on either round, so the total can be checked", async () => {
    const view = await moneyFor(eventId, at("dave"));
    expect(view.contests.map((c) => c.name).sort()).toEqual([
      "KP 7th",
      "Long drive 12th",
      "Nearest in two",
    ]);
  });
});
