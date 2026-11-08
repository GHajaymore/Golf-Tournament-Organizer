// Standings: aggregate player records from match data, apply the configured
// scoring + tiebreaker chain, rank within groups and overall, and compute the
// qualification cutoff. All values are derived on every call — never stored.

import { resolveMatch, countedHoles } from "./match";
import { breakMatchTie, type MatchTiebreakKey } from "./match-tiebreak";
import { toughestN, DEFAULT_TIEBREAKERS } from "./types";
import { placeByPointsThenSteps, type LevelStep } from "./level-places";
import type {
  Match,
  Player,
  PlayerStats,
  ScoringRules,
  TiebreakerKey,
} from "./types";

export interface RankedPlayer {
  player: Player;
  stats: PlayerStats;
  /** 1-based rank within the ranking context this appears in. */
  rank: number;
}

/**
 * THE CARD A MATCH'S HOLES ARE RANKED ON, for every "toughest N holes" step —
 * the all-square countback that decides a halved match, and the standings
 * tiebreaker that compares records on the hardest holes.
 *
 * Either ONE card every match here was played on (a domain test; a fixture of
 * one venue), or a function giving each match its OWN card. Every server
 * reader passes the function, built by `matchCountbackIndex`
 * (services/course-resolution.ts), because a league or interclub plays its
 * weeks at different clubs: the toughest holes of an away match are the away
 * card's, and until J26 (2026-11-06) the standings, the week view and the
 * head-to-head record all read the TOURNAMENT's card for every match — so an
 * away match halved on the course was decided on holes nobody played as the
 * hardest. `the-countback-card-is-the-match-venue.test.ts` refuses a reader
 * that goes back to one card for the whole tournament.
 */
export type MatchStrokeIndex = number[] | ((m: Match) => number[]);

/** The stroke index this match's toughest holes are ranked on. */
export function strokeIndexOfMatch(card: MatchStrokeIndex | undefined, m: Match): number[] {
  if (!card) return [];
  return typeof card === "function" ? card(m) : card;
}

/** How an all-square match is decided, and the card(s) it is decided on. */
export interface MatchTiebreak {
  sequence: MatchTiebreakKey[];
  strokeIndex: MatchStrokeIndex;
}

const emptyStats = (playerId: string): PlayerStats => ({
  playerId,
  played: 0,
  playedForPoints: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  holesWon: 0,
  holesLost: 0,
  points: 0,
  totalPoints: 0,
});

/**
 * Aggregate raw stats for a set of players from the matches they appear in.
 * Holes won/lost accumulate from every entered hole (live), while W/L/T and
 * `played` count only completed matches.
 */
