import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { roundMoneyFor } from "@/lib/services/expenses";

/**
 * What a player has riding on a round that has not finished.
 *
 * A player can be in the club's pot, their fourball's skins, a birdie pot and
 * a two-man bet at once. Every one of those was its own row on the screen and
 * there was no total anywhere, so the number somebody actually wants walking
 * to the first tee — what this costs if it all goes wrong — was arithmetic
 * they had to do in their head.
 *
 * Tested against real rows because every property here is about which rows the
 * SERVICE decides to count. The arithmetic is addition; the bugs are in the
 * membership.
 *
 * Three things it must never do, each of which is money in the wrong place:
 *
 *   - count a game somebody is not in. A fourball's $5 birdie pot appearing in
 *     a stranger's exposure is the same fault as it appearing in their
 *     settle-up, one screen earlier;
 *   - stop counting a round because it is unfinished. That is exactly the
 *     round the number is for, and it is the opposite of the rule that governs
 *     RESULTS — see roundMoneyIsFinal;
 *   - report a POSITION. A stake is knowable when the bet is agreed and does
 *     not move as holes come in, which is the only reason it is safe to show
 *     while a round is live.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-STAKE";

let eventId = "";
let stageId = "";
const player: Record<string, string> = {};
const email: Record<string, string> = {};

/** Everybody in the fourball, and one player who is out with somebody else. */
const WHO = ["ann", "bob", "cat", "dan", "outsider"] as const;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} open`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
    },
  });
  eventId = event.id;

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      // No cards are ever posted, so this round stays unfinished for the whole
      // file — which is the state the exposure number exists to describe.
      teeSheet: "",
    },
  });
  stageId = stage.id;

  for (const [i, who] of WHO.entries()) {
    const addr = `${TAG}.${who}@example.invalid`.toLowerCase();
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: addr, seed: i + 1, status: "confirmed" },
    });
    player[who] = p.id;
    email[who] = addr;
  }

  await prisma.stage.update({
    where: { id: stageId },
    data: {
      teeSheet: JSON.stringify({
        savedAt: "",
        startType: "tee",
        groups: [
          {
            name: "Group 1",
            startHole: 1,
            time: "8:00 AM",
            playerIds: [player.ann, player.bob, player.cat, player.dan],
          },
          { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: [player.outsider] },
        ],
      }),
    },
  });
});

beforeEach(async () => {
  await prisma.skinsPot.deleteMany({ where: { stageId } });
  await prisma.sideGame.deleteMany({ where: { eventId } });
  await prisma.contest.deleteMany({ where: { eventId } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const stakeOf = async (who: string) => (await roundMoneyFor(eventId, email[who])).stake;

describe("what a player has riding on a round still in play", () => {
  it("is nothing at all when there are no games", async () => {
    // The line is hidden on zero rather than reading "0 games, $0.00", which
    // is a row that tells somebody nothing and takes up the space of one that
    // would.
    expect(await stakeOf("ann")).toEqual({ games: 0, cents: 0 });
  });

  it("adds a fourball's skins to a birdie pot to a two-man bet", async () => {
    const pot = await prisma.skinsPot.create({
      data: { eventId, stageId, buyInCents: 2000, net: true, scope: "full", groupKey: "Group 1" },
    });
    await prisma.skinsEntry.createMany({
      data: [player.ann, player.bob, player.cat, player.dan].map((playerId) => ({
        potId: pot.id,
        playerId,
      })),
    });

    const birdies = await prisma.sideGame.create({
      data: { eventId, stageId, kind: "birdies", buyInCents: 500, groupKey: "Group 1" },
    });
    await prisma.sideGameEntry.createMany({
      data: [player.ann, player.bob].map((playerId) => ({
        sideGameId: birdies.id,
        playerId,
        confirmed: true,
      })),
    });

    // $20 + $5 = $25 across two games. Ann is in both.
    expect(await stakeOf("ann")).toEqual({ games: 2, cents: 2500 });
    // Cat is in the skins and not the birdie pot.
    expect(await stakeOf("cat")).toEqual({ games: 1, cents: 2000 });
  });

  it("leaves out somebody who is not in the game", async () => {
    const pot = await prisma.skinsPot.create({
      data: { eventId, stageId, buyInCents: 2000, net: true, scope: "full", groupKey: "Group 1" },
    });
    await prisma.skinsEntry.create({ data: { potId: pot.id, playerId: player.ann } });

    // THE BUG THIS PREVENTS: a fourball's bet showing up as a debt on the
    // screen of a player in another group, who never agreed to it.
    expect(await stakeOf("outsider")).toEqual({ games: 0, cents: 0 });
  });

  it("counts a stake somebody still owes, not only cash collected", async () => {
    // What a player is exposed to is what they will owe. Counting only
    // confirmed rows would show $0 to somebody who has agreed to four bets and
    // simply not paid yet — which is precisely the person the number is for.
    const game = await prisma.sideGame.create({
      data: { eventId, stageId, kind: "low-net", buyInCents: 1000, groupKey: "Group 1" },
    });
    await prisma.sideGameEntry.create({
      data: { sideGameId: game.id, playerId: player.bob, confirmed: false },
    });

    expect(await stakeOf("bob")).toEqual({ games: 1, cents: 1000 });
  });

  it("charges an opt-out pot to the group it belongs to, and no wider", async () => {
    // In opt-out mode the AUDIENCE is the membership — nobody ticks anything.
    // Resolved against the field instead, Group 1's $5 pot lands on every
    // player in the tournament, including the one in Group 2.
    await prisma.sideGame.create({
      data: {
        eventId,
        stageId,
        kind: "birdies",
        buyInCents: 500,
        groupKey: "Group 1",
        entryMode: "opt-out",
      },
    });

    expect(await stakeOf("dan")).toEqual({ games: 1, cents: 500 });
    expect(await stakeOf("outsider")).toEqual({ games: 0, cents: 0 });
  });

  it("offers the club's own opt-out game to the whole field", async () => {
    // The other half of the rule above, and the reason opt-out exists: nobody
    // ticks forty names for the weekly 2s pot.
    await prisma.sideGame.create({
      data: { eventId, stageId, kind: "eagles", buyInCents: 200, groupKey: "", entryMode: "opt-out" },
    });

    for (const who of WHO) {
      expect(await stakeOf(who), who).toEqual({ games: 1, cents: 200 });
    }
  });

  it("leaves the Nassau out rather than inventing a number for it", async () => {
    // A Nassau is three bets inside a match: it has no entrant list, and what
    // it costs depends on who somebody is drawn against. A "$5 Nassau" can
    // cost $15. Guessing would be worse than saying nothing.
    await prisma.sideGame.create({
      data: { eventId, stageId, kind: "nassau", buyInCents: 500, groupKey: "Group 1" },
    });

    expect(await stakeOf("ann")).toEqual({ games: 0, cents: 0 });
  });

  it("is a stake, not a position — no round reports a result", async () => {
    const pot = await prisma.skinsPot.create({
      data: { eventId, stageId, buyInCents: 2000, net: true, scope: "full", groupKey: "Group 1" },
    });
    await prisma.skinsEntry.create({ data: { potId: pot.id, playerId: player.ann } });

    const view = await roundMoneyFor(eventId, email.ann);
    // The round is unfinished, so it still reports nothing about who is
    // winning. Both rules hold at once: money at stake, no half-answer.
    expect(view.stake.cents).toBe(2000);
    expect(view.yourTotalCents).toBe(0);
    for (const r of view.rounds) {
      expect(r.final, r.label).toBe(false);
      expect(r.standing, r.label).toEqual([]);
    }
  });
});
