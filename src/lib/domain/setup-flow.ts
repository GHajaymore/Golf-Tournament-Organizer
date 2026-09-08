/**
 * Setting a tournament up, as a route rather than a pile of screens.
 *
 * The four Set-up screens have always been four independent destinations in a
 * sidebar. Each is dense, each is correct on its own, and between them there
 * was nothing: no order, no sense of how far through you were, and no way
 * onward or back except finding the next name in a list of twenty. An
 * organizer setting up their first tournament had to already know the order to
 * follow it.
 *
 * So this is the order, said once, with the question each screen answers and
 * the test for whether it has been answered. Everything that guides — the rail
 * across the top, the Back and Next at the bottom, the progress count — reads
 * this and nothing else, so the app cannot tell an organizer one order in the
 * rail and a different one in the buttons.
 *
 * THE ORDER IS THE PRODUCT DECISION, and it is not the one the checklist uses.
 * `setupChecklist` runs field → rounds → flights, and its reason — "you cannot
 * flight a field you have not entered" — is sound but only orders flights
 * last. What comes first is a different question, and the answer is what the
 * event IS: its name, then what is being played, then who is playing it.
 * Deciding the field before deciding whether it is a medal or a knockout is
 * the wrong way round, and it is the way round that had somebody adding
 * players before discovering the format was not the one they wanted.
 *
 * IT GUIDES; IT DOES NOT CAGE. `Next` waits until the current step is
 * genuinely finished, which is what makes it a guide — but every step stays
 * reachable from the rail and from the sidebar, because an organizer setting
 * up their ninth tournament of the season knows exactly which screen they want
 * and a wizard that will not let them go there is worse than no wizard. The
 * shape of the tournament is not a lock either, for the same reason.
 */

export interface SetupFacts {
  /** Entries in the field. */
  confirmed: number;
  /** Rounds configured. */
  stages: number;
  /** Flights generated. */
  groups: number;
  /** Fixtures drawn, which is what generating flights actually produces. */
  matches: number;
  /** A name of its own, rather than the placeholder a blank one falls back to. */
  named: boolean;
  /** A day it is played on. */
  dated: boolean;
  /** Somewhere to play — the event's own course, or a venue attached to it. */
  venued: boolean;
  /**
   * Whether the tournament has been launched.
   *
   * Not a step, and deliberately not one: launching is not part of setting a
   * tournament up, it is the act of handing it to the field. It is here so the
   * guide can say the one thing it otherwise never says — that setup is
   * finished and the tournament is still invisible to everybody in it.
   */
  launched: boolean;
}

export type SetupStepState = "done" | "current" | "todo";

export interface SetupStep {
  key: string;
  href: string;
  /** What the sidebar calls this screen. Passed in rather than written here,
   *  so the rail cannot come to call a screen something the sidebar doesn't. */
  label: string;
  /** The question this step answers, in the organizer's words. */
  question: string;
  /** What is still missing, shown only while this step is the current one. */
  missing: string;
  done: boolean;
  state: SetupStepState;
}

export interface SetupFlow {
  steps: SetupStep[];
  /** The first unfinished step — where an organizer should be. Null when
   *  everything is done. */
  current: SetupStep | null;
  doneCount: number;
  complete: boolean;
  /**
   * Everything is set up and the field still cannot see any of it.
   *
   * The gap this closes: the rail guided an organizer through four steps and
   * then vanished, silently, at the exact moment the tournament became real.
   * Nothing said "you are finished", and nothing said the thing that actually
   * matters — that until it is launched, nobody in the field can see their
   * schedule, their card or the leaderboard. The only warning about that fires
   * AFTER a score is entered, which is a day too late.
   *
   * Self-clearing, and that is what makes it worth showing: it is true for the
   * few minutes between finishing setup and launching, and false forever
   * after. A banner that stays is furniture; this one has an exit and takes
   * itself through it.
   */
  readyToLaunch: boolean;
}

/** The order, and the test for each step. Labels arrive from the nav. */
const STEPS: ReadonlyArray<{
  key: string;
  href: string;
  question: string;
  missing: (f: SetupFacts) => string;
  done: (f: SetupFacts) => boolean;
}> = [
  {
    key: "event",
    href: "/event",
    question: "What is this tournament, and where or when?",
    missing: (f) => (!f.named ? "It still needs a name." : "Say where it is played, or what day."),
    /**
     * A name, and EITHER a date OR a venue — not both.
     *
     * The temptation is to require both, and it is wrong twice over. A league
     * that plays somewhere different every week has no venue to give, and
     * `courseMode: "open"` exists precisely for it; a club whose date is still
     * being argued over in committee has a course and no day. Demanding both
     * would leave each of them stuck on step one of a guide, which is the
     * worst place to be stuck.
     *
     * One of the two is a real bar rather than a formality: a tournament with
     * neither is a name and nothing else, and there is nothing downstream that
     * can be decided about it.
     */
    done: (f) => f.named && (f.dated || f.venued),
  },
  {
    key: "stages",
    href: "/stages",
    // Before the field, deliberately — see the note at the top of the file.
    question: "What is being played?",
    missing: () => "Add at least one round.",
    done: (f) => f.stages > 0,
  },
  {
    key: "registration",
    href: "/registration",
    question: "Who is playing?",
    missing: () => "Nobody is entered yet.",
    done: (f) => f.confirmed > 0,
  },
  {
    key: "grouping",
    href: "/grouping",
    question: "How is the field divided, and who plays whom?",
    /**
     * Two conditions, not one, and the second is the one that matters.
     *
     * Flights existing is not the same as a schedule existing: generating
     * produces both, but a flight built and then left produces a tournament
     * with groups and no fixtures, which reads as finished and has nothing to
     * score. The checklist has always tested both; this says so out loud.
     */
    missing: (f) => (f.groups === 0 ? "No flights yet." : "Flights are made, but no pairings are drawn."),
    done: (f) => f.groups > 0 && f.matches > 0,
  },
];

