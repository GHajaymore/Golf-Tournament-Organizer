import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState, standingRows } from "@/lib/services/tournament";

/**
 * A MEDAL ROUND CAN REACH THE BOARD, EVEN IN AN EVENT THAT HAS A GROUP PHASE.
 *
 * `activeStage` is `rrStages[activeRrIdx] ?? rrStages[last] ?? playRounds[played]`
 * and the second fallback beats the third UNCONDITIONALLY. So an event holding
 * any Round Robin at all could never put a medal round on the board: the group
 * phase won even after the field had finished a Stroke Play Round with every
 * card in.
 *
 * Measured on 2026-09-12 on a three-week league — a match night, a legacy medal
 * (Round Robin set to Stroke Play) and a Stroke Play Round, cards in on both
 * medals:
 *
 *   playRounds  = Week 1, Week 2, Week 3
 *   activeStage = Week 1            <- what every board showed
 *   last played = Week 3
 *
 * It predates `boardStage`: the four boards each wrote `activeStage ?? stages[0]`
 * for themselves and all four had the same answer. Centralising them is what
 * made it one line to fix rather than five, and is why it was found at all —
 * the sweep that followed the blank-score regression went looking for readers
 * of the wrong question and turned up a wrong ANSWER underneath them.
 *
 * WHY ONLY A LATER ROUND WINS. `activeStage` is also the match-points chain's
 * position, and `currentRoundIndex` has a rule worth keeping: a week whose
 * matches are drawn but unplayed is current, where `currentPlayedRoundIndex`
 * would fall back to the week before. Taking the later of the two keeps that
 * for a plain league and still lets a medal round reach the board. The last
 * case below is the one that pins it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-LATESTROUND";

let league = "";
let leagueWeek3 = "";
let drawnNotPlayed = "";
let drawnNotPlayedWeek2 = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function makeEvent(name: string) {
  const org = await prisma.organization.create({
    data: { name: `${TAG} ${name}`, kind: "club" },
    select: { id: true },
  });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} ${name}`,
      organizationId: org.id,
      shape: "series",
      format: "match",
      status: "active",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}`,
    },
    select: { id: true },
  });
  const group = await prisma.group.create({
    data: { eventId: ev.id, name: `${TAG} g`, position: 0 },
    select: { id: true },
  });
  const players = [];
  for (let i = 0; i < 2; i += 1) {
    players.push(
      await prisma.player.create({
        data: {
          eventId: ev.id,
          groupId: group.id,
          name: `${TAG} P${i + 1}`,
          email: `${TAG}-${name}-${i}@example.invalid`.toLowerCase(),
          seed: i + 1,
          status: "confirmed",
          handicap: 0,
        },
        select: { id: true },
      }),
    );
  }
  return { eventId: ev.id, groupId: group.id, players };
}

const stage = (eventId: string, position: number, description: string, type: string, format: string) =>
  prisma.stage.create({
    data: { eventId, position, description, type, format, scoringBasis: "gross", holes: 18 },
    select: { id: true },
  });

beforeAll(async () => {
  await scrub();

  /**
   * A LEAGUE THAT HAS MOVED ON. Week 1 is a decided match night; weeks 2 and 3
   * are medals with every card in. Week 2 is the LEGACY shape — a Round Robin
   * set to Stroke Play — deliberately, because it is in `rrStages` by type and
   * so is exactly what the old fallback would have grabbed.
   */
  {
    const { eventId, groupId, players } = await makeEvent("league-has-moved-on");
    league = eventId;
    const w1 = await stage(eventId, 0, "Week 1", "Round Robin", "Match Play");
    await prisma.match.create({
      data: {
        eventId,
        stageId: w1.id,
        groupId,
        round: 1,
        playerAId: players[0].id,
        playerBId: players[1].id,
        holes: JSON.stringify(["A", "A", "A", "A", "A", ...new Array(13).fill(null)]),
      },
    });
    const w2 = await stage(eventId, 1, "Week 2", "Round Robin", "Stroke Play");
    const w3 = await stage(eventId, 2, "Week 3", "Stroke Play Round", "Stroke Play");
    leagueWeek3 = w3.id;
    for (const s of [w2, w3]) {
      for (const [i, p] of players.entries()) {
        await prisma.scorecard.create({
          data: {
            eventId,
            stageId: s.id,
            playerId: p.id,
            strokes: JSON.stringify([...new Array(17).fill(4), 4 + i * 3]),
          },
        });
      }
    }
  }

  /**
   * THE CASE THAT KEEPS THE FIX NARROW. Week 1 is played out; week 2 is DRAWN
   * and not started. `currentRoundIndex` calls week 2 current — that is its
   * rule, and it is the right one for "which round are we on" — while the
   * last round with results is week 1. A fix reading the played round outright
   * would move this board BACKWARDS onto a finished week.
   */
  {
    const { eventId, groupId, players } = await makeEvent("drawn-not-played");
    drawnNotPlayed = eventId;
    const w1 = await stage(eventId, 0, "Week 1", "Round Robin", "Match Play");
    await prisma.match.create({
      data: {
        eventId,
        stageId: w1.id,
        groupId,
        round: 1,
        playerAId: players[0].id,
        playerBId: players[1].id,
        holes: JSON.stringify(["A", "A", "A", "A", "A", ...new Array(13).fill(null)]),
      },
    });
    const w2 = await stage(eventId, 1, "Week 2", "Round Robin", "Match Play");
    drawnNotPlayedWeek2 = w2.id;
    // Drawn, and NOT A HOLE ON IT. The absence is the fixture.
    await prisma.match.create({
      data: {
        eventId,
        stageId: w2.id,
        groupId,
        round: 1,
        playerAId: players[0].id,
        playerBId: players[1].id,
        holes: JSON.stringify(new Array(18).fill(null)),
      },
    });
  }
}, 120_000);

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const stateOf = async (id: string) => {
  const s = await loadEventState(id);
  expect(s, "no state at all").toBeTruthy();
  return s!;
};

