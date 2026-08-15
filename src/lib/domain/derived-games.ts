/**
 * The side bets the CARDS can settle by themselves.
 *
 * Skins already works this way, and this is the rest of the family: low gross,
 * low net, a birdie pot, an eagle pot, and a Nassau. Nobody types a winner —
 * the scores name one, which is the whole difference between these and a
 * closest-to-the-pin (domain/contests.ts), where no scorecard has ever
 * recorded who was nearest the flag.
 *
 * Pure. Integer cents. Every pot pays out EXACTLY what was put in, split by
 * the one largest-remainder rule in domain/money.ts, so a tie never loses or
 * invents a penny.
 *
 * One convention runs through all of them, taken from the skins pot because a
 * club already understands it there: IF NOBODY WINS, EVERYBODY GETS THEIR
 * STAKE BACK. Inventing a winner would be worse, and keeping the money would
 * be worse still — the app is not a house.
 */

import { splitExactly } from "./money";
import { playNassau } from "./nassau";
import type { HoleResult } from "./types";

export const DERIVED_KINDS = ["low-gross", "low-net", "birdies", "eagles"] as const;
export type DerivedKind = (typeof DERIVED_KINDS)[number];

export const DERIVED_LABEL: Record<DerivedKind, string> = {
  "low-gross": "Low gross",
  "low-net": "Low net",
  birdies: "Birdie pot",
  eagles: "Eagle pot",
};

export const DERIVED_HELP: Record<DerivedKind, string> = {
  "low-gross": "Lowest gross score in the pot takes it. A tie splits it.",
  "low-net": "Lowest net score, after handicap strokes. A tie splits it.",
  birdies: "The pot divides by every birdie made, so two birdies is two shares.",
  eagles: "The same, for eagles. Rarely won, and worth having when it is.",
};

export function isDerivedKind(v: string): v is DerivedKind {
  return (DERIVED_KINDS as readonly string[]).includes(v);
}

export interface Net {
  playerId: string;
  netCents: number;
}

/** One player's card in a pot, already priced by the caller. */
export interface PotCard {
  playerId: string;
  /** Per hole; null where nothing has been entered. */
  strokes: (number | null)[];
  /** Handicap strokes received over the holes played, for the net games. */
  strokesReceived: number;
}

export interface DerivedPot {
  kind: DerivedKind;
  /** Stake per entrant, integer cents. */
  buyInCents: number;
  entrantIds: string[];
  cards: PotCard[];
  /** Par per hole, needed by the birdie and eagle pots. */
  pars: number[];
}

/** Gross over the holes actually played, and how many those were. */
function grossOf(card: PotCard): { gross: number; played: number } {
  let gross = 0;
  let played = 0;
  for (const s of card.strokes) {
    if (typeof s !== "number" || s <= 0) continue;
    gross += s;
    played += 1;
  }
  return { gross, played };
}

/**
 * How many holes this card beat par by `under` or more.
 *
 * Gross birdies, deliberately. A net birdie pot exists at some clubs but means
 * something different, and quietly paying one for the other would be the app
 * settling a bet nobody made. Counted per hole rather than off a total, since
 * a birdie is a hole and not an average.
 */
export function countUnder(card: PotCard, pars: number[], under: number): number {
  let n = 0;
  card.strokes.forEach((s, i) => {
    const par = pars[i];
    if (typeof s !== "number" || s <= 0 || typeof par !== "number") return;
    if (par - s >= under) n += 1;
  });
  return n;
}

/**
 * Who has the lowest score, over the holes they actually returned.
 *
 * A CARD THAT IS NOT FINISHED CANNOT WIN. Comparing a nine-hole total against
 * an eighteen-hole one would hand the pot to whoever walked in early, which is
 * the opposite of what the bet is for. So only cards with the most holes
 * played are eligible — in practice, the players who finished.
 */
export function lowScoreWinners(pot: DerivedPot): string[] {
  const entrants = new Set(pot.entrantIds);
  const scored = pot.cards
    .filter((c) => entrants.has(c.playerId))
    .map((c) => {
      const { gross, played } = grossOf(c);
      const score = pot.kind === "low-net" ? gross - Math.round(c.strokesReceived) : gross;
      return { playerId: c.playerId, score, played };
    })
    .filter((c) => c.played > 0);

  if (scored.length === 0) return [];

  const most = Math.max(...scored.map((c) => c.played));
  const eligible = scored.filter((c) => c.played === most);
  const best = Math.min(...eligible.map((c) => c.score));
  return eligible.filter((c) => c.score === best).map((c) => c.playerId).sort();
}

