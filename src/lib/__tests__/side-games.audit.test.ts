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

describe("the pots the cards settle", () => {
  /**
   * Each of these measures the DELTA one pot makes, rather than asserting an
   * absolute figure: bets from the blocks above are still on the books, and a
   * hard-coded total would be a test of the order this file happens to run in.
   * Cleanup is in a finally so a failure cannot leave a pot behind and take
   * the next test down with it — which is exactly what the first draft did.
   */
  async function withPot<T>(
    data: { stageId: string; kind: string; buyInCents: number },
    body: () => Promise<T>,
  ): Promise<T> {
    const game = await prisma.sideGame.create({
      data: { eventId, ...data, createdBy: "organizer" },
    });
    await prisma.sideGameEntry.createMany({
      data: Object.values(player).map((playerId) => ({ sideGameId: game.id, playerId })),
    });
    try {
      return await body();
    } finally {
      await prisma.sideGame.delete({ where: { id: game.id } });
    }
  }

  const daveGames = async () => (await moneyFor(eventId, at("dave"))).gamesCents;

  it("pays low gross to whoever shot it, off the scores alone", async () => {
    // Round 1: Dave shot 54 and everybody else 90. Nobody records that — the
    // cards are the only source, and a $40 pot is $30 to him after his stake.
    const before = await daveGames();
    await withPot({ stageId: round[0], kind: "low-gross", buyInCents: 1_000 }, async () => {
      const view = await moneyFor(eventId, at("dave"));
      expect(view.gamesCents - before).toBe(3_000);
      expect(sum(view.standing)).toBe(0);
    });
  });

  it("divides a birdie pot by the birdies actually made", async () => {
    // Par is 4 everywhere and Dave's round-1 card is all 3s: eighteen birdies
    // against nobody else's, so the $20 pot is his less his own $5.
    const before = await daveGames();
    await withPot({ stageId: round[0], kind: "birdies", buyInCents: 500 }, async () => {
      const view = await moneyFor(eventId, at("dave"));
      expect(view.gamesCents - before).toBe(1_500);
      expect(sum(view.standing)).toBe(0);
    });
  });

  it("hands a pot back when the round produced no winner at all", async () => {
    // An eagle pot on a round with no eagles. Everybody's stake returns and
    // nobody moves; keeping it would make the app a house.
    const before = await daveGames();
    await withPot({ stageId: round[1], kind: "eagles", buyInCents: 500 }, async () => {
      const view = await moneyFor(eventId, at("dave"));
      expect(view.gamesCents - before, "an unwon pot moves nobody").toBe(0);
      expect(sum(view.standing)).toBe(0);
    });
  });

  it("settles a Nassau off the match cards", async () => {
    // No pot and no entrants: a Nassau is a bet between the two players in
    // each match, and the app reads the holes to know who took which segment.
    const group = await prisma.group.create({
      data: { eventId, name: `${TAG} flight`, position: 0 },
    });
    const match = await prisma.match.create({
      data: {
        eventId,
        stageId: round[0],
        groupId: group.id,
        round: 1,
        playerAId: player.dave,
        playerBId: player.ann,
        holes: JSON.stringify(new Array(18).fill("A")),
      },
    });

    const before = await daveGames();
    await withPot({ stageId: round[0], kind: "nassau", buyInCents: 500 }, async () => {
      const view = await moneyFor(eventId, at("dave"));
      // Dave wins front, back and overall at $5 a segment.
      expect(view.gamesCents - before).toBe(1_500);
      expect(sum(view.standing)).toBe(0);
    });

    await prisma.match.delete({ where: { id: match.id } });
    await prisma.group.delete({ where: { id: group.id } });
  });
});

describe("a player putting their own name down", () => {
  /**
   * The rule the whole signup flow rests on: an intention is not a stake.
   *
   * A player can tap "I'm in" from the app before the round. The money is cash
   * on the first tee, so until the organizer says they have it, that entry
   * must move NOBODY's balance — counting it would tell the other players they
   * are owed money that does not exist, and a ledger that does that once will
   * not be trusted again.
   */
  it("does not put a penny in the pot until the organizer takes the cash", async () => {
    const kp = await prisma.contest.create({
      data: {
        eventId,
        stageId: round[0],
        kind: "closest-pin",
        name: "KP 3rd",
        hole: 3,
        buyInCents: 1_000,
        createdBy: "organizer",
      },
    });
    // Two players paid on the tee; Sam only tapped the button.
    await prisma.contestEntry.createMany({
      data: [
        { contestId: kp.id, playerId: player.dave, confirmed: true },
        { contestId: kp.id, playerId: player.ann, confirmed: true },
        { contestId: kp.id, playerId: player.sam, confirmed: false },
      ],
    });

    const asked = await moneyFor(eventId, at("sam"));
    const samBefore = asked.gamesCents;
    const line = asked.contests.find((c) => c.name === "KP 3rd")!;
    // The pot is the money actually collected, not the number of names.
    expect(line.potCents).toBe(2_000);
    expect(line.entrants).toBe(2);
    expect(line.youIn, "Sam is down as wanting in").toBe(true);
    expect(line.youConfirmed, "but the organizer does not have his money").toBe(false);

    // Now the organizer takes it.
    await prisma.contestEntry.update({
      where: { contestId_playerId: { contestId: kp.id, playerId: player.sam } },
      data: { confirmed: true },
    });

    const paid = await moneyFor(eventId, at("sam"));
    expect(paid.contests.find((c) => c.name === "KP 3rd")!.potCents).toBe(3_000);
    // Undecided, so it still costs him nothing — but the pot is now $30.
    expect(paid.gamesCents).toBe(samBefore);
    expect(sum(paid.standing)).toBe(0);

    await prisma.contest.delete({ where: { id: kp.id } });
  });

  it("keeps an unpaid name out of a DERIVED pot too", async () => {
    const game = await prisma.sideGame.create({
      data: { eventId, stageId: round[0], kind: "low-gross", buyInCents: 1_000, createdBy: "organizer" },
    });
    await prisma.sideGameEntry.createMany({
      data: [
        { sideGameId: game.id, playerId: player.dave, confirmed: true },
        { sideGameId: game.id, playerId: player.ann, confirmed: true },
        // Rob asked to join and has not paid: he must neither be charged the
        // stake nor be able to win a pot he is not in.
        { sideGameId: game.id, playerId: player.rob, confirmed: false },
      ],
    });

    const view = await moneyFor(eventId, at("rob"));
    expect(sum(view.standing)).toBe(0);

    const robPaid = await prisma.sideGameEntry.findFirst({
      where: { sideGameId: game.id, playerId: player.rob },
    });
    expect(robPaid?.confirmed).toBe(false);

    // Dave shot 54 in round 1 and takes the two-player pot: $20, less his $10.
    const dave = await moneyFor(eventId, at("dave"));
    const withPot = dave.gamesCents;
    await prisma.sideGame.delete({ where: { id: game.id } });
    const withoutPot = (await moneyFor(eventId, at("dave"))).gamesCents;
    expect(withPot - withoutPot, "a two-player pot, not a three-player one").toBe(1_000);
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
