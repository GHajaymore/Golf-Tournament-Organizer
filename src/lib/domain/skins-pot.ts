// The money side of a skins game: what goes in, what comes out, and who
// hands what to whom.
//
// Kept apart from playSkins() on purpose. That engine decides who won which
// hole and knows nothing about money; this one turns its result into an
// amount. Two reasons: the same pot arithmetic will serve other side games,
// and money bugs are a different kind of bug — they are found by arithmetic,
// not by golf, so they get their own tests.
//
// Everything here works in WHOLE CENTS as integers. A pot split three ways in
// floating point produces 16.666666666666668, and a settlement sheet that
// does not add up is worse than no settlement sheet at all.

import type { SkinsOutcome } from "./skins";

/** A player's stake and their share. All amounts are integer cents. */
export interface PotShare {
  playerId: string;
  /** Skins claimed outright. */
  skins: number;
  /** What they take from the pot. */
  wonCents: number;
  /** What they put in. */
  stakeCents: number;
  /** wonCents - stakeCents. Negative means they are down on the week. */
  netCents: number;
}

export interface PotResult {
  /** buyIn x players in. A week stands alone: nothing joins it from last week. */
  potCents: number;
  stakeCents: number;
  playerCount: number;
  /** Skins actually claimed by somebody. */
  claimedSkins: number;
  /** Skins nobody won outright. Their value is already inside the pot the
   *  winners share, so this is for display rather than money set aside. */
  unclaimedSkins: number;
  /** Always zero. Kept so a reader does not go looking for a carry. */
  carryCents: number;
  shares: PotShare[];
  /** True while any hole is still unplayed, so the sheet is provisional. */
  provisional: boolean;
}

/**
 * The split and settle helpers now live in `domain/money.ts`, owned by neither
 * this feature nor the expense ledger that also settles through them. Re-
 * exported here so every existing caller and test is untouched, and so there
 * remains exactly one implementation of each.
 */
import { splitExactly } from "./money";
export { splitExactly, settle, type Transfer } from "./money";

/**
 * Turn a played skins game into money.
 *
 * EACH WEEK SETTLES ON ITS OWN. Nothing rolls into next week: the pot goes
 * out to whoever won a hole that day, and the players settle before they
 * leave. A league that carried money forward would be asking this week's
 * field to play for last week's stake money, some of which was put in by
 * people who are not there.
 *
 * So the pot divides by the skins actually WON, not by every skin available.
 * If nine holes were played and only seven were won outright, those seven
 * share the lot.
 *
 * Note this is not the same as the carry *inside* a week, which is the whole
 * character of skins and is untouched: tie a hole and its value rolls into
 * the next one until somebody wins a hole alone. That happens in playSkins.
 *
 * If nobody wins a single hole all day, there is nothing to divide by, and
 * inventing a winner would be worse than the obvious answer: everyone gets
 * their own stake back.
 */
/**
 * HOW MANY HOLES OF THIS POT ARE STILL OUT, given every entrant's card.
 *
 * A skin is decided BETWEEN the entrants, so a hole is played when all of them
 * have returned it — not when one of them has. The service asked whether ANY
 * entrant had a score on a hole, which on a field where fifteen have finished
 * and one is on the 12th tee reported all eighteen holes as played. The pot
 * then settled, fed "You're owed", and offered real handovers to be marked
 * settled while a player was still on the course. Found on 2026-09-19 by
 * looking at a seeded club's Money screen, where the round's own panel said
 * "Nothing settled yet" two cards above the pot that had.
 *
 * `money-layout.ts` opens with the rule this breaks — final only, never live —
 * and the question it says to ask is "can the amount still change", not "has
 * something happened". A player with holes to play can win a skin, which
 * changes what everybody else holds.
 *
 * AN ENTRANT WITH NO CARD AT ALL DOES NOT HOLD THE POT OPEN, which is the same
 * exception `roundMoneyFinality` documents beside its own check: somebody who
 * never teed off has no row, team formats file one card for several players,
 * and holding every pot open for ever on an absent card would be a different
 * wrong answer. The organizer closing the tournament remains the backstop.
 */
export function holesUnplayedIn(
  cards: readonly (readonly (number | null | undefined)[])[],
  holeCount: number,
): number {
  const played = cards.filter((c) => c.some((s) => s != null));
  if (played.length === 0) return holeCount;
  let out = 0;
  for (let h = 0; h < holeCount; h += 1) {
    if (played.some((c) => c[h] == null)) out += 1;
  }
  return out;
}

export function skinsPot(
  outcome: SkinsOutcome,
  buyInCents: number,
  playerIds: string[],
  /** Holes at least one entrant has still to return — see `holesUnplayedIn`. */
  holesUnplayed = 0,
): PotResult {
  const stake = Math.max(0, Math.round(buyInCents));
  const players = [...new Set(playerIds)];
  const potCents = stake * players.length;

  const claimedSkins = outcome.standings.reduce((a, s) => a + s.skins, 0);
  const unclaimedSkins = Math.max(0, outcome.unclaimed);
  const skinsByPlayer = new Map(outcome.standings.map((s) => [s.playerId, s.skins]));

  // Divided by the skins actually WON, so the week goes out in full. Holes
  // that were tied and never won are not a share of the pot going begging —
  // their value is already in the hands of whoever won the hole it carried
  // into, and any left at the end simply widen everyone else's slice.
  //
  // Nobody won a hole all day is the one case with nothing to divide by.
  // Inventing a winner would be worse than the obvious answer: each player
  // takes back exactly what they put in.
  const weights =
    claimedSkins > 0
      ? players.map((id) => skinsByPlayer.get(id) ?? 0)
      : players.map(() => 1);
  const amounts = splitExactly(potCents, weights);

  const shares: PotShare[] = players.map((id, i) => {
    const wonCents = amounts[i] ?? 0;
    return {
      playerId: id,
      skins: skinsByPlayer.get(id) ?? 0,
      wonCents,
      stakeCents: stake,
      netCents: wonCents - stake,
    };
  });

  return {
    potCents,
    stakeCents: stake,
    playerCount: players.length,
    claimedSkins,
    unclaimedSkins,
    /** Always zero: a week settles on its own and carries nothing forward. */
    carryCents: 0,
    shares,
    provisional: holesUnplayed > 0,
  };
}

