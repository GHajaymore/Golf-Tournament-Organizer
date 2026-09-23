import { describe, it, expect } from "vitest";
import { computeStandings } from "../domain/standings";
import {
  buildBracket,
  drawBrackets,
  firstRoundLosers,
  pickQualifiers,
  bracketFinishOrder,
  knockoutProgress,
} from "../domain/bracket";
import type { Match, Player, ScoringRules, HoleResult } from "../domain/types";

/**
 * THE WHOLE SHAPE A CLUB ACTUALLY RUNS, END TO END, IN ONE TEST.
 *
 * Asked for on 2026-09-23: several round robin rounds with the club's own
 * scoring, then ONE qualifying match that sends the winner into a main
 * knockout and the loser into a consolation, then quarter-finals, semi-finals,
 * a final and a third-place play-off.
 *
 * Every piece of that existed and had its own cells. What had never been
 * asserted is that they COMPOSE — which is the class `matrix.test.ts` opens by
 * saying the 2026-08-12 audit found ~80 defects in: "they were in COMBINATIONS
 * nobody had a test for … every part behaves correctly on its own".
 *
 * THE MODE MATTERS AND IS EASY TO GET WRONG. `split` sounds like this shape
 * and is not: it divides the qualifiers by SEEDING before anybody tees off, so
 * "nobody drops into the second bracket, they are drawn into it". The shape
 * described here — win and you go up, lose and you go across — is `plate`, and
 * its own docstring says so: "decided by results rather than by seeding".
 *
 * Sixteen players, so the bracket the qualifying round feeds is a real one:
 *
 *     qualifying (8 matches)  ->  winners:     QF(4) SF(2) F(1)  + 3rd place
 *                             ->  consolation: QF(4) SF(2) F(1)
 */

const HOLES = 18;

/** A card `winner` takes by `by` holes with `left` to play. */
function closeout(winner: "A" | "B", by: number, left: number): HoleResult[] {
  const played = HOLES - left;
  const out: HoleResult[] = [];
  for (let i = 0; i < played; i += 1) out.push(i < by ? winner : "H");
  for (let i = 0; i < left; i += 1) out.push(null);
  return out;
}

/**
 * THE RESULTS ARE CHOSEN SO WINS AND MARGINS DISAGREE, which is the only way
 * this fixture can tell one scoring rule from another.
 *
 * The first draft had the higher-listed player win every match. That is a
 * strict hierarchy, and a strict hierarchy comes out in the same order under
 * ANY monotonic scoring — so the customization test passed the club's rules
 * and the app's defaults as identical and proved nothing about either. The
 * matrix file opens on exactly this: "if it stays green the fixture cannot
 * express a wrong answer, and the cell is decoration".
 *
 * Within each flight of four, over the pairs in the order below:
 *
 *              wins   net holes
 *   seat 0      2       -10      two scrapes and one thrashing taken
 *   seat 1      2        +1
 *   seat 2      1        -1
 *   seat 3      1       +10      lost twice by one, won once by twelve
 *
 * Ranked on WINS, seat 0 is near the top and seat 3 near the bottom. Ranked on
 * HOLES they swap ends. No rule set can satisfy both orders, so a test that
 * compares them is measuring something real.
 */
const PAIRS: Array<[number, number]> = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
];
const RESULTS: Array<{ winner: "A" | "B"; by: number; left: number }> = [
  { winner: "A", by: 1, left: 1 },   // 0 beats 1, one up
  { winner: "A", by: 1, left: 1 },   // 0 beats 2, one up
  { winner: "B", by: 12, left: 5 },  // 3 thrashes 0
  { winner: "A", by: 1, left: 1 },   // 1 beats 2
  { winner: "A", by: 1, left: 1 },   // 1 beats 3
  { winner: "A", by: 1, left: 1 },   // 2 beats 3
];

const field: Player[] = Array.from({ length: 16 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `Player ${i + 1}`,
  handicap: i,          // spread, so a handicap tiebreak cannot be a coin toss
  seed: i + 1,
  groupId: `flight-${Math.floor(i / 4) + 1}`, // four flights of four
}));

const byId = new Map(field.map((p) => [p.id, p]));
const flights = ["flight-1", "flight-2", "flight-3", "flight-4"].map((g) =>
  field.filter((p) => p.groupId === g),
);

