/**
 * ONE PRIZE PER PLAYER (Ajay, 2026-10-21, the team's recommendation C1: "go
 * with your recommendation").
 *
 * Many clubs print it in their terms of competition: nobody takes home two
 * PLACING prizes from one competition, and where a player could win two, the
 * gross prize is decided first and the player is then passed over for the net.
 * The tournament ticks it on Prizes (`Event.onePrizePerPlayer`); off, which is
 * every tournament stored before it, a player may hold any number.
 *
 * WHAT COUNTS is the line's own property (`Prize.countsForOnePrize`): winner,
 * runner-up, a flight's winner, best gross, best net count; a SKILL prize —
 * nearest the pin, longest drive, twos — does not, because a club universally
 * lets its winner also take nearest the pin. A `Contest` (the KP and long-drive
 * games with their own winners, under Side games) is not a Prize row at all,
 * so it is outside the rule entirely.
 *
 * Pure: the action that saves an award (`setPrizeWinner`), the one that ticks
 * the box, the one that switches a line, and the picker on the screen all ask
 * these functions, so the screen cannot offer a rule the server does not keep.
 */

export interface PrizeHolding {
  id: string;
  category: string;
  winnerId: string | null;
  /** Whether this line counts toward one prize per player. */
  counts: boolean;
}

/** The sentence under the tick-box, said once and drawn from here. */
export const ONE_PRIZE_LABEL = "One prize per player";
export const ONE_PRIZE_HELP =
  "Nobody takes home two placing prizes. Award the gross prizes first; a player who wins one is skipped for the net. Skill prizes such as nearest the pin and longest drive don't count.";
export const COUNTS_LABEL = "Counts toward one prize per player";

/**
 * Whether a name reads as a SKILL prize rather than a placing one — the default
 * for a line typed by hand, which the organizer can switch on the row.
 *
 * Kept narrow on purpose. A wrong "skill" lets a player take two placing
 * prizes without anybody choosing it; a wrong "placing" is refused on the
 * screen, where the switch beside it is the remedy.
 */
export function looksLikeSkillPrize(category: string): boolean {
  const c = category.toLowerCase();
  return (
    /\b(nearest|closest)\b.*\b(pin|hole|flag)\b/.test(c) ||
    /\bkp\b|\bntp\b|\bctp\b/.test(c) ||
    /\b(longest|straightest)\s+(drive|putt)\b/.test(c) ||
    /\blong\s+drive\b/.test(c) ||
    // "Twos", never "two": "Day two winner" is a placing prize.
    /\btwos\b|\bhole[\s-]in[\s-]one\b/.test(c)
  );
}

/** Whether a line's name says it is a GROSS prize — which is decided first. */
export function isGrossPrize(category: string): boolean {
  return /\bgross\b/i.test(category) && !/\bnet\b/i.test(category);
}

/**
 * The counting prize this player already holds OTHER than `prizeId`, or null.
 * Holding `prizeId` itself is not a clash: re-awarding a prize to its own
 * winner changes nothing.
 */
export function otherPrizeHeld(prizes: PrizeHolding[], prizeId: string, playerId: string): PrizeHolding | null {
  if (!playerId) return null;
  return prizes.find((p) => p.id !== prizeId && p.counts && p.winnerId === playerId) ?? null;
}

/**
 * Why `playerId` may NOT be given `prizeId`, or null where they may.
 *
 *   the rule off            → null, whatever they hold (the control)
 *   clearing the winner     → null
 *   a line that doesn't count (a skill prize) → null
 *   they hold another counting prize          → the refusal, naming it
 *
 * Where the prize being given is a GROSS one and what they hold is not, the
 * refusal says how to put gross first: clear the other line, then award this.
 */
