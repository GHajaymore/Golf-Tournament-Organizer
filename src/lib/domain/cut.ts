/**
 * Who survives a cut.
 *
 * The cut line and the qualification screen were two mechanisms for one
 * question, each with half an answer. The cut line could say "top 16" or "top
 * 50%" but only ever across the whole field; qualification could say "per
 * flight" or "overall" but lived at tournament level and had no percentage.
 * An organizer could set both, to different things, and nothing reconciled
 * them.
 *
 * This is the union: how many, and out of what.
 */

import { formGroups } from "./grouping";
import type { Player } from "./types";

export type CutScope = "overall" | "perFlight";
export type CutMode = "count" | "percent";

/**
 * Long-form explanations for the two cut settings, shown behind the info
 * control beside each field.
 *
 * They live here, next to the logic, because the difference between them is
 * subtle enough to have already caused a real bug: the dashboard highlighted
 * players using the qualification number when the tournament was actually
 * being decided by each round's own cut. An explanation kept in a component
 * can drift from the behaviour it describes; one kept here cannot go stale
 * without someone editing this file.
 */
export const CUT_SCOPE_HELP =
  "Overall takes the top players from the whole field, so one strong flight can fill most of the places. Per flight takes the same number out of each flight, so every flight sends someone through regardless of how the others scored.";

export const ROUND_CUT_HELP =
  "This trims the field on the way out of this round: whoever survives plays the next one. It is set on each round, so a league can cut differently week to week.";

export const QUALIFICATION_CUT_HELP =
  "This decides who reaches the knockout bracket, and it is a property of the tournament rather than of one round. A tournament that runs straight through from round to round does not need it — use the cut line on each round instead.";

export interface CutRule {
  scope: CutScope;
  mode: CutMode;
  /** Used when mode is "count" — per flight when the scope is per flight. */
  count: number;
  /** Used when mode is "percent". */
  percent: number;
}

export interface CutCandidate {
  id: string;
  /** Which flight they played in; null groups everyone together. */
  groupId?: string | null;
}

export function isCutScope(v: string): v is CutScope {
  return v === "overall" || v === "perFlight";
}

/** How many survive out of a field of this size, never fewer than one. */
export function survivorCount(rule: CutRule, fieldSize: number): number {
  if (fieldSize <= 0) return 0;
  const n =
    rule.mode === "percent"
      ? Math.ceil((fieldSize * rule.percent) / 100)
      : rule.count;
  return Math.max(1, Math.min(n, fieldSize));
}

/**
 * The players who go through, from standings already in finishing order.
 *
 * Order matters and is the caller's responsibility — this takes the front of
 * the list, it does not rank. Passing unsorted standings would silently cut
 * the wrong people, which is why the parameter is named for what it must be.
 *
 * A per-flight cut applies the rule *within each flight*, so "top 2" means two
 * from every flight rather than two from the tournament. That is what a club
 * means by it, and it is the difference between a bracket of eight and a
 * bracket of two.
 */
export function survivors(rankedInOrder: CutCandidate[], rule: CutRule): Set<string> {
  if (rule.scope === "overall") {
    const n = survivorCount(rule, rankedInOrder.length);
    return new Set(rankedInOrder.slice(0, n).map((p) => p.id));
  }

  // Group while preserving the ranking order inside each flight.
  const byFlight = new Map<string, CutCandidate[]>();
  for (const p of rankedInOrder) {
    const key = p.groupId ?? "";
    const list = byFlight.get(key);
    if (list) list.push(p);
    else byFlight.set(key, [p]);
  }

  const out = new Set<string>();
  for (const list of byFlight.values()) {
    // Sized against that flight, not the whole field: "top 50%" of a flight of
    // eight is four, whatever the other flights look like.
    const n = survivorCount(rule, list.length);
    for (const p of list.slice(0, n)) out.add(p.id);
  }
  return out;
}

/**
 * Would enabling this cut change who plays the next round?
 *
 * A cut set to pass at least as many players as the field it filters is a
 * no-op: "top 16" of a 16-player flight advances all 16, and the round after
 * it plays with exactly the field that would have played anyway. The default
 * cut count is a fixed 16, so turning a cut *on* for a 16-player event quietly
 * advances everyone — the organizer configures a cut line, reads "16 of 16
 * advance", and nothing is actually cut. That is worth a warning wherever the
 * cut is set or its result shown, because the screen otherwise looks like a
 * working cut.
 *
 * Scope decides what "the field" is. An overall cut filters the whole entry,
 * so the relevant size is the field. A per-flight cut filters each flight
 * independently, so the relevant size is the largest flight — clear everyone
 * in the biggest flight and every smaller flight is cleared too. The absolute
 * number is deliberately left alone; this only reports whether it bites.
 */