/**
 * THE ORDER, once, for everything that states one.
 *
 * The note at the top of this file argues for this sequence and says outright
 * that `setupChecklist` uses a different one. That was left as a disagreement
 * rather than resolved, and an organizer met all of it at once: on
 * `/event` the rail across the top read details → rounds → field → flights
 * while the "Recommended flow" card below it read field → flights → rounds,
 * and the dashboard they had just come from listed field → rounds → flights.
 *
 * Three orders, two of them on one screen, for the same four screens. Whichever
 * is right, an app that states three cannot be teaching any of them — so they
 * read this now, and a test asserts they agree.
 */
export const SETUP_ORDER: readonly string[] = ["/event", "/stages", "/registration", "/grouping"];

/** Sort anything carrying an `href` into `SETUP_ORDER`, unknown hrefs last. */
export function bySetupOrder<T extends { href: string }>(items: readonly T[]): T[] {
  const rank = (href: string) => {
    const i = SETUP_ORDER.indexOf(href);
    return i === -1 ? SETUP_ORDER.length : i;
  };
  // Stable within a rank, so anything this order does not mention keeps the
  // sequence its caller chose — the optional tail stays a tail.
  return items.map((item, i) => ({ item, i })).sort((a, b) => rank(a.item.href) - rank(b.item.href) || a.i - b.i).map((x) => x.item);
}

export function setupFlow(facts: SetupFacts, labelFor: (href: string) => string): SetupFlow {
  const done = STEPS.map((s) => s.done(facts));
  /**
   * The current step is the FIRST unfinished one, not the first after the last
   * finished one.
   *
   * They differ the moment somebody works out of order — add the field before
   * the rounds and steps 3 and 2 are done and undone respectively. Pointing at
   * the last-plus-one would then send them past the gap they left, which is
   * the one thing a guide must never do.
   */
  const currentIndex = done.indexOf(false);

  const steps: SetupStep[] = STEPS.map((s, i) => ({
    key: s.key,
    href: s.href,
    label: labelFor(s.href),
    question: s.question,
    missing: s.missing(facts),
    done: done[i],
    state: done[i] ? "done" : i === currentIndex ? "current" : "todo",
  }));

  const complete = currentIndex === -1;
  return {
    steps,
    current: complete ? null : steps[currentIndex],
    doneCount: done.filter(Boolean).length,
    complete,
    readyToLaunch: complete && !facts.launched,
  };
}

/**
 * Whether the rail is saying anything at all.
 *
 * Exported so the one screen that carries BOTH the rail and the flat setup
 * checklist can show the checklist exactly when the rail has gone quiet.
 * Working that out at the call site meant writing the rail's own render
 * condition a second time, in a different file, in negative form — which is
 * how the two would come to disagree and put two progress lists on one screen.
 */
export function railSpeaks(flow: SetupFlow | null): boolean {
  return !!flow && (!flow.complete || flow.readyToLaunch);
}

export interface SetupPosition {
  /** The step being looked at, when this screen is one of them. */
  step: SetupStep | null;
  back: SetupStep | null;
  next: SetupStep | null;
}

/**
 * Where a given screen sits in the flow, and what is either side of it.
 *
 * Back and Next are the STEP either side, regardless of whether it is done.
 * Going back to a finished step is exactly what "I want to change the date"
 * means, and refusing it because the step is complete would be the app
 * arguing with somebody who has changed their mind.
 */
export function positionOf(flow: SetupFlow, href: string): SetupPosition {
  const i = flow.steps.findIndex((s) => s.href === href);
  if (i === -1) return { step: null, back: null, next: null };
  return {
    step: flow.steps[i],
    back: i > 0 ? flow.steps[i - 1] : null,
    next: i < flow.steps.length - 1 ? flow.steps[i + 1] : null,
  };
}

/**
 * Whether the organizer may move on from this step yet.
 *
 * The guide's one piece of insistence, and it is about the CURRENT step only:
 * finish what you are on. Somebody who has jumped back to a finished step is
 * not blocked, because there is nothing there to finish.
 */
export function canAdvance(step: SetupStep | null): boolean {
  return !step || step.done;
}