export function aggregateStats(
  players: Player[],
  matches: Match[],
  scoring: ScoringRules,
  carriedPoints: Record<string, number> = {},
  /**
   * How an all-square match is decided, and the card to decide it on.
   *
   * Applied here rather than stored on the match, so changing the sequence
   * re-decides every affected match instead of leaving results frozen at
   * whatever rule was in force when the card was entered.
   */
  matchTiebreak?: MatchTiebreak,
): Map<string, PlayerStats> {
  const stats = new Map<string, PlayerStats>();
  for (const p of players) stats.set(p.id, emptyStats(p.id));

  /**
   * Points earned match by match, so a cap has something to cap.
   *
   * The totals below used to be worked out from season aggregates —
   * wins × winPts plus holesWon × holeRatioPts — which cannot express "no
   * more than N from any one match". Summing per match instead gives exactly
   * the same number when no cap is set (the sum of the parts is the whole),
   * and gives the cap somewhere to bite when there is one.
   */
  const earned = new Map<string, number>();
  const take = (playerId: string, outcomePts: number, holesWon: number) => {
    const raw = outcomePts + holesWon * scoring.holeRatioPts;
    const capped = scoring.maxPerMatch > 0 ? Math.min(raw, scoring.maxPerMatch) : raw;
    earned.set(playerId, (earned.get(playerId) ?? 0) + capped);
  };

  for (const m of matches) {
    const a = stats.get(m.playerAId);
    const b = stats.get(m.playerBId);
    if (!a && !b) continue;

    /**
     * A forfeited match is decided by the forfeit, not by the card.
     *
     * The opponent takes the win and the configured win points; the player who
     * forfeited takes the configured loss points and nothing else — no holes,
     * and no point for playing, because they did not play it. Whatever holes
     * were entered before they walked in are discarded rather than counted:
     * crediting a conceder the three holes he was up would flatter him in
     * hole differential, which is what the flight is ranked on.
     */
    const conceded = forfeitWinnerSide(m);
    if (conceded) {
      const forfeitedBy = conceded === "B" ? m.playerAId : m.playerBId;
      const loser = conceded === "B" ? a : b;
      const winner = conceded === "B" ? b : a;
      const winnerId = conceded === "B" ? m.playerBId : m.playerAId;
      if (loser) {
        loser.played += 1;
        loser.losses += 1;
      }
      if (winner) {
        winner.played += 1;
        winner.wins += 1;
        winner.playedForPoints += 1;
      }
      if (loser) take(forfeitedBy, scoring.lossPts, 0);
      if (winner) take(winnerId, scoring.winPts, 0);
      continue;
    }

    const r = resolveMatch(m.holes);

    if (a) {
      a.holesWon += r.holesWonA;
      a.holesLost += r.holesWonB;
    }
    if (b) {
      b.holesWon += r.holesWonB;
      b.holesLost += r.holesWonA;
    }

    if (r.complete) {
      if (a) a.playedForPoints += 1;
      if (b) b.playedForPoints += 1;
      if (a) a.played += 1;
      if (b) b.played += 1;
      // A halved match is only halved if nothing decides it. The countback
      // runs here so the points follow the organizer's rule rather than the
      // raw card.
      const decided =
        r.winner === "H" && matchTiebreak?.sequence.length
          ? breakMatchTie(m.holes, strokeIndexOfMatch(matchTiebreak.strokeIndex, m), matchTiebreak.sequence).winner
          : null;
      const outcome = decided ?? r.winner;

      if (outcome === "H") {
        if (a) a.ties += 1;
        if (b) b.ties += 1;
      } else if (outcome === "A") {
        if (a) a.wins += 1;
        if (b) b.losses += 1;
      } else if (outcome === "B") {
        if (b) b.wins += 1;
        if (a) a.losses += 1;
      }

      const ptsFor = (side: "A" | "B") =>
        outcome === "H" ? scoring.tiePts : outcome === side ? scoring.winPts : scoring.lossPts;
      if (a) take(m.playerAId, ptsFor("A"), r.holesWonA);
      if (b) take(m.playerBId, ptsFor("B"), r.holesWonB);
    } else {
      // A match still being played pays nothing for an outcome it hasn't had,
      // but its holes already count — that is what makes the board move during
      // the round. Capped the same way, so a live blowout can't sail past the
      // limit and then fall back to it when the match finishes.
      if (a) take(m.playerAId, 0, r.holesWonA);
      if (b) take(m.playerBId, 0, r.holesWonB);
    }
  }

  for (const s of stats.values()) {
    // The bonus and the appearance points sit outside the cap: both are
    // awarded for taking part, not earned from any one match. `playPts` is per
    // match contested, which is what makes it different from the flat bonus —
    // in a league where availability varies, turning up eight times should not
    // pay the same as turning up once.
    s.points =
      (earned.get(s.playerId) ?? 0) + scoring.bonusPts + scoring.playPts * s.playedForPoints;
    s.totalPoints = s.points + (carriedPoints[s.playerId] ?? 0);
  }

  return stats;
}

/**
 * Head-to-head as a NUMBER, over the players who are actually tied.
 *
 * A pairwise comparison is not a total order. Beating each other in a
 * cycle — A beat B, B beat C, C beat A — is an ordinary thing to happen in a
 * round robin, and `Array.sort` given an intransitive comparator returns
 * whatever its algorithm happens to produce: the order then depends on how
 * many OTHER players are in the array. The audit found exactly that, two
 * players level on points ranking differently over a field of 24 than over 28,
 * which is a leaderboard that changes when somebody unrelated enters.
 *
 * So the tie is broken the way golf and every league actually breaks it: a
 * mini-league among the tied players only. Wins less losses against that
 * group is a scalar, scalars are transitive, and for the common case of two
 * players it is exactly the old answer — who won the meeting.
 *
 * And it decides the SHARED PLACE as well as the order (2026-11-07): the
 * group is asked once, a part left level is asked again over only its own
 * members, and a cycle that the mini-league cannot separate goes on to the
 * next step together (`placesOfLevelGroup`, domain/level-places.ts). The
 * pairwise `headToHead` that the shared place used to be asked of is gone.
 *
 * A MEETING NOT YET PLAYED COUNTS FOR NOTHING, deliberately: an unplayed match
 * cannot be held against anybody. So while a round robin is still being played
 * (the normal live state), a player who has not met the others in the group
 * scores 0 and sits BETWEEN those who won their meetings and those who lost
 * them. Said in the tie-break's help, the guide and knockouts-and-leagues.md.
 */