export function cutAdvancesEveryone(
  rule: CutRule,
  fieldSize: number,
  /** Sizes of the individual flights; only consulted for a per-flight cut. */
  flightSizes?: number[],
): boolean {
  const relevant =
    rule.scope === "perFlight" && flightSizes && flightSizes.length
      ? Math.max(...flightSizes)
      : fieldSize;
  if (relevant <= 0) return false;
  return survivorCount(rule, relevant) >= relevant;
}

/** A round's own cut fields, as stored on the Stage it feeds. */
export interface RoundCutFields {
  cutEnabled: boolean;
  /** "count" | "percent". */
  cutMode: string;
  cutCount: number;
  cutPercent: number;
  /** "overall" | "perFlight". */
  cutScope: string;
}

export interface RoundCutLine {
  /** 1-based number of the round whose field is being cut down. */
  fromRound: number;
  /** 1-based number of the round the survivors advance into. */
  toRound: number;
  /** The advance clause alone, e.g. "top 8 advance" or "top 25% per flight advance". */
  advance: string;
  /** The whole line, e.g. "Round 1 → Round 2 · top 8 advance". */
  label: string;
}

/**
 * The cut rule that decides who advances OUT of the active round, or null.
 *
 * The cut is a property of the round it feeds: Stage N's cutEnabled means the
 * field entering N is the top of N-1's standings (the schema and CutControl
 * both read the *receiving* round's fields). So the cut that thins the active
 * round's field is the next round's, and it exists only when there is a next
 * round and its cut is on.
 *
 * This is the single source of truth for a round-to-round cut: the standings
 * highlight resolves who survives with it (via `survivors`), and the dashboard
 * card labels it (via `currentRoundCut`). A knockout uses event-level
 * qualification instead, which is why the caller only asks here when there is
 * no bracket/qualification stage to advance into.
 */
export function currentRoundCutRule(
  rounds: RoundCutFields[],
  activeIndex: number,
): CutRule | null {
  if (activeIndex < 0) return null;
  const next = rounds[activeIndex + 1];
  if (!next || !next.cutEnabled) return null;
  return {
    scope: next.cutScope === "perFlight" ? "perFlight" : "overall",
    mode: next.cutMode === "percent" ? "percent" : "count",
    count: next.cutCount,
    percent: next.cutPercent,
  };
}

/** The current round's cut as a one-line dashboard label, or null. */
export function currentRoundCut(
  rounds: RoundCutFields[],
  activeIndex: number,
): RoundCutLine | null {
  const rule = currentRoundCutRule(rounds, activeIndex);
  if (!rule) return null;

  const perFlight = rule.scope === "perFlight";
  const amount = rule.mode === "percent" ? `${rule.percent}%` : `${rule.count}`;
  const advance = `top ${amount}${perFlight ? " per flight" : ""} advance`;
  const fromRound = activeIndex + 1;
  const toRound = activeIndex + 2;
  return { fromRound, toRound, advance, label: `Round ${fromRound} → Round ${toRound} · ${advance}` };
}

/** One line describing what the rule will do, for the setup screen. */
export function describeCut(rule: CutRule, fieldSize: number, flightCount: number): string {
  const perFlight = rule.scope === "perFlight" && flightCount > 0;

  if (rule.mode === "percent") {
    return perFlight
      ? `Top ${rule.percent}% of each flight advances.`
      : `Top ${rule.percent}% of the field advances — ${survivorCount(rule, fieldSize)} of ${fieldSize}.`;
  }

  if (perFlight) {
    const total = rule.count * flightCount;
    return `Top ${rule.count} from each of the ${flightCount} flights advances — ${total} in total.`;
  }
  return `Top ${survivorCount(rule, fieldSize)} of ${fieldSize} advances.`;
}

