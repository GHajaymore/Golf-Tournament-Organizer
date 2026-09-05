// Bracket seeding and advancement. Two single-elimination brackets (Winners,
// Consolation) seeded from qualifiers; winners are chosen manually (README).

import type { BracketKind, Player } from "./types";
import type { RankedPlayer } from "./standings";

/** Standard 8-seed pairing order from the handoff: seed 1 plays 8, etc. */
export const SEED_ORDER_8 = [1, 8, 4, 5, 3, 6, 2, 7];

export interface BracketSlot {
  playerId: string | null;
  /** Seed within this bracket (1-based) when known from round 1. */
  seed: number | null;
  name: string;
}

export interface BracketMatch {
  /** Stable key: `${bracket}-${roundIndex}-${matchIndex}`. */
  key: string;
  roundIndex: number;
  matchIndex: number;
  a: BracketSlot;
  b: BracketSlot;
  winnerId: string | null;
}

export interface BracketRound {
  label: string;
  roundIndex: number;
  matches: BracketMatch[];
}

export interface BracketView {
  kind: BracketKind;
  rounds: BracketRound[];
  champion: BracketSlot | null;
}

/** Kept as reference for a future label pass; not read today. */
const _ROUND_LABELS = ["Round of 8", "Semifinals", "Final"];

/**
 * Select qualifiers: top `qualifyPerGroup` from each group's ranking, then
 * ordered by their overall rank across the whole field.
 */
export function pickQualifiers(
  groupsRanked: RankedPlayer[][],
  qualifyPerGroup: number,
  overallRanked: RankedPlayer[],
): Player[] {
  const ids = new Set<string>();
  for (const g of groupsRanked) {
    for (const rp of g.slice(0, qualifyPerGroup)) ids.add(rp.player.id);
  }
  return overallRanked.filter((rp) => ids.has(rp.player.id)).map((rp) => rp.player);
}

/**
 * How an organizer wants the knockout arranged.
 *
 *   single — one bracket, every qualifier in it. A championship: you lose, you
 *            are out. The plainest shape and the one most events want.
 *
 *   split  — top half and bottom half of the qualifiers play separate
 *            brackets. Two flights decided before a ball is struck, so a
 *            player never meets someone far above them. Not a consolation:
 *            nobody drops into the second bracket, they are drawn into it.
 *
 *   plate  — one bracket, and whoever loses in the first round goes into a
 *            second. This is what a club usually means by a consolation or
 *            plate, and it differs from `split` in the way that matters: it is
 *            decided by results rather than by seeding, so everyone starts
 *            with a shot at the main prize.
 */
export type BracketMode = "single" | "split" | "plate";

export const BRACKET_MODES: Array<{ key: BracketMode; label: string; blurb: string }> = [
  { key: "single", label: "One bracket", blurb: "Every qualifier in a single knockout. Lose and you're out." },
  { key: "split", label: "Two flights", blurb: "Top half and bottom half play separate brackets, drawn by qualifying rank." },
  { key: "plate", label: "Main + plate", blurb: "One knockout; first-round losers drop into a plate. Everyone starts with a shot at the main prize." },
];

export function isBracketMode(v: string): v is BracketMode {
  return v === "single" || v === "split" || v === "plate";
}

export interface BracketDraw {
  main: Player[];
  /** Empty in single mode, and in plate mode until the first round is played. */
  second: Player[];
  /** What to call the second bracket, or "" when there isn't one. */
  secondLabel: string;
}

/**
 * Work out who plays in which bracket.
 *
 * `firstRoundLosers` only matters in plate mode, where the second bracket is
 * filled by results rather than by seeding. Passing none simply means the
 * first round hasn't been decided yet, and the plate is still empty — which is
 * the honest state to show rather than guessing at it.
 */
export function drawBrackets(
  qualifiers: Player[],
  mode: BracketMode = "split",
  firstRoundLosers: Player[] = [],
): BracketDraw {
  if (mode === "single") {
    return { main: qualifiers, second: [], secondLabel: "" };
  }
  if (mode === "plate") {
    return { main: qualifiers, second: firstRoundLosers, secondLabel: "Plate" };
  }
  const half = Math.ceil(qualifiers.length / 2);
  return {
    main: qualifiers.slice(0, half),
    second: qualifiers.slice(half),
    secondLabel: "Consolation",
  };
}

/** Split qualifiers (already in overall-rank order): top half -> Winners, bottom -> Consolation.
 *  Retained as the `split` case of drawBrackets, which is what callers should use. */