/**
 * THE CLUB'S OWN SCORING, not the app's default.
 *
 * Three for a win rather than one, a point for turning up, and holes worth
 * something — the combination a club reaches for when it wants attendance to
 * count and a thrashing to be worth more than a scrape. `maxPerMatch` caps
 * what one match can be worth, which is the guard that stops the hole
 * component swamping the result.
 */
const CLUB_RULES: ScoringRules = {
  winPts: 3,
  tiePts: 1,
  lossPts: 0,
  holeRatioPts: 0.1,
  bonusPts: 0,
  playPts: 1,
  maxPerMatch: 5,
  // The club settles a tie head to head first — "you beat him, you finish
  // above him" — which is the order most committees reach for.
  tiebreakers: ["head-to-head", "holes-won-ratio", "fewest-holes-lost", "lower-handicap"],
};

const DEFAULT_RULES: ScoringRules = {
  winPts: 1,
  tiePts: 0.5,
  lossPts: 0,
  holeRatioPts: 0,
  bonusPts: 0,
  playPts: 0,
  maxPerMatch: 0,
  tiebreakers: ["head-to-head", "holes-won-ratio", "fewest-holes-lost", "lower-handicap"],
};

/**
 * A full round robin inside each flight: every pair once.
 *
 * `swap` mirrors every result for the second qualifying round, so a player
 * cannot be carried by one round alone — the chain has to add both up.
 */
function roundRobin(stageId: string, swap = false): Match[] {
  const out: Match[] = [];
  let n = 0;
  for (const flight of flights) {
    for (const [ai, bi] of PAIRS) {
      const r = RESULTS[PAIRS.findIndex(([x, y]) => x === ai && y === bi)];
      const winner = swap ? (r.winner === "A" ? "B" : "A") : r.winner;
      out.push({
        id: `${stageId}-m${n}`,
        stageId,
        groupId: flight[ai].groupId!,
        round: 1,
        playerAId: flight[ai].id,
        playerBId: flight[bi].id,
        holes: closeout(winner, r.by, r.left),
        forfeitedBy: "",
      } as Match);
      n += 1;
    }
  }
  return out;
}

