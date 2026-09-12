/**
 * WHAT HAS TO BE TRUE BEFORE A TOURNAMENT MOVES TO ITS NEXT PHASE.
 *
 * Set up → launch → play → finish. The steps INSIDE setting up are guided and
 * deliberately not forced: `setup-flow.ts` says so in as many words — "IT
 * GUIDES; IT DOES NOT CAGE… an organizer setting up their ninth tournament of
 * the season knows exactly which screen they want and a wizard that will not
 * let them go there is worse than no wizard." Committees really do work out of
 * order: entries arrive before the format is settled, a late player is added on
 * the first tee, a field is flighted the morning of.
 *
 * THE TRANSITIONS BETWEEN PHASES ARE A DIFFERENT QUESTION, and they were not
 * guarded at all. `launchTournament` checked nothing: a tournament with no
 * rounds and nobody in it would go live, and go live LOCKED, because launching
 * clears `configUnlocked`. The organizer's next move is then to unlock the
 * thing they just locked in order to build the tournament they just published.
 *
 * So: guide within a phase, gate between them. That is the same line the rest
 * of this codebase draws — `setAccountRole` refuses to demote the only
 * Organizer rather than asking twice, because the damage lands on other people
 * and the remedy is cheap once named.
 *
 * EVERY REFUSAL NAMES ITS REMEDY. A gate that says no without saying what to do
 * is the app being the obstacle, which is the failure the course picker's "Use
 * «what you typed»" row exists to avoid. And every rule here is the MINIMUM
 * that makes the phase mean anything — not a checklist of good practice.
 * Flights are not required to launch, because a medal has none; a venue is not
 * required, because "no fixed course — players choose" is a real answer.
 */

export interface LaunchFacts {
  /** Rounds the field actually plays. */
  playingRounds: number;
  /** Entries in the field, confirmed. */
  confirmed: number;
}

/**
 * Why this tournament cannot go live, or null when it can.
 *
 * Two conditions, and each is the difference between a live tournament and an
 * empty one. Nothing about readiness, tee times or money: those are judgements
 * a committee makes, and refusing on them would be this file deciding how to
 * run a golf club.
 */
export function launchRefusal(facts: LaunchFacts): string | null {
  if (facts.playingRounds < 1) {
    return "There are no rounds yet, so there is nothing to play. Add a round on Rounds & formats, then launch.";
  }
  if (facts.confirmed < 1) {
    return "Nobody is in the field yet, so there is nobody to launch it for. Enter the field on Registration & field, then launch.";
  }
  return null;
}

export interface FinishFacts {
  /** Cards complete but still waiting for somebody to sign them off. */
  pendingConfirmations: number;
}

/**
 * Why this tournament cannot be marked finished, or null when it can.
 *
 * ONE CONDITION, and it is about the RESULT rather than about tidiness.
 * Completing publishes the standings as final and starts the retention
 * countdown; doing it with cards still awaiting review declares a winner from
 * scores nobody has agreed. The remedy is on one screen and takes a minute.
 *
 * DELIBERATELY NOT REFUSED: a tournament with no scores at all. A club that
 * abandons a day to weather has to be able to close it, and a gate that traps
 * an abandoned event would be the app arguing with the weather.
 */
export function finishRefusal(facts: FinishFacts): string | null {
  if (facts.pendingConfirmations > 0) {
    const n = facts.pendingConfirmations;
    return `${n} card${n === 1 ? " is" : "s are"} still waiting to be signed off, so the result is not settled yet. Approve or correct ${n === 1 ? "it" : "them"} on Score entry, then finish.`;
  }
  return null;
}