export function onePrizeRefusal(input: {
  on: boolean;
  prizes: PrizeHolding[];
  prizeId: string;
  playerId: string;
  playerName: string;
}): string | null {
  if (!input.on || !input.playerId) return null;
  const prize = input.prizes.find((p) => p.id === input.prizeId);
  if (!prize || !prize.counts) return null;
  const held = otherPrizeHeld(input.prizes, input.prizeId, input.playerId);
  if (!held) return null;
  const who = input.playerName || "That player";
  if (isGrossPrize(prize.category) && !isGrossPrize(held.category)) {
    return `${who} already has ${held.category}. This tournament gives one prize per player, gross first — clear ${held.category} to give ${prize.category} here, or choose the next player.`;
  }
  return `${who} already has ${held.category}. This tournament gives one prize per player — choose the next player.`;
}

/** Every player holding two or more counting prizes, with what they hold, in list order. */
export function onePrizeClashes(prizes: PrizeHolding[]): Array<{ playerId: string; categories: string[] }> {
  const held = new Map<string, string[]>();
  for (const p of prizes) {
    if (!p.counts || !p.winnerId) continue;
    held.set(p.winnerId, [...(held.get(p.winnerId) ?? []), p.category]);
  }
  return [...held].filter(([, c]) => c.length > 1).map(([playerId, categories]) => ({ playerId, categories }));
}

/** "a, b and c" */
function andList(items: string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Why the box may NOT be ticked, or null. Ticking it while somebody already
 * holds two counting prizes would leave the tournament in a state its own rule
 * says cannot exist, and nothing would say which award the rule meant to undo —
 * so the tick is refused, naming who and what, and the committee clears one.
 */
export function onePrizeTickRefusal(prizes: PrizeHolding[], nameOf: (playerId: string) => string): string | null {
  const clashes = onePrizeClashes(prizes);
  if (clashes.length === 0) return null;
  const said = clashes.map((c) => `${nameOf(c.playerId) || "One player"} has ${andList(c.categories)}`);
  return `${andList(said)}. Clear ${clashes.length === 1 && clashes[0].categories.length === 2 ? "one of them" : "the extra awards"} before giving one prize per player.`;
}

/**
 * The order the lines are AWARDED in while the rule is on: gross first.
 *
 *   1. the counting GROSS lines   — decided first, as the Rules and club terms do
 *   2. the other counting lines   — net and the placings, skipping a gross winner
 *   3. the lines that do not count — skill prizes, which interact with nothing
 *
 * Each group keeps the committee's own order (the `position` the list is
 * stored in). A sort rather than the structure's order, because the order
 * lines were ADDED in is not the order of precedence: "Top 3 overall" pressed
 * before "Best gross & net", or a gross line typed last, would otherwise put
 * the net placings ahead of the gross. `position` itself is untouched, so the
 * final report and the player's list read in the committee's order.
 * With the rule off the list is returned as it came.
 */
export function awardOrder<T extends { category: string; counts: boolean }>(prizes: T[], on: boolean): T[] {
  if (!on) return prizes;
  const rank = (p: T) => (!p.counts ? 2 : isGrossPrize(p.category) ? 0 : 1);
  return prizes.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
}

export interface PickerOption {
  id: string;
  name: string;
  place?: number | null;
}

/**
 * The winner picker for one line while the rule is on: the players who may
 * take it, in the order offered (finishing order), the first of them marked as
 * the suggestion; then everybody who already holds another counting prize,
 * out of the way and saying what they hold. Nobody is hidden — the organizer
 * sees why a name is down there, and the server says the same if it is chosen.
 * A line that does not count, or the rule off, is offered as it came.
 */
export function pickerFor(
  options: PickerOption[],
  prizes: PrizeHolding[],
  prizeId: string,
  on: boolean,
): { free: Array<PickerOption & { suggested: boolean }>; holding: Array<PickerOption & { holds: string }> } {
  const prize = prizes.find((p) => p.id === prizeId);
  if (!on || !prize || !prize.counts) return { free: options.map((o) => ({ ...o, suggested: false })), holding: [] };
  const free: Array<PickerOption & { suggested: boolean }> = [];
  const holding: Array<PickerOption & { holds: string }> = [];
  for (const o of options) {
    const held = otherPrizeHeld(prizes, prizeId, o.id);
    if (held) holding.push({ ...o, holds: held.category });
    else free.push({ ...o, suggested: false });
  }
  if (free[0]) free[0].suggested = true;
  return { free, holding };
}
