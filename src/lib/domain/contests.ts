/**
 * The side bets that are not skins: closest to the pin, long drive, and
 * whatever else the first tee invents.
 *
 * Simpler than a skins pot in one way that matters — there is no per-hole
 * carry, just a pot and whoever won it — and identical in the way that
 * matters more: everybody puts in, one or more people take it out, and the
 * money moves BETWEEN PLAYERS. So it produces `Net[]` like everything else,
 * and hands it to the one `settle()`.
 *
 * A club-funded prize is deliberately NOT this. If the club pays $50 for
 * closest to the pin then nobody owes anybody, and putting it in a settle-up
 * would invent a debt between two people who never had one. Those live on
 * `Prize`, and stay out of the ledger.
 *
 * Pure. Integer cents throughout.
 */

import { splitExactly } from "./money";

export const CONTEST_KINDS = ["closest-pin", "long-drive", "other"] as const;
export type ContestKind = (typeof CONTEST_KINDS)[number];

export const CONTEST_LABEL: Record<ContestKind, string> = {
  "closest-pin": "Closest to the pin",
  "long-drive": "Long drive",
  other: "Side bet",
};

export function isContestKind(v: string): v is ContestKind {
  return (CONTEST_KINDS as readonly string[]).includes(v);
}

export interface Contest {
  id: string;
  kind: ContestKind;
  /** What the organizer called it, when the kind is not the whole story. */
  name: string;
  /** Stake per entrant, integer cents. Zero is a free contest — legal, and
   *  worth nothing to the ledger. */
  buyInCents: number;
  /** Everybody who put in. */
  entrantIds: string[];
  /** Whoever won it. Empty until it is decided; more than one is a tie. */
  winnerIds: string[];
}

export interface Net {
  playerId: string;
  netCents: number;
}

/**
 * What one contest does to the money.
 *
 * Every entrant is down their stake; the winners share the pot, split exactly
 * by the same largest-remainder rule the whole app uses, so a $25 pot between
 * two ties is 1250/1250 and a $25 pot between three is 834/833/833 — never
 * $8.33 three times with a cent left in the app's pocket.
 *
 * UNDECIDED CONTESTS PAY NOBODY AND CHARGE NOBODY. A pot that has been
 * collected but not yet won is not a debt: showing every entrant down their
 * stake before anyone has won would tell a player they owe money the moment
 * they enter, and the sheet would stop balancing against the cash on the
 * table. So an undecided contest contributes nothing at all, and the screen
 * says it is still open.
 *
 * A winner who is not an entrant still wins: somebody who was put down for
 * the long drive without paying in is the organizer's business to sort out,
 * and refusing to record it would just move the argument off the app.
 */
export function contestNets(contest: Contest): Net[] {
  const stake = Math.max(0, Math.round(contest.buyInCents));
  const entrants = [...new Set(contest.entrantIds.filter(Boolean))];
  const winners = [...new Set(contest.winnerIds.filter(Boolean))];

  if (stake === 0 || entrants.length === 0 || winners.length === 0) return [];

  const totals = new Map<string, number>();
  for (const id of entrants) totals.set(id, (totals.get(id) ?? 0) - stake);

  const pot = stake * entrants.length;
  const shares = splitExactly(pot, winners.map(() => 1));
  winners.forEach((id, i) => totals.set(id, (totals.get(id) ?? 0) + shares[i]));

  return [...totals.entries()]
    .map(([playerId, netCents]) => ({ playerId, netCents }))
    .filter((n) => n.netCents !== 0)
    .sort((a, b) => b.netCents - a.netCents || a.playerId.localeCompare(b.playerId));
}

/**
 * Every contest in an outing, as one ledger.
 *
 * Sums to zero across the field, because each contest does: the pot that goes
 * out is exactly the stakes that came in.
 */
export function contestLedger(contests: Contest[]): Net[] {
  const totals = new Map<string, number>();
  for (const contest of contests) {
    for (const n of contestNets(contest)) {
      totals.set(n.playerId, (totals.get(n.playerId) ?? 0) + n.netCents);
    }
  }
  return [...totals.entries()]
    .map(([playerId, netCents]) => ({ playerId, netCents }))
    .sort((a, b) => b.netCents - a.netCents || a.playerId.localeCompare(b.playerId));
}

/** The pot on the table, for the screen. */
export function potOf(contest: Contest): number {
  const stake = Math.max(0, Math.round(contest.buyInCents));
  return stake * new Set(contest.entrantIds.filter(Boolean)).size;
}

/** Whether this contest has been decided. */
export function isDecided(contest: Contest): boolean {
  return contest.winnerIds.filter(Boolean).length > 0;
}