export function splitBrackets(qualifiers: Player[]): {
  winners: Player[];
  consolation: Player[];
} {
  const { main, second } = drawBrackets(qualifiers, "split");
  return { winners: main, consolation: second };
}

/**
 * Who lost in the opening round of a bracket.
 *
 * Reads the organizer's recorded winners rather than inferring anything: a
 * match with a winner has a loser, and a match still in progress has neither.
 * Byes are excluded — a player who advanced unopposed didn't lose to anybody.
 */
export function firstRoundLosers(view: BracketView, byId: Map<string, Player>): Player[] {
  const round0 = view.rounds[0];
  if (!round0) return [];
  const out: Player[] = [];
  for (const m of round0.matches) {
    if (!m.winnerId) continue;
    // A bye has only one side, so there is no loser to drop.
    if (!m.a.playerId || !m.b.playerId) continue;
    const loserId = m.winnerId === m.a.playerId ? m.b.playerId : m.a.playerId;
    const p = byId.get(loserId);
    if (p) out.push(p);
  }
  return out;
}

/**
 * The standard seeding order for a bracket of `size`, built by reflection.
 *
 * Each round of doubling pairs every existing seed with its complement, which
 * is what produces the property a seeded draw exists for: the top two seeds
 * can only meet in the final, the top four only in the semis, and so on.
 *
 * Replaces a hardcoded eight-entry table. That table meant a knockout could
 * only ever hold eight players — a 16- or 32-player championship, or a
 * four-side final, was simply not expressible.
 */
export function seedOrder(size: number): number[] {
  // Eight keeps the exact table this app has always used. Reflection produces
  // the same *pairs* but lists the bottom half in a different order, and
  // changing that would redraw any eight-player bracket already under way —
  // the same players, rearranged, which is indistinguishable from a mistake to
  // whoever is playing in it. Every other size is generated.
  if (size === 8) return [...SEED_ORDER_8];
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    const next: number[] = [];
    for (const s of order) next.push(s, n + 1 - s);
    order = next;
  }
  return order.slice(0, size);
}

/**
 * How a knockout finished, read off the bracket.
 *
 * A knockout has no points table, so `computeStandings` gives every player the
 * same zero and sorts them by the only thing left — seed, which is handicap
 * order. Both readers of "how did this tournament finish" took that at face
 * value: the honours board proposed the LOWEST-HANDICAP ENTRANT as champion of
 * a competition they may have lost in the first round, and the season table
 * scored the field in handicap order. The player who won the final was placed
 * wherever their handicap put them.
 *
 * A knockout says exactly where everybody finished, in the one place nobody was
 * reading: the draw. Losing in round r of an R-round bracket is a placing, and
 * everyone beaten in the same round shares it — the two beaten semi-finalists
 * are both third, which is why clubs play off for it (see `third-place.ts`).
 * So the loser of the final is 2nd, the beaten semi-finalists 3rd, the beaten
 * quarter-finalists 5th: 2^(rounds after theirs) + 1.
 *
 * Returns an empty list when the bracket has no champion. An unfinished
 * knockout has no finishing order, and inventing one is how this went wrong in
 * the first place — the caller falls back rather than being handed a guess.
 *
 * The WINNERS bracket only. A consolation draw is a second competition with its
 * own winner, and in plate mode its field is players who are already placed in
 * this list; scoring it would need a club to say how the two relate, which
 * nothing in the app asks. Its players are left unplaced, exactly as they are
 * today.
 */
