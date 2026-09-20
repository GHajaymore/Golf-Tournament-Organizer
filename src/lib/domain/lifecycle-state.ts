/**
 * When the stored status disagrees with what has actually happened.
 *
 * The lifecycle — draft, registration, ready, live, completed — is entirely
 * the organizer's to set, and that is right: only they know whether entries
 * are open. But nothing ever checked it against the tournament, so a draw with
 * forty of forty-eight matches played sat on the dashboard labelled "Draft",
 * under a primary button offering to open registration.
 *
 * THAT BUTTON IS THE PART THAT IS FIXED, as of 2026-09-14 — see
 * `nextLifecycleAction`, which offers launching instead of entries once
 * anything has been played. The label on the chip is not "fixed" and should
 * not be: it still says Draft, beside a second chip saying the tournament is
 * being played, because this file reports the disagreement and the organizer
 * resolves it.
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
  /**
   * Results recorded ANYWHERE in the tournament — see `resultsIn`.
   *
   * It was `matchesScored`, fed from `matchProgress`, which counts the ACTIVE
   * STAGE's `Match` rows and nothing else. Two consequences, and the second is
   * the one that made this warning unreliable rather than merely narrow:
   *
   *   A PURE STROKE TOURNAMENT WAS NEVER WARNED AT ALL. No round robin means
   *   no matches, so the count was 0 however many cards had come in, and a
   *   medal played from start to finish in `draft` got silence.
   *
   *   AND IT WAS A DIFFERENT ROUND'S NUMBER. On the demo tournament it read 47
   *   — settled matches on round 1 — while the card beside it said "Cards in
   *   7/33" off round 2. Two counts of "results", side by side, about two
   *   different rounds.
   *
   * Exactly the three faults `domain/review-queue.ts` was written to fix for
   * the review stat, in the same screen, and the fix is the same one: count
   * both sources over the whole tournament.
   */
  resultsIn: number;
  /** Entries in the field. */
  playersEntered: number;
}

