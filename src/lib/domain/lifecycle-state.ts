/**
 * When the stored status disagrees with what has actually happened.
 *
 * The lifecycle — draft, registration, ready, live, completed — is entirely
 * the organizer's to set, and that is right: only they know whether entries
 * are open. But nothing ever checked it against the tournament, so a draw with
 * forty of forty-eight matches played sat on the dashboard labelled "Draft",
 * under a primary button offering to open registration.
 *
 * THAT BUTTON IS THE PART THAT IS FIXED, as of 2026-09-14: the next thing to
 * do is launching, not entries, once anything has been played. Since the state
 * machine (proposal 3 Nov) the button, the chip and the "being played" notice
 * are all `tournamentStatus(facts)`'s (`nextAction`, `chip`,
 * `underWayUnlaunched`); the readers that said them here — `nextLifecycleAction`,
 * `tournamentPhase`, `lifecycleMismatch`, `datesPassedUnlaunched` — were deleted
 * by state machine PR 9a, and `the-tournament-is-asked-one-way.test.ts` refuses
 * their names anywhere in src, e2e or scripts.
 *
 * That is not a cosmetic disagreement, which is why this warns rather than
 * tidies. But the reason it gave was WRONG, and stayed wrong on two screens
 * for as long as both existed — see `LAUNCH_DOES` below.
 *
 * So this reports and offers; it does not correct. Flipping the status by
 * itself locks configuration, which is a real consequence an organizer has to
 * choose rather than have chosen for them because a score got typed in early.
 */

/**
 * Statuses that have not yet given players access to the tournament.
 *
 * Exported because the setup guide asks the same question at the other end of
 * the day: it tells an organizer who has just finished setting up that the
 * field still cannot see any of this, and the warning below tells them again
 * once a score arrives. Two readers, one definition — a second copy is how the
 * two would come to disagree about what "launched" means.
 *
 * ONE WORD SINCE STATE MACHINE PR 8 (J14). It held three — `registration` and
 * `ready` were steps of the old ladder, read as one Setting-up step since G1
 * (31 Oct) and written by nothing since #976. Migration A045 moved every row
 * still holding one to `draft` and kept the old word in `Event.legacyStatus`,
 * which is where the only difference they still made (members may see it,
 * `openToMembers`) is read now. `no-tournament-keeps-an-old-word.test.ts`
 * refuses either word as a tournament's status anywhere in src, scripts or e2e.
 */
export const PRE_LAUNCH_STATUSES = ["draft"];
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
 * The machine's `step` learnt that the hard way (a returned card once read as
 * FINISHED on a never-launched tournament, 2026-09-14).
 */
export function isFinished(status: string): boolean {
  return status === "completed";
}

/*
 * IS THE CONFIGURATION FROZEN lived here until state machine PR 9b, as
 * "launched AND not unlocked by the blanket flag". The blanket is retired and its
 * flag is not read; the one predicate is the machine's `setupLockedByLaunch(status,
 * family)` in `tournament-status.ts`, which says what the flag used to say for a
 * casual round: it never locks.
 */

