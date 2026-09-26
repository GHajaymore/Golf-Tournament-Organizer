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

/**
 * ONE ROUND, as the guide has to judge it.
 *
 * THE STEP USED TO BE A COUNT, and a count cannot be wrong about a round it
 * never looked at. `f.stages > 0` meant "Rounds & formats" went DONE the
 * moment a single Stage row existed — so on 2026-09-15 the rail read
 * "Rounds & formats DONE" directly above a Round 2 showing a "Not generated
 * yet" chip, an empty "Played on", and no deadline either. Four rounds of a
 * three-day tournament, and nothing anywhere said which day any of them was.
 *
 * Several thousand passing tests were happy with that, which is the part
 * worth remembering: every one of them asserted the count, and the count was
 * right.
 *
 * So the rounds arrive one by one and each step asks its own question of
 * them. What a round must answer is split deliberately across two steps —
 * see the `stages` and `grouping` entries — because a round's SCHEDULE
 * depends on nothing downstream and its FIXTURES depend on the field and the
 * flights, which are steps 3 and 4. Asking step 2 for fixtures would pin the
 * guide on step 2 until steps 3 and 4 were done, which is the guide
 * deadlocking on its own order.
 */
export interface SetupRound {
  /**
   * "Round 2", from `roundLabel` — never counted here.
   *
   * The `missing` line names the round that is holding the step up, and the
   * number in it is the one every other screen shows. See
   * `round-number-source.test.ts`: a round number derived from a list position
   * is the bug that had one club championship called "Round 3" on two screens
   * and "Round 2" on four others. Empty is tolerated, and the message falls
   * back to saying it without a number.
   */
  label: string;
  /**
   * Whether the scheduler draws this round's pairings — `generatesPairings`.
   *
   * True for a round robin, which is what "generating flights actually
   * produces" was written about. FALSE for a medal — a Stroke Play Round draws
   * no pairings, by design, because nobody is playing anybody — and false for
   * a knockout, whose fixtures come from the bracket rather than from here.
   *
   * Without it the last step of setup could never be completed by either of
   * them. Read off a single-round tournament on 2026-09-09: four players
   * entered, two flights generated, the screen itself saying "Flights are
   * made, but no pairings are drawn" — and the rail stuck on "4 TO DO" for
   * ever, because the thing it was waiting for is not a thing that happens on
   * a medal.
   *
   * What that cost is more than a stuck counter. `readyToLaunch` requires
   * `complete`, so the one banner that says "setup is finished and the field
   * still cannot see any of it" never appeared on a medal at all — and the
   * other warning about an unlaunched tournament does not fire until somebody
   * enters a score, which is a day too late.
   */
  drawsPairings: boolean;
  /**
   * A day this round is played on, or a day it is played BY. Either answers
   * "when is this one?", and the schema says so at both fields: a fixed-day
   * league PLAYS on Tuesday and wants `playedOn`; a knockout round where the
   * players arrange their own match wants a `deadline`.
   *
   * ONE OF THE TWO, never both, for the reason the `event` step takes a date
   * OR a venue: demanding both refuses a real tournament, and a guard that
   * refuses a real tournament is worse than no guard.
   */
  scheduled: boolean;
  /**
   * Whether this round's field is the survivors of a cut out of the round
   * before it.
   *
   * THE EXEMPTION THAT STOPS THE FIXTURE TEST BECOMING THE `drawsPairings`
   * BUG AGAIN. A cut-fed round cannot be drawn during setup, and the screen
   * says so in as many words — "run it once this round is complete", because
   * the draw ranks a field on results that do not exist yet. Requiring it
   * would be waiting for something that cannot happen until the tournament is
   * half played, which is exactly the shape that pinned a medal on step four
   * for ever.
   */
  cutFed: boolean;
  /** Fixtures drawn for THIS round. */
  matches: number;
}

/**
 * Whether a round says WHEN it is.
 *
 * A DAY IT IS PLAYED ON, OR A DAY IT IS PLAYED BY — and the reason both count
 * is written at both columns in the schema. A Tuesday league PLAYS on Tuesday
 * and wants `playedOn`; a knockout round whose players arrange their own match
 * between themselves is played BY a date and wants `deadline`. Insisting on
 * the first refuses the second, which is a shape clubs genuinely run, and a
 * guard that refuses a real tournament is worse than no guard.
 *
 * Here rather than inline in the service so the rule is testable without a
 * database. It is one line, and a one-line rule with no test is how the
 * deadline half quietly stops counting.
 */
