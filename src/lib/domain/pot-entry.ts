/**
 * Who is in a pot, when the club does not collect a signature from everybody.
 *
 * Every pot in this app was opt-in: a name is in because somebody put it
 * there. That is right for a Saturday sweep and wrong for the two commonest
 * cases a club actually runs —
 *
 *   - a weekly league, where the skins are part of turning up, and
 *   - closest-to-the-pin and longest drive, which are simply on, for everyone.
 *
 * Under opt-in an organizer ticks forty names every week, and a player added
 * on the Thursday is silently out of a pot they believe they are in. The
 * absence of a row means "not entered", and there is no way to say "everybody,
 * unless they said otherwise".
 *
 * So a pot carries a MODE, and the field is the default membership in one of
 * them. The granularity follows the tournament's own shape and needs no
 * setting of its own: a pot hangs off a round, so a season-long league gets
 * opt-out per round for free — this Thursday, not the season — and a
 * single- or multi-day tournament's contest can hang off the outing instead.
 */

export type PotEntryMode =
  /** A name is in because somebody put it there. The original behaviour. */
  | "opt-in"
  /** Everyone in the field is in, unless they said otherwise. */
  | "opt-out";

export const POT_ENTRY_MODES: PotEntryMode[] = ["opt-in", "opt-out"];

export function isPotEntryMode(v: string): v is PotEntryMode {
  return (POT_ENTRY_MODES as string[]).includes(v);
}

/**
 * A row recorded against a pot for one player.
 *
 * The same row means different things in the two modes, which is why both
 * flags exist rather than one. `excluded` is a decision about PLAYING;
 * `confirmed` is a decision about MONEY. Collapsing them would make "took
 * himself out" and "hasn't paid yet" the same fact, and they settle
 * differently: one owes nothing, the other owes the stake.
 */
export interface PotDecision {
  playerId: string;
  /** The organizer has the cash. */
  confirmed: boolean;
  /** Explicitly out — the opt-out half. */
  excluded: boolean;
}

export interface PotMembership {
  /** Stakes actually in the pot. */
  entrants: string[];
  /** In the pot's audience but still owing the stake. */
  pending: string[];
  /** Took themselves out, or were taken out. */
  excluded: string[];
}

/**
 * Work out a pot's membership from the field and whatever was recorded.
 *
 * One rule, read the same way in both modes, so there is no second
 * implementation to drift:
 *
 *   - an `excluded` row is out, always, in either mode;
 *   - a row with `confirmed: false` is pending — they are in the pot's
 *     audience and owe the stake;
 *   - otherwise the MODE decides what silence means. Opt-in: silence is out.
 *     Opt-out: silence is in, and paid.
 *
 * That last clause is the one to be honest about. In an opt-out pot a player
 * with no row at all counts as a confirmed stake, because the premise of
 * "everyone is in" is a club that collects as a matter of course — the weekly
 * subs, the bar tab, the entry fee. It is a real relaxation of "only money in
 * hand is in the pot", and it is confined to the mode where the organizer has
 * said that is how their club works. An organizer who has not been paid by
 * somebody marks them unpaid, which puts them in `pending` exactly as an
 * opt-in signup would be.
 */
export function potMembership(
  mode: PotEntryMode,
  fieldIds: string[],
  decisions: PotDecision[],
  /**
   * Everyone with a real Player row in this event, WHATEVER their status.
   *
   * Two different questions were being answered with one list, and a player
   * who withdraws separates them: who is still in the field to be offered a
   * pot, and whose money is already in one.
   *
   * `removeSignup` keeps a player with playing history as `withdrawn` rather
   * than deleting them, so a confirmed `ContestEntry` — a stake the organizer
   * has taken — outlives their place in the field. Filtered against the
   * confirmed field alone, that row landed in no bucket at all: not entrant,
   * not pending, not excluded. The pot showed three stakes against four
   * collected, the winner was paid £30 of £40, and the player who paid showed
   * as square.
   *
   * `skinsPotFor` already loads every status and says why: "a stake is paid or
   * it is not. Withdrawing from a tournament is not a refund" — rule 7 makes
   * the record the only thing there is, and a record that quietly drops a
   * payment is worse than no record. The two pot families disagreed about the
   * same fact; this is skins' shape.
   *
   * NOT simply removing the filter. `ContestEntry` has no foreign key to
   * `Player`, so a hard-deleted player leaves an orphan row behind, and the
   * filter is what keeps that out of a pot. This narrows it to "is a real
   * player in this event" instead of "is still playing".
   *
   * Defaults to `fieldIds`, so a caller that has not been given the wider list
   * behaves exactly as before.
   */
  stakeholderIds: string[] = fieldIds,
): PotMembership {
  const byId = new Map(decisions.map((d) => [d.playerId, d]));
  const inField = new Set(fieldIds);
  const isPlayer = new Set(stakeholderIds);

  /**
   * A stake taken from somebody who has since left the field.
   *
   * Confirmed only. An unpaid ask from a player who has withdrawn is not money
   * the organizer holds, and carrying it into `pending` would put a departed
   * player on the "take their money" list for a pot they will never play.
   */
  const paidButGone = decisions.filter(
    (d) => !d.excluded && d.confirmed && !inField.has(d.playerId) && isPlayer.has(d.playerId),
  );

  const excluded = decisions.filter((d) => d.excluded).map((d) => d.playerId);
  const excludedSet = new Set(excluded);

  if (mode === "opt-out") {
    const entrants: string[] = [];
    const pending: string[] = [];
    for (const id of fieldIds) {
      if (excludedSet.has(id)) continue;
      const row = byId.get(id);
      // No row is the ordinary case here, and it means in and settled.
      if (!row || row.confirmed) entrants.push(id);
      else pending.push(id);
    }
    // Plus anyone whose stake was taken before they left. Opt-out reaches this
    // too: the withdrawal removes them from `fieldIds`, and the loop above
    // walks that list.
    for (const d of paidButGone) entrants.push(d.playerId);
    return { entrants, pending, excluded };
  }

  // Opt-in: only the rows that exist, and only where the money arrived.
  // Still filtered, so an orphan row from a hard-deleted player cannot enter a
  // pot — but on "is a real player in this event" rather than "is still
  // playing", which is what dropped a paid stake on withdrawal.
  const entrants: string[] = [];
  const pending: string[] = [];
  for (const d of decisions) {
    if (d.excluded || !isPlayer.has(d.playerId)) continue;
    // Gone and never paid: nothing is owed and nobody should be chased.
    if (!inField.has(d.playerId) && !d.confirmed) continue;
    (d.confirmed ? entrants : pending).push(d.playerId);
  }
  return { entrants, pending, excluded };
}

/** What the mode is called on screen, and what it promises. */
export const POT_MODE_LABEL: Record<PotEntryMode, string> = {
  "opt-in": "Players opt in",
  "opt-out": "Everyone in the field",
};

export const POT_MODE_HELP: Record<PotEntryMode, string> = {
  "opt-in":
    "Nobody is in until you tick them, or they put their own name down from the app and hand you the stake. Right for a one-off sweep.",
  "opt-out":
    "Everyone playing is in and counted as paid — the way a weekly league or a closest-to-the-pin usually works. Take out anyone who isn't playing for it, or mark them unpaid if you haven't collected. Anyone entered later joins automatically.",
};
