/**
 * Where a club's handicaps come from, and what happens when they cannot.
 *
 * A club has a position on this and it is not a per-member preference. Some
 * clubs run entirely on association figures — every member has a GHIN number,
 * nobody types an index, and an organizer editing one by hand is a mistake
 * rather than a feature. Others have no association data at all and run on the
 * club's own record. Today the app assumes the second and lets the first
 * happen by accident, one member at a time.
 *
 * The precedence itself is already settled and does not change here: an
 * association figure is the authority and a club handicap is the fallback —
 * see `maySuggestFor` in handicap-record.ts and
 * `docs/requirement-per-round-handicap.md`. What this adds is the club saying
 * so ONCE, for everybody, instead of the answer being assembled from whatever
 * each row happens to hold.
 */

/** What a club has decided about where indexes come from. */
export type HandicapPolicy =
  /**
   * The club's own record, and figures an organizer types. Today's behaviour
   * and the default, because a club that has said nothing has not opted into
   * anything.
   */
  | "club"
  /**
   * BOTH, per member, and almost certainly what a real club is.
   *
   * A member with an association number plays off that number; a member
   * without one plays off the club figure. Very few clubs are entirely one
   * or the other — a society has visitors, a club has social members who have
   * never held an index — and forcing the choice at club level would make an
   * organizer pick which half of their roster to get wrong.
   */
  | "hybrid"
  /**
   * Association figures only. Nobody types an index; a member without a GHIN
   * number is an unfinished roster row rather than a player at zero.
   */
  | "ghin";

export const HANDICAP_POLICIES: HandicapPolicy[] = ["club", "hybrid", "ghin"];

export function isHandicapPolicy(v: string): v is HandicapPolicy {
  return (HANDICAP_POLICIES as string[]).includes(v);
}

export function handicapPolicyOf(raw: string | null | undefined): HandicapPolicy {
  const v = (raw ?? "").trim().toLowerCase();
  return isHandicapPolicy(v) ? v : "club";
}

/**
 * May an organizer type a handicap for this member?
 *
 * Takes the MEMBER as well as the club, because under `hybrid` the answer
 * differs between two people on the same roster. That is not a wrinkle in the
 * design; it is the design — a club with an association number for half its
 * members and none for the other half is the ordinary case, and a club-level
 * yes/no would force an organizer to pick which half to get wrong.
 */
export function mayEditHandicapByHand(
  policy: HandicapPolicy,
  member: { ghin: string } = { ghin: "" },
): boolean {
  if (policy === "club") return true;
  if (policy === "ghin") return false;
  // hybrid: the association owns the figure for anybody who has a number with
  // them, and the club owns it for everybody else.
  return !member.ghin.trim();
}

/**
 * Why this edit cannot set a handicap by hand, or null if it can.
 *
 * "Just use GHIN and no manual" has to be enforced rather than displayed. A
 * greyed-out box is a suggestion: the action behind it is a public HTTP
 * endpoint and will be called with whatever the caller likes, and a club that
 * has declared the association authoritative should not end up with a typed
 * figure sitting beside association ones looking equally official.
 *
 * Changing the GHIN NUMBER is always allowed, including under this policy —
 * that is how a member gets connected in the first place, and refusing it
 * would make the policy impossible to adopt.
 */
export function refuseHandByHand(
  policy: HandicapPolicy,
  input: { handicap?: number; handicapSource?: string },
  current: { handicap: number; ghin?: string },
): string | null {
  const ghin = (current.ghin ?? "").trim();
  if (mayEditHandicapByHand(policy, { ghin })) return null;

  const wantsManual = (input.handicapSource ?? "").trim().toLowerCase() === "manual";
  const changesFigure =
    typeof input.handicap === "number" &&
    Number.isFinite(input.handicap) &&
    input.handicap !== current.handicap;

  if (!wantsManual && !changesFigure) return null;

  return policy === "ghin"
    ? "This club plays off GHIN indexes, so handicaps aren't entered by hand. " +
        "Add or correct the member's GHIN number instead."
    : // Hybrid, and this member HAS a number. Naming that is the difference
      // between a rule that reads as arbitrary and one an organizer can act
      // on: the fix is to remove the number, not to argue with the club.
      "This member's index comes from GHIN. Clear their GHIN number if the club " +
        "should set their handicap instead.";
}

