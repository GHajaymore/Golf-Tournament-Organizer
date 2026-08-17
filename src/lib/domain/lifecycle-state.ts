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
 * tidies. Launching is what grants players access to their own tournament —
 * their schedule, their matches, their card, the leaderboard. A tournament
 * being scored while still marked draft means the field cannot see any of it,
 * and the only symptom is a word on a screen the players never look at.
 *
 * So this reports and offers; it does not correct. Flipping the status by
 * itself would lock configuration and hand out player access — real
 * consequences an organizer has to choose, not have chosen for them because a
 * score got typed in early.
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

/** Statuses that have not yet given players access to the tournament. */
const PRE_LAUNCH = ["draft", "registration", "ready"];

export function lifecycleMismatch(facts: LifecycleFacts): LifecycleWarning | null {
  const { status, matchesScored, playersEntered } = facts;

  if (PRE_LAUNCH.includes(status) && matchesScored > 0) {
    return {
      title: `${matchesScored} ${matchesScored === 1 ? "result is" : "results are"} in, but this tournament hasn’t been launched`,
      detail:
        `Players can’t see their matches, their card or the leaderboard until it is — so ` +
        `${playersEntered > 0 ? `the ${playersEntered} in the field have` : "the field has"} no way to follow ` +
        `a tournament that is already being played. Scoring still works either way; launching is what opens it to them.`,
      offerLaunch: true,
    };
  }

  return null;
}
