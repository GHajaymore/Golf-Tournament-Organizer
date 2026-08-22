import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { loadEventState, matchProgress, standingRows } from "@/lib/services/tournament";
import { roundMoneyFor } from "@/lib/services/expenses";

/**
 * "Complete" means two different things, and merging them costs a club money.
 *
 * A match won 5&4 is a FINISHED MATCH — it settles the bracket, the standings,
 * the round and the payouts. Its CARD is incomplete: four holes were conceded
 * under Rule 3.2b and never played, and that decides one thing only, whether
 * the player is ranked on a stroke board.
 *
 * The concrete hazard `docs/scoring-input-model.md` was written to prevent:
 * once match play carries gross cards it becomes natural for something to ask
 * "does this card have eighteen holes?" before treating a round as done. A 5&4
 * match would then never complete, the round would never close, and its pots
 * would never pay out. This drives the real loader and the real money service
 * against real rows, because that is the only place the two questions can be
 * observed answering differently about the same match.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MATCH-CARDS";

let orgId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/** Par 72, stroke index 1..18, so a card can be priced at all. */
const newEvent = (name: string) => ({
  organizationId: orgId,
  name: `${TAG} ${name}`,
  dates: "",
  course: "Home",
  city: "",
  address: "",
  regDeadline: "",
  shareToken: `${TAG}-${name}-${Date.now()}`,
  // Match play, which is the whole point: this board used to be a column of
  // zeros because nothing joined MatchScorecard to a player.
  format: "match",
  customPars: JSON.stringify(new Array(18).fill(4)),
  customYards: JSON.stringify(new Array(18).fill(400)),
  customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
});

/**
 * Halved over the full eighteen — a finished match with a complete card.
 * Both players round in fours.
 */
const HALVED = {
  holes: JSON.stringify(new Array(18).fill("H")),
  a: JSON.stringify(new Array(18).fill(4)),
  b: JSON.stringify(new Array(18).fill(4)),
};

/**
 * A wins the first five, the next nine are halved, and the match ends on the
 * 14th: five up with four to play (Rule 3.2a(3)). The last four holes have no
 * score because they were never played, and nothing may invent one for them.
 */
const FIVE_AND_FOUR = {
  holes: JSON.stringify([
    ...new Array(5).fill("A"),
    ...new Array(9).fill("H"),
    ...new Array(4).fill(null),
  ]),
  a: JSON.stringify([...new Array(14).fill(4), null, null, null, null]),
  b: JSON.stringify([...new Array(5).fill(5), ...new Array(9).fill(4), null, null, null, null]),
};

/**
 * A four-player flight, every match played, one of them closed out early.
 *
 * A Round Robin stage holds the WHOLE round robin, so each player has three
 * matches inside this one round — the case that makes several cards land on one
 * `(playerId, stageId)`, and the reason the aggregation had to be taught to
 * cope with it.
 */
async function flightOfFour(name: string, opts: { leaveOneLive?: boolean } = {}) {
  const event = await prisma.event.create({ data: newEvent(name) });
  const group = await prisma.group.create({
    data: { eventId: event.id, name: `${TAG} Flight 1`, position: 0 },
  });
  const players = [];
  for (const [i, who] of ["Ainsley", "Brody", "Cassidy", "Devon"].entries()) {
    players.push(
      await prisma.player.create({
        data: {
          eventId: event.id,
          groupId: group.id,
          name: `${TAG} ${who}`,
          seed: i + 1,
          status: "confirmed",
          // Scratch throughout, so gross and net are the same number and a
          // failure here is never an allowance question in disguise.
          handicap: 0,
        },
      }),
    );
  }
  const [p1, p2, p3, p4] = players;

  const round = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      type: "Round Robin",
      format: "Match Play",
      scoringBasis: "gross",
      holes: 18,
    },
  });
  // A knockout to advance into, so "the bracket advances" is observable.
  await prisma.stage.create({
    data: { eventId: event.id, position: 1, type: "Bracket Stage", format: "Match Play", holes: 18 },
  });

  const pairs: Array<[typeof p1, typeof p1, typeof HALVED | null]> = [
    [p1, p2, FIVE_AND_FOUR],
    [p1, p3, HALVED],
    [p1, p4, HALVED],
    [p2, p3, HALVED],
    [p2, p4, HALVED],
    // The negative control: left with no result at all, so the round is
    // genuinely unfinished and `final` above cannot be passing vacuously.
    [p3, p4, opts.leaveOneLive ? null : HALVED],
  ];

  for (const [a, b, card] of pairs) {
    const match = await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: round.id,
        groupId: group.id,
        round: 1,
        playerAId: a.id,
        playerBId: b.id,
        holes: card ? card.holes : JSON.stringify(new Array(18).fill(null)),
      },
    });
    if (!card) continue;
    await prisma.matchScorecard.createMany({
      data: [
        { eventId: event.id, matchId: match.id, slot: "A", strokes: card.a },
        { eventId: event.id, matchId: match.id, slot: "B", strokes: card.b },
      ],
    });
  }

  // A pot on the round, so the money service actually runs its arithmetic
  // rather than short-circuiting on there being nothing to pay.
  const pot = await prisma.skinsPot.create({
    data: { eventId: event.id, stageId: round.id, buyInCents: 500, net: false },
  });
  await prisma.skinsEntry.createMany({
    data: players.map((p) => ({ potId: pot.id, playerId: p.id })),
  });

  return { event, round, players: { p1, p2, p3, p4 } };
}