export interface LifecycleWarning {
  /**
   * What to put BESIDE the stored status, so the chip is not the only word.
   *
   * "Tournament status: Draft" sat directly above this warning's own title
   * saying 47 results were in — the screen stating a fact and then apologising
   * for it an inch below. The stored status is still shown, because it is the
   * organizer's and this file reports rather than corrects; what changes is
   * that it no longer stands alone.
   */
  chip: string;
  title: string;
  detail: string;
  /**
   * `offerLaunch` USED TO BE HERE, and it is gone rather than kept for later.
   *
   * It answered "should the bar offer launching alongside this warning", was
   * hardcoded `true` on the only object that ever carried it, and once the
   * warning's own Launch button was removed as a duplicate it had no reader
   * left in the app at all — just an assertion that a constant was still that
   * constant, which is coverage in the decorative sense this repo keeps
   * warning about.
   *
   * The question is real and `nextLifecycleAction` answers it properly, for
   * every status rather than only the overtaken one.
   */
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
 * HAS THIS TOURNAMENT BEEN LAUNCHED — asked once, here.
 *
 * The comment above says a second copy is how two readers come to disagree
 * about what "launched" means, and then seven places wrote one: every screen
 * and action that needed the answer spelled `status === "live" || status ===
 * "completed"` by hand.
 *
 * WHICH IS THE INVERSE OF THIS FILE'S OWN DEFINITION, not the same rule
 * written twice. `PRE_LAUNCH_STATUSES` is the list; launched means NOT on it.
 * Those agree today because the two sets happen to cover every status, and
 * they would diverge the moment a sixth is added — a "paused" or "abandoned"
 * would be launched by this file's reckoning and pre-launch by the hand-written
 * one, silently and in opposite directions on different screens.
 *
 * So this is derived from the list rather than restating the pair.
 */
export function isLaunched(status: string): boolean {
  return !PRE_LAUNCH.includes(status);
}

/**
 * Has the organizer declared it over.
 *
 * Nothing derived, and deliberately not "has everything been played": four
 * rounds with one played and four rounds with four played both have cards.
 * See `tournamentPhase`, which learnt that the hard way.
 */
export function isFinished(status: string): boolean {
  return status === "completed";
}

/**
 * IS THE CONFIGURATION FROZEN — the composite, which was the one really being
 * copied.
 *
 * `isSetupLocked` in `page-helpers.ts` has said `launched && !configUnlocked`
 * for a long time, and four other places said it again by hand: the roster
 * screen, the roster action, `action-shared`'s guard and `LifecycleBar`. Five
 * copies of one sentence, and `page-helpers` is `server-only` so a client
 * component could not have called it even if somebody had thought to.
 *
 * Here instead, where both halves can reach it. `isSetupLocked` now delegates,
 * so the server-side name keeps working and there is still one answer.
 */
export function configurationLocked(event: { status: string; configUnlocked: boolean }): boolean {
  return isLaunched(event.status) && !event.configUnlocked;
}

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
 * The code agrees with the measurement. `launchTournament` writes
 * `status: "live"`, `launchedAt` and `configUnlocked: false`, and
 * `PRE_LAUNCH_STATUSES` is read only here and in the setup rail — neither of
 * which gates anything. What a player may see is decided by
 * `canSeeLeaderboard`, which reads `leaderboardVisibility` and nothing else.
 *
 * IT WRITES A FOURTH THING, and this comment used to say "exactly three".
 * Ahead of the three above, `launchTournament` runs an `account.updateMany`
 * setting every non-staff account on the event to the `player` role. That is a
 * real grant and the launch dialog now says so — what stays false is the
 * implication that VIEWING waits on it, since `canSeeLeaderboard` never asks
 * what role the account holds beyond staff-or-not. Worth naming rather than
 * quietly leaving out: "launch writes three things" invites the next reader to
 * conclude the role grant does not happen, which is the opposite error.
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
  const { status, resultsIn, playersEntered } = facts;

  if (PRE_LAUNCH.includes(status) && resultsIn > 0) {
    return {
      chip: "Being played",
      title: `${resultsIn} ${resultsIn === 1 ? "result is" : "results are"} in, but this tournament hasn’t been launched`,
      /**
       * The nudge stands; the reason for it has changed.
       *
       * It used to be "the field cannot see any of this", which is false. The
       * real cost is plainer and still worth saying: the tournament is being
       * played and the app is calling it a draft, in front of
       * ${playersEntered} people who can already open the board.
       *
       * AND IT STOPS THERE NOW. It used to close with `LAUNCH_DOES` and
       * `VISIBILITY_IS_ELSEWHERE` as well, which made one paragraph explain
       * the disagreement, what launching writes, that configuration locks, and
       * where leaderboard visibility really lives — then point at a fourth
       * screen to settle the question it had just raised. Four topics in a
       * warning is a warning nobody finishes.
       *
       * Both sentences are still shown, on the launch dialog, which is where
       * the organizer is actually deciding to press it. A description of what
       * a button does belongs on the button, not on the notice that suggests
       * it.
       */
      detail:
        `Scoring works either way, so nothing is stuck — but ` +
        `${playersEntered > 0 ? `the ${playersEntered} in the field can` : "anyone in the field can"} ` +
        `already open the board and their card, on a tournament that still calls itself a draft.`,
    };
  }

  return null;
}

/**
 * HOW MANY RESULTS THIS TOURNAMENT HOLDS, from both sources, over all of it.
 *
 * The lifecycle question is "has anybody played yet", and nothing else. That
 * makes the LOOSE test the right one here, which is worth saying because this
 * codebase spends most of its care arguing the opposite way: `money-layout.ts`
 * refuses to pay on a settled event whose amount can still move, and CLAUDE.md
 * records `matchSettled` being satisfied by a single hole as a trap. It is a
 * trap for money. For "is this thing under way" a single hole is exactly the
 * evidence wanted — somebody is out on the course whatever the status column
 * says — and `TournamentJourney` reaches the same conclusion in its own words:
 * "a card that has come in means somebody is out there".
 *
 * So: any match with a hole on it, and any card that exists. Counted over
 * every round rather than the active one, which is the whole point — see
 * `LifecycleFacts.resultsIn` for the two faults that came from counting one.
 *
 * Pure, and the caller supplies the rows, exactly as `reviewQueue` does.
 */
