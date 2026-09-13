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

/**
 * WHAT A PRINTED STANDINGS SHEET IS ALLOWED TO CALL ITSELF.
 *
 * `/reports` titled its printable panel "Final standings snapshot" — a
 * constant, with no test of any kind behind the word "Final". Read off the
 * demo tournament on 2026-09-12: a tournament in DRAFT, seven of thirty-three
 * cards in, thirty-six match results unconfirmed, and twenty-six rows of the
 * printed sheet reading "—". It said Final.
 *
 * That matters more here than anywhere else in the app, and the reports screen
 * says so in its own comment: this is "the one whose output gets printed and
 * pinned up". A wrong number on a screen is corrected by refreshing it. A
 * wrong number on a noticeboard at prizegiving is argued about.
 *
 * THE TEST IS THE ONE THE MONEY RULES ALREADY USE, and it is worth restating
 * because the instinct is the other one. Do not ask "has enough happened".
 * Ask **can this still change** — `money-layout.ts` opens with exactly that
 * distinction and the reason: a settled event with an unsettled amount is
 * still unsettled. Standings behave the same way. Every card in for round one
 * of three is not a final anything; a round nobody has finished is not either.
 *
 * So the only thing that earns the word is the organizer saying the
 * tournament is over. That is a deliberate choice they make — `lifecycleMismatch`
 * above exists precisely because this app reports the lifecycle rather than
 * correcting it — and it is the one signal that cannot be produced by a score
 * arriving early.
 */
export interface SnapshotStanding {
  /** What to call the panel. */
  title: string;
  /**
   * The qualifier printed under it, or "" once it is genuinely final.
   *
   * Self-clearing, which is what keeps it from being furniture: it says the
   * one thing a reader of a pinned-up sheet needs and then stops saying it.
   */
  note: string;
}

export function snapshotStanding(input: {
  /** draft | registration | ready | live | completed. */
  status: string;
  /** What the round on the board has returned, and out of how many. */
  done: number;
  total: number;
  /** "cards" or "matches" — a round robin does not return scorecards. */
  unit: string;
  /** A team round is not "standings", and was already titled separately. */
  noun?: string;
}): SnapshotStanding {
  const noun = input.noun ?? "standings";
  if (input.status === "completed") {
    return { title: `Final ${noun}`, note: "" };
  }
  /**
   * NOT "Provisional standings" alone. The heading says the state and the note
   * says the evidence, because "provisional" is a word a reader can discount
   * and "7 of 33 cards in" is not.
   *
   * A round with nothing on it at all is named differently again: "0 of 33"
   * under a table of dashes reads as a broken export rather than an empty one.
   */
  const title = `${noun.charAt(0).toUpperCase()}${noun.slice(1)} so far`;
  if (input.total <= 0 || input.done <= 0) {
    return { title, note: "Nothing returned for this round yet — these standings will change." };
  }
  if (input.done >= input.total) {
    // Every card in and the tournament still open: honest, and a different
    // sentence, because "7 of 33" and "33 of 33" are not the same warning.
    return {
      title,
      note: "This round is all in, but the tournament has not been closed yet.",
    };
  }
  return {
    title,
    note: `${input.done} of ${input.total} ${input.unit} in — these standings will change.`,
  };
}
