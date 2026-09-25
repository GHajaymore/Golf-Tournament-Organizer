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

/**
 * HOW MANY PLAYERS ARE ENTITLED TO PLAY THIS ROUND, after every cut before it.
 *
 * A cut is stored on the round it FEEDS — `rounds[n].cutEnabled` means the
 * field entering round n is the top of round n-1's standings — so the field
 * shrinks as the tournament goes on and the event's entry list stops being the
 * right denominator the moment a club takes one.
 *
 * Read off the seeded club's Club Championship on 2026-09-20, a COMPLETED
 * 36-hole championship cut to 16: twenty-eight entered, sixteen played the
 * second round, sixteen returned a card, and the dashboard said
 *
 *     CARDS IN  16/28  ·  57% submitted
 *
 * over a tournament where every player still in it had handed their card in.
 * Twelve cards were not missing; those twelve had been cut the day before.
 * The same shape as counting a team round's sides in players.
 *
 * FLIGHTS ARE TRACKED WHERE THEY CAN BE, because "top 2 per flight" is a
 * different number from "top 2" and the difference compounds over two cuts.
 * After an OVERALL cut the flight split is no longer derivable FROM SIZES —
 * the survivors can come from anywhere — so a later per-flight cut is sized
 * against the whole remaining field instead.
 *
 * WHICH WAY THAT ERRS IS THE PART TO KNOW: too BIG. A club would see "16 of 24
 * · 67% submitted" over a round where all sixteen are in — cards reading as
 * outstanding that do not exist, which is a smaller instance of the very
 * defect this function was written for. It takes two cuts of different scopes
 * in one tournament to appear at all, and it is still far closer than the
 * entry list, so it is named here rather than hidden.
 *
 * The exact answer is available and costs more than a denominator is worth:
 * flight membership travels with the PLAYERS, so chaining `survivors` round by
 * round would keep it — but that needs the field ranked as of each
 * intermediate round, which means every card up to it. Whoever has that in
 * hand should do it properly; this function errs high until they do.
 */