/**
 * A player's position across a whole season, for a league that plays weekly.
 *
 * Summed rather than re-derived, because a week already settled does not
 * change when a later week is played.
 */
export function seasonPosition(weeks: PotResult[]): Array<{ playerId: string; netCents: number }> {
  const totals = new Map<string, number>();
  for (const w of weeks) {
    for (const s of w.shares) {
      totals.set(s.playerId, (totals.get(s.playerId) ?? 0) + s.netCents);
    }
  }
  return [...totals.entries()]
    .map(([playerId, netCents]) => ({ playerId, netCents }))
    .sort((a, b) => b.netCents - a.netCents || a.playerId.localeCompare(b.playerId));
}

/**
 * Nobody won a hole outright, so every player takes their stake back.
 *
 * Asked of `claimedSkins`, never of the payouts: in exactly this case every
 * share HAS a payout — its own stake — so "nobody has winnings" is never true
 * and a screen asking it printed each player as a winner of 0 skins.
 */
export function stakesGoBack(result: PotResult): boolean {
  return result.claimedSkins === 0;
}

export interface NightPurseRow {
  playerId: string;
  /** How many of the night's games they were in. */
  games: number;
  stakeCents: number;
  wonCents: number;
  netCents: number;
}

export interface NightPurse {
  rows: NightPurseRow[];
  /** Everything staked across the night's games. */
  stakeCents: number;
  /** Everything paid out. Equal to `stakeCents` — see below. */
  wonCents: number;
  /** No game still has a hole to play. */
  final: boolean;
}

/**
 * ONE NIGHT'S PURSE: every player's stake, winnings and net across every
 * skins game the round ran, with the totals.
 *
 * A league night runs up to four games, and the question at the bar is not
 * "what did I win in the front-nine net" but "where am I tonight". This adds
 * the games up per player.
 *
 * THE TOTAL LINE IS THE CHECK. Each game pays out exactly what went in
 * (`splitExactly`, and stakes back when nobody wins a hole), so the night's
 * winnings must equal the night's stakes to the cent. A total that does not
 * reconcile is how an organizer stops trusting the whole board, which is why
 * the screen prints both numbers rather than only the rows.
 *
 * Most up first; ties by id so the order is stable. Games not yet entered
 * (no result) are skipped.
 */
export function nightPurse(results: readonly (PotResult | null)[]): NightPurse {
  const rows = new Map<string, NightPurseRow>();
  let stakeCents = 0;
  let wonCents = 0;
  let final = true;
  for (const r of results) {
    if (!r) continue;
    if (r.provisional) final = false;
    for (const s of r.shares) {
      const row = rows.get(s.playerId) ?? {
        playerId: s.playerId,
        games: 0,
        stakeCents: 0,
        wonCents: 0,
        netCents: 0,
      };
      row.games += 1;
      row.stakeCents += s.stakeCents;
      row.wonCents += s.wonCents;
      row.netCents += s.netCents;
      rows.set(s.playerId, row);
      stakeCents += s.stakeCents;
      wonCents += s.wonCents;
    }
  }
  return {
    rows: [...rows.values()].sort(
      (a, b) => b.netCents - a.netCents || a.playerId.localeCompare(b.playerId),
    ),
    stakeCents,
    wonCents,
    final,
  };
}

export type SkinsScope = "full" | "front" | "back";

export function isSkinsScope(v: string): v is SkinsScope {
  return v === "full" || v === "front" || v === "back";
}

export const SCOPE_LABEL: Record<SkinsScope, string> = {
  full: "All 18",
  front: "Front 9",
  back: "Back 9",
};

/**
 * What a club calls one of its games, in one place.
 *
 * A league night runs four — front and back, each gross and net — and every
 * screen that lists them has to name them the same way, or the board and the
 * money page disagree about which game a player won. One reader, so they
 * cannot drift.
 *
 * On a nine-hole round the scope is meaningless (see `scopeRange`), so the
 * name does not claim a nine that was never sliced.
 */
export function skinsGameLabel(net: boolean, scope: SkinsScope, roundHoles = 18): string {
  const money = net ? "Net" : "Gross";
  if (roundHoles === 9 || scope === "full") return `Skins (${money})`;
  return `${SCOPE_LABEL[scope]} Skins (${money})`;
}

/**
 * Which holes a pot is played over, as an index range into the round's card.
 *
 * A league playing eighteen may run its skins on the front only, so the scope
 * is the pot's own decision rather than the round's hole count.
 *
 * On a NINE-hole round the card already is the nine being played — a
 * nine-hole card has no back nine to slice, and treating "back" as holes
 * 10-18 there would select nothing and score no skins at all. So a nine-hole
 * round ignores the scope and plays the card it has.
 */
export function scopeRange(scope: SkinsScope, roundHoles: number): { from: number; to: number } {
  if (roundHoles === 9) return { from: 0, to: 9 };
  if (scope === "front") return { from: 0, to: 9 };
  if (scope === "back") return { from: 9, to: 18 };
  return { from: 0, to: 18 };
}
