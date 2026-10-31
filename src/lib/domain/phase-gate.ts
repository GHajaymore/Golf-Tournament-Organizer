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

// The one list of statuses that mean "not launched". Imported rather than
// repeated, for the reason lifecycle-state.ts gives beside it: launched means
// NOT on this list, and two copies of that is two answers.
import { PRE_LAUNCH_STATUSES } from "./lifecycle-state";
import { missingCardsRefusal } from "./round-card-status";

export interface LaunchFacts {
  /** Rounds the field actually plays. */
  playingRounds: number;
  /** Entries in the field, confirmed. */
  confirmed: number;
  /**
   * Whether the tournament says when it is played — `Event.dates`, in the
   * organizer's own words.
   *
   * Required only to LAUNCH, which is the moment a field is told about it. A
   * draft with no date is somebody thinking, and this file's own rule is that
   * a gate states the minimum that makes the phase mean anything: a
   * tournament published to its members without a date cannot be planned
   * around, and "when is it?" is the first question every one of them asks.
   *
   * "Tentative" is a real answer — see `datesTentative` on the schema — so
   * this refuses an EMPTY date, never an unsettled one.
   */
  dated: boolean;
  /**
   * Playing rounds whose format scores against a course card that the round
   * does not have — see domain/round-card-status.ts. Required rather than
   * optional, so a caller that forgets it fails to compile instead of offering
   * a Launch button the action then refuses (Ajay, 2026-09-28).
   */
  missingCards: readonly { label: string; course: string }[];
  /**
   * Playing rounds whose type and format cannot produce a result together
   * (`unscorableRoundLabels`), by name. Required for the same reason as the
   * cards above: launch went live over a stroke round set to Match Play
   * (2026-10-16).
   */
  unscorable: readonly string[];
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
    return "Nobody is entered yet, so there is nobody to launch it for. Add players on Entries, then launch.";
  }
  if (!facts.dated) {
    // "Tournament details" is the screen's name in the sidebar. This said
    // "Tournament setup", which is no screen a newcomer can find.
    return "This tournament has no dates, so nobody can plan around it. Add them on Tournament details — mark them tentative if the committee hasn't fixed them yet — then launch.";
  }
  if (facts.unscorable.length > 0) {
    const names = facts.unscorable.join(" and ");
    return `${names} cannot be scored in the format ${facts.unscorable.length === 1 ? "it is" : "they are"} set to. Choose another format on ${facts.unscorable.length === 1 ? "its card" : "their cards"} on Rounds & formats, then launch.`;
  }
  /**
   * A round the format cannot score. Score entry already refused it — on the
   * first tee, which is the worst moment to find out. Only par and stroke
   * index decide this; an unchecked card, missing distances or unrated tees
   * are warnings elsewhere and never stop a launch.
   */
  return missingCardsRefusal(facts.missingCards);
}

export interface PlayFacts {
  /** draft | registration | ready | live | completed. */
  status: string;
  /**
   * Whether ANY result exists anywhere in this tournament — a settled match or
   * a scorecard, the same two sources `resultsIn` counts.
   *
   * This is the whole of the migration story, so it is a fact rather than a
   * flag somebody sets. See below.
   */
  anyResult: boolean;
}

/**
 * Why a score cannot be entered yet, or null when it can.
 *
 * LAUNCH IS THE TRANSITION FROM SETTING UP TO PLAYING, and until now it gated
 * nothing: a tournament left in draft played a full round, and the only sign
 * was a banner on the organizer's dashboard saying so. This is the gate the
 * phase model at the top of this file always implied — "guide within a phase,
 * gate between them" — applied to the one transition that had no gate.
 *
 * THE EXEMPTION IS THE POINT, and without it this must not ship. A tournament
 * that is ALREADY UNDER WAY in draft is not locked retroactively. The reason
 * is specific rather than cautious: a player standing on the 14th green cannot
 * launch anything — only staff can — so refusing their card mid-round strands
 * them with a remedy that is not theirs to apply. The deferred register has
 * carried this item as "blocked on old data" precisely because turning the
 * gate on retroactively would lock live players out of rounds they are in the
 * middle of, and the seeded Demo Cup is one of those tournaments.
 *
 * So the rule is: you cannot START play without launching. A tournament that
 * already started keeps going, and the dashboard banner keeps saying its
 * status is out of date — which is a thing to tidy, not a thing to break.
 *
 * It self-clears. Every tournament begun after this has to launch before its
 * first score, so the exempt population only ever shrinks.
 */
export function playRefusal(facts: PlayFacts): string | null {
  if (!PRE_LAUNCH_STATUSES.includes(facts.status)) return null;
  // Already under way. Not ours to stop halfway through.
  if (facts.anyResult) return null;
  return "This tournament hasn’t been launched yet, so play hasn’t started. An organizer can launch it from the dashboard.";
}