export function fieldEnteringRound(
  rounds: RoundCutFields[],
  index: number,
  field: { total: number; flights?: number[] },
): number {
  let total = Math.max(0, field.total);
  let flights = (field.flights ?? []).filter((n) => n > 0);

  for (let r = 1; r <= index && r < rounds.length; r += 1) {
    const round = rounds[r];
    if (!round?.cutEnabled) continue;
    const rule: CutRule = {
      scope: round.cutScope === "perFlight" ? "perFlight" : "overall",
      mode: round.cutMode === "percent" ? "percent" : "count",
      count: round.cutCount,
      percent: round.cutPercent,
    };
    if (rule.scope === "perFlight" && flights.length > 0) {
      flights = flights.map((n) => survivorCount(rule, n));
      total = flights.reduce((a, b) => a + b, 0);
    } else if (rule.scope === "perFlight") {
      // A per-flight cut whose flight split an earlier overall cut already
      // erased. Its true size is count × (surviving flights), and neither is
      // known here. `survivorCount(rule, total)` — min(count, total) for a count
      // rule — collapses "top N per flight" to "top N of the field", which errs
      // LOW: two flights of top-2 read as 2, not 4, and the progress bar then
      // shows over 100%. Leaving `total` as the whole remaining field errs HIGH
      // instead — the documented, safe direction (a denominator too big, never
      // too small). flights stays [] — still not derivable.
    } else {
      total = survivorCount(rule, total);
      // An overall cut takes whoever is at the top, so the flight split it
      // leaves behind is not derivable from the sizes.
      flights = [];
    }
  }
  return total;
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
  /**
   * The sentence under it, TENSED against how far the field has actually got.
   *
   * It read "Survivors of Round 1 play Round 2." in every state, which is true
   * and unreadable next to a board showing Round 3: two true sentences on one
   * screen with nothing saying they answer different questions. The cut card
   * describes the CHAIN — which round feeds which — and the board describes
   * what has been RETURNED, and on a league where the field has gone past the
   * chain those are different rounds.
   *
   * Nothing underneath was wrong. `currentRoundCut` and the engine that
   * actually moves people index off the same round deliberately, so changing
   * which round this describes would make the label name a cut nobody is
   * applying. The fix is the sentence.
   */
  note: string;
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
  /**
   * The round the BOARD is showing, 1-based, or 0 when nothing has been
   * returned yet. Optional so a caller that does not know stays correct: it
   * gets the neutral wording rather than a guessed tense.
   */
  playedThrough = 0,
): RoundCutLine | null {
  const rule = currentRoundCutRule(rounds, activeIndex);
  if (!rule) return null;

  const perFlight = rule.scope === "perFlight";
  const amount = rule.mode === "percent" ? `${rule.percent}%` : `${rule.count}`;
  const advance = `top ${amount}${perFlight ? " per flight" : ""} advance`;
  const fromRound = activeIndex + 1;
  const toRound = activeIndex + 2;

  /**
   * THREE STATES, AND THE CARD SHOULD READ DIFFERENTLY IN EACH.
   *
   * Written as the club would say it out loud, and always naming BOTH rounds,
   * because the number beside it is the whole reason somebody looked.
   *
   *   nothing returned yet   the cut is a plan
   *   the cut round is live  it is happening now
   *   the field is past it   it has happened, and the board is elsewhere
   *
   * The last is the case this exists for: on a league standing at Round 3, a
   * card reading "Survivors of Round 1 play Round 2" is a true sentence that
   * reads like a live instruction.
   */
  const note =
    playedThrough > fromRound
      ? `Round ${fromRound} is complete — the ${advance.replace(/ advance$/, "")} went through to Round ${toRound}.`
      : playedThrough === fromRound
        ? `Round ${fromRound} is being played — the ${advance.replace(/ advance$/, "")} go through to Round ${toRound}.`
        : `After Round ${fromRound}, the ${advance.replace(/ advance$/, "")} go through to Round ${toRound}.`;

  return {
    fromRound,
    toRound,
    advance,
    label: `Round ${fromRound} → Round ${toRound} · ${advance}`,
    note,
  };
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
    // Clamped to the field: "top 16 from each of 2 flights" over a 16-player
    // field cannot advance 32. Individual flight sizes are not passed here, so
    // this bounds the total by what exists rather than sizing each flight.
    const total = Math.min(rule.count * flightCount, fieldSize);
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

/**
 * WHETHER THE QUALIFYING LINE WAS SETTLED ON POINTS OR ON COUNTBACK.
 *
 * The qualification panel prints "Cutoff pts" — the lowest total that got
 * through — and says of the table under it: "Every player is shown, so you
 * can see exactly who missed out and by how much."
 *
 * On Demo Cup, read on 2026-09-11, it printed 10.5. Four players were on
 * exactly 10.5: two advanced and two did not. So the honest answer to "by how
 * much" was "by nothing", and the screen had no way to say it — a member on
 * 10.5 reads a cutoff of 10.5 and concludes they qualified.
 *
 * The app was not WRONG about who goes through. `rankPlayers` separated them
 * on the club's own tiebreak chain — head-to-head, holes-won ratio, fewest
 * holes lost, lower handicap — which is a published countback and a perfectly
 * proper way to decide a cut. What was missing is that it happened at all,
 * on the screen an organizer has to explain the cut from.
 *
 * Deliberately NOT the same thing as `tiedAtCut`. That fires when the chain
 * cannot separate two players at the line and a play-off is owed. This fires
 * when it CAN and did: nobody is owed anything, and the organizer still needs
 * to be able to answer "I had the cutoff score, why am I out?".
 *
 * Points only, and that is the whole of its claim. It says the line did not
 * fall between two different totals; it does not say which tiebreaker settled
 * it, because that is the chain's business and differs per club.
 */
export function cutSettledOnCountback(
  rows: ReadonlyArray<{ points: number; advancing: boolean }>,
): boolean {
  const through = rows.filter((r) => r.advancing);
  const out = rows.filter((r) => !r.advancing);
  // Nobody on one side of the line means there is no line to describe.
  if (through.length === 0 || out.length === 0) return false;

  const lowestThrough = Math.min(...through.map((r) => r.points));
  const highestOut = Math.max(...out.map((r) => r.points));
  return lowestThrough === highestOut;
}

/**
 * WHERE A SINGLE CUT LINE MAY BE DRAWN — AND WHEN IT MAY NOT BE DRAWN AT ALL.
 *
 * One horizontal rule across a board makes a claim about every row at once:
 * everything above it is through, everything below it is out. That claim is
 * only available when the advancing set is a contiguous PREFIX of the rows in
 * the order they are displayed in.
 *
 * It is not always. A bracket takes its field from the ranking that qualified
 * it — the match-points chain of an earlier round — while the board beside it
 * ranks whatever round the field is playing NOW. The two orders have no
 * relation, so the qualifiers land scattered through the list.
 *
 * MEASURED on the seeded Demo Cup, 2026-09-15, off `/me/board` and therefore
 * off the public share link too. Thirty-three rows, ranked on the medal round
 * in progress; FOUR players advancing, at positions 2, 7, 8 and 17. The reader
 * took the LAST of those and drew its line under row 17, so:
 *
 *   - thirteen players were shown above the line who are not through, and
 *   - the leader of the round — top of the board, four shots clear — sat
 *     above the line without being one of the four.
 *
 * Nothing distinguished them, because the line was the only thing on that
 * screen saying anything about qualification at all.
 *
 * This is the same disease `qualificationBubble` already refuses to print a
 * sentence about ("Walkthrough Player is -12 shots outside qualification"), and
 * the cure is the same: say nothing positional when the positions do not carry
 * the meaning. Which round should seed a bracket is a product question and sits
 * in `docs/deferred-register.md`; whether to draw this line is not.
 *
 * Returns the index of the last advancing row when the line is honest, and
 * `null` when it is not — including when everybody advances, where there is no
 * line to draw. A caller with `null` should mark the advancing rows one at a
 * time, as the console's table, the qualification panel and Reports all do.
 */
export function cutLineIndex(rows: ReadonlyArray<{ advancing: boolean }>): number | null {
  let last = -1;
  for (let i = 0; i < rows.length; i += 1) if (rows[i].advancing) last = i;
  // Nobody through, or everybody through: no line separates anything.
  if (last < 0 || last >= rows.length - 1) return null;
  // Every row above it must be through, or the line speaks for rows it cannot
  // speak for. `last` is the final advancing row by construction, so checking
  // the prefix is the whole test.
  for (let i = 0; i < last; i += 1) if (!rows[i].advancing) return null;
  return last;
}