describe("the board follows the field", () => {
  it("shows the medal the field has just played, not the group phase", async () => {
    const state = await stateOf(league);
    expect(state.boardStage?.id, "the board was stuck on the group phase").toBe(leagueWeek3);
    expect(state.boardStage?.description).toBe("Week 3");
    // And it is scored as a medal, which is the whole reason the round matters.
    expect(state.boardIsStroke).toBe(true);
  });

  it("counts the medal rounds' cards at all", async () => {
    /**
     * THE DEEPER HALF, and the one moving the board exposed.
     *
     * `strokeRounds` is the set of rounds this board may add together, and the
     * rule — rounds add up when they measure the same unit — is right. What was
     * wrong is WHICH round set that unit: `activeStage`, which for any event
     * holding a Round Robin is a Round Robin. So `carryUnitsCompatible`
     * measured every round against MATCH PLAY and the medals were filtered out
     * entirely. Their cards were counted nowhere.
     *
     * Read off the Demo Cup on 2026-09-12, read-only, before the fix:
     *
     *   strokeRounds = Round Robin | Single Match Stage | Bracket Stage
     *   strokeUnit   = "match points"
     *   cards on the medal round = 7, of which 0 were in strokeRounds
     *
     * Both medals here, and NOT the match night — which is the half that
     * proves the unit rule still bites.
     */
    const state = await stateOf(league);
    expect(state.strokeUnit).toBe("strokes");
    expect(state.strokeRounds.map((s) => s.description)).toEqual(["Week 2", "Week 3"]);
  });

  it("ranks the board on what the board is showing", async () => {
    /**
     * `standingRows` branched on `state.isStroke` — the EVENT — while the board
     * beside it printed whatever `boardIsStroke` said. When the two disagree
     * the result is a board ordered by match points with a strokes column, and
     * on the Demo Cup that read `rank1 gross0 thru0` for players who had never
     * touched the medal round.
     *
     * This could not be fixed when it was first tried: three audit fixtures
     * went red, because `boardIsStroke` was itself still wrong for a legacy
     * medal. Reverting was right then. With that fixed the whole suite passes,
     * which is the difference between a change being wrong and being early.
     */
    const state = await stateOf(league);
    const rows = standingRows(state).filter((r) => r.ranked);
    expect(rows.length).toBe(2);
    // 72 and 75 twice over — the two medal weeks summed, which is the existing
    // rule for rounds that measure the same thing.
    expect(rows.map((r) => r.gross)).toEqual([144, 150]);
    expect(rows.map((r) => r.thru)).toEqual([36, 36]);
    // And no win-loss-halved record, because a medal has none. This is the
    // exact cell that was blank the other way round on a legacy medal.
    expect(rows.every((r) => r.record === "")).toBe(true);
  });

  it("leaves the match-points chain where it was", async () => {
    /**
     * `activeStage` is not just "the current round" — it is where the chained
     * standings have been computed to, and `overall` is built by walking
     * `rrStages` up to it. Moving the BOARD must not move the CHAIN, or a
     * league's points would follow whichever medal night happened last.
     */
    const state = await stateOf(league);
    expect(state.activeStage?.description, "the chain followed the board").toBe("Week 1");
    expect(state.boardStage).not.toBe(state.activeStage);
  });
});

describe("a round that is drawn but unplayed is still the current one", () => {
  it("does not send the board back to a finished week", async () => {
    /**
     * THE NARROWING, and it is not decoration: this is the case that makes the
     * obvious fix — read the played round outright — wrong. Week 2 is drawn
     * with no holes on it, so the last round with RESULTS is week 1. Only a
     * LATER round may take the board, so week 2 keeps it.
     */
    const state = await stateOf(drawnNotPlayed);
    expect(state.boardStage?.id, "the board fell back to a finished week").toBe(drawnNotPlayedWeek2);
    expect(state.boardStage).toBe(state.activeStage);
  });
});