export function bracketFinishOrder(
  view: BracketView,
  /**
   * Who won the play-off for third, when a club ran one.
   *
   * Everything else here is derived from the draw, which is right — a knockout
   * records its own result — but the play-off for third is the one fixture the
   * draw cannot describe. It is fed by LOSERS, so it is stored outside the
   * bracket as a `round: 0` match, and nothing read it back.
   *
   * The app offers the fixture in two places, tells the organizer to play it,
   * creates the match, takes the score and audits it — and then placed both
   * beaten semi-finalists third anyway. In the season table that pays each of
   * them the average of third and fourth, so the two players who settled it on
   * the course score identically. It is worse on the honours board, which is a
   * permanent record of a placing the club actually decided.
   *
   * Omitted or null means no play-off was played, which stays the default:
   * plenty of clubs send everyone to the bar instead, and two beaten
   * semi-finalists genuinely share third.
   */
  thirdPlaceWinnerId?: string | null,
): Array<{ playerId: string; name: string; rank: number }> {
  if (!view.champion?.playerId) return [];

  const totalRounds = view.rounds.length;
  const placed: Array<{ playerId: string; name: string; rank: number }> = [
    { playerId: view.champion.playerId, name: view.champion.name, rank: 1 },
  ];
  const seen = new Set([view.champion.playerId]);

  for (const round of view.rounds) {
    // Everyone knocked out in this round shares one placing.
    const rank = 2 ** (totalRounds - 1 - round.roundIndex) + 1;
    for (const match of round.matches) {
      if (!match.winnerId) continue;
      for (const slot of [match.a, match.b]) {
        if (!slot.playerId || slot.playerId === match.winnerId) continue;
        /**
         * Placed once, at the first stage they went out.
         *
         * Unreachable in a draw where everybody appears once — a player only
         * ever advances by winning, so they can lose at most one match. It is
         * reachable through a seeded field that lists the same player twice,
         * which `parseBracketDraw` permits on purpose: it will not silently
         * tidy a stored draw, because deduplicating one would move every
         * player after it into a different slot. So a duplicate reaches here,
         * and the earlier — deeper — finish is the one that counts.
         */
        if (seen.has(slot.playerId)) continue;
        seen.add(slot.playerId);
        placed.push({ playerId: slot.playerId, name: slot.name, rank });
      }
    }
  }

  /**
   * The play-off splits the shared third into a third and a fourth.
   *
   * Applied here rather than inside the loop because it is a fact about a
   * fixture OUTSIDE the draw, and the loop's job is to read the draw. Only the
   * two players who genuinely share third can be moved: a winner id that names
   * anybody else is a play-off that no longer matches the semi-finals — a
   * corrected semi-final result will do that — and the honest answer is then
   * the draw's own, not a placing derived from a fixture that has been
   * overtaken.
   */
  if (thirdPlaceWinnerId) {
    const third = placed.filter((p) => p.rank === 3);
    if (third.length === 2 && third.some((p) => p.playerId === thirdPlaceWinnerId)) {
      for (const p of third) p.rank = p.playerId === thirdPlaceWinnerId ? 3 : 4;
    }
  }

  return placed.sort((a, b) => a.rank - b.rank);
}

/**
 * The stored draw: qualifier ids in seeding order, or null for "not drawn yet".
 *
 * Null on anything it cannot read — empty, malformed, not an array, an array of
 * no usable ids. That is deliberate: falling back to seeding from live
 * standings is exactly what the app did before there was a stored draw, so a
 * corrupt value degrades to the old behaviour rather than to an empty bracket.
 * A knockout that silently loses its field is a worse failure than one that
 * re-derives it.
 */
export function parseBracketDraw(json: string): string[] | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return null;
    const ids = arr.filter((v): v is string => typeof v === "string" && v.trim() !== "");
    return ids.length ? ids : null;
  } catch {
    return null;
  }
}

/** The draw, ready to store. Order is the whole point — it IS the seeding. */
export function serializeBracketDraw(playerIds: string[]): string {
  return JSON.stringify(playerIds);
}