/**
 * Which side won by forfeit, or null when the match was played out.
 *
 * The one place that answers it. `aggregateStats` already honoured a forfeit,
 * but the two tiebreakers below went to the card themselves — so a conceder
 * three up when he walked in was reported as having WON the meeting, and the
 * holes the forfeit discards still counted towards his differential. Two
 * players level on points could be separated by a match one of them never
 * finished, in favour of the one who quit.
 *
 * Returns null when `forfeitedBy` names neither player. That covers a team
 * round, where the forfeit holds a team id and the player columns are empty:
 * such a match contributes nothing to a player's record either way, and
 * guessing a side from an id that is not in it would be worse than ignoring
 * it.
 */
function forfeitWinnerSide(m: Match): "A" | "B" | null {
  const by = m.forfeitedBy ?? "";
  if (!by) return null;
  if (by === m.playerAId) return "B";
  if (by === m.playerBId) return "A";
  return null;
}

function miniLeague(
  playerId: string,
  tied: Player[],
  matches: Match[],
  matchTiebreak?: MatchTiebreak,
): number {
  const others = new Set(tied.map((p) => p.id).filter((id) => id !== playerId));
  if (others.size === 0) return 0;

  let score = 0;
  for (const m of matches) {
    const isA = m.playerAId === playerId;
    const isB = m.playerBId === playerId;
    if (!isA && !isB) continue;
    const opponent = isA ? m.playerBId : m.playerAId;
    if (!others.has(opponent)) continue;

    // Forfeit and all-square countback both handled in one place, so this
    // agrees with the wins and losses on the table.
    const outcome = decidedOutcome(m, matchTiebreak);
    if (outcome === null || outcome === "H") continue;
    const wonIt = (outcome === "A" && isA) || (outcome === "B" && isB);
    score += wonIt ? 1 : -1;
  }
  return score;
}

/**
 * How a match FINISHED, as the standings count it.
 *
 * `aggregateStats` already answers this: a forfeit decides the meeting, and a
 * card that comes back all square is put through `breakMatchTie` when the
 * organizer has configured a sequence, so the wins and losses on the table
 * reflect the countback.
 *
 * `headToHead` and `miniLeague` answered it separately and stopped at
 * `r.winner === "H"`, treating a match the countback had decided as no meeting
 * at all. So two players level on points, one of whom beat the other on the
 * all-square countback, fell straight through head-to-head to whatever the
 * next tiebreaker said — and the table showed the win.
 *
 * One reader now, because a tiebreaker disagreeing with the record it is
 * breaking a tie about is the whole fault.
 *
 * Returns null for a match with no result yet — not "H", which means played
 * and level.
 *
 * EXPORTED for the head-to-head record (2026-09-28), which must count a
 * meeting exactly as the table that meeting was part of counted it.
 */
export function decidedOutcome(
  m: Match,
  matchTiebreak?: MatchTiebreak,
): "A" | "B" | "H" | null {
  const conceded = forfeitWinnerSide(m);
  if (conceded) return conceded;

  const r = resolveMatch(m.holes);
  if (!r.complete || !r.winner) return null;
  if (r.winner !== "H") return r.winner;
  if (!matchTiebreak?.sequence.length) return "H";
  return breakMatchTie(m.holes, strokeIndexOfMatch(matchTiebreak.strokeIndex, m), matchTiebreak.sequence).winner ?? "H";
}

/** Indexes (0-based) of the `n` hardest holes, by ascending stroke index (1 = hardest). */
function toughestHoleIndexes(strokeIndex: number[], n: number): Set<number> {
  return new Set(
    strokeIndex
      .map((si, i) => ({ si, i }))
      .sort((a, b) => a.si - b.si)
      .slice(0, n)
      .map((x) => x.i),
  );
}