/**
 * What to show for a member's index, and whether it can be trusted.
 *
 * THE DECISION THIS FILE EXISTS FOR. A club switches to GHIN, the integration
 * is not configured yet or the association is unreachable, and the app has to
 * answer "what is this player's handicap" anyway — because a round is starting
 * and eighteen people are on the first tee.
 *
 * There are three possible answers and only one of them is safe.
 *
 *   - **Zero.** Catastrophic. A 24-handicapper playing off scratch does not
 *     look like an outage; it looks like a competition, and it is settled and
 *     paid out before anybody works out why the results are absurd. This is
 *     the failure mode the whole design is arranged to make impossible.
 *   - **Refuse to score.** Honest but useless. The round happens whether or
 *     not the association answers, and a club standing on the first tee cannot
 *     wait for an API.
 *   - **The last figure actually received, labelled with its age.** A
 *     fortnight-old index is very nearly right — indexes move slowly, by
 *     design — and saying how old it is lets a committee decide. This is the
 *     answer.
 *
 * So a stale index is USABLE and a missing one is BLOCKING, and the two are
 * different states rather than both collapsing to a number.
 */
export type HandicapStanding =
  /** A figure we hold and may use. `staleDays` is how old it is; 0 is fresh. */
  | { usable: true; index: number; staleDays: number; stale: boolean; note: string }
  /** No figure at all. The roster row is unfinished and must be finished. */
  | { usable: false; reason: "no-ghin-number" | "never-synced"; note: string };

/** Past this, say how old the figure is rather than presenting it as current. */
export const STALE_AFTER_DAYS = 7;

export function handicapStanding(input: {
  policy: HandicapPolicy;
  /** The figure held on the row, whatever its source. */
  index: number;
  /** When an association figure was last actually received, if ever. */
  syncedAt: Date | null;
  /** The member's association number, if they have one. */
  ghin: string;
  /** Today, passed in so this stays a pure function. */
  now: Date;
}): HandicapStanding {
  const { policy, index, syncedAt, ghin, now } = input;
  const hasNumber = !!ghin.trim();

  // A club running its own record has nothing to be stale about: the figure on
  // the row IS the club's figure, and it is as current as the last card.
  if (policy === "club") {
    return { usable: true, index, staleDays: 0, stale: false, note: "" };
  }

  /**
   * Under HYBRID, a member with no association number is simply a club-handicap
   * member and there is nothing wrong with them.
   *
   * This is the branch that makes hybrid worth having. The same roster row that
   * blocks a round under a GHIN-only club is perfectly ordinary here, so the
   * screen must not decorate it with a warning: a club that has deliberately
   * chosen "both" would otherwise see half its members flagged forever.
   */
  if (policy === "hybrid" && !hasNumber) {
    return { usable: true, index, staleDays: 0, stale: false, note: "" };
  }

  if (!hasNumber) {
    return {
      usable: false,
      reason: "no-ghin-number",
      note: "No GHIN number on file, and this club plays off GHIN indexes.",
    };
  }

  if (!syncedAt) {
    return {
      usable: false,
      reason: "never-synced",
      note: "No index has been received from GHIN for this member yet.",
    };
  }

  const staleDays = Math.max(0, Math.floor((now.getTime() - syncedAt.getTime()) / 86_400_000));
  const stale = staleDays >= STALE_AFTER_DAYS;
  return {
    usable: true,
    index,
    staleDays,
    stale,
    note: stale
      ? `Index last received from GHIN ${staleDays} days ago.`
      : "",
  };
}