export interface FinishFacts {
  /** Cards complete but still waiting for somebody to sign them off. */
  pendingConfirmations: number;
  /**
   * Cards and match results somebody has said are wrong.
   *
   * Required rather than optional on purpose. This gate used to read the
   * review queue's total alone, and disputes are deliberately NOT in that
   * total — so a tournament could be finished, its standings published as
   * final, over a result still in dispute. A caller that forgets this field
   * now fails to compile instead of reopening that hole.
   */
  disputed: number;
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
  // First, because it is the stronger reason and has a different remedy: a
  // dispute is settled on the card or the match, not approved from a list.
  // Rule 20.2c — the Committee decides, and the result is final only then.
  if (facts.disputed > 0) {
    const n = facts.disputed;
    return `${n} result${n === 1 ? " is" : "s are"} disputed, so the tournament can’t be finished yet. Open ${n === 1 ? "it" : "them"} on Score entry, settle the question, then finish.`;
  }
  if (facts.pendingConfirmations > 0) {
    const n = facts.pendingConfirmations;
    // "result", as the dispute line above says it: the count holds match
    // results as well as cards, and a match-play league read "540 cards are
    // still waiting" with not a card in it (2026-10-10).
    return `${n} result${n === 1 ? " is" : "s are"} still waiting to be signed off, so the result is not settled yet. Approve or correct ${n === 1 ? "it" : "them"} on Score entry, then finish.`;
  }
  return null;
}

/**
 * COMPLETING WITH ROUNDS NOBODY HAS PLAYED (2026-10-31, the panel: tournament director, golf
 * professional, UX Writer).
 *
 * Completing closes every round still open — so a two-day outing could close Round 2 as not
 * played with one confirm, by mistake. A committee may mean it (a round abandoned to the weather;
 * the result stands on the rounds played — the Committee's call under the Rules), so it is ASKED,
 * never refused. Only when NOTHING has been scored at all is it refused: there is no result.
 *
 * A round with any score is not "unplayed" (its partial scores stand, as before), and a round the
 * committee has already closed has had its question answered.
 */
export interface CompletingRound {
  number: number;
  hasResult: boolean;
  closed: boolean;
}

export const NOTHING_SCORED = "Nothing has been scored yet, so there is no result to complete.";

/** "Round 2", "Rounds 2 and 3", "Rounds 2, 3 and 4". */
export function roundsInWords(numbers: number[]): string {
  if (numbers.length === 1) return `Round ${numbers[0]}`;
  return `Rounds ${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/**
 * What completing has to say about the rounds first: a refusal (nothing scored), a question
 * (some rounds unplayed), or nothing. The words are the panel's, agreed 31 Oct.
 */
export function completingRoundsCheck(rounds: CompletingRound[]): { refuse: string } | { ask: string } | null {
  if (rounds.length === 0) return null;
  if (rounds.every((r) => !r.hasResult)) return { refuse: NOTHING_SCORED };
  const unplayed = rounds.filter((r) => !r.hasResult && !r.closed).map((r) => r.number);
  if (unplayed.length === 0) return null;
  const one = unplayed.length === 1;
  return {
    ask: `${roundsInWords(unplayed)} ${one ? "has" : "have"} no scores. Completing will close ${one ? "it" : "them"} as not played, and results will be decided on the rounds played.`,
  };
}

/** Every status a tournament can hold, in the order it passes through them. */
export const EVENT_STATUSES = [...PRE_LAUNCH_STATUSES, "live", "completed"];

export type StatusMove =
  | { kind: "write" }
  /** Going live from setting up IS launching, and has to go through that gate. */
  | { kind: "launch" }
  | { kind: "refuse"; error: string };

/**
 * WHAT A REQUEST TO CHANGE A TOURNAMENT'S STATUS ACTUALLY IS.
 *
 * The status action took any string and wrote it. Three things followed, none
 * of them offered by any screen:
 *
 *   "live" on a draft      went live around the launch gate — no rounds, nobody
 *                          in the field, no launch time, setup left unlocked
 *   an unknown word        was read as "draft", so a typo took a tournament off
 *                          its members' screens
 *   "draft" on a live one  the same, deliberately
 *
 * A status is MOVED, and the moves are few. Before launch a committee can step
 * back and forth freely: nothing has been published. Going live is launching,
 * whichever door asks. Finishing has its own gate (`finishRefusal`). And once
 * a tournament has been launched it does not return to setting up — its
 * members are looking at it, and Unlock setup is the way to correct it without
 * taking it away from them.
 *
 * An unknown value is REFUSED. Coercing it to the safest-looking one is how a
 * mistake becomes an action.
 */
export function statusMove(from: string, to: string): StatusMove {
  if (!EVENT_STATUSES.includes(to)) return { kind: "refuse", error: "That is not a tournament status." };
  const launched = !PRE_LAUNCH_STATUSES.includes(from);
  if (launched && PRE_LAUNCH_STATUSES.includes(to)) {
    return {
      kind: "refuse",
      error: "This tournament has been launched, so it can’t go back to setting up. Use Unlock setup to correct it — its players keep seeing it while you do.",
    };
  }
  if (to === "live" && !launched) return { kind: "launch" };
  return { kind: "write" };
}