/**
 * A player's (holes won − holes lost) on the `n` hardest holes OF EACH MATCH'S
 * OWN CARD, across all their matches — an away match's hardest holes are the
 * away card's (`MatchStrokeIndex`).
 */
function holesDiffOn(playerId: string, matches: Match[], card: MatchStrokeIndex, n: number): number {
  let diff = 0;
  for (const m of matches) {
    const isA = m.playerAId === playerId;
    const isB = m.playerBId === playerId;
    if (!isA && !isB) continue;
    // A forfeited match has no card worth reading. aggregateStats discards
    // those holes for exactly this reason — crediting a conceder the holes he
    // was up flatters him — and this tiebreaker was still counting them, on
    // the six hardest holes of the course.
    if (forfeitWinnerSide(m)) continue;
    /**
     * And only the holes the RESULT counted.
     *
     * Same argument as the forfeit above, one step further. `resolveMatch`
     * stops at the closeout — Rule 3.2a(3), a match ends when one side leads
     * by more holes than remain — and its own comment says why: holes played
     * after that "must not be part of the record either", because they were
     * feeding `holes-won-ratio` and `fewest-holes-lost`.
     *
     * That fix went into `resolveMatch` and this reader was missed, so a
     * player beaten 3&2 who took the 17th and 18th in the walk-in had those
     * two holes excluded from every stat and counted here — on the six
     * hardest holes of the course, deciding a tie about the very match the
     * result says ended two holes earlier.
     */
    const counted = countedHoles(m.holes);
    const holeIdxs = toughestHoleIndexes(strokeIndexOfMatch(card, m), n);
    for (const idx of holeIdxs) {
      const h = counted[idx];
      if (h === null || h === undefined || h === "H") continue;
      const won = (h === "A" && isA) || (h === "B" && isB);
      diff += won ? 1 : -1;
    }
  }
  return diff;
}

/**
 * One step of the committee's chain as a FIGURE per player, higher is better,
 * asked of the group of players it is separating (`LevelStep`).
 *
 * Head-to-head is the only step whose figure depends on the group: the
 * mini-league among exactly those players (`miniLeague`). Everything else is
 * the player's own record. The pairwise comparator this replaced
 * (`tiebreakerCompare`, with a two-player `headToHead` fallback) answered "did
 * these two separate" of a pair's own meeting, which in a cycle is a different
 * question from the one the group's order was decided on.
 */
function chainStep(
  key: TiebreakerKey,
  stats: Map<string, PlayerStats>,
  matches: Match[],
  holeDifficulty: MatchStrokeIndex | undefined,
  /** The round's all-square rule, so a decided halved match counts as a meeting. */
  matchTiebreak: MatchTiebreak | undefined,
): LevelStep<Player> {
  const own = (figure: (s: PlayerStats, p: Player) => number): LevelStep<Player> => ({
    score: (p) => figure(stats.get(p.id)!, p),
    regroup: false,
  });
  switch (key) {
    case "head-to-head":
      return { score: (p, group) => miniLeague(p.id, [...group], matches, matchTiebreak), regroup: true };
    case "most-wins":
      return own((s) => s.wins); // more wins ranks first
    case "win-percentage":
      return own((s) => (s.played > 0 ? s.wins / s.played : 0)); // higher win% ranks first
    case "holes-won-ratio":
      return own((s) => s.holesWon - s.holesLost); // higher differential ranks first
    case "fewest-holes-lost":
      return own((s) => -s.holesLost); // fewer lost ranks first
    case "lower-handicap":
      return own((_, p) => -p.handicap); // lower handicap ranks first
    default: {
      // The countbacks. N is part of the key rather than one of two fixed
      // choices, so a committee can write its own ladder — hardest 9, then 6,
      // then 3, then the hardest hole — and toughestN rejects anything outside
      // 1..18, which is how a bad key from the database decides nothing rather
      // than reading holes that do not exist.
      const n = toughestN(key);
      // No course/stroke-index data available — the step decides nothing and
      // the next is asked. (A per-match card with no index ranks no holes for
      // that match.)
      if (n === null || !holeDifficulty || (Array.isArray(holeDifficulty) && holeDifficulty.length === 0)) {
        return own(() => 0);
      }
      // Better record on the toughest holes ranks first.
      return own((_, p) => holesDiffOn(p.id, matches, holeDifficulty, n));
    }
  }
}

