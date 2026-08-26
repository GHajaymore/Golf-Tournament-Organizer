/**
 * The seam between this app and a handicapping authority.
 *
 * Two capabilities, deliberately separate, because a club can be entitled to
 * one and not the other:
 *
 *   - READING an index. The club plays off association figures instead of its
 *     own record.
 *   - WRITING a score back. The round the club just played is posted to each
 *     golfer's official record.
 *
 * A club may well be permitted to read and not to write — that is the ordinary
 * case, since posting to somebody's official record is a bigger permission
 * than looking one up. Modelling them as one switch would force a club to take
 * both or neither.
 *
 * PROVIDER-AGNOSTIC ON PURPOSE. GHIN is the USGA's system and the first one
 * anybody here will use, and the authorization may come through GHIN directly
 * or through the USGA. But a club in England answers to England Golf under
 * CONGU, and one in Australia to Golf Australia, and the app already knows
 * what country a club is in. A seam shaped around the letters G-H-I-N would
 * have to be rebuilt for the second club that asked, so the seam is shaped
 * around the QUESTION — "what is this golfer's index", "record this round" —
 * and GHIN is one answer to it.
 *
 * Nothing in here talks to anything yet. There is no contract, no credential
 * and no endpoint, and pretending otherwise would be the worst possible thing
 * to build: an integration that looks configured and silently returns nothing
 * is how a club ends up playing a competition off handicaps that were never
 * fetched.
 */

/** What a club has been granted, per capability. */
export type IntegrationStatus =
  /** Nothing set up. The honest default and what every provider reports today. */
  | "unconfigured"
  /** Credentials present and accepted. */
  | "ready"
  /** Credentials present and rejected — expired key, revoked access. */
  | "rejected";

/** Whatever a provider needs, held per organization. Never logged. */
export interface IntegrationCredential {
  providerId: string;
  /** Opaque to this app. A key, a token, a club number — the provider decides. */
  secret: string;
  /** Non-secret settings: an association club id, a region code. */
  settings: Record<string, string>;
}

/**
 * An index, as received. Never invented.
 *
 * There is no "default" variant and that is the point: every failure is a
 * REASON, so nothing downstream can mistake an outage for a scratch golfer.
 * See `handicapStanding` in domain/handicap-policy.ts for what a club plays
 * off when this comes back unsuccessful.
 */
export type IndexLookup =
  | {
      ok: true;
      /** The Handicap Index as the association holds it. */
      index: number;
      /** When the association last revised it, if they say. */
      revisedAt: Date | null;
    }
  | {
      ok: false;
      reason:
        | "unconfigured"
        | "no-such-golfer"
        | "not-authorized"
        | "unavailable"
        | "rate-limited";
      /** Safe to show a committee. Never contains the credential. */
      detail: string;
    };

/**
 * The result of posting one round to one golfer's record.
 *
 * `alreadyPosted` is not an error. Posting the same round twice would move a
 * golfer's official handicap on a score they played once, so a provider that
 * recognises a repeat and declines it is doing the right thing and the app
 * must treat it as success.
 */
export type ScorePost =
  | { ok: true; reference: string; alreadyPosted: boolean }
  | {
      ok: false;
      reason:
        | "unconfigured"
        | "not-authorized"
        | "no-such-golfer"
        | "rejected"
        | "unavailable";
      detail: string;
      /** Whether trying again could plausibly succeed. */
      retryable: boolean;
    };

/** One round, in the shape an association wants it. */
export interface RoundToPost {
  /** The golfer's association number. */
  golferId: string;
  /** Gross strokes actually taken, hole by hole. Nulls are holes not played. */
  strokes: Array<number | null>;
  playedOn: Date;
  /** Course and tee identification, as the association knows them. */
  courseId: string;
  teeId: string;
  /** Competition or casual — associations treat them differently. */
  competition: boolean;
  /**
   * This app's own id for (this golfer, this round).
   *
   * Sent so the association can recognise a repeat, and stored so this app can
   * too. Posting a score is the one thing here that changes something in the
   * world, and the world does not have an undo.
   */
  idempotencyKey: string;
}

/** Reading indexes from an association. */
export interface HandicapAuthority {
  id: string;
  label: string;
  /** Where a club goes to get permission. Shown when unconfigured. */
  howToEnable: string;
  status(credential: IntegrationCredential | null): IntegrationStatus;
  lookup(golferId: string, credential: IntegrationCredential | null): Promise<IndexLookup>;
}

/** Posting scores back to an association. */
export interface ScoreReporter {
  id: string;
  label: string;
  howToEnable: string;
  status(credential: IntegrationCredential | null): IntegrationStatus;
  post(round: RoundToPost, credential: IntegrationCredential | null): Promise<ScorePost>;
}