/**
 * IS THE PLAYER APP SHUT TO A PLAYER — the other half of what launching means.
 *
 * Launching moved `status` and locked setup and did nothing else. `isLaunched`
 * was read in exactly two places, both about locking SETUP, so a player could
 * open the board and their own card in a tournament that was never launched.
 * A share link worked before the club considered the tournament open.
 *
 * GATED IS A PROPERTY OF THE TOURNAMENT, NOT OF THE APP, which is Ajay's call
 * of 2026-09-23. Tournaments are being played in DRAFT today, so a rule that
 * simply read `!isLaunched(status)` would shut live players out of rounds they
 * are halfway through. `accessGated` is true for tournaments created after the
 * gate existed and false for every one that predates it — the migration
 * backfills it, and the column default does the rest.
 *
 * STAFF ARE NOT GATED, and that is not an exception so much as the point: an
 * organizer has to be able to look at the player app for a tournament they
 * have not launched, which is exactly when they are checking it.
 *
 * Asked of the SHELL rather than of each screen. `(player)/layout.tsx` wraps
 * every player route and already says "declared on the layout so a screen
 * added later inherits it" about its own metadata; a gate answered per page is
 * how `roundProgress` came to have four readers of one absence.
 *
 * DRAFT ONLY, AND DELIBERATELY NOT `!isLaunched` — Ajay's call of 2026-09-23,
 * made after the first attempt used the inverse of launched and turned
 * `verify-player-states` red.
 *
 * Pre-launch is THREE statuses, not one: `draft`, `registration`, `ready`.
 * Shutting all three shuts a player out during REGISTRATION, which is exactly
 * when they want the app — to see they are in, or on the waiting list, or not
 * entered at all. Those three sentences are a rule that script exists to
 * protect, and the gate was quietly deleting them.
 *
 * Draft is the one state that means "the club is still building this and
 * nobody should be in here". From `registration` onward there is something
 * true to tell a player, so the app opens and the screens say it.
 *
 * So this reads the status directly rather than through `isLaunched`. The
 * two answer different questions — "may setup still be edited" and "may a
 * player in" — and the file's own warning about a hand-written inverse is
 * about restating ONE rule in two places, not about two rules that happen to
 * share a word.
 */
export function playerAppShut(
  event: { status: string; accessGated: boolean; registrationOpen: boolean; legacyStatus: string },
  isStaff: boolean,
): boolean {
  if (isStaff) return false;
  /**
   * ONE SETTING-UP STEP (Ajay, 2026-10-31, gap G1). Draft, registration and
   * ready now read as one, and nobody presses "Start taking entries" any more,
   * so the status can no longer say "the club has opened this to players".
   * The published sign-up link says it instead: from the moment entries are
   * taken there is something true to tell a player — the reason above — and
   * before it, nobody should be in here. Required, so every caller says.
   */
  return event.accessGated && !openToMembers(event);
}

/**
 * MAY MEMBERS SEE THIS TOURNAMENT — the one answer, for the club's list of
 * tournaments (`club-events.ts`) and the player app's closed door
 * (`playerAppShut`). Two readers, one rule.
 *
 * Launched: yes. Before launch (G1, 2026-10-31 — one "Setting up" step) the
 * switch is the PUBLISHED SIGN-UP LINK: from then on there is something true to
 * tell a member. And, so that nothing members could see before G1 disappears
 * (QA with the tournament director, customer success and security, 2026-10-31),
 * a row that was STORED in one of the old ladder's two later words keeps the
 * visibility it had — those two were open to members. Migration A045 (state
 * machine PR 8) moved those rows to `draft` and kept the old word in
 * `legacyStatus`, so that is what is asked here: any old word at all, because
 * both were open. Nothing writes `legacyStatus`, so going forward the link is
 * the switch. `draft` with no link and no old word stays closed, as it always was.
 *
 * Asked by TRUTH, not `!== ""`: a client generated before A045 hands back a row
 * with no such field, and an absent word must read as none — never as "open".
 * REQUIRED, so the compiler lists every caller that must select it.
 */