/** Smallest power of two that holds `n` players, minimum 2. */
export function bracketSizeFor(n: number): number {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

/**
 * What to call each round, counting back from the final.
 *
 * Derived rather than listed, so a bracket of any depth names its rounds
 * correctly instead of running off the end of a three-entry array.
 */
export function roundLabels(size: number): string[] {
  const total = Math.log2(size);
  const labels: string[] = [];
  for (let r = 0; r < total; r += 1) {
    const remaining = total - r;
    if (remaining === 1) labels.push("Final");
    else if (remaining === 2) labels.push("Semifinals");
    else if (remaining === 3) labels.push("Quarterfinals");
    else labels.push(`Round of ${2 ** remaining}`);
  }
  return labels;
}

/**
 * Build a full bracket view for any number of seeded players (index 0 = seed 1).
 *
 * The bracket sizes itself to the field, rounding up to the next power of two;
 * the unfilled seeds become byes and auto-advance. `winners` maps match key ->
 * winning playerId (organizer picks). Rounds after the first are populated by
 * advancing chosen winners.
 */
/**
 * A stored winner, honoured only if that player is actually in the match.
 *
 * Winners are keyed positionally (`consolation-0-1`), and a plate field is
 * rebuilt from the losers known so far — so the field GROWS as results come
 * in, and slot `consolation-0-1` can be a semi-final between two players one
 * minute and a quarter-final between two different players the next. The
 * stored winner was applied regardless, so a player advanced out of a match he
 * was not in while his real match read unplayed.
 *
 * Discarding a winner that no longer matches its slot is the conservative
 * answer: the organizer is shown an unrecorded match and can enter it again,
 * which is recoverable. Advancing the wrong player is not.
 */
function claimedWinner(
  stored: string | undefined,
  aId: string | null,
  bId: string | null,
): string | null {
  if (!stored) return null;
  return stored === aId || stored === bId ? stored : null;
}

export function buildBracket(
  kind: BracketKind,
  seededPlayers: Player[],
  winners: Record<string, string>,
): BracketView {
  const byId = new Map(seededPlayers.map((p) => [p.id, p]));
  const seedById = new Map(seededPlayers.map((p, i) => [p.id, i + 1]));

  const slotFor = (playerId: string | null): BracketSlot => {
    if (!playerId) return { playerId: null, seed: null, name: "TBD" };
    const p = byId.get(playerId);
    return {
      playerId,
      seed: seedById.get(playerId) ?? null,
      name: p ? p.name : "—",
    };
  };

  const size = bracketSizeFor(seededPlayers.length);
  const order = seedOrder(size);
  const labels = roundLabels(size);
  const seedSlot = (seedNum: number): string | null => seededPlayers[seedNum - 1]?.id ?? null;

  const rounds: BracketRound[] = [];

  /**
   * A BYE IS NOT A WIN, and in the last round it must not read as one.
   *
   * `bracketSizeFor(1)` is 2, so a one-player bracket's only round IS the
   * final: the lone player was auto-advanced against nobody and crowned
   * champion of a match that was never played. Two live paths reached it every
   * time. A PLATE is built from the first round's losers, so the moment the
   * first first-round result was recorded the plate held exactly one player
   * and the screen printed the name of the player who had just been knocked
   * out, under a trophy. And SPLIT mode — the default — with two qualifiers
   * gives each half one player, so both brackets declared a champion before a
   * single knockout match was played.
   *
   * An organizer who records a result explicitly still gets it: `claimedWinner`
   * runs first and is untouched, so a genuine walkover is still a win. What
   * this removes is the app deciding one on its own.
   */
  const lastRound = labels.length - 1;

  // Opening round: one match per pair in the seed order. Missing seeds are byes.
  const first: BracketMatch[] = [];
  for (let i = 0; i < size / 2; i += 1) {
    const aId = seedSlot(order[i * 2]);
    const bId = seedSlot(order[i * 2 + 1]);
    const key = `${kind}-0-${i}`;
    let winnerId = claimedWinner(winners[key], aId, bId);
    if (!winnerId && lastRound > 0) {
      if (aId && !bId) winnerId = aId;
      else if (bId && !aId) winnerId = bId;
    }
    first.push({ key, roundIndex: 0, matchIndex: i, a: slotFor(aId), b: slotFor(bId), winnerId });
  }
  rounds.push({ label: labels[0], roundIndex: 0, matches: first });

  // Every later round is fed by the winners of the one before it.
  for (let round = 1; round < labels.length; round += 1) {
    const prev = rounds[round - 1].matches;
    const matches: BracketMatch[] = [];
    for (let i = 0; i < prev.length / 2; i += 1) {
      const aId = prev[i * 2].winnerId;
      const bId = prev[i * 2 + 1].winnerId;
      const key = `${kind}-${round}-${i}`;
      let winnerId = claimedWinner(winners[key], aId, bId);
      // Only auto-advance a bye once the other feeder is known to be empty —
      // and never INTO the trophy. Reaching an unopposed final is not winning
      // one, so the last round waits for a recorded result like any other.
      if (round < lastRound) {
        if (!winnerId && aId && !bId && isByeFeeder(prev[i * 2 + 1])) winnerId = aId;
        if (!winnerId && bId && !aId && isByeFeeder(prev[i * 2])) winnerId = bId;
      }
      matches.push({
        key,
        roundIndex: round,
        matchIndex: i,
        a: slotFor(aId),
        b: slotFor(bId),
        winnerId,
      });
    }
    rounds.push({ label: labels[round], roundIndex: round, matches });
  }

  const finalMatch = rounds[rounds.length - 1]?.matches[0];
  const champion = finalMatch?.winnerId ? slotFor(finalMatch.winnerId) : null;

  return { kind, rounds, champion };
}

/** A feeder match that can never produce a player (both slots empty) is a bye. */
function isByeFeeder(m: BracketMatch): boolean {
  return m.a.playerId === null && m.b.playerId === null;
}