export function resultsIn(input: {
  /** Every match in the tournament, reduced to whether it has been played. */
  matches: ReadonlyArray<{ played: boolean }>;
  /** Every scorecard in the tournament. A card that exists was started. */
  cards: ReadonlyArray<unknown>;
}): number {
  return input.matches.filter((m) => m.played).length + input.cards.length;
}

/**
 * WHERE THE TOURNAMENT ACTUALLY IS — one rule, and every screen reads it.
 *
 * This is `TournamentJourney`'s `current`, lifted out of the component. It was
 * fixed there on 2026-09-14 after one returned card reported a never-launched
 * tournament as FINISHED, and the fix is worth restating because it is the
 * whole reason this function exists rather than the expression:
 *
 *   finished           a decision somebody made — `status === "completed"`.
 *                      Nothing derived can know it: four rounds with one
 *                      played and four rounds with four played both have
 *                      cards.
 *   launched || scored play has started. `launched` is the ordinary route;
 *                      `scored` is the evidence route.
 *
 * So a result can only ever move this FORWARD to Play, never to Finish.
 *
 * IT LIVES HERE BECAUSE THE DASHBOARD HAD ITS OWN ANSWER. The journey card on
 * `/event` and the status chip on `/dashboard` were describing the same
 * tournament from two computations, and on the demo tournament they disagreed:
 * the card said Play and the chip said Draft. Fixing one and leaving the other
 * to be fixed later is how they came to disagree in the first place — same
 * reasoning as `PRE_LAUNCH_STATUSES` and `LAUNCH_DOES` above, both of which
 * are single strings for exactly this reason.
 */
export type TournamentPhase = "setup" | "launch" | "play" | "results";

export function tournamentPhase(facts: {
  /**
   * THE STATUS ITSELF, not two booleans derived from it.
   *
   * This took `launched` and `finished` as separate flags, so `/event/page.tsx`
   * computed `status === "live" || status === "completed"` and
   * `status === "completed"` and handed both down through `EventSetupClient`,
   * which used neither and passed them straight on. A page deriving fragments
   * of the lifecycle and posting them through two components is how the
   * dashboard and the journey card came to disagree in the first place.
   *
   * One fact in, one phase out, and the rule about what "launched" means stays
   * in this file with `PRE_LAUNCH_STATUSES`.
   */
  status: string;
  /** Any result anywhere — see `resultsIn`. */
  scored: boolean;
  /** Whether the setup flow reports itself finished. */
  setupComplete: boolean;
}): TournamentPhase {
  return isFinished(facts.status)
    ? "results"
    : isLaunched(facts.status) || facts.scored
      ? "play"
      : facts.setupComplete
        ? "launch"
        : "setup";
}

/**
 * THE ONE THING TO DO NEXT, so that three buttons stop competing.
 *
 * The dashboard offered "Start taking entries" on the status card, "Launch
 * tournament" in the warning below it, and "Leaderboard" in the header — three
 * primary-weighted controls at once, two of them about a lifecycle that
 * scoring had already overtaken. Nothing said which one to press.
 *
 * THE FIRST BRANCH IS THE FIX, and it is a behaviour change rather than a
 * restyle. A tournament sitting in `draft` with results in it used to be
 * offered the next NOMINAL step — "Start taking entries" — which invites an
 * organizer to open registration on a tournament 47 results into being played.
 * The step that actually reconciles the disagreement is launching, and
 * `launchTournament` does not care which pre-launch status it is called from:
 * it gates on `launchRefusal` (a round, and somebody in the field), both of
 * which such a tournament passes by construction.
 *
 * Returning the action rather than rendering it means the page can ask what it
 * will be — the header demotes its own primary when this returns one — without
 * keeping a second copy of the rule.
 */