/**
 * Reform a cut-down field into fresh, balanced flights.
 *
 * An overall cut takes the best players across every flight, so survivors land
 * unevenly — four out of one flight, one out of the next. Left in their old
 * flights, that lone survivor plays a round robin of one: the scheduler draws
 * no matches for a flight of one, so the player is in the round with nothing to
 * play, and nothing says so. If the cut ignored the flight walls, the next
 * round has to as well.
 *
 * So the surviving field is pooled and reformed from scratch, balanced the same
 * way the tournament was drawn initially, into flights of roughly the original
 * size. The flight count is capped at ⌊n/2⌋ so no flight can come out with a
 * single player — better a slightly larger flight than one nobody can play in.
 * Too few survivors to fill even one pairing yields no flights at all, which
 * the caller reads as "nothing to schedule" rather than emitting an empty one.
 */
export function reflightSurvivors(
  survivors: Player[],
  targetPerFlight: number,
): Array<{ name: string; playerIds: string[] }> {
  const n = survivors.length;
  if (n < 2) return [];
  const per = Math.max(2, Math.round(targetPerFlight) || 2);
  const desired = Math.max(1, Math.round(n / per));
  /**
   * Never more flights than can hold two apiece — the whole point is to stop a
   * flight of one, which is exactly what an over-eager split reintroduces.
   *
   * BELT AND BRACES, and worth saying so. `formGroups` already caps the count
   * itself: asked for five flights out of five players it returns [3, 2], not
   * five singles. Mutation testing confirms it — removing this clamp changes no
   * outcome the sweep can find. It stays because it states the intent HERE,
   * where the reason lives, rather than depending on a guarantee two modules
   * away that nothing obliges `formGroups` to keep.
   */
  const count = Math.min(desired, Math.floor(n / 2));
  return formGroups(survivors, "balanced", { mode: "count", value: count }).map((g) => ({
    name: g.name,
    playerIds: g.playerIds,
  }));
}

export interface NextRoundFlight {
  /** The existing flight these players stay in, or null when the field was
   *  pooled and reformed (an overall cut). */
  keepGroupId: string | null;
  /** Name for a freshly formed flight; empty when an existing flight is kept. */
  name: string;
  playerIds: string[];
}

/**
 * How the survivors of a round are arranged into flights for the next one.
 *
 * A per-flight cut is a separate race inside each flight, so its survivors stay
 * exactly where they were — the flights are untouched. An overall cut ranked
 * everyone against everyone, so it reforms the field (see reflightSurvivors).
 * The caller keeps the existing flight rows for the first case and reassigns
 * players for the second; either way it draws a round robin per returned flight
 * and skips any left with fewer than two players.
 */
export function nextRoundFlights(
  survivors: Player[],
  scope: CutScope,
  targetPerFlight: number,
): NextRoundFlight[] {
  if (scope === "overall") {
    return reflightSurvivors(survivors, targetPerFlight).map((f) => ({
      keepGroupId: null,
      name: f.name,
      playerIds: f.playerIds,
    }));
  }
  // Per flight (and a plain regen with no cut): flights are unchanged. Group by
  // the flight each player already belongs to, preserving the ranking order the
  // survivors arrived in. A player with no flight was never scheduled, and is
  // not scheduled now.
  const byFlight = new Map<string, string[]>();
  for (const p of survivors) {
    if (!p.groupId) continue;
    const list = byFlight.get(p.groupId);
    if (list) list.push(p.id);
    else byFlight.set(p.groupId, [p.id]);
  }

  /**
   * A FLIGHT OF ONE IS NOT A FLIGHT, and keeping it is how a round comes back
   * empty.
   *
   * "1 from each of 3 flights" is a perfectly ordinary cut, and it left three
   * flights holding one player each. A round robin of one draws no pairings,
   * the caller drops any flight under two, and the round it had just wiped was
   * rebuilt with nothing in it — under a screen still saying "3 of 12 advance"
   * and a tag reading "not generated yet", which was there before the click.
   * The partial version was quieter still: one flight reduced to a single
   * survivor while the others drew normally, so that player sat in a round with
   * no opponent and nothing anywhere said so.
   *
   * When it happens, the survivors are pooled and re-flighted together. That is
   * what the cut meant: a per-flight cut down to one is "the flight winners go
   * through", and flight winners play each other. Flights are only preserved
   * while they are still flights — which is every ordinary case, and every case
   * the caller had before this.
   */
  const kept = [...byFlight.entries()].map(([groupId, playerIds]) => ({
    keepGroupId: groupId,
    name: "",
    playerIds,
  }));
  if (kept.some((f) => f.playerIds.length < 2)) {
    return reflightSurvivors(survivors, targetPerFlight).map((f) => ({
      keepGroupId: null,
      name: f.name,
      playerIds: f.playerIds,
    }));
  }
  return kept;
}
