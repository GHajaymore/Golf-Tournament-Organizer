/**
 * WHAT LAUNCH ASKS OF SETUP — built once, from the setup flow's own answers.
 *
 * The workflow review (2026-10-31, gap G3) found Launch ignoring setup: the rail
 * could say "4 of 5" over a scramble with no sides while Launch went through,
 * and the facts the gate reads were built three times — on the dashboard, in
 * `launchTournament`, and in `setupFlow` — each from its own queries. Three
 * builders are three answers waiting to disagree.
 *
 * So the facts are built HERE and nowhere else (`launch-facts-built-once.test.ts`
 * refuses a second builder), from the same `SetupFacts` the rail is drawn from.
 * The dashboard and the action ask `launchCheckFor` (services/setup-flow.ts),
 * which builds the flow and reads its `launch` — so the button, the action and
 * the rail cannot come to different verdicts about one tournament.
 *
 * THE PANEL'S RULING (tournament director, golf professional, UX Writer):
 * refuse only what would make a round unscorable or wrong — those are in
 * `launchRefusal`; warn, in the launch dialog, about everything else the setup
 * flow says is still open. A club may launch without a tee sheet or without
 * saying how money works; it may not launch a scramble nobody has been put in a
 * side for, because there is nothing to put a score against.
 *
 * Nothing here reads the tournament's status: draft, taking entries and ready
 * are about to become one "Setting up" step (G1), and launch asks the same of
 * all of them.
 */
import { launchRefusal, type LaunchFacts } from "./phase-gate";
import type { SetupFacts, SetupStep } from "./setup-flow";

/**
 * The facts, with the two that `SetupFacts` leaves optional made REQUIRED: a
 * builder that forgets the course cards or the playing-round count fails to
 * compile rather than launching over them.
 */
export type LaunchSource = SetupFacts & {
  playingRounds: number;
  missingCards: readonly { label: string; course: string }[];
};

/** THE ONE BUILDER of `LaunchFacts`. */
export function launchFactsFrom(f: LaunchSource): LaunchFacts {
  return {
    playingRounds: f.playingRounds,
    confirmed: f.confirmed,
    dated: f.dated,
    missingCards: f.missingCards,
    // The stages step's own fact — the same rule (`roundShapeMismatch`).
    unscorable: f.rounds.filter((r) => !r.scorable).map((r) => r.label),
    // The sides step's own fact. Not in a cup: a cup's pairs are its lineups.
    noSides: !!f.teams?.needed && !f.cup && f.teams.sides === 0,
    // The cup step's own fact: how many teams a cup has, when it is one.
    cupTeams: f.cup ? f.cup.flights : null,
    /**
     * The flights step's own test of a round's fixtures (`drawsPairings`, not
     * cut-fed, no matches) — and only where that step applies: a straight
     * knockout and a cup draw their fixtures elsewhere.
     */
    undrawn:
      f.straightKnockout || f.cup
        ? []
        : f.rounds.filter((r) => r.drawsPairings && !r.cutFed && r.matches === 0).map((r) => r.label),
    flightsMade: f.groups > 0,
  };
}

/**
 * ONE THING STILL OPEN that does not stop a launch. One plain sentence (`says`)
 * and one link (`fix`, to `href`, the screen named by the sidebar's own name).
 */
export interface LaunchWarning {
  says: string;
  /** The link's words — "Answer it on Prizes & payouts". */
  fix: string;
  href: string;
  /**
   * Whether the fix can still be made once the tournament is live ("open"), or
   * needs Unlock first because launching locks configuration ("unlock") — flights,
   * sides and the name are structural; a round's day, the tee sheet and the money
   * answer are not.
   */
  afterLaunch: "open" | "unlock";
}

/** The warning as one line of text — what a screen reader and a test both read. */
export function warningText(w: LaunchWarning): string {
  return `${w.says} ${w.fix}${w.afterLaunch === "unlock" ? " — after launch, this needs Unlock first." : " — you can still do this after launch."}`;
}

export interface LaunchCheck {
  /** Why it cannot go live — `launchRefusal` — or null. */
  refusal: string | null;
  /** What is still open but does not stop a launch. Shown in the launch dialog. */
  warnings: LaunchWarning[];
  /** The setup rail's own count — steps not done, of the steps this tournament has. */
  stepsOpen: number;
  steps: number;
}

/**
 * A warning for each setup step still open. The step's own `missing` line is
 * the fact; the sentence around it says what launching without it means. A
 * step whose open-ness `launchRefusal` already refuses never reaches the
 * dialog — the button is disabled first.
 */
function warningFor(step: SetupStep, f: LaunchSource): LaunchWarning | null {
  const at = (fix: string, afterLaunch: LaunchWarning["afterLaunch"]) => ({ fix: `${fix} on ${step.label}`, href: step.href, afterLaunch });
  switch (step.key) {
    case "event":
      return f.named ? null : { says: "It still has no name of its own.", ...at("Give it one", "unlock") };
    case "stages":
      // `missing` is "Round 2 has no day and no deadline." and the like.
      return { says: `${step.missing} Players will not know when to play it.`, ...at("Add a day", "open") };
    case "teams":
      return f.teams && f.teams.sides > 0 && f.teams.unsided > 0
        ? { says: `${step.missing} They have no side to score for.`, ...at("Put them on one", "unlock") }
        : null;
    case "cup":
      return f.cup && f.cup.flights === 2 && f.cup.unplaced > 0
        ? { says: `${step.missing} They cannot be picked for a session.`, ...at("Put them on a team", "unlock") }
        : null;
    case "grouping":
      return f.groups === 0
        ? { says: "There are no flights, so the whole field plays as one division.", ...at("Make flights", "unlock") }
        : null;
    case "money":
      return { says: "Nobody has said how money works here, so the app is guessing.", ...at("Answer it", "open") };
    default:
      return null;
  }
}

/**
 * THE TEE SHEET — not a setup step (a league whose players arrange their own
 * matches has none), so a warning only: the rounds with no saved tee sheet that
 * the field turns up for together, by name.
 */
function teeSheetWarning(f: LaunchSource, teeSheetLabel: string): LaunchWarning | null {
  const bare = f.rounds.filter((r) => r.teeSheetSaved === false).map((r) => r.label || "A round");
  if (bare.length === 0) return null;
  const names = bare.length === 1 ? bare[0] : `${bare.slice(0, -1).join(", ")} and ${bare[bare.length - 1]}`;
  return {
    says: `${names} ${bare.length === 1 ? "has" : "have"} no tee sheet saved, so nobody has a time to turn up for.`,
    fix: `Draw one on ${teeSheetLabel}`,
    href: "/foursomes",
    afterLaunch: "open",
  };
}

export function launchCheck(
  f: LaunchSource,
  steps: readonly SetupStep[],
  labelFor: (href: string) => string,
): LaunchCheck {
  const warnings = steps
    .filter((s) => !s.done)
    .map((s) => warningFor(s, f))
    .filter((w): w is LaunchWarning => !!w);
  const tee = teeSheetWarning(f, labelFor("/foursomes"));
  if (tee) warnings.push(tee);
  return {
    refusal: launchRefusal(launchFactsFrom(f)),
    warnings,
    stepsOpen: steps.filter((s) => !s.done).length,
    steps: steps.length,
  };
}