export interface LifecycleAction {
  label: string;
  /**
   * `launch` opens the confirmation dialog; `status` writes `to` directly.
   *
   * Launching is the only one that asks first, and that is deliberate: it is
   * the transition that locks configuration, and the dialog is where this app
   * says what the button does. See the dialog in `LifecycleBar`.
   */
  kind: "launch" | "status";
  /** The status to write, for `kind: "status"`. */
  to?: string;
}

export function nextLifecycleAction(facts: {
  status: string;
  resultsIn: number;
}): LifecycleAction | null {
  // Play has overtaken the lifecycle. Reconcile it, rather than walking a
  // tournament that is already being played through the entries it never took.
  if (PRE_LAUNCH.includes(facts.status) && facts.resultsIn > 0) {
    return { label: "Launch tournament", kind: "launch" };
  }
  /**
   * "Start taking entries", not "Open registration".
   *
   * This moves the tournament to the `registration` PHASE. It publishes no
   * sign-up link and does not change what `registrationStatus` decides — so
   * the old label promised the one thing it did not do, while two other
   * controls a few inches away used the same word for the public link and for
   * accepting entries. Three things, one word. Ajay's call, 2026-08-21.
   */
  if (facts.status === "draft") return { label: "Start taking entries", kind: "status", to: "registration" };
  if (facts.status === "registration") return { label: "Mark ready", kind: "status", to: "ready" };
  if (facts.status === "ready") return { label: "Launch tournament", kind: "launch" };
  if (facts.status === "live") return { label: "Complete tournament", kind: "status", to: "completed" };
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
  /**
   * A KNOCKOUT TIE DOES NOT MOVE THE TABLE UNDER IT, which every other round
   * on this screen does.
   *
   * The standings a bracket event shows are the GROUP phase's — match points,
   * played, won, halved — and a bracket result is a `BracketWinner` row, not a
   * `Match`. So it can never change a figure in that table: the qualifying is
   * over, and what is still being decided is who wins the thing.
   *
   * "5 of 6 ties in — these standings will change" was therefore two true
   * halves and a false join. The count is right and the consequence belongs to
   * a different table, which is the same shape as a note describing one panel
   * while sitting under another.
   */
  const ties = input.unit === "ties";
  /**
   * A ROUND THE APP DOES NOT SCORE IS NOT A ROUND WAITING FOR CARDS.
   *
   * `isManualFormat` rounds are recorded by the committee — the format's own
   * entry says "no engine computes this. That is the point" — so there is
   * nothing to return and nothing that will change. "Nothing returned for this
   * round yet" was an absence reported as a delay, printed on `/reports` two
   * inches above the notice explaining that no result is expected here, and on
   * the player's own screen where there is no notice at all.
   */
  if (input.unit === "manual") {
    return { title, note: "This round is scored by hand — the committee records the result." };
  }
  if (input.total <= 0 || input.done <= 0) {
    return {
      title,
      note: ties
        ? "No tie has been decided yet — this table is the qualifying, not the bracket."
        : "Nothing returned for this round yet — these standings will change.",
    };
  }
  if (input.done >= input.total) {
    // Every card in and the tournament still open: honest, and a different
    // sentence, because "7 of 33" and "33 of 33" are not the same warning.
    return {
      title,
      note: ties
        ? "Every tie drawn has been decided, but the tournament has not been closed yet."
        : "This round is all in, but the tournament has not been closed yet.",
    };
  }
  return {
    title,
    note: ties
      ? `${input.done} of ${input.total} ties decided — the bracket is still being played.`
      : `${input.done} of ${input.total} ${input.unit} in — these standings will change.`,
  };
}
