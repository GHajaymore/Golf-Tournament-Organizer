/**
 * IS A LIVE LINK TO A HANDICAP FEDERATION FETCHING INDEXES? Not yet.
 *
 * The team's ruling, 2026-10-24: the choice that makes the handicap service
 * the ONLY source of a club's indexes ("GHIN only", "England Golf only" …) is
 * hidden until a federation adapter actually fetches them. Every adapter in
 * this folder reports `unconfigured` (`ghin.ts`, `bodies.ts`), so a club on
 * that choice was told nobody may type an index while nothing could supply
 * one.
 *
 * This is the ONLY switch. While it says no:
 *   - Club settings does not offer the choice (`offeredHandicapPolicies`);
 *   - `saveHandicapPolicy` refuses to store it;
 *   - every reader of `Organization.handicapPolicy` goes through
 *     `handicapPolicyOf`, which reads a stored service-only value as the
 *     club's own record ("club"), so indexes are typed by the club.
 * The day an adapter really fetches indexes, make this answer true (from that
 * adapter, not a constant) and the choice comes back everywhere at once.
 *
 * Its own module so that a test can force it either way.
 */
export function federationLinkLive(): boolean {
  return false;
}
