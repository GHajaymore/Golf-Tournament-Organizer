/**
 * IS A LIVE LINK TO A HANDICAP FEDERATION FETCHING INDEXES? Not yet.
 *
 * The team's rulings, 2026-10-24: the two choices that read a club's indexes
 * from its handicap body — the service ONLY ("GHIN only", "England Golf
 * only" …) and "<body> where a member has one" — are hidden until a federation
 * adapter actually fetches indexes. Every adapter in this folder reports
 * `unconfigured` (`ghin.ts`, `bodies.ts`), and each choice refuses a typed
 * index for a member with a number with the body, so that member's index
 * could be neither typed nor received.
 *
 * This is the ONLY switch. While it says no:
 *   - Club settings offers neither choice (`offeredHandicapPolicies`);
 *   - `saveHandicapPolicy` refuses to store either;
 *   - every reader of `Organization.handicapPolicy` goes through
 *     `handicapPolicyOf`, which reads a stored value of either as the club's
 *     own record ("club"), so indexes are typed by the club.
 * The day an adapter really fetches indexes, make this answer true (from that
 * adapter, not a constant) and both choices come back everywhere at once.
 *
 * Its own module so that a test can force it either way.
 */
export function federationLinkLive(): boolean {
  return false;
}
