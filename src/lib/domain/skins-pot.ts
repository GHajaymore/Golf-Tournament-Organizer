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
 * Split `totalCents` in proportion to `weights`, exactly.
 *
 * Largest remainder: give everyone their whole-cent share, then hand the odd
 * cents to whoever was rounded down hardest. Ties broken by order, so the
 * result is deterministic rather than depending on sort stability.
 *
 * The point is the guarantee — the parts always sum to the whole. A pot of
 * £60 across 7 skins is £8.571428..., and any method that rounds each share
 * independently loses or invents a few pence.
 */
export function splitExactly(totalCents: number, weights: number[]): number[] {
  const total = Math.max(0, Math.round(totalCents));
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * Math.max(0, w)) / sum);
  const floors = exact.map((e) => Math.floor(e));
  let left = total - floors.reduce((a, f) => a + f, 0);

  // Biggest fractional part first; index order settles a dead heat.
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = [...floors];
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

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
export function skinsPot(
  outcome: SkinsOutcome,
  buyInCents: number,
  playerIds: string[],
  /** Holes with no score anywhere yet — the sheet cannot be final. */
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

export interface Transfer {
  fromPlayerId: string;
  toPlayerId: string;
  cents: number;
}

/**
 * Who actually hands money to whom.
 *
 * Everybody-pays-everybody is arithmetically correct and socially useless: a
 * twelve-player league would settle with sixty-six handshakes. Netting it out
 * turns that into a handful.
 *
 * Greedy largest-debtor against largest-creditor. It does not always find the
 * theoretical minimum number of transfers — that problem is NP-hard — but it
 * is within one of it in practice, runs instantly, and produces a sheet a
 * treasurer can read. Deterministic: ties broken by player id so the same
 * week always settles the same way.
 */
export function settle(nets: Array<{ playerId: string; netCents: number }>): Transfer[] {
  const debtors = nets
    .filter((n) => n.netCents < 0)
    .map((n) => ({ id: n.playerId, owed: -n.netCents }))
    .sort((a, b) => b.owed - a.owed || a.id.localeCompare(b.id));
  const creditors = nets
    .filter((n) => n.netCents > 0)
    .map((n) => ({ id: n.playerId, due: n.netCents }))
    .sort((a, b) => b.due - a.due || a.id.localeCompare(b.id));

  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].owed, creditors[j].due);
    if (pay > 0) {
      out.push({ fromPlayerId: debtors[i].id, toPlayerId: creditors[j].id, cents: pay });
      debtors[i].owed -= pay;
      creditors[j].due -= pay;
    }
    if (debtors[i].owed === 0) i += 1;
    if (creditors[j].due === 0) j += 1;
  }
  return out;
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