/**
 * What one derived pot does to the money.
 *
 * Every entrant is down their stake; the pot goes back out. Low gross and low
 * net split between whoever tied; a birdie or eagle pot divides by the number
 * MADE, so two birdies is two shares of it — the same rule the skins pot uses
 * for skins won, and the reason a big day pays properly rather than capping at
 * one prize.
 */
export function derivedNets(pot: DerivedPot): Net[] {
  const stake = Math.max(0, Math.round(pot.buyInCents));
  const entrants = [...new Set(pot.entrantIds.filter(Boolean))];
  if (stake === 0 || entrants.length === 0) return [];

  const totals = new Map<string, number>();
  for (const id of entrants) totals.set(id, -stake);
  const potCents = stake * entrants.length;

  const pay = (ids: string[], weights: number[]) => {
    const shares = splitExactly(potCents, weights);
    ids.forEach((id, i) => totals.set(id, (totals.get(id) ?? 0) + shares[i]));
  };

  if (pot.kind === "birdies" || pot.kind === "eagles") {
    const under = pot.kind === "eagles" ? 2 : 1;
    const counts = entrants.map((id) => {
      const card = pot.cards.find((c) => c.playerId === id);
      return card ? countUnder(card, pot.pars, under) : 0;
    });
    const made = counts.reduce((a, n) => a + n, 0);
    // Nobody made one: everybody gets their stake back rather than the app
    // choosing a winner or keeping the money.
    if (made === 0) pay(entrants, entrants.map(() => 1));
    else pay(entrants, counts);
  } else {
    const winners = lowScoreWinners(pot);
    if (winners.length === 0) pay(entrants, entrants.map(() => 1));
    else pay(winners, winners.map(() => 1));
  }

  return [...totals.entries()]
    .map(([playerId, netCents]) => ({ playerId, netCents }))
    .filter((n) => n.netCents !== 0)
    .sort((a, b) => b.netCents - a.netCents || a.playerId.localeCompare(b.playerId));
}

/* ── Nassau ────────────────────────────────────────────────────────────────
 *
 * Three bets on one card — front, back and the overall eighteen — each worth
 * the same. Unlike every pot above, a Nassau is between TWO PLAYERS rather
 * than into a pool, so it pays across the match instead of out of a pot.
 */

export interface NassauBet {
  matchId: string;
  playerAId: string;
  playerBId: string;
  holes: HoleResult[];
  /** Stake on EACH segment, integer cents. A "$5 Nassau" is 500 here. */
  stakeCents: number;
}

/**
 * What a Nassau owes, once its segments are decided.
 *
 * ONLY COMPLETED SEGMENTS PAY. A front nine that is three holes old has a
 * leader and no result, and paying a lead would be settling a bet still being
 * played — the same reason an undecided contest pays nobody. A halved segment
 * pays nobody either, which is what a halved match means.
 *
 * Nine-hole rounds produce one segment, not three: slicing nine holes into
 * "front" and "overall" would charge the same bet twice under two names.
 */
export function nassauNets(bet: NassauBet): Net[] {
  const stake = Math.max(0, Math.round(bet.stakeCents));
  if (stake === 0 || !bet.playerAId || !bet.playerBId) return [];

  const outcome = playNassau(bet.holes);
  let aCents = 0;
  for (const segment of outcome.segments) {
    const result = segment.result;
    if (!result || !result.complete) continue;
    if (result.winner === "A") aCents += stake;
    else if (result.winner === "B") aCents -= stake;
  }
  if (aCents === 0) return [];

  return [
    { playerId: bet.playerAId, netCents: aCents },
    { playerId: bet.playerBId, netCents: -aCents },
  ].sort((x, y) => y.netCents - x.netCents || x.playerId.localeCompare(y.playerId));
}

/** Every Nassau in a round, as one ledger. */
export function nassauLedger(bets: NassauBet[]): Net[] {
  const totals = new Map<string, number>();
  for (const bet of bets) {
    for (const n of nassauNets(bet)) {
      totals.set(n.playerId, (totals.get(n.playerId) ?? 0) + n.netCents);
    }
  }
  return [...totals.entries()]
    .map(([playerId, netCents]) => ({ playerId, netCents }))
    .filter((n) => n.netCents !== 0)
    .sort((a, b) => b.netCents - a.netCents || a.playerId.localeCompare(b.playerId));
}
