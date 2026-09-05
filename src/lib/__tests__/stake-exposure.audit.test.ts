import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { roundMoneyFor, moneyFor } from "@/lib/services/expenses";

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
      /**
       * A real card, because the birdie pot cannot be tested without one.
       *
       * With no pars `countUnder` can never see a birdie, so a birdie pot pays
       * everybody their stake back and nets to zero — which is the same answer
       * a working gate gives, and would make the test below unable to fail.
       * Holes 1-3 are par 4s so the three 3s the fixtures post really are three
       * birdies. Nobody here plays off anything but scratch, so the stroke
       * index changes no result in this file; it is present because
       * `resolveCourse` returns a card only when all three arrays parse.
       */
      customPars: JSON.stringify([4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5]),
      customYards: JSON.stringify([
        380, 410, 395, 165, 520, 400, 375, 150, 510, 405, 390, 170, 530, 385, 415, 155, 400, 505,
      ]),
      customStrokeIndex: JSON.stringify([
        1, 11, 5, 15, 3, 13, 7, 17, 9, 2, 12, 6, 16, 4, 14, 8, 18, 10,
      ]),
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

/**
 * The OUTING ledger has to keep the same rule the round card keeps.
 *
 * Every case above goes through `roundMoneyFor`, which gates on
 * `roundMoneyIsFinal` before computing anything. `moneyFor` — the settle-up on
 * `/me/money` in split mode — called the same `gameNets` with no stage and no
 * gate, and `skinsPotFor` returns a result whenever anybody is in the pot,
 * however many holes are left. It sets `provisional` to say so; nothing read
 * it.
 *
 * So a half-played pot's shares landed in `gamesCents`, `netCents`, the
 * standing and the `settle()` transfer list — a list of who hands cash to
 * whom — directly beneath a round card correctly saying the round is still
 * being played. `money-layout.ts` opens by saying the app has no business
 * doing that: "a player looking at £40 on the 14th who finishes with nothing
 * has been told something the app had no business claiming".
 */