describe("round robin rounds into a main and a consolation knockout", () => {
  // Two qualifying rounds. The second is deliberately scored the other way up,
  // so a player who did well in round one and badly in round two cannot be
  // carried by either round alone.
  const rr1 = roundRobin("rr1");
  const rr2 = roundRobin("rr2", true);

  it("carries points from one round robin round into the next", () => {
    const afterOne = computeStandings(field, rr1, CLUB_RULES);
    const carried: Record<string, number> = {};
    for (const rp of afterOne) carried[rp.player.id] = rp.stats.totalPoints;

    const chained = computeStandings(field, rr2, CLUB_RULES, carried);
    const standalone = computeStandings(field, rr2, CLUB_RULES);

    // Every chained total is its own round plus what it brought in.
    for (const rp of chained) {
      const own = standalone.find((s) => s.player.id === rp.player.id)!;
      expect(rp.stats.totalPoints).toBeCloseTo(own.stats.totalPoints + carried[rp.player.id], 6);
    }
    // And the carry is not all zeroes, or the assertion above proves nothing.
    expect(Object.values(carried).some((v) => v > 0)).toBe(true);
  });

  it("the club's scoring changes the order — so the customization is real", () => {
    /**
     * THE CONTROL FOR THE CUSTOMIZATION. A settings block that cannot change
     * an outcome is decoration, and a test that runs it without comparing
     * cannot tell the two apart. Same matches, two rule sets, different order.
     */
    const club = computeStandings(field, rr1, CLUB_RULES).map((r) => r.player.id);
    const plain = computeStandings(field, rr1, DEFAULT_RULES).map((r) => r.player.id);
    expect(club).not.toEqual(plain);
  });

  it("sends the qualifying winners up and the losers across, and never both", () => {
    const afterOne = computeStandings(field, rr1, CLUB_RULES);
    const carried: Record<string, number> = {};
    for (const rp of afterOne) carried[rp.player.id] = rp.stats.totalPoints;
    const overall = computeStandings(field, rr2, CLUB_RULES, carried);
    const perFlight = flights.map((f) =>
      computeStandings(f, [...rr1, ...rr2], CLUB_RULES, carried),
    );

    // All four from each flight go through: the qualifying MATCH is what
    // separates them, which is the point of the shape.
    const qualifiers = pickQualifiers(perFlight, 4, overall);
    expect(qualifiers).toHaveLength(16);

    // `plate` is the mode that matches "win and you go up, lose and you go
    // across". Before a result exists the second bracket is empty, and that is
    // the honest state rather than a guess.
    const beforeAnyResult = drawBrackets(qualifiers, "plate");
    expect(beforeAnyResult.main).toHaveLength(16);
    expect(beforeAnyResult.second).toHaveLength(0);
    expect(beforeAnyResult.secondLabel).toBe("Plate");

    // The qualifying round IS the opening round of the main bracket: 8 matches.
    const emptyMain = buildBracket("winners", qualifiers, {});
    expect(emptyMain.rounds[0].matches).toHaveLength(8);

    // Record the qualifying results: the higher seed wins every one, so the
    // expected split is knowable without re-deriving it from the engine.
    const winners: Record<string, string> = {};
    for (const m of emptyMain.rounds[0].matches) {
      const a = m.a.playerId!;
      const b = m.b.playerId!;
      winners[m.key] = byId.get(a)!.seed < byId.get(b)!.seed ? a : b;
    }

    const main = buildBracket("winners", qualifiers, winners);
    const losers = firstRoundLosers(main, byId);
    expect(losers, "eight matches produce eight losers").toHaveLength(8);

    const consolation = buildBracket("consolation", losers, {});
    // Eight into a consolation is a quarter-final, a semi and a final.
    expect(consolation.rounds).toHaveLength(3);
    expect(consolation.rounds[0].matches).toHaveLength(4);

    // NOBODY IS IN BOTH. The rule the whole shape rests on: you go up or you
    // go across, never both, and a player who lost cannot still be alive in
    // the main draw.
    const inConsolation = new Set(losers.map((p) => p.id));
    const stillInMain = new Set(
      main.rounds[1].matches.flatMap((m) => [m.a.playerId, m.b.playerId].filter(Boolean) as string[]),
    );
    for (const id of stillInMain) {
      expect(inConsolation.has(id), `${id} is in the plate and still in the main draw`).toBe(false);
    }
    expect(stillInMain.size).toBe(8);

    // And the two fields together are the whole entry, with nobody lost.
    expect(new Set([...inConsolation, ...stillInMain]).size).toBe(16);
  });

  it("names a champion, a runner-up and a third place once the last match is in", () => {
    const qualifiers = [...field];
    const seedWins = (view: ReturnType<typeof buildBracket>, acc: Record<string, string>) => {
      for (const round of view.rounds) {
        for (const m of round.matches) {
          const a = m.a.playerId;
          const b = m.b.playerId;
          if (!a || !b) continue;
          acc[m.key] = byId.get(a)!.seed < byId.get(b)!.seed ? a : b;
        }
      }
      return acc;
    };

    // Play the main draw out, round by round, because later rounds only exist
    // once the earlier ones are decided.
    let winners: Record<string, string> = {};
    for (let pass = 0; pass < 4; pass += 1) {
      winners = seedWins(buildBracket("winners", qualifiers, winners), { ...winners });
    }
    const main = buildBracket("winners", qualifiers, winners);

    const progress = knockoutProgress(main);
    expect(progress.decided).toBe(progress.total);

    // Seed 1 beats everybody on this rule, and seed 2 is the other finalist.
    const order = bracketFinishOrder(main, null);
    expect(order[0].name).toBe("Player 1");
    expect(order[1].name).toBe("Player 2");

    /**
     * THIRD PLACE IS A MATCH, NOT AN INFERENCE. Two players lose a semi-final
     * and nothing about the draw says which of them finished third — only the
     * play-off does. With no result recorded they must not be separated.
     */
    const losingSemiFinalists = order.filter((p) => p.rank === 3).map((p) => p.playerId);
    expect(losingSemiFinalists).toHaveLength(2);

    const withPlayOff = bracketFinishOrder(main, losingSemiFinalists[1]);
    const third = withPlayOff.find((p) => p.rank === 3)!;
    const fourth = withPlayOff.find((p) => p.rank === 4)!;
    expect(third.playerId).toBe(losingSemiFinalists[1]);
    expect(fourth.playerId).toBe(losingSemiFinalists[0]);
  });
});
