/**
 * Deciding whether a round may be posted to a golfer's official record.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * CLAUDE.md rule 7 says TourneyHQ calculates and records money and never moves
 * it. Posting a score is the first thing in this app that breaks the spirit of
 * that rule in the other direction: it does not move money, but it MOVES
 * SOMETHING IN THE WORLD. A posted score changes a golfer's official handicap,
 * that handicap follows them to every club they play, and there is no undo
 * that this app controls. A duplicate post is not a duplicate row — it is a
 * real person's index moving on a round they played once.
 *
 * So the rules are stricter than anywhere else in the codebase:
 *
 *   - **Nothing is posted unless a club has explicitly turned it on.** Not by
 *     default, not because credentials happen to exist, not as a side effect
 *     of anything.
 *   - **Every post is keyed**, so the same round for the same golfer cannot be
 *     sent twice however many times the button is pressed or the job re-runs.
 *   - **A round is posted only once it is FINISHED.** A card still being
 *     entered is not a score; posting one and correcting it later would leave
 *     the association holding the wrong number with no way to know.
 *   - **A refusal is recorded, not swallowed.** A club has to be able to see
 *     what did not go, and why.
 */

/** Why a round is not going to be posted. Every one is showable to a club. */
export type PostRefusal =
  | "not-enabled"
  | "no-golfer-id"
  | "round-unfinished"
  | "card-incomplete"
  | "already-posted"
  | "not-competition";

export interface PostCandidate {
  /** Has the club turned score posting on? */
  enabled: boolean;
  /** The golfer's association number, if the roster holds one. */
  golferId: string;
  /** Whether the round itself is complete and settled. */
  roundFinished: boolean;
  /** Gross strokes. A hole not played is null. */
  strokes: Array<number | null>;
  /** How many holes this round is played over. */
  holeCount: number;
  /** Whether this app has already recorded a successful post for this key. */
  alreadyPosted: boolean;
  /**
   * Whether the club runs this round as a counting competition.
   *
   * Associations treat competition and casual rounds differently, and a club
   * that has not said which is not asking this app to guess.
   */
  competition: boolean;
}

export type PostDecision =
  | { post: true }
  | { post: false; refusal: PostRefusal; note: string };

export function decidePost(c: PostCandidate): PostDecision {
  // Checked first, and deliberately before anything else: a club that has not
  // turned this on should not have its rounds even evaluated for posting.
  if (!c.enabled) {
    return {
      post: false,
      refusal: "not-enabled",
      note: "Score posting is off for this club.",
    };
  }

  if (c.alreadyPosted) {
    /**
     * Not an error. The commonest way a score gets posted twice is a retry
     * that succeeded the first time, and treating that as a failure invites
     * somebody to press the button again.
     */
    return {
      post: false,
      refusal: "already-posted",
      note: "This round has already been posted for this golfer.",
    };
  }

  if (!c.golferId.trim()) {
    return {
      post: false,
      refusal: "no-golfer-id",
      note: "No association number on file for this player.",
    };
  }

  if (!c.competition) {
    return {
      post: false,
      refusal: "not-competition",
      note: "This round is not marked as a counting competition.",
    };
  }

  if (!c.roundFinished) {
    // A card mid-entry is not a score. Posting one and correcting it later
    // leaves the association holding a number nobody can reconcile.
    return {
      post: false,
      refusal: "round-unfinished",
      note: "The round is still being played.",
    };
  }

  /**
   * A card with gaps is not postable, and this is not the same question as
   * whether the ROUND is finished.
   *
   * A player can walk in on the 14th of a completed round. Their card is not a
   * score under any handicapping system, and sending eighteen holes with four
   * of them silently treated as anything at all would put a fiction on their
   * permanent record.
   */
  const played = c.strokes.slice(0, c.holeCount).filter((n) => n != null).length;
  if (played < c.holeCount) {
    return {
      post: false,
      refusal: "card-incomplete",
      note: `Only ${played} of ${c.holeCount} holes returned.`,
    };
  }

  return { post: true };
}

/**
 * The key that makes posting the same round twice impossible.
 *
 * One golfer, one round, one post. Stored with a unique constraint so that two
 * requests racing each other cannot both succeed — the second fails at the
 * database rather than at a check somebody has to remember to write.
 *
 * The EVENT is in the key as well as the stage. Stage ids are unique already,
 * but a key that reads back as gibberish is a key nobody can investigate with,
 * and the first question anybody asks about a bad post is "which tournament".
 */
export function postKey(eventId: string, stageId: string, playerId: string): string {
  return `${eventId}:${stageId}:${playerId}`;
}
