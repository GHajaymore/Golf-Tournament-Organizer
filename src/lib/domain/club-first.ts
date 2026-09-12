import { orgProfile, type OrgKind } from "./org-profile";

/**
 * NAME THE CLUB BEFORE YOU CREATE ITS FIRST TOURNAMENT.
 *
 * A club is set up once and its tournaments are many, and the app had that the
 * wrong way round: every club screen reached its organization through whichever
 * tournament was open, so the one-time decisions could not be made until a
 * tournament existed to stand inside. Club settings answer from
 * `primaryOrganizationFor` now, which is what makes this gate possible at all
 * — before that, requiring club setup first would have been a deadlock.
 *
 * THREE THINGS IT DELIBERATELY DOES NOT DO, each decided rather than defaulted:
 *
 * It never blocks an EXISTING club. One tournament is enough to prove a club is
 * already working, and a gate that stopped a going concern mid-season to
 * collect a field it had skipped would be the app interrupting real golf to
 * tidy its own records. `eventCount > 0` is the whole test — no dated flag, no
 * migration, and it can never fire twice for anybody.
 *
 * It never blocks a STANDALONE organizer. "A one-off outing with friends" is a
 * real answer at sign-up and the whole point of the personal kind: there is no
 * club to set up, so there is nothing to require. That is the escape hatch, and
 * it already existed — it needed wiring, not inventing.
 *
 * And it does not ask for MEMBERS, though that was the instinct. The members
 * list still reads the active event for "who is already in this field", so
 * requiring it before the first tournament would demand a screen that cannot
 * open yet — a deadlock dressed as a checklist. Naming the club is the step
 * that is both reachable and meaningful today; members follows the roster work.
 */

export interface ClubFirstFacts {
  /** Tournaments this organization has ever had. Zero means brand new. */
  eventCount: number;
  /** Whether the organizer chose the club's name, rather than sign-up deriving
   *  one from their own — see `organizationWasNamed`. */
  named: boolean;
  /** club | community | personal. */
  kind: string;
}

/**
 * Why this organization cannot create its first tournament yet, or null.
 *
 * Returns the sentence so the rule and its wording stay together, and names
 * the screen that answers it — a refusal that does not say what to do next
 * makes the app the obstacle.
 */
export function clubFirstRefusal(facts: ClubFirstFacts): string | null {
  // A going concern is never interrupted.
  if (facts.eventCount > 0) return null;
  // Nobody is being asked to invent a club they said they did not have.
  if (facts.kind === "personal") return null;
  if (facts.named) return null;

  const noun = orgProfile(facts.kind as OrgKind).noun;
  return (
    `Give your ${noun} a name first — it goes on every scorecard, the console header and the public leaderboard, ` +
    `and it is set once for every tournament you will ever run. Name it on ${orgProfile(facts.kind as OrgKind).settingsLabel}, then create this one.`
  );
}
