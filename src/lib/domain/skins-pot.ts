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
  /** (buyIn x players in) + anything carried in from last week. */
  potCents: number;
  /** What last week left on the table and this week is playing for. */
  carryInCents: number;
  stakeCents: number;
  playerCount: number;
  /** Skins actually claimed by somebody. */
  claimedSkins: number;
  /** Skins nobody won — a tie on the last hole leaves value on the table. */
  unclaimedSkins: number;
  /** The value of those unclaimed skins: stays in the pot. */
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
 * The pot is divided by TOTAL skins, claimed and unclaimed alike, not just
 * the ones somebody won. That is what makes the carry real: if nine skins
 * were available and only seven were claimed, two skins' worth genuinely
 * stays in the pot rather than being quietly shared out among the winners.
 * A league carries it to next week; a one-off returns it. Either way the
 * money is accounted for rather than vanishing.
 */
export function skinsPot(
  outcome: SkinsOutcome,
  buyInCents: number,
  playerIds: string[],
  /** Holes with no score anywhere yet — the sheet cannot be final. */
  holesUnplayed = 0,
  /**
   * Money last week left on the table.
   *
   * The carry is the whole reason a league skins game stays interesting: a
   * week where everything tied makes the next week worth double. It joins the
   * pot and is won like any other part of it — it does not belong to anybody
   * until somebody wins a hole outright.
   */
  carryInCents = 0,
): PotResult {
  const stake = Math.max(0, Math.round(buyInCents));
  const players = [...new Set(playerIds)];
  const carriedIn = Math.max(0, Math.round(carryInCents));
  const potCents = stake * players.length + carriedIn;

  const claimedSkins = outcome.standings.reduce((a, s) => a + s.skins, 0);
  const unclaimedSkins = Math.max(0, outcome.unclaimed);
  const totalSkins = claimedSkins + unclaimedSkins;

  // One weight per player, plus a final weight standing for the carry, so a
  // single exact split covers both and the cents cannot go missing between
  // two separate roundings.
  const skinsByPlayer = new Map(outcome.standings.map((s) => [s.playerId, s.skins]));
  const weights = [...players.map((id) => skinsByPlayer.get(id) ?? 0), unclaimedSkins];
  const amounts = splitExactly(potCents, weights);
  const carryCents = amounts[amounts.length - 1] ?? 0;

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
    carryInCents: carriedIn,
    stakeCents: stake,
    playerCount: players.length,
    claimedSkins,
    unclaimedSkins,
    carryCents: totalSkins > 0 ? carryCents : potCents,
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