export function openToMembers(event: { status: string; registrationOpen: boolean; legacyStatus: string }): boolean {
  return isLaunched(event.status) || event.registrationOpen || !!event.legacyStatus;
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
 * `status: "live"`, and `launchedAt`, and
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
  "Launching marks it live and locks the configuration; after that an Organizer changes one part at a time with a committee correction. Players can score only once it is launched; each round is closed on its own.";

/** And the half that was being attributed to launch by mistake. */
export const VISIBILITY_IS_ELSEWHERE =
  "It doesn't decide what the field can see — that's “Who can see the leaderboard” on Tournament details.";

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
 * every round rather than the active one, which is the whole point: counting
 * the active stage's matches alone never warned a pure stroke tournament, and
 * read a different round's number beside the card's own.
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
 * tournament is over. That is a deliberate choice they make — this app reports
 * the lifecycle rather than correcting it — and it is the one signal that
 * cannot be produced by a score arriving early.
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

/**
 * HOW MANY OF THE ROUND'S CARDS ARE IN — what `snapshotStanding` is given as
 * `done`, by the printed sheet and the player's own screen alike.
 *
 * Certified, normally. A CASUAL round's card is in once every hole is on it
 * (2026-10-07): nobody reviews a friendly and the host's phone never signs
 * the cards it keeps, so counting certified printed "Cards in 0/3" and
 * "Nothing returned for this round yet" over a finished round whose money had
 * already settled — `roundMoneyIsFinal` counts a full card as in.
 * `unreturned` is exactly the full-and-unsigned cards.
 */
export function cardsIn(
  progress: { certified: number; unreturned?: number; unit: string },
  casual: boolean,
): number {
  return casual && progress.unit === "cards" ? progress.certified + (progress.unreturned ?? 0) : progress.certified;
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
  /**
   * WHETHER THERE IS A ROUND AT ALL.
   *
   * Distinct from `total: 0`, which this function already handles and which
   * means "a round exists and nothing has come back from it". A tournament
   * with NO round has the same two zeroes and a different situation, and read
   * the same sentence: "Nothing returned for this round yet — these standings
   * will change", about a round nobody has created.
   *
   * Found on the seeded club's "Winter Series — Not Yet Planned", 2026-09-22:
   * no rounds, nobody entered, and `/stages` two clicks away saying "What is
   * being played? Add at least one round." The screens disagreed about
   * whether a round existed.
   *
   * It is the state every club is in for its first ten minutes, which is the
   * reason `verify-lifecycle.mjs` exists — and an absence reported as a DELAY
   * is the shape CLAUDE.md keeps recording: the sentence promises something is
   * coming when nothing has been set up to come.
   *
   * Optional and defaulting to true, so the two callers that can only run with
   * a round on screen are unchanged and need not prove it.
   */
  hasRound?: boolean;
  /** A casual round — see the all-in branch below. */
  casual?: boolean;
  /**
   * The committee has CLOSED the round on the board ("This round is
   * finished"). Then nothing more is coming back from it, and "2 of 3 cards
   * in — these standings will change" is false: the third card is not late,
   * it is not coming, and the board already shows that player without a
   * place. Walked 2026-10-08 on a 36-hole aggregate with both rounds closed.
   */
  roundClosed?: boolean;
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
  /**
   * NO ROUND IS NOT AN EMPTY ROUND, and it is checked BEFORE the zero branch
   * because both states carry the same two zeroes. See `hasRound`.
   */
  if (input.hasRound === false) {
    return {
      title,
      note: "No round has been added yet — there will be nothing to report until there is something to play.",
    };
  }
  if (input.roundClosed && !ties) {
    return { title, note: "The committee has closed this round — nothing more is coming in from it." };
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
    // A casual round is never "closed" — nobody reviews a friendly, and it is
    // kept or deleted rather than completed — so every card in IS the result.
    if (input.casual) return { title, note: "Every card is in — this is the result." };
    // Every card in and the tournament still open: honest, and a different
    // sentence, because "7 of 33" and "33 of 33" are not the same warning.
    // Named as the act that makes it official (2026-10-08): a round's result
    // is official when the committee closes THE ROUND; a decided draw, when
    // the tournament is completed. "The tournament has not been closed" sent
    // a committee looking at the wrong control for a round's result.
    return {
      title,
      note: ties
        ? "Every tie drawn has been decided — unofficial until the committee completes the tournament."
        : "This round is all in — unofficial until the committee closes it.",
    };
  }
  return {
    title,
    note: ties
      ? `${input.done} of ${input.total} ties decided — the bracket is still being played.`
      : `${input.done} of ${input.total} ${input.unit} in — these standings will change.`,
  };
}
