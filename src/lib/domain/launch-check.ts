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
import { isRated } from "./handicap";

/**
 * The facts, with the two that `SetupFacts` leaves optional made REQUIRED: a
 * builder that forgets the course cards or the playing-round count fails to
 * compile rather than launching over them.
 */
export type LaunchSource = SetupFacts & {
  playingRounds: number;
  missingCards: readonly { label: string; course: string }[];
  /** Tees with no rating under a round that needs a handicap — `unratedTeesFact`; null when nothing is wrong. */
  unratedTees: UnratedTees | null;
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
  /** The screen's name in the sidebar — the link's words when the row is folded. */
  screen: string;
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

/**
 * AT MOST THREE ROWS in the launch dialog. Up to three warnings are each a row;
 * past that, the first two are rows and the third row names the rest INLINE —
 * "Also open: Tee sheet · Prizes & payouts" — each its own link to its own
 * screen. Never a catch-all link: a screen that does not show the fix is a
 * closed door (QA, 2026-10-31).
 */
export function launchRows(warnings: readonly LaunchWarning[]): { rows: LaunchWarning[]; alsoOpen: LaunchWarning[] } {
  if (warnings.length <= 3) return { rows: [...warnings], alsoOpen: [] };
  return { rows: warnings.slice(0, 2), alsoOpen: warnings.slice(2) };
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
  const at = (fix: string, afterLaunch: LaunchWarning["afterLaunch"]) => ({ fix: `${fix} on ${step.label}`, href: step.href, screen: step.label, afterLaunch });
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
    screen: teeSheetLabel,
    afterLaunch: "open",
  };
}

/**
 * THE TEES THAT CANNOT GIVE A COURSE HANDICAP, and the rounds that need one.
 * `null` when nothing is wrong: every round is gross (no handicap is used), or
 * every tee has its Course Rating and Slope.
 *
 * Pure, so the one reader that builds it (`tournament-facts.ts`) hands it the
 * rounds and the tees and the rule stays here. Any basis but "gross" uses a
 * handicap, Stableford included (`unratedWarning` explains why it is not
 * `isNetBasis`).
 */
export interface UnratedTees {
  /** Labels of the rounds that score off a handicap. */
  rounds: string[];
  /** Tees with no Slope: `courseHandicapExact` falls back to the raw Handicap Index. */
  noSlope: string[];
  /** Tees with a Slope but no Course Rating: scaled by Slope, without the Course Rating minus Par term. */
  noRating: string[];
  /** The course has no tees at all, so nothing can be rated. */
  noTees: boolean;
}

export function unratedTeesFact(input: {
  rounds: readonly { label: string; scoringBasis: string }[];
  /** The tees the field actually plays (`teesInPlayFor`), not every set on the course. */
  tees: readonly { name: string; slopeRating: number; courseRating: number }[];
  /**
   * Whether there is a fixed course. Without one (players choose, or none is
   * named yet) "no tees are set up" would be false, so nothing is said.
   * Defaults to true: a caller that has a course says nothing extra.
   */
  fixedCourse?: boolean;
}): UnratedTees | null {
  const rounds = input.rounds.filter((r) => r.scoringBasis !== "gross").map((r) => r.label);
  if (rounds.length === 0) return null;
  if (input.tees.length === 0) {
    return input.fixedCourse === false ? null : { rounds, noSlope: [], noRating: [], noTees: true };
  }
  // The app's own test for a Slope (`isRated`), the one `courseHandicapExact` falls back on.
  const noSlope = input.tees.filter((t) => !isRated(t)).map((t) => t.name);
  const noRating = input.tees.filter((t) => isRated(t) && !(t.courseRating > 0)).map((t) => t.name);
  return noSlope.length === 0 && noRating.length === 0 ? null : { rounds, noSlope, noRating, noTees: false };
}

const joined = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * WHICH FAULT, ONCE (J27). The launch warning and the rail's to-do both ask
 * this, so they cannot come to name different faults. Worst first: no tees at
 * all, a tee with no Slope (the raw Handicap Index is used), a Slope with no
 * Course Rating (scaled by Slope alone).
 */
export type UnratedTier = "noTees" | "noSlope" | "noRating";
export function unratedTiers(u: UnratedTees | null | undefined): UnratedTier[] {
  if (!u) return [];
  if (u.noTees) return ["noTees"];
  const tiers: UnratedTier[] = [];
  if (u.noSlope.length > 0) tiers.push("noSlope");
  if (u.noRating.length > 0) tiers.push("noRating");
  return tiers;
}

/**
 * A WARNING, NEVER A REFUSAL (the panel's ruling stands: unrated tees never stop
 * a launch). Under the World Handicap System a Course Handicap is made from the
 * tee's Slope and Course Rating, so without them the app has only the raw
 * Handicap Index to score with.
 */
function unratedTeesWarning(u: UnratedTees | null | undefined, screen: string): LaunchWarning | null {
  const tiers = unratedTiers(u);
  if (!u || tiers.length === 0) return null;
  const rounds = joined(u.rounds);
  const rawIndex = "usually understates strokes on a hard course and overstates them on an easy one";
  const parts = tiers.map((tier) => {
    if (tier === "noTees") {
      return `No tees are set up for the course, so there is no Slope or Course Rating to work out a Course Handicap for ${rounds}: players are scored on their raw Handicap Index, which ${rawIndex}.`;
    }
    if (tier === "noSlope") {
      const one = u.noSlope.length === 1;
      return `${joined(u.noSlope)} ${one ? "has" : "have"} no Slope, so ${rounds} score players on ${one ? "it" : "them"} off their raw Handicap Index, which ${rawIndex}.`;
    }
    const one = u.noRating.length === 1;
    return `${joined(u.noRating)} ${one ? "has" : "have"} a Slope but no Course Rating, so ${rounds} score players on ${one ? "it" : "them"} on the Slope alone, without the Course Rating minus Par adjustment, which can leave their strokes a little off.`;
  });
  return { says: parts.join(" "), fix: `Add the Course Rating and Slope on ${screen}`, href: "/event", screen, afterLaunch: "open" };
}

/** The rail's one line for each fault, in the same terms as the warning. */
const TODO_WORDS: Record<UnratedTier, string> = {
  noTees: "Add tees with their Course Rating and Slope, or players get strokes off their raw Handicap Index.",
  noSlope: "Add the Slope Rating to the tees, or players get strokes off their raw Handicap Index.",
  noRating: "Add the Course Rating to the tees, or players' strokes are a little off.",
};

/**
 * THE SETUP RAIL'S TO-DO FOR THE SAME FACT (J27): the worst fault, in one line.
 * Optional, never a hold: a scratch or gross-only event has nothing to add (the
 * fact is null for it).
 */
export function unratedTeesTodo(u: UnratedTees | null | undefined): string | null {
  const tier = unratedTiers(u)[0];
  return tier ? TODO_WORDS[tier] : null;
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
  const unrated = unratedTeesWarning(f.unratedTees, labelFor("/event"));
  if (unrated) warnings.push(unrated);
  return {
    refusal: launchRefusal(launchFactsFrom(f)),
    warnings,
    stepsOpen: steps.filter((s) => !s.done).length,
    steps: steps.length,
  };
}