export function roundIsScheduled(playedOn: string, deadline: string): boolean {
  // Trimmed, because both columns default to "" and a stored space is not a
  // day. Same reading as `named`, `dated` and `venued`.
  return !!playedOn.trim() || !!deadline.trim();
}

export interface SetupFacts {
  /** Entries in the field. */
  confirmed: number;
  /** The rounds, in play order. */
  rounds: readonly SetupRound[];
  /** Flights generated. */
  groups: number;
  /** A name of its own, rather than the placeholder a blank one falls back to. */
  named: boolean;
  /** A day it is played on. */
  dated: boolean;
  /** Somewhere to play — the event's own course, or a venue attached to it. */
  venued: boolean;
  /**
   * Whether anybody has said how THIS tournament's money works.
   *
   * True when the tournament has chosen a mode of its own, and true when the
   * club has one to inherit — `resolveMoneyMode` is event → club → kind, so a
   * club that has answered has answered for every tournament it runs and
   * asking again would be the app forgetting.
   *
   * FALSE ONLY WHEN NOBODY HAS EVER BEEN ASKED, which is the state the last
   * fallback covers: `orgProfile(kind).ledger` guesses "split" for a society
   * and "none" for a club. That guess is right often enough to ship and it is
   * still a guess, and the cost of it landing wrong is the worst kind — a
   * settle-up telling a player they owe thirty pounds they paid at signup, or
   * a society's minibus money quietly not tracked anywhere.
   *
   * So this is the one step that exists to convert a guess into an answer, and
   * it is satisfied by one click on a screen that is always reachable. That
   * matters more than it looks: `readyToLaunch` requires every step, and a
   * step that cannot be finished pins the guide for ever — see
   * `drawsPairings`, which is that bug written down.
   */
  moneyAnswered: boolean;
  /**
   * THE SIDES, for a tournament with a round played in them.
   *
   * Found 2026-09-26 creating a Scramble the way a non-golfer would and
   * following only the guide: it walked details → rounds → field → flights →
   * money and never once mentioned teams, while the dashboard read "Sides in
   * 0/0" — a round that cannot be scored until sides exist, on a checklist that
   * could reach "5 of 5 done" without them. Worse, the step it DID point at,
   * Flights, previews "Flight 1: four names" — which to a newcomer looks exactly
   * like a team, and is not one.
   *
   * `needed` is the sidebar's own test for showing Teams & pairs — any round in
   * a team format (`TEAM_FORMAT_NAMES`) — so the step and the menu entry appear
   * together. Absent, or `needed: false`, and the step does not exist at all: a
   * medal is not a five-step setup with a sixth step it can never finish.
   */
  teams?: { needed: boolean; sides: number; unsided: number };
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
   * Everything is set up, and nobody has said the tournament is live.
   *
   * The gap this closes: the rail guided an organizer through four steps and
   * then vanished, silently, at the exact moment the tournament became real.
   * Nothing said "you are finished", and nothing said what was left to do.
   *
   * THIS USED TO SAY the thing that matters is "that until it is launched,
   * nobody in the field can see their schedule, their card or the
   * leaderboard". That is false, and it is the same sentence that was removed
   * from two screens on 2026-09-11 after being measured — see `LAUNCH_DOES` in
   * `lifecycle-state.ts`, which records a player on a `draft` tournament
   * opening the board and a certifiable card. The sweep that caught the two
   * rendered copies did not read comments, so this one sat here describing a
   * gate the app does not have. What launching actually does is state the
   * lifecycle and lock configuration.
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
  /** A step only some tournaments have. Absent means every tournament. */
  applies?: (f: SetupFacts) => boolean;
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
    /**
     * A ROUND, AND A DAY FOR EACH ONE ONCE THERE IS MORE THAN ONE.
     *
     * The first half is what this step always asked. The second is what
     * `f.stages > 0` could not see: on 2026-09-15 a four-round tournament
     * dated "May 14–16, 2026" had a deadline on Round 1 and nothing at all on
     * Rounds 2, 3 and 4, and the rail called the step DONE. Nothing in the
     * app could answer "which day is Round 2?", and nothing was asking.
     *
     * WHY A DAY *OR* A DEADLINE. Both are real answers to "when", and the
     * schema argues for each: `playedOn` is the Tuesday league that PLAYS on
     * Tuesday, `deadline` is the knockout round whose players arrange their
     * own match. Insisting on the first would refuse the second, which is a
     * genuine shape clubs run.
     *
     * WHY ONLY ONCE THERE ARE TWO. A single-round tournament is already dated
     * by the event — that is what step one asked for — so asking again is the
     * app forgetting an answer it has, the same reason `moneyAnswered` takes
     * the club's. With two rounds the event's date stops being an answer: a
     * range covering three days says nothing about which of them is Round 2.
     *
     * AND NOT FIXTURES, which is the candidate this deliberately leaves to
     * the flights step. A round's pairings come from the flights, which come
     * from the field — steps four and three. A step that cannot be finished
     * until two later steps are done is a guide deadlocking on its own order.
     */
    missing: (f) => {
      if (f.rounds.length === 0) return "Add at least one round.";
      const waiting = f.rounds.filter((r) => !r.scheduled);
      const named = waiting.find((r) => !!r.label)?.label;
      if (waiting.length > 1) return "Some rounds have no day and no deadline.";
      return named
        ? `${named} has no day and no deadline.`
        : "One round has no day and no deadline.";
    },
    done: (f) =>
      f.rounds.length > 0 && (f.rounds.length === 1 || f.rounds.every((r) => r.scheduled)),
  },
  {
    key: "registration",
    href: "/registration",
    question: "Who is playing?",
    missing: () => "Nobody is entered yet.",
    /**
     * ONE ENTRY, AND THAT IS GENUINELY THE BAR — checked 2026-09-15 rather
     * than left as the "at least one" shape the two steps either side of it
     * turned out to be.
     *
     * Only the organizer knows how big the field is meant to be. `capacity` is
     * a ceiling and not a target, `manualPlayerCount` is an estimate for a
     * tournament not taking entries at all, and neither is a number the app
     * may hold a step open against — a society day that ends up with eleven
     * players is not half-finished, it is a society day with eleven players.
     *
     * THE ONE CANDIDATE THAT WAS CONSIDERED AND REJECTED is pending entries.
     * Under `approve` mode an entry lands as `pending` and waits for the
     * organizer, so "one confirmed and twelve people waiting to hear" is a
     * real state and a real piece of outstanding work. It is still not this
     * step: entries arrive continuously and after launch, so the rail would
     * flip between DONE and TODO as strangers filled the form in, and setup
     * would un-finish itself on a tournament already being played. A banner
     * that comes back is furniture — see `readyToLaunch`, which is kept
     * self-clearing for the same reason.
     */
    done: (f) => f.confirmed > 0,
  },
  {
    key: "teams",
    href: "/teams",
    /**
     * WHO PLAYS ON WHICH SIDE — only where a round is played in sides.
     *
     * After the field, because sides are made FROM the field; before flights,
     * because in a team event the flight preview ("Flight 1: four names") is
     * what a newcomer mistakes for the teams, and this puts the real question
     * first. See `teams` on SetupFacts for how it was found.
     *
     * DONE WHEN EVERY CONFIRMED PLAYER IS ON A SIDE, not when one side exists:
     * a player left off every side has nothing to score in a scramble, and
     * "one side made" would read finished with most of the field unplaced.
     * Any side in the event counts, so a club using different sides per round
     * is not held on this step by the rounds it has not reached.
     */
    question: "Who plays on which side?",
    missing: (f) => {
      const t = f.teams;
      if (!t || t.sides === 0) return "No sides yet — draw them automatically, or make them by hand.";
      return `${t.unsided === 1 ? "1 player is" : `${t.unsided} players are`} not on a side yet.`;
    },
    done: (f) => !f.teams?.needed || (f.teams.sides > 0 && f.teams.unsided === 0),
    applies: (f) => !!f.teams?.needed,
  },
  {
    key: "grouping",
    href: "/grouping",
    question: "How is the field divided, and who plays whom?",
    /**
     * Two conditions where there are two, and one where there is only one.
     *
     * Flights existing is not the same as a schedule existing: on a round
     * robin, generating produces both, and a flight built and then left is a
     * tournament with groups and no fixtures — it reads as finished and has
     * nothing to score. That is why the second test is here.
     *
     * IT ONLY APPLIES WHERE PAIRINGS ARE DRAWN. A medal draws none and a
     * knockout draws its own from the bracket, so demanding fixtures of either
     * is waiting for something that is never going to happen — and it did:
     * both were pinned on the last step of setup for ever. See
     * `drawsPairings` for what that cost beyond the counter.
     *
     * AND IT IS ASKED OF EACH ROUND, not of the tournament. It used to read
     * `f.matches > 0` across the whole event, which any one round satisfies
     * for all of them: a second round robin with no draw at all passed on the
     * strength of the first round's forty-eight matches, while the Rounds &
     * formats screen sat there showing it a "Not generated yet" chip. That is
     * the same defect as the count this file's `SetupRound` was written for,
     * one step along.
     *
     * The remedy is on Rounds & formats rather than here — "Generate Round 2
     * pairings" lives beside the round it builds — so the message says where
     * to go. A step whose fix is on another screen is worth naming; a step
     * that does not say is just a closed door.
     */
    missing: (f) => {
      if (f.groups === 0) return "No flights yet.";
      const undrawn = f.rounds.filter((r) => r.drawsPairings && !r.cutFed && r.matches === 0);
      const named = undrawn.find((r) => !!r.label)?.label;
      return named
        ? `${named} has no pairings — generate them on Rounds & formats.`
        : "Flights are made, but no pairings are drawn.";
    },
    done: (f) =>
      f.groups > 0 && f.rounds.every((r) => !r.drawsPairings || r.cutFed || r.matches > 0),
  },
  {
    key: "money",
    href: "/prizes",
    /**
     * LAST, AND A STEP RATHER THAN A SETTING LEFT LYING ABOUT.
     *
     * The club's own chain has asked this since it was written — "Decide how
     * money works", on `/organization` — and its blurb ends "Changeable per
     * tournament later" without ever saying WHERE. The answer was the last
     * card on the Prizes screen, below the ledger it governs, so keeping that
     * promise meant scrolling past everything the decision decides. An
     * organizer read a settle-up and then found out whether the settle-up
     * applied.
     *
     * Last of the five because it is the only one that is not golf. The other
     * four are what has to be true before anybody can tee off; this is what
     * has to be true before anybody is asked for money, and it is the natural
     * hand-off into launching — what it costs and what is at stake is the last
     * thing you settle before the field can see any of it.
     *
     * WHY `/prizes` AND NOT A SCREEN OF ITS OWN. The prize list, the purse,
     * the pots and the mode are one subject and already one screen, and a new
     * route carrying a single radio group would be a screen an organizer has
     * to learn in order to answer one question. The screen states the mode at
     * the top now — see `MoneyModeLine` — so arriving here from the guide
     * answers the question before anything else on it is read.
     */
    question: "What does it cost, and who handles the money?",
    missing: () => "Nobody has said how money works here.",
    done: (f) => f.moneyAnswered,
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
export const SETUP_ORDER: readonly string[] = [
  "/event",
  "/stages",
  "/registration",
  // Only in a tournament with a round played in sides — see the step. Listed
  // here so every reader places it the same way when it is present; the
  // journey card filters it out when it is not (see TournamentJourney).
  "/teams",
  "/grouping",
  // The money, last — see the step. It is the only one of the five that is not
  // a precondition of playing golf, and the one the club chain promised was
  // "changeable per tournament later" without saying where.
  "/prizes",
];

/**
 * The setup screens THIS tournament walks, in `SETUP_ORDER`.
 *
 * `stepHrefs` is the flow's own list of steps. A conditional step — one with
 * `applies`, which today is only Teams & pairs — is kept only when the flow has
 * it, so the journey card does not show a medal a Teams chip it can never tick.
 * Absent, and it is the always-present steps: what the card showed before a
 * conditional step existed.
 */
export function setupScreens(stepHrefs?: readonly string[]): string[] {
  const conditional = STEPS.filter((s) => s.applies).map((s) => s.href);
  return SETUP_ORDER.filter((h) => !conditional.includes(h) || !!stepHrefs?.includes(h));
}

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
  // Only the steps this tournament has — a medal has no sides to make.
  const own = STEPS.filter((s) => !s.applies || s.applies(facts));
  const done = own.map((s) => s.done(facts));
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

  const steps: SetupStep[] = own.map((s, i) => ({
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