describe("the outing ledger, while a pot is still being played for", () => {
  /**
   * Three holes in, fifteen to come.
   *
   * Ann birdies 1-3, everybody else pars. Then nothing: the round stops. The
   * same three holes serve every pot in this block — a skins pot Ann has taken
   * outright, a birdie pot she is alone in, and a low-gross pot she leads by
   * three — so each of them really would pay her if the gate let it.
   */
  async function partialCards() {
    for (const [who, first] of [["ann", 3], ["bob", 4], ["cat", 4], ["dan", 4]] as const) {
      await prisma.scorecard.create({
        data: {
          eventId,
          stageId,
          playerId: player[who],
          strokes: JSON.stringify(Array.from({ length: 18 }, (_, i) => (i < 3 ? first : null))),
        },
      });
    }
  }

  /** Every card in: Ann round in 69 with three birdies, everybody else 72. */
  async function finishCardsAtPar() {
    const pars = [4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
    await prisma.scorecard.updateMany({
      where: { stageId, playerId: player.ann },
      data: { strokes: JSON.stringify(pars.map((p, i) => (i < 3 ? 3 : p))) },
    });
    for (const who of ["bob", "cat", "dan"] as const) {
      await prisma.scorecard.updateMany({
        where: { stageId, playerId: player[who] },
        data: { strokes: JSON.stringify(pars) },
      });
    }
  }

  /** Everybody in, stake paid, so membership is never what a zero means. */
  async function sideGameFor(kind: string, buyInCents: number) {
    const game = await prisma.sideGame.create({
      data: { eventId, stageId, kind, buyInCents, groupKey: "" },
    });
    await prisma.sideGameEntry.createMany({
      data: [player.ann, player.bob, player.cat, player.dan].map((playerId) => ({
        sideGameId: game.id,
        playerId,
        confirmed: true,
      })),
    });
    return game;
  }

  async function halfPlayedPot() {
    const pot = await prisma.skinsPot.create({
      data: { eventId, stageId, buyInCents: 2000, net: true, scope: "full", groupKey: "" },
    });
    await prisma.skinsEntry.createMany({
      data: [player.ann, player.bob, player.cat, player.dan].map((playerId) => ({
        potId: pot.id,
        playerId,
      })),
    });
    await partialCards();
    return pot;
  }

  afterEach(async () => {
    await prisma.scorecard.deleteMany({ where: { stageId } });
    await prisma.match.deleteMany({ where: { stageId } });
    await prisma.group.deleteMany({ where: { eventId, name: { startsWith: TAG } } });
  });

  it("reports no skins money at all while holes are unplayed", async () => {
    await halfPlayedPot();
    const view = await moneyFor(eventId, email.ann);

    // The control: the pot really would pay her if it were settled, so a zero
    // here is the gate working rather than the fixture producing no money.
    expect(view.gamesCents, "no provisional winnings in the outing total").toBe(0);
    expect(view.gameLines.filter((l) => /skins/i.test(l.label))).toEqual([]);
    // And nothing is proposed as a payment between two people.
    expect(view.transfers).toEqual([]);
  });

  it("settles it once every hole is in", async () => {
    /**
     * The other half, and the one a careless gate breaks: a finished pot must
     * still pay. Without this the test above passes just as well against a
     * skins ledger that never reports anything.
     */
    await halfPlayedPot();
    await prisma.scorecard.updateMany({
      where: { stageId, playerId: player.ann },
      data: { strokes: JSON.stringify([3, 3, 3, ...new Array(15).fill(4)]) },
    });
    for (const who of ["bob", "cat", "dan"] as const) {
      await prisma.scorecard.updateMany({
        where: { stageId, playerId: player[who] },
        data: { strokes: JSON.stringify(new Array(18).fill(4)) },
      });
    }

    const view = await moneyFor(eventId, email.ann);
    // Four stakes of £20; Ann took three skins and nobody else took any, so
    // the whole pot is hers less her own stake.
    expect(view.gamesCents).toBeGreaterThan(0);
    expect(view.gameLines.some((l) => /skins/i.test(l.label))).toBe(true);
  });

  /**
   * The DERIVED pots — low gross, low net, birdies, eagles — are the same
   * defect one block further down `gameNets`, and they had no `provisional`
   * flag to read. `derivedNets` settles off whatever cards exist, so through
   * `moneyFor` a pot mid-round reached the outing total and the transfer list
   * exactly as skins did.
   *
   * Each kind was judged on its own. Low gross and low net are the obvious
   * half: `lowScoreWinners` compares only the cards with the MOST holes
   * played, so three holes in it pays whoever is furthest round. The birdie
   * pot is the interesting half, because a birdie already made genuinely does
   * not un-happen — and it is still wrong, because the pot divides by the
   * counts RELATIVE to each other. One birdie on the 3rd shows a player
   * holding the whole pot; four more birdies across the field leaves them with
   * a fifth of it. The event is settled and the amount is not, and the amount
   * is the part the ledger states.
   */
  it("reports no low-gross money while the cards are half in", async () => {
    await sideGameFor("low-gross", 1000);
    await partialCards();

    const view = await moneyFor(eventId, email.ann);
    // Ann is round in 9 to everybody else's 12 and every card is three holes
    // long, so she is the low-gross winner of a pot that is not finished.
    expect(view.gamesCents, "no provisional low gross in the outing total").toBe(0);
    expect(view.transfers).toEqual([]);
    // And nobody is shown as down on it either — the losing half of the same
    // claim, which a gate that only hid the winner would leave behind.
    expect((await moneyFor(eventId, email.bob)).gamesCents).toBe(0);
  });

  it("settles low gross once every hole is in", async () => {
    // The control. Without it the test above passes just as well against a
    // ledger that never reports a derived pot at all.
    await sideGameFor("low-gross", 1000);
    await partialCards();
    await finishCardsAtPar();

    // Four stakes of £10 into a £40 pot; Ann's 69 beats three 72s outright.
    expect((await moneyFor(eventId, email.ann)).gamesCents).toBe(3000);
    expect((await moneyFor(eventId, email.bob)).gamesCents).toBe(-1000);
    expect((await moneyFor(eventId, email.ann)).transfers.length).toBeGreaterThan(0);
  });

  it("reports no birdie-pot money while holes are unplayed", async () => {
    await sideGameFor("birdies", 500);
    await partialCards();

    const view = await moneyFor(eventId, email.ann);
    // Three birdies to nobody else's one is the whole pot on the counts so
    // far, and the counts so far are not the counts.
    expect(view.gamesCents, "no provisional birdie money in the outing total").toBe(0);
    expect(view.transfers).toEqual([]);
    expect((await moneyFor(eventId, email.bob)).gamesCents).toBe(0);
  });

  it("pays the birdie pot once every hole is in", async () => {
    await sideGameFor("birdies", 500);
    await partialCards();
    await finishCardsAtPar();

    // Four stakes of £5 into a £20 pot. Ann made the only three birdies of the
    // day, so all of it is hers, less her own stake.
    expect((await moneyFor(eventId, email.ann)).gamesCents).toBe(1500);
    expect((await moneyFor(eventId, email.bob)).gamesCents).toBe(-500);
  });

  it("still pays a Nassau segment that has finished, mid-round", async () => {
    /**
     * The deliberate exception, asserted so the reasoning is pinned rather
     * than remembered.
     *
     * `nassauNets` pays only segments `resolveMatch` calls COMPLETE, and a
     * front nine that is over cannot be re-decided by a back nine nobody has
     * started. Both halves of the rule the derived pots fail hold here: the
     * bet has happened, and its amount can no longer move. Gating this would
     * not be caution, it would be withholding a settled result — the opposite
     * failure, and the one `stakeFor` exists to avoid on the other screen.
     */
    const group = await prisma.group.create({
      data: { eventId, name: `${TAG} flight`, position: 0 },
    });
    await prisma.sideGame.create({
      data: { eventId, stageId, kind: "nassau", buyInCents: 500, groupKey: "" },
    });
    await prisma.match.create({
      data: {
        eventId,
        stageId,
        groupId: group.id,
        round: 1,
        playerAId: player.ann,
        playerBId: player.bob,
        // Ann five up after five and the last four halved: the front nine is
        // over. The back has not been started and the overall eighteen still
        // has nine to play, so neither of those pays anything yet.
        holes: JSON.stringify([
          ...["A", "A", "A", "A", "A", "H", "H", "H", "H"],
          ...new Array(9).fill(null),
        ]),
      },
    });
    await partialCards();

    // One segment at £5, and only one.
    expect((await moneyFor(eventId, email.ann)).gamesCents).toBe(500);
    expect((await moneyFor(eventId, email.bob)).gamesCents).toBe(-500);
  });
});
