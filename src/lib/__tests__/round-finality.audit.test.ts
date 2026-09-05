import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { roundMoneyFor } from "@/lib/services/expenses";

/**
 * When a MATCH-PLAY round is finished, as the money screen must read it.
 *
 * A stroke round finishes when its cards come in, which `holesReturned`
 * measures and `round-money.audit.test.ts` covers. Match play returns no
 * scorecards at all — it writes `MatchScorecard`, which none of this reads —
 * so the round has a second measure, and this file is about that one.
 *
 * The defect it was written for: the measure was `matchSettled`, which is
 * satisfied by a match with ONE hole on it. That is the right question for
 * "which round is the tournament on" and the wrong one for money, so a round
 * flipped to final the moment each pairing had a single hole entered.
 *
 * Nothing leaked. Every pot family refuses a provisional result for its own
 * reasons — skins on its `provisional` flag, the derived pots on holes
 * returned, and a match round has no `Scorecard` rows to score off anyway. So
 * the symptom was not a wrong number, it was SILENCE: `roundMoneyFor` computes
 * the player's exposure only while a round is unfinished, so declaring the
 * round finished removed the stake line as well, and a player halfway through
 * their match was shown neither what they had riding nor a result. An empty
 * money screen reads as "nothing to report" rather than as a fault, which is
 * why it survived.
 *
 * Both directions are asserted here, because either alone is easy to satisfy
 * wrongly: a rule that never finishes a match round passes every "still being
 * played" case, and a rule that finishes it immediately passes every "pays
 * out" case.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-FINAL";

let eventId = "";
let stageId = "";
let groupId = "";
const matchId: Record<string, string> = {};
const player: Record<string, string> = {};
const email: Record<string, string> = {};

const WHO = ["ann", "bob", "cat", "dan"] as const;

/** Eighteen holes, from a string: A, B, H, and "." for a hole not yet played. */
const holes = (s: string) => JSON.stringify(s.split("").map((c) => (c === "." ? null : c)));

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
      name: `${TAG} matchplay`,
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
      type: "Round Robin",
      format: "Match Play",
      holes: 18,
      teeSheet: "",
    },
  });
  stageId = stage.id;

  const group = await prisma.group.create({ data: { eventId, name: `${TAG} flight`, position: 0 } });
  groupId = group.id;

  for (const [i, who] of WHO.entries()) {
    const addr = `${TAG}.${who}@example.invalid`.toLowerCase();
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: addr, seed: i + 1, status: "confirmed" },
    });
    player[who] = p.id;
    email[who] = addr;
  }

  // Two matches, so "every match" means something. A rule that reads one match
  // and stops would pass a single-match fixture whatever it did.
  for (const [key, a, b] of [
    ["top", "ann", "bob"],
    ["bottom", "cat", "dan"],
  ] as const) {
    const m = await prisma.match.create({
      data: {
        eventId,
        stageId,
        groupId,
        round: 1,
        playerAId: player[a],
        playerBId: player[b],
        holes: holes(".".repeat(18)),
      },
    });
    matchId[key] = m.id;
  }

  // Something to be exposed to. Everybody in, £20 each — so a stake of zero
  // can only ever mean the screen declined to report one.
  const pot = await prisma.skinsPot.create({
    data: { eventId, stageId, buyInCents: 2000, net: false, scope: "full", groupKey: "" },
  });
  await prisma.skinsEntry.createMany({
    data: WHO.map((who) => ({ potId: pot.id, playerId: player[who] })),
  });
});