/**
 * Rank players by total points desc, then the configured tiebreaker chain.
 * Falls back to seed for a fully deterministic ordering.
 */
/**
 * Two chains, same keys in the same order.
 *
 * Order matters and is not incidental: a committee that reorders the default
 * four has configured a chain, and reading that as "untouched" would ignore
 * the one decision they made.
 */
function sameChain(a: readonly TiebreakerKey[], b: readonly TiebreakerKey[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

export function rankPlayers(
  players: Player[],
  stats: Map<string, PlayerStats>,
  scoring: ScoringRules,
  matches: Match[],
  /** Stroke index per hole (1 = hardest) — each match's own card — for the "toughest N holes" tiebreakers. Omit if unknown. */
  holeDifficulty?: MatchStrokeIndex,
  /**
   * The round's all-square rule.
   *
   * `aggregateStats` already receives this and applies it to wins and losses.
   * Without it here, head-to-head read a match the countback had decided as no
   * meeting at all — the table showed the win and the tiebreaker did not.
   */
  matchTiebreak?: MatchTiebreak,
): RankedPlayer[] {
  // `DEFAULT_TIEBREAKERS`, not a fourth copy of the same four keys. It is the
  // same array the schema hands every event, which is what makes the
  // "did anybody choose this" test below possible at all.
  //
  // AN EMPTY CHAIN IS A CHOICE, NOT AN ABSENCE. This read `?.length ?`, so a
  // committee that unticked every tie-breaker was handed the default four
  // back — under a screen saying none were active. Only a chain that is not
  // there at all takes the default; an empty one separates nobody, and players
  // level on points share the place (how ties are decided is the Committee's
  // to set — Committee Procedures 5A(6)).
  const chain = Array.isArray(scoring.tiebreakers) ? scoring.tiebreakers : DEFAULT_TIEBREAKERS;

  /**
   * TWO PLAYERS NOTHING SEPARATES SHARE A PLACE.
   *
   * This numbered `i + 1` down the sorted list, so `overall` could never hold
   * the same rank twice — however level two players actually were. The sort's
   * last fallback is `seed`, which is entry order, so a genuine dead heat was
   * silently broken by whoever signed up first and the board printed 1 and 2
   * as though somebody had won.
   *
   * It is not only a display fault. `suggestChampion` refuses to name a
   * champion when `leaders.length > 1`, and that branch could never fire for
   * any non-stroke event — so a two-player match halved on the last green put
   * the lower seed on the club's honours board, permanently, with no tie for a
   * committee to resolve. The stroke board has always shared ranks; this is
   * the same rule on the other one.
   *
   * "Nothing separates them" means the points are equal AND every tiebreaker
   * the organizer configured returned zero. The seed fallback above is
   * deliberately not consulted: it exists to make the ORDER stable, which a
   * list still needs, and using it here is exactly what hid the tie.
   *
   * HANDICAP IS THE SAME KIND OF THING AS SEED, and is excluded for the same
   * reason. It makes the ORDER deterministic; it does not mean anybody beat
   * anybody. Everything else in the chain is a RESULT — who won the meeting,
   * holes won, holes lost, the hardest six — and a place is shared unless
   * something a player DID separates them.
   *
   * Measured before changing it, because the consequence is not theoretical:
   *
   *   two players halve their match  ->  1st and 2nd, the lower handicap "won"
   *   eight players, nobody has played  ->  places 1 to 8 in handicap order
   *
   * The second is the one somebody walks past on a clubhouse screen: before a
   * ball is struck, the board names a leader. Both are the same fault, which
   * is a number that is not a result deciding a tie.
   *
   * NOTHING IS MIGRATED AND NO CONFIGURED CHAIN CHANGES. `lower-handicap` is
   * the last entry of the schema's own column default, so every event carries
   * it whether or not anybody chose it, and the two cannot be told apart from
   * the data. It still orders the list exactly as it did — the board reads in
   * the same sequence today as yesterday — it just stops claiming that a
   * halved match had a winner.
   *
   * A committee that must produce ONE name still can: a tie on the board is
   * what a play-off or a committee decision resolves, and neither is the
   * leaderboard's job to invent. See `suggestChampion`, which already refuses
   * to name a champion while `leaders.length > 1`.
   */
  /**
   * THE COMMITTEE'S CHAIN WINS. The standard only applies where there isn't one.
   *
   * `lower-handicap` is the last entry of the schema's own column default, so
   * EVERY event carries it whether or not anybody opened Rounds & formats. That
   * is the whole difficulty: the stored value cannot, by itself, tell "the
   * committee chose this" from "nobody ever looked".
   *
   * It can be told by comparing against the default itself. A chain that still
   * equals `DEFAULT_TIEBREAKERS` exactly is one nobody has touched, so the
   * standard applies and a handicap does not break a tie. A chain that differs
   * in any way — a key added, removed, or reordered — was configured by a
   * person, and it is honoured exactly as written, `lower-handicap` included.
   *
   * That is the rule Ajay asked for on 2026-09-15: the standard as the default,
   * overridden by the custom rule where there is one. It needs no migration and
   * takes nothing away from a club that genuinely wants handicap to settle a
   * tie — they say so on the screen built for saying it.
   *
   * THE COLUMN DEFAULT IS NOW LOAD-BEARING. It is the sentinel for "unset", so
   * changing it would silently re-read every untouched event as configured.
   * Change `DEFAULT_TIEBREAKERS` and this and the schema together, or not at
   * all.
   *
   * The narrow cost, stated rather than hidden: a committee that deliberately
   * picks exactly the default four reads as untouched. They get shared places
   * on a genuine dead heat, which is the standard answer anyway — and moving
   * any entry makes their choice legible again.
   */
  const configured = !sameChain(chain, DEFAULT_TIEBREAKERS);

  /**
   * And on an untouched chain, a handicap orders the list without deciding it.
   *
   * Exactly how `seed` is already treated a few lines below: it exists to make
   * the ORDER stable, which a list still needs, and it does not mean anybody
   * beat anybody. Everything else in the chain is a RESULT — who won the
   * meeting, holes won, holes lost, the hardest six.
   */
  const separating = configured ? chain : chain.filter((key) => key !== "lower-handicap");

  /**
   * PLACES ARE DECIDED OVER THE WHOLE LEVEL GROUP, NOT PAIR BY PAIR
   * (2026-11-07). `placeByPointsThenSteps` (`domain/level-places.ts`) groups
   * the table by points and asks each separating step of the group: head-to-
   * head as the group's own mini-league, re-asked of any part it leaves level;
   * a cycle goes on to the next step together; whoever the chain cannot
   * separate shares the place.
   *
   * Until then the ORDER was the group's mini-league but the SHARED PLACE was
   * asked of each neighbouring pair's own meeting — so three players beating
   * each other in a circle were numbered 2, 3, 4 in entry order, and a cut on
   * countback sent the earliest entry through instead of owing a draw.
   *
   * The steps that do not separate (a handicap on an untouched chain) still
   * order a shared place, and then the seed does: the list keeps the order it
   * has always had inside a tie, and stops claiming that order is a result.
   */
  const steps = separating.map((key) => chainStep(key, stats, matches, holeDifficulty, matchTiebreak));
  const orderOnly = chain
    .filter((key) => !separating.includes(key))
    .map((key) => chainStep(key, stats, matches, holeDifficulty, matchTiebreak));
  const within = (a: Player, b: Player): number => {
    for (const step of orderOnly) {
      const d = step.score(b, []) - step.score(a, []);
      if (d !== 0) return d;
    }
    return a.seed - b.seed;
  };
  // Seed order in, so two players with the same seed keep a stable order.
  const bySeed = [...players].sort((a, b) => a.seed - b.seed);
  return placeByPointsThenSteps(bySeed, (p) => stats.get(p.id)?.totalPoints ?? 0, steps, within).map(
    ({ row, place }) => ({ player: row, stats: stats.get(row.id)!, rank: place }),
  );
}

/** Convenience: aggregate + rank in one call for a group or the whole field. */
export function computeStandings(
  players: Player[],
  matches: Match[],
  scoring: ScoringRules,
  carriedPoints: Record<string, number> = {},
  /** Each match's card for the toughest-holes steps (`MatchStrokeIndex`). */
  holeDifficulty?: MatchStrokeIndex,
  matchTiebreakers: MatchTiebreakKey[] = [],
): RankedPlayer[] {
  const stats = aggregateStats(players, matches, scoring, carriedPoints, {
    sequence: matchTiebreakers,
    strokeIndex: holeDifficulty ?? [],
  });
  return rankPlayers(players, stats, scoring, matches, holeDifficulty, {
    sequence: matchTiebreakers,
    strokeIndex: holeDifficulty ?? [],
  });
}

/**
 * Qualification cutoff for a single group: the totalPoints of the last player
 * who still advances (the `qualifyPerGroup`-th ranked player). Returns null if
 * the group has fewer players than the cutoff.
 */
export function groupCutoff(ranked: RankedPlayer[], qualifyPerGroup: number): number | null {
  if (ranked.length === 0 || qualifyPerGroup <= 0) return null;
  const idx = Math.min(qualifyPerGroup, ranked.length) - 1;
  return ranked[idx].stats.totalPoints;
}

/** Players who share the position that the cut line runs through. */
export interface CutLineTie {
  /** The shared finishing position — the one printed twice on the board. */
  rank: number;
  /** Everyone on it: some marked advancing, at least one not. */
  playerIds: string[];
}

/**
 * A tie for the last qualifying place, which is not the app's to break.
 *
 * Stroke standings share a rank when a countback cannot separate two players —
 * the board prints "8" twice, and correctly. Qualification then takes the first
 * N of that list, and the order inside a tied pair is whatever the sort's last
 * fallback produced, which is SEED: handicap order. So the board printed two
 * players level and the app advanced one of them and eliminated the other,
 * saying nothing about how it chose. The exported standings carried both rows
 * at rank 8, one "Advancing" and one "Eliminated".
 *
 * Under the Rules a tie for the last qualifying place is decided by a play-off,
 * or by a countback the committee has published beforehand (Committee
 * Procedures 5A). Neither is a thing software may do quietly on a club's
 * behalf. So this does not change who the app provisionally picks — a
 * tournament must still run — it finds the tie so every screen can say one is
 * outstanding.
 *
 * Scoped like `qualificationBubble`, and for the same reason: ranks are
 * assigned across the whole field, so under a per-flight cut two players in
 * different flights can share a rank without being in the same race at all.
 * Comparing them would report a play-off between players who never had a place
 * to argue over.
 */
export function cutLineTies(
  rows: Array<{
    id: string;
    rank: number;
    ranked: boolean;
    advancing: boolean;
    groupId?: string | null;
  }>,
  scope: "overall" | "perFlight",
): CutLineTie[] {
  const buckets = new Map<string, typeof rows>();
  for (const r of rows) {
    // An unranked player holds no position, so they cannot be tied for one.
    if (!r.ranked || !Number.isFinite(r.rank) || r.rank < 1) continue;
    const key = scope === "perFlight" ? `${r.groupId ?? ""}|${r.rank}` : `${r.rank}`;
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }

  const ties: CutLineTie[] = [];
  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    // The line runs THROUGH this position only if it has players on both sides.
    if (!group.some((r) => r.advancing) || !group.some((r) => !r.advancing)) continue;
    ties.push({ rank: group[0].rank, playerIds: group.map((r) => r.id) });
  }
  return ties.sort((a, b) => a.rank - b.rank);
}

export interface BubblePlayer {
  id: string;
  /** Ranking value. Read as points (higher is better) or strokes (lower is
   *  better) per `higherIsBetter` — the caller decides which its format uses. */
  score: number;
  /** The flight this player is in; used only for a per-flight cut. */
  groupId?: string | null;
  /** Whether they are currently inside the cut. */
  advancing: boolean;
}

/** The cut line's closest race: who holds the last spot and who just misses. */
export interface Bubble {
  lastIn: BubblePlayer;
  firstOut: BubblePlayer;
  /** Distance from the first player out to the cut line, never negative. */
  gap: number;
}

/**
 * The bubble to watch, measured against the line that actually applies.
 *
 * "Bubble watch" reported how far the first player out was from the last player
 * in. Under a per-flight cut it compared each near-miss against the *overall*
 * standings — so a flight winner sitting well down the combined list looked
 * "behind" a stronger player in a deeper flight, and the gap came out negative:
 * a player safe in their own flight was told they were points outside
 * qualification. The two are not on the same ladder. A per-flight cut is a
 * separate race inside every flight, so the only meaningful comparison is
 * within a flight.
 *
 * Per flight, this finds each flight's own bubble — its worst qualifier against
 * its best near-miss — and surfaces the tightest of them, the race actually
 * worth watching. Because a flight's qualifiers are by definition its better
 * scores, the last-in always outranks the first-out and the gap is never
 * negative. Overall, the whole field is one flight and the behaviour is
 * unchanged.
 */
/**
 * What is actually happening at the cut line — the shape, not the words.
 *
 * There are three, and telling them apart is the whole of the problem:
 *
 *   shared-place    the ranking could not separate them at all, so neither
 *                   player is through and the committee has a decision
 *   level-on-score  they are level on the number the event is ranked by, and
 *                   a tiebreaker the club configured did the separating.
 *                   Nothing to decide — but not a gap either
 *   clear-gap       one of them is genuinely behind
 *
 * "A gap of nothing is not a gap" was written about the middle case and fixed
 * for the SHARED-PLACE one only, so both branches went on printing "0 shots
 * outside qualification" whenever a countback did its job. That sentence is
 * not about anything: the player is not outside by a margin.
 *
 * The DECISION lives here and the WORDS stay with the caller, deliberately.
 * Stroke play is level on shots and separated by a countback; match play is
 * level on points and separated by the tiebreaker chain. Those are different
 * sentences about the same situation, and forcing one wording on both would
 * have a stroke board talking about tiebreakers it does not use.
 */
export type CutLineShape = "shared-place" | "level-on-score" | "clear-gap";

export function cutLineShape(gap: number, sharedPlace: boolean): CutLineShape {
  if (gap !== 0) return "clear-gap";
  return sharedPlace ? "shared-place" : "level-on-score";
}

export function qualificationBubble(
  players: BubblePlayer[],
  scope: "overall" | "perFlight",
  higherIsBetter: boolean,
): Bubble | null {
  const better = (a: number, b: number) => (higherIsBetter ? a > b : a < b);
  const gapOf = (lastIn: BubblePlayer, firstOut: BubblePlayer) =>
    higherIsBetter ? lastIn.score - firstOut.score : firstOut.score - lastIn.score;

  const buckets = new Map<string, BubblePlayer[]>();
  for (const p of players) {
    const key = scope === "perFlight" ? p.groupId ?? "" : "__all__";
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }

  let tightest: Bubble | null = null;
  for (const list of buckets.values()) {
    // The worst-placed player still inside, and the best-placed one outside.
    let lastIn: BubblePlayer | null = null;
    let firstOut: BubblePlayer | null = null;
    for (const p of list) {
      if (p.advancing) {
        if (!lastIn || better(lastIn.score, p.score)) lastIn = p;
      } else if (!firstOut || better(p.score, firstOut.score)) {
        firstOut = p;
      }
    }
    if (!lastIn || !firstOut) continue;
    const gap = gapOf(lastIn, firstOut);
    /**
     * A NEGATIVE GAP IS NOT A BUBBLE, and the invariant above says so: "the
     * last-in always outranks the first-out and the gap is never negative".
     *
     * Its reasoning — a flight's qualifiers are by definition its better
     * scores — holds only while `advancing` was decided on the SAME ranking as
     * `score`. It is not always. Seen on the seeded Demo Cup's public board on
     * 2026-09-12, which qualifies into a bracket and so takes its advancing set
     * from the match-points chain, while the board beside it was ranking the
     * medal round the field had just played:
     *
     *     "Walkthrough Player is -12 shots outside qualification."
     *
     * The LEADER, told they were outside, by a negative margin, on a screen
     * anybody with the link can open. And `-12` is not a sentence about
     * anything, exactly as the note above says of `0`.
     *
     * Skipping the bucket rather than returning null: another flight may have
     * a perfectly coherent bubble, and this one has nothing to say. `tightest`
     * takes the SMALLEST gap, so a negative would otherwise always win and hide
     * every real race behind it.
     *
     * This is a symptom, not the disease — which is that a bracket's field can
     * be chosen on a different ranking from the one on screen. That is a
     * product question about which round seeds a bracket and it is in
     * `docs/deferred-register.md`, deliberately unanswered here. What is not a
     * product question is whether to print this sentence.
     */
    if (gap < 0) continue;
    if (!tightest || gap < tightest.gap) tightest = { lastIn, firstOut, gap };
  }
  return tightest;
}
