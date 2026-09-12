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

export const CONTEST_KINDS = ["closest-pin", "long-drive", "off-course", "other"] as const;
export type ContestKind = (typeof CONTEST_KINDS)[number];

export const CONTEST_LABEL: Record<ContestKind, string> = {
  "closest-pin": "Closest to the pin",
  "long-drive": "Long drive",
  /**
   * POKER, CARDS, DARTS, THE QUIZ — the games an outing plays off the course.
   *
   * A trip is two days of golf and an evening of something else, and the
   * something else is played for money exactly like the long drive is. The
   * arithmetic above is already the right arithmetic and knows nothing about
   * golf: everybody puts in, the winners share the pot, split to the cent.
   * There was simply nothing to call it, so it went under "Side bet" — where
   * it looked like a bet on the round — or, worse, into the expense ledger,
   * which is the wrong book entirely.
   *
   * THAT IS THE DISTINCTION WORTH HOLDING. A pot is money players staked
   * AGAINST EACH OTHER and the app decides who gets it. A shared cost is money
   * one person fronted FOR THE GROUP and the app decides who owes them. Poker
   * is unambiguously the first, however far it is from a golf course — and
   * green fees are unambiguously the second, however close.
   *
   * The free-text `name` carries what it actually was, so the ledger reads
   * "Saturday poker" rather than a category. The hole is meaningless here and
   * the form does not ask for it.
   */
  "off-course": "Off-course game (poker, cards, darts)",
  other: "Side bet",
};

/**
 * Whether this kind happens on a golf hole.
 *
 * Asked by the form so it can stop demanding a hole number for the poker
 * school, and stated here rather than in the component so a kind added later
 * has one place to declare itself. Closest to the pin without a hole is a
 * contest somebody forgot to finish describing; poker without a hole is
 * simply poker.
 */
export function contestHasHole(kind: ContestKind): boolean {
  return kind !== "off-course";
}

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