beforeEach(async () => {
  // Back to a drawn but unplayed round before each case.
  await prisma.match.updateMany({
    where: { stageId },
    data: { holes: holes(".".repeat(18)), forfeitedBy: "" },
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const roundOf = async (who: string) => {
  const view = await roundMoneyFor(eventId, email[who]);
  const round = view.rounds.find((r) => r.stageId === stageId);
  if (!round) throw new Error("the fixture's round is missing from the view");
  return { view, round };
};

const setHoles = (key: string, s: string) =>
  prisma.match.update({ where: { id: matchId[key] }, data: { holes: holes(s) } });

describe("when a match-play round is finished, for the money screen", () => {
  it("is still being played when every match is one hole old", async () => {
    /**
     * THE DEFECT. One hole is a lead, not a result — Rule 3.2a, a match is won
     * when a side leads by more holes than remain, and one up with seventeen
     * to play is as live as a match gets.
     *
     * Both halves are asserted. The round must not claim to be final, AND the
     * player must still be told what they have riding on it: those are the
     * same line of code, so a fix that restores one without the other has not
     * fixed the thing anybody would notice.
     */
    await setHoles("top", "A" + ".".repeat(17));
    await setHoles("bottom", "B" + ".".repeat(17));

    const { view, round } = await roundOf("ann");
    expect(round.final, "a round one hole old is not final").toBe(false);
    expect(view.stake.cents, "the player's exposure is still reported").toBe(2000);
    expect(view.stake.games).toBe(1);
    expect(round.standing, "and no position is claimed").toEqual([]);
  });

  it("is still being played when one match is over and the other is not", async () => {
    // "Every match" is the rule, and a fixture where they agree cannot tell
    // `every` from `some`.
    await setHoles("top", "AAAAAHHHHHHHHH....");
    await setHoles("bottom", "B" + ".".repeat(17));

    const { view, round } = await roundOf("ann");
    expect(round.final).toBe(false);
    expect(view.stake.cents).toBe(2000);
  });

  it("is finished once every match has a result", async () => {
    /**
     * The control, and the half a careless gate breaks. Without it the cases
     * above pass just as well against a round that can never finish — which
     * would be the same silence, permanently.
     */
    await setHoles("top", "AAAAAHHHHHHHHH....");
    await setHoles("bottom", "HHHHHHHHHHHHHHHHHB");

    const { view, round } = await roundOf("ann");
    expect(round.final, "every match decided finishes the round").toBe(true);
    // The other side of the same rule: a finished round reports no exposure,
    // because exposure is what you have riding on something not yet decided.
    expect(view.stake.cents).toBe(0);
  });

  it("counts a match closed out early, not one played to the 18th", async () => {
    // 5&4 is a finished match with four holes never played. A rule wanting
    // eighteen returned holes would refuse most real match play — almost none
    // of which reaches the last green.
    await setHoles("top", "AAAAAHHHHHHHHH....");
    await setHoles("bottom", "BBBBBHHHHHHHHH....");

    expect((await roundOf("ann")).round.final).toBe(true);
  });

  it("counts a forfeit as a result", async () => {
    // A conceded match has no holes at all. Reading it as unplayed would leave
    // the round live forever — the failure the forfeit feature was built to
    // remove, arriving through the feature itself.
    await setHoles("top", "AAAAAHHHHHHHHH....");
    await prisma.match.update({
      where: { id: matchId.bottom },
      data: { forfeitedBy: player.dan },
    });

    expect((await roundOf("ann")).round.final).toBe(true);
  });

  it("does not read a drawn but unplayed round as finished", async () => {
    /**
     * The trap on the other side. A scheduled match nobody has touched is
     * stored as an empty or all-null card, and `resolveMatch([])` is COMPLETE
     * — nothing remains to play, so `remaining` is zero. A draw published on
     * Monday for a Saturday would have read as a finished round all week, and
     * every player's stake line would have been missing from the moment the
     * draw went up.
     */
    const { view, round } = await roundOf("ann");
    expect(round.final).toBe(false);
    expect(view.stake.cents).toBe(2000);

    await prisma.match.updateMany({ where: { stageId }, data: { holes: "[]" } });
    const empty = await roundOf("ann");
    expect(empty.round.final, "an empty card is not a played match").toBe(false);
    expect(empty.view.stake.cents).toBe(2000);
  });
});