describe("a match-play round with a card that stopped short", () => {
  it("completes the round, settles the money and advances the bracket", async () => {
    const { event, round, players } = await flightOfFour("settled");

    const state = await loadEventState(event.id);
    expect(state).not.toBeNull();
    if (!state) return;

    // ── The MATCH question ────────────────────────────────────────────────
    // Every match is decided, including the one that ended on the 14th. This
    // is the reading `matchSettled` gives, and it is what closes the round.
    const progress = matchProgress(state);
    expect(progress.total).toBe(6);
    expect(progress.done, "a 5&4 match is a decided match").toBe(6);
    expect(progress.pct).toBe(100);

    // The money follows. `roundMoneyIsFinal` settles a round when every hole
    // that will be played is returned OR every match is settled — and a match
    // round that waited for eighteen holes from a match that ended on the 14th
    // would hold its pot open forever.
    const money = await roundMoneyFor(event.id, "");
    const roundMoney = money.rounds.find((r) => r.stageId === round.id);
    expect(roundMoney, "the round is in the money view").toBeTruthy();
    expect(roundMoney!.final, "a settled match round pays out").toBe(true);

    // The bracket is drawn from the standings, so the winner of the 5&4 is in
    // it — the match having produced a result, not a partial card.
    const seeded = new Set(state.qualifiers.map((p) => p.id));
    expect(seeded.size).toBeGreaterThan(0);
    expect(
      state.brackets.winners.rounds[0].matches.some(
        (m) => m.a.playerId === players.p1.id || m.b.playerId === players.p1.id,
      ),
      "the winner of the match that ended early is in the draw",
    ).toBe(true);

    // ── The CARD question, which has the opposite answer ──────────────────
    const by = (id: string) => state.strokeStandings.find((s) => s.player.id === id)!;

    // The join itself: this board was a column of zeros before, because the
    // strokes lived in MatchScorecard and nothing resolved them to a player.
    expect(by(players.p3.id).gross, "three halved rounds in fours").toBe(54 * 4);
    expect(by(players.p3.id).thru).toBe(54);
    expect(by(players.p3.id).holesOwed).toBe(54);
    expect(by(players.p3.id).ranked).toBe(true);
    expect(by(players.p3.id).rank).toBeGreaterThanOrEqual(1);

    // And the two who were in the match that ended on the 14th: shown with the
    // holes they actually played, and holding no position. Fifty holes against
    // somebody else's fifty-four is not a comparison, and net double bogey —
    // right for a handicap record — would put a score on the results sheet
    // that the player never made.
    for (const p of [players.p1, players.p2]) {
      const row = by(p.id);
      expect(row.thru, "fourteen of the first match, then two full rounds").toBe(50);
      expect(row.holesOwed).toBe(54);
      expect(row.ranked, "a card that stopped short holds no position").toBe(false);
      expect(row.rank, "and no rank is invented for it").toBe(0);
      // Shown, not hidden: the strokes actually taken are still on the board.
      expect(row.gross).toBeGreaterThan(0);
    }

    // The standings row still ranks them — on MATCH POINTS, which is what a
    // match-play event is decided on. Their place in the tournament is
    // untouched by the state of their card.
    const rows = standingRows(state);
    const p1Row = rows.find((r) => r.id === players.p1.id)!;
    expect(p1Row.ranked, "a match-play row is ranked on points").toBe(true);
    expect(p1Row.rank).toBeGreaterThanOrEqual(1);
    // ...and it carries the strokes now, where it used to carry a zero.
    expect(p1Row.gross).toBeGreaterThan(0);
    expect(p1Row.thru).toBe(50);
  });

  it("does not report a round final while a match is genuinely still out", async () => {
    // The control for the test above. Without it, "final" could be true for a
    // reason that has nothing to do with the 5&4 card.
    const { event, round } = await flightOfFour("live", { leaveOneLive: true });

    const state = await loadEventState(event.id);
    expect(state).not.toBeNull();
    if (!state) return;
    expect(matchProgress(state).done).toBe(5);
    expect(matchProgress(state).total).toBe(6);

    const money = await roundMoneyFor(event.id, "");
    const roundMoney = money.rounds.find((r) => r.stageId === round.id);
    expect(roundMoney!.final, "one match still out holds the pot open").toBe(false);
  });
});
