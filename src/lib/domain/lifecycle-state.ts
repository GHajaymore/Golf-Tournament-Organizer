/**
 * When the stored status disagrees with what has actually happened.
 *
 * The lifecycle — draft, registration, ready, live, completed — is entirely
 * the organizer's to set, and that is right: only they know whether entries
 * are open. But nothing ever checked it against the tournament, so a draw with
 * forty of forty-eight matches played sat on the dashboard labelled "Draft",
 * under a primary button offering to open registration.
 *
 * That is not a cosmetic disagreement, which is why this warns rather than
 * tidies. But the reason it gave was WRONG, and stayed wrong on two screens
 * for as long as both existed — see `LAUNCH_DOES` below.
 *
 * So this reports and offers; it does not correct. Flipping the status by
 * itself locks configuration, which is a real consequence an organizer has to
 * choose rather than have chosen for them because a score got typed in early.
 */

export interface LifecycleFacts {
  /** draft | registration | ready | live | completed. */
  status: string;
  /** Matches with a result recorded. */
  matchesScored: number;
  /** Entries in the field. */
  playersEntered: number;
}

export interface LifecycleWarning {
  title: string;
  detail: string;
  /** Whether the bar should offer the launch action alongside it. */
  offerLaunch: boolean;
}

/**
 * Statuses that have not yet given players access to the tournament.
 *
 * Exported because the setup guide asks the same question at the other end of
 * the day: it tells an organizer who has just finished setting up that the
 * field still cannot see any of this, and the warning below tells them again
 * once a score arrives. Two readers, one definition — a second copy is how the
 * two would come to disagree about what "launched" means.
 */
export const PRE_LAUNCH_STATUSES = ["draft", "registration", "ready"];
const PRE_LAUNCH = PRE_LAUNCH_STATUSES;

/**
 * WHAT LAUNCHING ACTUALLY DOES — because two screens said something else.
 *
 * Both of them told the organizer that the field is locked out until launch:
 *
 *   this file      "Players can't see their matches, their card or the
 *                   leaderboard until it is"
 *   SetupFlowRail  "Nobody in the field can see any of it yet … that is what
 *                   opens their schedule, their card and the leaderboard"
 *
 * Neither is true, and it was measured rather than reasoned about. On
 * 2026-09-11, signed in as a player on a tournament whose status was `draft`:
 * `/me` rendered, `/me/board` rendered the standings, and `/me/card` rendered
 * a full scorecard with "Certify my card" on it.
 *
 * The code agrees with the measurement. `launchTournament` writes exactly
 * three things — `status: "live"`, `launchedAt`, and `configUnlocked: false` —
 * and `PRE_LAUNCH_STATUSES` is read in only two places, this file and the
 * setup rail, neither of which gates anything. What a player may see is
 * decided by `canSeeLeaderboard`, which reads `leaderboardVisibility` and
 * nothing else.
 *
 * This matters more than a wrong sentence usually does, because an organizer
 * who believes it will leave a half-built tournament open on the reasoning
 * that nobody can see it yet. They can.
 *
 * Whether launch SHOULD gate access is a product question and is deliberately
 * not answered here: adding that gate would cut players off from every
 * tournament currently being played in draft — Demo Cup has 47 results in one
 * — and that is not a change to make on the strength of a comment. What is
 * fixed is the claim.
 *
 * One string, both readers, for the reason the constant above exists.
 */
export const LAUNCH_DOES =
  "Launching marks it live and locks the configuration until you unlock it again.";

/** And the half that was being attributed to launch by mistake. */
export const VISIBILITY_IS_ELSEWHERE =
  "It doesn't decide what the field can see — that's “Who can see the leaderboard” on Tournament details.";

export function lifecycleMismatch(facts: LifecycleFacts): LifecycleWarning | null {
  const { status, matchesScored, playersEntered } = facts;

  if (PRE_LAUNCH.includes(status) && matchesScored > 0) {
    return {
      title: `${matchesScored} ${matchesScored === 1 ? "result is" : "results are"} in, but this tournament hasn’t been launched`,
      /**
       * The nudge stands; the reason for it has changed.
       *
       * It used to be "the field cannot see any of this", which is false. The
       * real cost is plainer and still worth saying: the tournament is being
       * played and the app is calling it a draft, in front of
       * ${playersEntered} people who can already open the board.
       */
      detail:
        `Scoring works either way, so nothing is stuck — but ` +
        `${playersEntered > 0 ? `the ${playersEntered} in the field can` : "anyone in the field can"} ` +
        `already open the board and their card, on a tournament that still calls itself a draft. ` +
        `${LAUNCH_DOES} ${VISIBILITY_IS_ELSEWHERE}`,
      offerLaunch: true,
    };
  }

  return null;
}
