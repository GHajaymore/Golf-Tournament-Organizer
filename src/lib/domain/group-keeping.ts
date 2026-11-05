/**
 * ONE SCORER PER GROUP: whose phone keeps a group's card (2026-11-04, sprint 2
 * part B).
 *
 * At a real team cup (2026-10-18) every phone in a four-ball could write the
 * match. On a round whose `scoreKeeping` is "group" (`roundScoring`), one
 * player per group keeps the card — the scorer — and every save from anyone
 * else in the group is refused in words. Anyone in the group may take over
 * (a flat battery is the ordinary reason), which moves the card to their phone
 * and is logged; the phone that was taken over is then refused, because its
 * `epoch` is stale.
 *
 * THE GROUP is, in this order:
 *   1. the published tee-sheet group the player is in — who walked off the tee
 *      together, the people who can see each other's card;
 *   2. else the match the player is in, on this round — a four-ball is its own
 *      group when nobody published a sheet;
 *   3. else the whole round — a casual four with no sheet and no draw.
 * `groupKeyFor` is the only place that order is written.
 *
 * Pure: the caller loads the sheet, the matches and the keeper row
 * (`services/group-keeping.ts`).
 */

/** A match's two sides, as player ids. */
export interface KeepingMatch {
  id: string;
  sideA: string[];
  sideB: string[];
}

export interface KeepingContext {
  /** The published tee sheet's groups, each narrowed to the confirmed field. Empty when none is published. */
  teeGroups: string[][];
  /** This round's matches. */
  matches: KeepingMatch[];
}

/** The whole round, as one group. */
export const WHOLE_ROUND = "round";

/**
 * The group a player keeps score in, as a stable key.
 *
 * A tee-sheet group is keyed by who is in it, sorted, not by its position on
 * the sheet: a sheet republished in a different order is the same groups, and
 * a group a player has been moved into or out of is a different one — whose
 * card nobody has kept yet.
 *
 * A player in more than one of this round's matches (a round robin) is not
 * narrowed to one of them: their group is the round.
 */
export function groupKeyFor(playerId: string, ctx: KeepingContext): string {
  const tee = ctx.teeGroups.find((g) => g.includes(playerId));
  if (tee) return `tee:${[...tee].sort().join(",")}`;
  const mine = ctx.matches.filter((m) => m.sideA.includes(playerId) || m.sideB.includes(playerId));
  if (mine.length === 1) return `match:${mine[0].id}`;
  return WHOLE_ROUND;
}

/** Everyone in a group, given its key and the round's confirmed field. */
export function groupMembers(key: string, ctx: KeepingContext, field: readonly string[]): string[] {
  if (key.startsWith("tee:")) return key.slice(4).split(",").filter(Boolean);
  if (key.startsWith("match:")) {
    const m = ctx.matches.find((x) => `match:${x.id}` === key);
    return m ? [...m.sideA, ...m.sideB] : [];
  }
  return [...field];
}

/** The keeper row, as far as the rule needs it. */
export interface Keeper {
  playerId: string;
  epoch: number;
}

export type KeepDecision =
  | { ok: true; epoch: number }
  | { ok: false; error: string; keeper: string | null };

/**
 * WHETHER THIS PHONE MAY SAVE THIS GROUP'S CARD.
 *
 * `keeper` is the row as it stands AFTER the claim upsert — so when nobody
 * kept the group, the first phone to save became its scorer and this reads
 * its own row. `epoch` is the epoch the phone holds, when it holds one: a
 * screen written before this rule sends none, and is held to "you are the
 * scorer" alone.
 *
 * `nameOf` turns the scorer's id into the name a refused player reads.
 */
export function mayKeep(input: {
  actorId: string;
  keeper: Keeper;
  epoch: number | undefined;
  nameOf: (playerId: string) => string;
}): KeepDecision {
  const { actorId, keeper, epoch, nameOf } = input;
  if (keeper.playerId !== actorId) {
    return {
      ok: false,
      keeper: keeper.playerId,
      error: `${nameOf(keeper.playerId) || "Someone else"} is keeping score for your group. Ask them to enter it, or take over the card from your phone.`,
    };
  }
  if (epoch !== undefined && epoch !== keeper.epoch) {
    return {
      ok: false,
      keeper: keeper.playerId,
      error: "The card moved to another phone since this one last saved, so this score wasn't sent. Reload to see who is keeping it.",
    };
  }
  return { ok: true, epoch: keeper.epoch };
}

/** Said to a player asked to keep a group they are not in. */
export const NOT_YOUR_GROUP = "You can only keep score for your own group.";

/** Said when a hand-over names somebody outside the group. */
export const HAND_OVER_OUTSIDE = "You can only hand the card to someone in your group.";

/** Said when someone who is not the scorer tries to hand the card on. */
export const HAND_OVER_NOT_YOURS = "Only the player keeping the card can hand it over.";
