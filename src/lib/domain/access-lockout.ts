/**
 * TURNING ROUND CODES OFF CAN LOCK A FIELD OUT OF ITS OWN ROUND.
 *
 * Entries may be made without an email address on a tournament that signs
 * players in by Round Code — `entryNeedsEmail` decides that, and the society
 * and charity templates ship exactly that setting. Those players are perfectly
 * well identified: `createPlaySession` signs `stageId:playerId:expiry:code`
 * and never reads an address.
 *
 * What they do not have is an `Account`. `syncPlayerAccount` returns early on
 * a blank address, so there is no row to sign in with, and there never was.
 *
 * So changing `playerAccess` away from codes does three things at once:
 *
 *   1. `revokeRoundCodes` blanks every stage's `accessCode` — deliberately,
 *      because "off" has to mean off;
 *   2. `getPlaySession` refuses a session whose stage has no code, so the
 *      players already out on the course are signed out mid-round;
 *   3. email sign-in cannot let them back in, because they have no address.
 *
 * One dropdown, and a field that was scoring fine ten seconds ago cannot get
 * back to its own card. Nothing warned anybody. Found while writing
 * `docs/deferred-register.md` on 2026-09-11 — by checking a claim about the
 * code rather than trusting a summary of it.
 *
 * REFUSED RATHER THAN WARNED, which is the house answer to this shape.
 * `setAccountRole` refuses to demote the only Organizer — "promote someone
 * else first" — rather than asking twice. The reasoning transfers exactly: the
 * organizer cannot see who this would strand, the damage lands on other people,
 * and the remedy is cheap and obvious once named.
 *
 * NARROW ON PURPOSE. It fires only when codes are actually being switched off
 * AND somebody would be stranded. A tournament whose entrants all have
 * addresses can switch freely, which is the ordinary case and the one a club
 * growing out of Round Codes is in.
 */

export interface LockoutInput {
  /** Whether Round Codes are in use now, before the change. */
  wasUsingCodes: boolean;
  /** Whether they would still be in use after it. */
  nowUsingCodes: boolean;
  /** Entrants who are still in the field and hold no email address. */
  strandedCount: number;
}

/**
 * Whether this change withdraws the Round Codes.
 *
 * EXPORTED SO THE CALLER DOES NOT WRITE IT AGAIN. `saveTournamentSettings`
 * needs the same question answered before it counts anybody — the count is a
 * query, and running it on every save of every setting would be waste — so it
 * had its own `if (wasUsingCodes && !nowUsingCodes)`. That is one rule with two
 * readers, and it was not theoretical: with the condition duplicated, mutating
 * it here left the audit suite GREEN, because the caller's copy shadowed the
 * broken rule and the refusal was never reached. Found by mutation on
 * 2026-09-11, which is the only way that shape ever shows itself.
 */
export function revokesCodes(input: Pick<LockoutInput, "wasUsingCodes" | "nowUsingCodes">): boolean {
  return input.wasUsingCodes && !input.nowUsingCodes;
}

/**
 * The refusal, or null when the change is safe.
 *
 * Returns the sentence rather than a boolean so the rule and its wording stay
 * together: a caller that had to compose the message could tell somebody the
 * count without telling them what to do about it.
 */
export function lockoutRefusal(input: LockoutInput): string | null {
  if (!revokesCodes(input)) return null;
  if (input.strandedCount <= 0) return null;

  const one = input.strandedCount === 1;
  const who = one ? "1 player in this tournament has" : `${input.strandedCount} players in this tournament have`;
  const them = one ? "that player" : "those players";

  return (
    `${who} no email address, and the Round Code is how they sign in. ` +
    `Turning it off would withdraw every code and lock them out of their own card — ` +
    `including anyone out on the course right now. ` +
    `Add an email address for ${them} on Registration & field first, or leave access codes on.`
  );
}
