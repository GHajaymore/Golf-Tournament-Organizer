/**
 * WHERE IS THIS TOURNAMENT, WHAT IS NEXT, AND WHAT IS LOCKED — asked once.
 *
 * The state machine of "Tournament state machine — proposal 3 Nov", PR 1. On
 * main the three questions are answered in 26 places (the proposal's
 * inventory, section 1a), and they agree on the Launch button and on not much
 * else: a medal with no flights is "not set up" on the rail while Launch works
 * (D1), a knockout five ties in is "not started" everywhere but the scoring
 * gate (D2), the secretary's home says "Complete the tournament" over a card
 * the dashboard then refuses to complete on (D3).
 *
 * TWO FUNCTIONS, ONE EACH SIDE OF THE DATABASE. `tournamentFactsFor`
 * (services/tournament-facts.ts) reads the tournament into the plain values
 * below; `tournamentStatus` here turns them into four answers — the step, the
 * locks with their reasons, the ONE next action, and what is refused and why.
 * Pure: no prisma, no clock. "Today" arrives in the facts, from the club's
 * clock (CLAUDE.md, "The club's clock").
 *
 * NOTHING READS THIS YET. PR 1 adds it beside the readers it will replace, and
 * `tournament-status-shadow.test.ts` holds it to them everywhere except the
 * disagreements it was written to settle, each listed there by id. Screens and
 * actions switch over in PR 3 onward.
 *
 * IT COMPOSES THE RULES THAT ALREADY EXIST rather than restating them, so
 * there is still one rule for each question: the setup steps are
 * `setupFlow`'s, the launch refusal is `launchCheck`'s (`launchRefusal`
 * through its one builder), completing asks `finishRefusal` and
 * `completingCheckFor`, playing asks `playRefusal`. What it ADDS is the panel's
 * ruling of 3 Nov (section 8): which steps HOLD launch per format family, when
 * a family's play is over, and the lock's reason and way out.
 */
import { configurationLocked, isFinished, isLaunched } from "./lifecycle-state";
import { setupFlow, type SetupFacts, type SetupFlow, type SetupStep } from "./setup-flow";
import type { LaunchCheck, UnratedTees } from "./launch-check";
import { completingCheckFor, finishRefusal, playRefusal, statusMove } from "./phase-gate";
import type { BracketView } from "./bracket";
import { screenName } from "@/lib/nav";
import { hasKnockoutStage, isKnockoutRound, isStraightKnockout } from "@/lib/stage-types";

/* ------------------------------------------------------------------ facts */

/** One round, with its OWN facts — never a tournament-wide total. */
export interface RoundFacts {
  id: string;
  /** "Round 2", from `roundLabel` — never counted here. */
  label: string;
  type: string;
  format: string;
  /** Where it sits; `roundNumber` counts in this order. */
  position: number;
  /** A round the field plays (`isPlayingRound`). */
  playing: boolean;
  /** Scored in Stableford points (`isStablefordRound`). */
  stableford: boolean;
  /** Its type and format can produce a result together (`roundShapeMismatch` is null). */
  scorable: boolean;
  /** It has a day OR a deadline (`roundIsScheduled`). */
  scheduled: boolean;
  /** The scheduler draws its pairings (`generatesPairings`). */
  drawsPairings: boolean;
  /** Its field is the survivors of a cut, so it cannot be drawn during setup. */
  cutFed: boolean;
  /** Fixtures drawn for this round. */
  matches: number;
  /** Of those, the ones that are OVER — `storedMatchIsOver`, never `matchSettled`. */
  matchesOver: number;
  /** A saved tee sheet, where one is the question (a stroke round); null where it is not. */
  teeSheetSaved: boolean | null;
  /**
   * HAS THIS ROUND BEEN PLAYED AT ALL — the one definition, the widest of
   * today's three spellings (`roundsWithResults`): an individual or team card,
   * a match card, a Match with a hole or a forfeit, and — for a knockout round
   * — any `BracketWinner`. `resultsIn` leaves the last out, which is D2.
   */
  hasResult: boolean;
  /** The committee has closed it (`Stage.closedAt`). */
  closed: boolean;
}

/** One draw of a knockout — `bracketDraws()` is the one answer to which draws there are. */
export interface DrawFacts {
  /** "", "Plate", "Flight B"… as `bracketDraws` names it. */
  label: string;
  /** Players in it. A draw of one has no tie to play (see `drawFacts`). */
  entrants: number;
  /** Its Final has a winner. */
  finalDecided: boolean;
}

export const LOCK_SCOPES = ["details", "rounds", "field", "flights", "draw", "sides", "cup", "money", "teeSheet"] as const;
export type LockScope = (typeof LOCK_SCOPES)[number];

export interface TournamentFacts {
  /** The club's day (`clubDayForEvent`), never the server's. */
  today: string;
  /** Stored: draft | registration | ready | live | completed. Legacy values allowed until J14. */
  status: string;
  /** The old value of a row moved to `draft` by J14's migration; "" until it lands (PR 8). */
  legacyStatus: "" | "registration" | "ready";
  /** Today's blanket Unlock. Read as the legacy correction until PR 9. */
  configUnlocked: boolean;
  /**
   * A committee correction open on one scope (panel 8.1, TD Q2). Null until
   * PR 5b adds its columns; the shape is here so nothing changes when it does.
   */
  correction: { scope: LockScope; by: string; reason: string; until: string } | null;
  /** "match" is a casual round. */
  shape: string;
  /**
   * THE ORGANIZER MADE IT A LEAGUE — its KIND, never its round count (Golf
   * Pro, PR 3: "a 36-hole medal is not a league"). True when the tournament is
   * called a league (`playKind`), keeps a league table of clubs
   * (`leaguePoints`), or asks a weekly sign-up (`attendanceMode` other than
   * everyone — "weekly-league attendance", domain/attendance.ts). Read by
   * `tournamentFamily`, and only together with a weekly round.
   */
  league: boolean;
  named: boolean;
  /** `Event.dates` is not empty — the launch gate's own `dated`. */
  dated: boolean;
  venued: boolean;
  startOn: string;
  endOn: string;
  moneyAnswered: boolean;
  bracketMode: string;
  flightsConfirmed: boolean;
  playSuspended: boolean;
  /** Confirmed entries. */
  confirmed: number;
  /** Flights (not match carriers). */
  groups: number;
  /** Confirmed players in no flight, while flights exist (J04). */
  unplacedInFlights: number;
  /** The sides, as `SetupFacts.teams`. */
  teams: { needed: boolean; sides: number; unsided: number };
  /** A team cup's teams (its flights) and the players on neither; null when not a cup. */
  cup: { flights: number; unplaced: number } | null;
  /** Every round, in play order. */
  rounds: RoundFacts[];
  /**
   * Playing rounds whose format needs a course card they lack (`roundsMissingCards`).
   * `stageId` says WHICH round, so a round's own need (`RoundNeed`, J16) is the
   * launch gate's fact and never a second reading of the card.
   */
  missingCards: { stageId: string; label: string; course: string }[];
  /** Tees with no rating under a round that scores off a handicap (`unratedTeesFact`); a launch warning only. */
  unratedTees?: UnratedTees | null;
  /** A knockout's draws and its play-off for third; null when there is no Bracket Stage. */
  knockout: { draws: DrawFacts[]; thirdPlace: { on: boolean; decided: boolean } } | null;
  /** A cup's verdict is no longer "open"; null when not a cup or not read. */
  cupDecided: boolean | null;
  /** The review queue (`state.pendingConfirmations`, `state.reviewing.disputed`). */
  review: { pendingConfirmations: number; disputed: number };
}

/* ----------------------------------------------------------------- answer */

export type Family =
  | "stroke"
  | "stableford"
  | "match"
  | "roundRobinFlights"
  | "knockout"
  | "flightedKnockout"
  | "teamCup"
  | "league"
  | "casual";

export type Step = "setting-up" | "live" | "play-over" | "completed";

/** Where to go to put it right — a sentence and a screen. Never a closed door. */
export interface WayOut {
  says: string;
  href: string;
}

export type LockBy = "launch" | "draw" | "scores" | "results" | "completed";

export type Lock =
  | { locked: false }
  | {
      locked: true;
      by: LockBy;
      /** "Locked because the draw is confirmed." */
      because: string;
      wayOut: WayOut;
      /** A committee correction may open it: only a lock by launch or by the draw (panel 8.1). */
      correctable: boolean;
    };

export interface StatusStep {
  key: string;
  href: string;
  label: string;
  question: string;
  missing: string;
  done: boolean;
  /** While this step is open, launch is refused. Optional steps never hold. */
  holds: boolean;
  /**
   * OPEN, AND NOTHING WAITS FOR IT (panel 8.2, "Shown, optional"): a medal's
   * flights ("Optional — one field"), the money answer, a second round's day,
   * a league's later weeks. Shown unticked with its words; never the guide's
   * current step and never a refusal. Exactly `!done && !holds`.
   */
  optional: boolean;
}

export type NextKind = "launch" | "complete" | "reopen" | "draw" | "schedule";

export interface NextAction {
  kind: NextKind;
  label: string;
  href: string;
  /**
   * The round it is about, for an action done on one round ("Generate Round 2
   * pairings", "Set Week 3's day"): Rounds & formats opens that round rather
   * than reloading itself (J16). Null for an action on the whole tournament.
   */
  roundId: string | null;
  enabled: boolean;
  /** Refused IN PLACE, with the reason. */
  disabledBecause: string | null;
  /** Where the refusal is put right (QA, panel 8.4). Null only when enabled. */
  wayOut: WayOut | null;
  /** The confirm sentence, when pressing it should ask first (`completingCheckFor`). */
  asks: string | null;
}

export interface StatusWarning {
  says: string;
  fix: string;
  href: string;
  /** What the sidebar calls the screen it is fixed on — the launch dialog names it. */
  screen: string;
  afterLaunch: "open" | "unlock";
}

/**
 * WHAT ONE ROUND STILL NEEDS (J16), in the order a round is set up: where (a
 * course with a card), what (a format its type can score), when (a day or a
 * deadline), then who meets whom (pairings) and who goes off when (tee times,
 * which wait for entries). Each is the machine's own fact, so the strip on
 * Rounds & formats says exactly what launch refuses and its dialog warns:
 *
 *   course / card  `missingCards` — the launch gate's card fact (holds)
 *   format         `!scorable` — `roundShapeMismatch` (holds)
 *   draw           a round robin not drawn and not fed by a cut, or a single
 *                  match not made (holds); once live, the draw owed now
 *   date           not `scheduled` (a day OR a deadline): asked of every round
 *                  only when there is more than one (a one-round tournament's
 *                  day is its dates); a league only of its NEXT unplayed week,
 *                  which holds (J08) — later weeks are one warning, not a line each
 *   teeSheet       `teeSheetSaved === false` (the dialog's own question), and
 *                  only once somebody has entered: a tee sheet is drawn from the field
 *
 * A round that is played (a result) or closed needs nothing.
 */
export type RoundNeedKey = "course" | "card" | "format" | "draw" | "date" | "teeSheet";

export interface RoundNeed {
  key: RoundNeedKey;
  /** Read after the round's name: "has no course card". */
  missing: string;
  /** What it costs, in the players' terms (the UX writer, 2 Nov): "players cannot see when they play". */
  consequence: string;
  /** Launch is refused while it is open. Only ever true while setting up. */
  holds: boolean;
  /** Where it is put right: the round itself on Rounds & formats, or the tee sheet. */
  fix: "round" | "tee-sheet";
}

export interface StatusRound {
  id: string;
  label: string;
  state: "not-started" | "under-way" | "closed";
  needs: RoundNeed[];
}

export interface TournamentStatus {
  family: Family;
  step: Step;
  /** "Setting up" | "Live" | "Play over" | "Completed", with " · results in" / " · Suspended". */
  chip: string;
  /** The second line under the chip: what made play over, and that results are not released. */
  chipDetail: string;
  /** Results are in and it was never launched (absorbs `lifecycleMismatch`). */
  underWayUnlaunched: boolean;
  /** For `TournamentJourney` and `eventPhase`. */
  journey: "setup" | "launch" | "play" | "results";
  setup: { steps: StatusStep[]; done: number; of: number; current: StatusStep | null };
  /**
   * Each round's own step — D8's "has this round started", answered from results only —
   * and what that round still needs, by the same rules that hold launch and warn in its
   * dialog (J16): the strip on Rounds & formats draws these, never a reading of its own.
   */
  rounds: StatusRound[];
  /** THE one button. Null only for a casual round, which is never on the home. */
  nextAction: NextAction | null;
  locks: Record<LockScope, Lock>;
  refusals: { launch: string | null; play: string | null; complete: string | null; reopen: string | null };
  /**
   * What pressing it should ASK first, when it is allowed (PR 4): completing
   * with a round nobody has played (`completingCheckFor`'s question). Here as
   * well as on `nextAction`, because the action asks it whatever the button of
   * the moment is — a live league's button may be "Set Round 4's day".
   */
  asks: { complete: string | null };
  warnings: StatusWarning[];
}

/* ------------------------------------------------------------- the rules */

const isWeekly = (t: string) => t === "Round Robin" || t === "Stroke Play Round";

/**
 * WHICH FAMILY — first match wins, in the proposal's order (section 2e).
 *
 * A LEAGUE BY ITS KIND, NOT BY ITS ROUND COUNT (Golf Pro, PR 3). PR 1 took the
 * sidebar's test — more than one weekly round — and that test calls a 36-hole
 * medal a league: two Stroke Play Rounds are two "weekly" rounds. A
 * championship over two days is one stroke-play competition (Rule 3.3; its
 * Terms set the number of rounds, Committee Procedures 5A), and the league's
 * one relaxation — only the next unplayed week needs a day (J08) — must never
 * reach it. So a league is a tournament the organizer MADE one (`league`: its
 * kind, its league table, its weekly sign-up) with a weekly round in it. The
 * sidebar's "This week" door keeps its own question ("is there more than one
 * round to show a week of?"), which is a door and not a ruling about golf.
 */
export function tournamentFamily(f: Pick<TournamentFacts, "shape" | "rounds" | "bracketMode" | "league">): Family {
  const types = f.rounds.map((r) => r.type);
  if (f.shape === "match") return "casual";
  if (types.includes("Team Session")) return "teamCup";
  if (f.league && types.some(isWeekly)) return "league";
  if (hasKnockoutStage(f.rounds)) return f.bracketMode === "flights" ? "flightedKnockout" : "knockout";
  if (types.includes("Round Robin")) return "roundRobinFlights";
  if (types.includes("Single Match Stage")) return "match";
  const playing = f.rounds.filter((r) => r.playing);
  if (playing.length > 0 && playing.every((r) => r.stableford)) return "stableford";
  return "stroke";
}

/** Players a family needs before there is anything to play (Golf Pro, 8.2). */
function minimumField(family: Family): number {
  return family === "match" || family === "knockout" || family === "flightedKnockout" ? 2 : 1;
}

/** "Round 1, Round 2 and Round 3". */
function andList(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "1 player is" / "3 players are". */
function playersAre(n: number): string {
  return n === 1 ? "1 player is" : `${n} players are`;
}

/**
 * A DRAW, AS THE MACHINE COUNTS IT — from the view `bracketDraws` hands over.
 *
 * Decided is the bracket's own champion (a winner recorded in its Final).
 * Entrants are counted so a draw of ONE is not waited on for ever: the bracket
 * never crowns a champion of a final nobody played (`matrix.test.ts`), so the
 * second half of a two-qualifier split would hold play over open indefinitely.
 */
export function drawFacts(d: { label: string; view: BracketView }): DrawFacts {
  const ids = new Set<string>();
  for (const r of d.view.rounds) for (const m of r.matches) for (const s of [m.a, m.b]) if (s.playerId) ids.add(s.playerId);
  return { label: d.label, entrants: ids.size, finalDecided: !!d.view.champion?.playerId };
}

/**
 * IS THIS FAMILY'S PLAY OVER (sections 2e and 8.2).
 *
 *   knockout      every draw with a tie in it has its Final decided, and the
 *                 play-off for third too when it is on (F2, F3). Never
 *                 `playOverOf`: nobody closes a Bracket Stage (D3).
 *   match         every Single Match Stage's match is over (`matchIsOver`),
 *                 closed or not; any other playing round closed.
 *   team cup      the cup is decided, or every session closed.
 *   everything    every playing round closed — `playOverOf`.
 */
function playIsOver(f: TournamentFacts, family: Family): boolean {
  // A casual round is kept or deleted, never closed or completed (`snapshotStanding`):
  // it has no window between the last card and a result to release. Found by the
  // property test (seed 1, case 5): Play over with no button to press.
  if (family === "casual") return false;
  const playing = f.rounds.filter((r) => r.playing);
  if (family === "knockout" || family === "flightedKnockout") {
    const k = f.knockout;
    if (!k) return false;
    const real = k.draws.filter((d) => d.entrants >= 2);
    if (real.length === 0) return false;
    return real.every((d) => d.finalDecided) && (!k.thirdPlace.on || k.thirdPlace.decided);
  }
  if (playing.length === 0) return false;
  if (family === "teamCup") return f.cupDecided === true || playing.every((r) => r.closed);
  if (family === "match") {
    return playing.every((r) =>
      r.type === "Single Match Stage" ? r.closed || (r.matches > 0 && r.matchesOver === r.matches) : r.closed,
    );
  }
  return playing.every((r) => r.closed);
}

/** The second line under "Play over": what ended play, and that results are not out. */
function playOverWords(f: TournamentFacts, family: Family): string {
  const tail = " · results not released";
  if (family === "knockout" || family === "flightedKnockout") {
    const n = f.knockout?.draws.filter((d) => d.entrants >= 2).length ?? 0;
    return `${n === 1 ? "Final decided" : "Every final decided"}${tail}`;
  }
  if (family === "teamCup") return `${f.cupDecided ? "Cup decided" : "Every session closed"}${tail}`;
  if (family === "match") return `Every match over${tail}`;
  return `Every round closed${tail}`;
}

/**
 * The part of the facts a tournament being SET UP is judged on — everything
 * but the day and the three facts only a live tournament's whole state knows.
 * The setup rail and the launch gate read this much (PR 2), on every set-up
 * screen, without paying for the rest.
 */
export type SetupSideFacts = Omit<TournamentFacts, "today" | "knockout" | "cupDecided" | "review">;

/**
 * THE FACTS THE SETUP FLOW TAKES — the same values, so its steps are its own.
 *
 * Since PR 2 this is the ONLY builder of `SetupFacts`: `setupFlowFor` and
 * `launchCheckFor` (services/setup-flow.ts) read the tournament through
 * `tournamentFactsFor`'s batch and come here, where they had a read of their
 * own (`the-setup-flow-reads-the-facts.audit.test.ts` held every answer across
 * the switch).
 */
export function setupFactsOf(f: SetupSideFacts): SetupFacts {
  const playing = f.rounds.filter((r) => r.playing);
  return {
    confirmed: f.confirmed,
    rounds: f.rounds.map((r) => ({
      label: r.label,
      drawsPairings: r.drawsPairings,
      scheduled: r.scheduled,
      scorable: r.scorable,
      cutFed: r.cutFed,
      matches: r.matches,
      ...(r.teeSheetSaved === null ? {} : { teeSheetSaved: r.teeSheetSaved }),
    })),
    groups: f.groups,
    named: f.named,
    dated: f.dated,
    venued: f.venued,
    playingRounds: playing.length,
    missingCards: f.missingCards,
    unratedTees: f.unratedTees ?? null,
    straightKnockout: isStraightKnockout(f.rounds),
    moneyAnswered: f.moneyAnswered,
    launched: isLaunched(f.status),
    teams: f.teams,
    ...(f.cup ? { cup: f.cup } : {}),
  };
}

/** The next week nobody has played or closed — a league's one round that must be dated. */
function nextUnplayedWeek(f: TournamentFacts): RoundFacts | null {
  return f.rounds.find((r) => r.playing && isWeekly(r.type) && !r.closed && !r.hasResult) ?? null;
}

/**
 * A ROUND WHOSE PAIRINGS ARE OWED — one rule for the launch gate's "no
 * pairings" hold, the live tournament's "Generate Round N pairings" and the
 * round's own need (J16). Before launch: a round that draws pairings, is not
 * fed by a cut (its field is not known yet) and has no matches. Once live: the
 * same, open, and a cut-fed round once the round before it is closed.
 */
function owesDraw(f: TournamentFacts, i: number, launched: boolean): boolean {
  const r = f.rounds[i];
  if (!r.drawsPairings || r.matches > 0) return false;
  if (!launched) return !r.cutFed;
  return r.playing && !r.closed && (!r.cutFed || (i > 0 && f.rounds[i - 1].closed));
}

/** A single match not made yet — a match's own hold (Golf Pro, 8.2). */
function matchNotMade(f: TournamentFacts, family: Family): RoundFacts | null {
  if (family !== "match") return null;
  const first = f.rounds.find((r) => r.playing);
  return first && first.type === "Single Match Stage" && first.matches === 0 ? first : null;
}

/** What each playing round still needs — see `RoundNeed`. */
function roundNeedsOf(f: TournamentFacts, family: Family, launched: boolean): Map<string, RoundNeed[]> {
  const out = new Map<string, RoundNeed[]>();
  const week = family === "league" ? nextUnplayedWeek(f) : null;
  const unmade = matchNotMade(f, family);
  f.rounds.forEach((r, i) => {
    if (!r.playing) return;
    const needs: RoundNeed[] = [];
    out.set(r.id, needs);
    if (r.closed || r.hasResult) return;
    const holds = !launched;
    const card = f.missingCards.find((c) => c.stageId === r.id);
    if (card) {
      needs.push(
        card.course
          ? { key: "card", missing: "has no course card", consequence: "its cards cannot be scored", holds, fix: "round" }
          : { key: "course", missing: "has no course", consequence: "its cards cannot be scored", holds, fix: "round" },
      );
    }
    if (!r.scorable) {
      needs.push({ key: "format", missing: "cannot be scored in the format it is set to", consequence: "its results cannot be worked out", holds, fix: "round" });
    }
    if (!r.scheduled) {
      if (family === "league") {
        // J08: only the next unplayed week needs a day; the later ones are the dialog's one warning.
        if (week?.id === r.id) {
          needs.push({ key: "date", missing: "has no day and no deadline", consequence: "nobody knows when to play it", holds, fix: "round" });
        }
      } else if (f.rounds.length > 1) {
        needs.push({ key: "date", missing: "has no date", consequence: "players cannot see when they play", holds: false, fix: "round" });
      }
    }
    if (owesDraw(f, i, launched)) {
      needs.push({ key: "draw", missing: "has no pairings", consequence: "there are no matches to play", holds, fix: "round" });
    } else if (unmade?.id === r.id) {
      needs.push({ key: "draw", missing: "has no match made yet", consequence: "there is nothing to score", holds, fix: "round" });
    }
    if (r.teeSheetSaved === false && f.confirmed > 0) {
      needs.push({ key: "teeSheet", missing: "has no tee times", consequence: "players cannot see when they start", holds: false, fix: "tee-sheet" });
    }
  });
  return out;
}

interface Hold {
  href: string;
  refusal: string;
}

/**
 * WHAT HOLDS LAUNCH BEYOND TODAY'S GATE — the Golf Pro's "changes from today"
 * (panel 8.2), each with its refusal. Today's own refusals come first and in
 * today's words, through `setupFlow(...).launch`.
 */
function familyHolds(f: TournamentFacts, family: Family): Hold[] {
  const holds: Hold[] = [];
  const min = minimumField(family);
  if (f.confirmed >= 1 && f.confirmed < min) {
    holds.push({
      href: "/registration",
      refusal:
        family === "match"
          ? "A match needs two players, and only one is entered. Add the other on Entries, then launch."
          : "A knockout needs at least two players, and only one is entered. Add more on Entries, then launch.",
    });
  }
  const unmade = matchNotMade(f, family);
  if (unmade) {
    holds.push({
      href: "/stages",
      refusal: `${unmade.label || "The match"} has no match made yet, so there is nothing to score. Make it on Rounds & formats, then launch.`,
    });
  }
  if (family === "league") {
    const week = nextUnplayedWeek(f);
    if (week && !week.scheduled) {
      holds.push({
        href: "/stages",
        refusal: `${week.label || "The next week"} has no day and no deadline, so nobody knows when to play it. Give it one on Rounds & formats, then launch.`,
      });
    }
  }
  if (f.cup && f.cup.flights === 2 && f.cup.unplaced > 0) {
    holds.push({
      href: "/cup",
      refusal: `${playersAre(f.cup.unplaced)} not on a team, so they cannot be picked for a session. Put them on one on Team cup, then launch.`,
    });
  }
  if (f.teams.needed && !f.cup && f.teams.sides > 0 && f.teams.unsided > 0) {
    holds.push({
      href: "/teams",
      refusal: `${playersAre(f.teams.unsided)} not on a side, so their team rounds cannot be scored. Put them on one on Teams & pairs, then launch.`,
    });
  }
  if (family === "roundRobinFlights") {
    if (f.groups === 0) {
      holds.push({
        href: "/grouping",
        refusal: "A round robin is played in flights, and none are made yet. Make them on Flights, then launch.",
      });
    } else if (f.unplacedInFlights > 0) {
      holds.push({
        href: "/grouping",
        refusal: `${playersAre(f.unplacedInFlights)} in no flight, so they have no matches. Put them in one on Flights, then launch.`,
      });
    }
  }
  return holds;
}

/**
 * THE STEPS, RE-JUDGED BY FAMILY — `setupFlow`'s steps, with `done` and
 * `holds` set by the panel's table (8.2). Two re-judgements are the fixes the
 * proposal names: the details step needs the DATE the launch gate needs (D4),
 * and flights are optional for a medal and a Stableford (D1). A single match
 * is not shown Flights at all (8.2: "Not shown"), where today it is held on
 * "No flights yet" (D1c).
 */
function judgedSteps(f: TournamentFacts, family: Family, flow: SetupFlow | null, holds: Hold[]): StatusStep[] {
  if (!flow) return [];
  const playing = f.rounds.filter((r) => r.playing);
  const extra = (href: string) => holds.some((h) => h.href === href);
  const undrawn = f.rounds.some((_, i) => owesDraw(f, i, false));
  const stepHolds: Record<string, boolean> = {
    event: !f.dated,
    stages:
      playing.length < 1 || f.rounds.some((r) => !r.scorable) || f.missingCards.length > 0 || extra("/stages"),
    registration: f.confirmed < 1 || extra("/registration"),
    cup: !!f.cup && f.cup.flights !== 2,
    teams: f.teams.needed && !f.cup && f.teams.sides === 0,
    grouping: undrawn || extra("/grouping"),
    money: false,
  };
  const shown = flow.steps.filter((s) => !(family === "match" && s.key === "grouping"));
  return shown.map((s) => {
    const holdsNow = (stepHolds[s.key] ?? false) || extra(s.href);
    let done = s.done;
    let missing = s.missing;
    if (s.key === "event") {
      // D4: the details step asks for the DATES the launch gate asks for — a
      // venue alone no longer ticks it while Launch refuses "no dates".
      done = f.named && f.dated;
      missing = !f.dated ? "It needs its dates — mark them tentative if they are not fixed." : s.missing;
    } else if (s.key === "stages") {
      /**
       * J08: A LEAGUE NEEDS ONLY ITS NEXT WEEK DATED (Golf Pro Q4). Inter-club
       * weeks are arranged within a window, so a day or a deadline for the
       * next unplayed week is a complete answer; later weeks are warned in the
       * launch dialog and, once live, offered as the next action ("Set Week
       * 3's day"). Every other family keeps "every round has a day or a
       * deadline": a 36-hole championship with an undated Round 2 is not set up.
       */
      done =
        !holdsNow && (family === "league" || f.rounds.length === 1 || f.rounds.every((r) => r.scheduled));
      if (holdsNow && f.missingCards.length > 0 && playing.length > 0 && f.rounds.every((r) => r.scorable)) {
        missing = `${andList(f.missingCards.map((c) => c.label))} ${f.missingCards.length === 1 ? "has" : "have"} no course card to score against.`;
      } else if (holdsNow && family === "league") {
        const week = nextUnplayedWeek(f);
        if (week && !week.scheduled && f.rounds.every((r) => r.scorable) && f.missingCards.length === 0) {
          missing = `${week.label || "The next week"} has no day and no deadline — only the next week needs one.`;
        }
      }
    } else if (s.key === "grouping") {
      done = !holdsNow && f.groups > 0 && f.unplacedInFlights === 0;
      if (!holdsNow && f.groups === 0) missing = "Optional — one field.";
      else if (!holdsNow && f.unplacedInFlights > 0) missing = `${playersAre(f.unplacedInFlights)} in no flight.`;
    } else {
      done = !holdsNow && s.done;
    }
    // A step that holds launch is never done.
    if (holdsNow) done = false;
    return { key: s.key, href: s.href, label: s.label, question: s.question, missing, done, holds: holdsNow, optional: !done && !holdsNow };
  });
}

/** A league's playing weeks after the next unplayed one that have neither a day nor a deadline (J08). */
function laterUndatedWeeks(f: TournamentFacts): RoundFacts[] {
  const next = nextUnplayedWeek(f);
  if (!next) return [];
  return f.rounds.filter((r) => r.playing && isWeekly(r.type) && r.position > next.position && !r.scheduled && !r.closed && !r.hasResult);
}

const DASHBOARD = "/dashboard";
const SCORE_ENTRY = "/entry";

/** The scopes today's blanket lock covers (`assertUnlocked` and its kin). Money and the tee sheet it never did. */
const BLANKET: readonly LockScope[] = ["details", "rounds", "field", "flights", "draw", "sides", "cup"];

function lock(by: LockBy, because: string, wayOut: WayOut): Lock {
  return { locked: true, by, because, wayOut, correctable: by === "launch" || by === "draw" };
}

/**
 * THE LOCKS, PER SCOPE, as today's four locks set them — PR 1 changes no lock
 * (the upstream-change rules are PR 7, the scoped locks PR 5). What it adds is
 * the scope, the reason in words and the way out.
 */
function locksOf(f: TournamentFacts, family: Family): Record<LockScope, Lock> {
  const open: Lock = { locked: false };
  const out = Object.fromEntries(LOCK_SCOPES.map((s) => [s, open])) as Record<LockScope, Lock>;
  const finished = isFinished(f.status);
  // The shared predicate, not a second spelling of it (one-definition-of-launched.test.ts).
  const blanket = configurationLocked(f);
  for (const scope of BLANKET) {
    if (!blanket) continue;
    out[scope] = finished
      ? lock("completed", "Locked because the tournament is completed.", { says: "Reopen it on the dashboard", href: DASHBOARD })
      : lock("launch", "Locked because the tournament is live.", { says: "Unlock it on the dashboard", href: DASHBOARD });
  }
  // The confirmed draw — `movePlayerToGroup`'s second lock, asked after the first.
  if (!out.flights.locked && f.flightsConfirmed) {
    out.flights = lock("draw", "Locked because the draw is confirmed.", { says: "Reopen the draw on Flights", href: "/grouping" });
  }
  /**
   * A knockout in flights: the division IS the draw. It stays open after launch
   * and closes at the first result (`flightsOpenForChange`; knockouts doc; J07).
   */
  if (family === "flightedKnockout") {
    const results = f.rounds.some((r) => isKnockoutRound(r.type) && r.hasResult);
    out.draw = finished
      ? lock("completed", "Locked because the tournament is completed.", { says: "Reopen it on the dashboard", href: DASHBOARD })
      : results
        ? lock("results", "Locked because this knockout has results.", { says: "Clear the results on the Bracket", href: "/bracket" })
        : open;
  }
  if (f.correction && out[f.correction.scope].locked) {
    const l = out[f.correction.scope];
    if (l.locked && l.correctable) out[f.correction.scope] = open;
  }
  return out;
}

/**
 * Where a refusal to complete is put right. Every one of them — a dispute, a
 * card awaiting sign-off, nothing scored — is settled on Score entry.
 */
const COMPLETE_WAY_OUT: WayOut = { says: "Open Score entry", href: SCORE_ENTRY };

/*
 * THE REFUSALS THE ACTIONS RETURN (PR 4), in the app's voice: what is wrong,
 * then what to do. No button shows them — the button for a launched
 * tournament is never Launch — but the actions now return them to a second
 * tab, a double press or a caller that is not a screen.
 */
export const ALREADY_LAUNCHED = "This tournament has already been launched, so there is nothing to launch.";
export const ALREADY_COMPLETED = "This tournament is already completed. To change a result, reopen it on the dashboard.";
export const NOT_LAUNCHED_TO_COMPLETE = "This tournament hasn’t been launched yet, so there is nothing to complete. Launch it from the dashboard first.";
export const NOT_COMPLETED_TO_REOPEN = "This tournament isn’t completed, so there is nothing to reopen.";
/** The launch dialog's warning for a tournament whose last day has gone by unlaunched — and the Tournaments list's word (PR 6). */
export const DATES_PASSED_UNLAUNCHED = "Its dates have passed and it was never launched.";

export function tournamentStatus(f: TournamentFacts): TournamentStatus {
  const family = tournamentFamily(f);
  const launched = isLaunched(f.status);
  const finished = isFinished(f.status);
  const anyResult = f.rounds.some((r) => r.hasResult);
  const underWayUnlaunched = !launched && anyResult;
  const over = launched && !finished && playIsOver(f, family);
  const step: Step = finished ? "completed" : over ? "play-over" : launched ? "live" : "setting-up";

  /* setup */
  // A casual round has no setup at all: it is created live, in one step (match-setup.ts).
  const flow = family === "casual" ? null : setupFlow(setupFactsOf(f), (h) => screenName(h));
  const holds = launched ? [] : familyHolds(f, family);
  const steps = judgedSteps(f, family, flow, holds);
  const todayLaunch = flow?.launch ?? null;
  const current = launched ? null : (steps.find((s) => s.holds) ?? null);
  // Today's gate first, in today's words; then the panel's new holds, the one on the current step first.
  const refusalLaunch = launched
    ? ALREADY_LAUNCHED
    : (todayLaunch?.refusal ?? holds.find((h) => h.href === current?.href)?.refusal ?? holds[0]?.refusal ?? null);

  /* refusals */
  const completing =
    step === "live" || step === "play-over"
      ? completingCheckFor(
          f.rounds.map((r) => ({ id: r.id, type: r.type, position: r.position, closedAt: r.closed ? "closed" : null })),
          new Set(f.rounds.filter((r) => r.hasResult).map((r) => r.id)),
        )
      : null;
  const refusalComplete = finished
    ? ALREADY_COMPLETED
    : !launched
      ? NOT_LAUNCHED_TO_COMPLETE
      : (finishRefusal({ pendingConfirmations: f.review.pendingConfirmations, disputed: f.review.disputed }) ??
        (completing && "refuse" in completing ? completing.refuse : null));
  const refusals = {
    launch: refusalLaunch,
    play: playRefusalOf(f),
    complete: refusalComplete,
    reopen: finished ? null : NOT_COMPLETED_TO_REOPEN,
  };

  /* the one next action */
  let nextAction: NextAction | null = null;
  if (family !== "casual") {
    if (step === "completed") {
      nextAction = { kind: "reopen", label: "Reopen tournament", href: DASHBOARD, roundId: null, enabled: true, disabledBecause: null, wayOut: null, asks: null };
    } else if (step === "setting-up") {
      const enabled = refusals.launch === null;
      nextAction = {
        kind: "launch",
        // A control is not renamed by the state it is pressed in (PM/UX ruling, PR 3): the button is
        // "Launch tournament" whether or not results are in. "It's being played" is said by the
        // chip ("Setting up · results in") and the card's notice (`underWay`), never by the button.
        label: "Launch tournament",
        href: DASHBOARD,
        roundId: null,
        enabled,
        disabledBecause: enabled ? null : refusals.launch,
        wayOut: enabled ? null : current ? { says: `Open ${current.label}`, href: current.href } : { says: "Open the dashboard", href: DASHBOARD },
        asks: null,
      };
    } else {
      const owedDraw =
        step === "live"
          ? f.rounds.find((_, i) => owesDraw(f, i, true))
          : undefined;
      const week = step === "live" && family === "league" ? nextUnplayedWeek(f) : null;
      if (owedDraw) {
        nextAction = {
          kind: "draw",
          label: `Generate ${owedDraw.label || "the next round's"} pairings`,
          href: "/stages",
          roundId: owedDraw.id,
          enabled: true,
          disabledBecause: null,
          wayOut: null,
          asks: null,
        };
      } else if (week && !week.scheduled) {
        nextAction = { kind: "schedule", label: `Set ${week.label || "the next week"}’s day`, href: "/stages", roundId: week.id, enabled: true, disabledBecause: null, wayOut: null, asks: null };
      } else {
        const enabled = refusals.complete === null;
        nextAction = {
          kind: "complete",
          label: "Complete tournament",
          href: DASHBOARD,
          roundId: null,
          enabled,
          disabledBecause: enabled ? null : refusals.complete,
          wayOut: enabled ? null : COMPLETE_WAY_OUT,
          asks: completing && "ask" in completing ? completing.ask : null,
        };
      }
    }
  }

  /* warnings: what is open and does not hold */
  const warnings: StatusWarning[] = [];
  if (!launched && todayLaunch) {
    for (const w of todayLaunch.warnings) {
      // A hold is a refusal, not a warning; and a step not shown warns about nothing.
      if (steps.some((s) => s.holds && s.href === w.href)) continue;
      if (w.href !== "/foursomes" && !steps.some((s) => s.href === w.href)) continue;
      if (family === "league" && w.href === "/stages") {
        // J08: the later weeks, by name — never "some rounds", and never a hold.
        const later = laterUndatedWeeks(f);
        if (later.length === 0) continue;
        warnings.push({
          says: `${andList(later.map((r) => r.label || "A week"))} ${later.length === 1 ? "has" : "have"} no day or deadline yet. Only the next week needs one now; give the others theirs as the season goes.`,
          fix: w.fix,
          href: w.href,
          screen: w.screen,
          afterLaunch: w.afterLaunch,
        });
        continue;
      }
      warnings.push({ says: w.says, fix: w.fix, href: w.href, screen: w.screen, afterLaunch: w.afterLaunch });
    }
    if ((family === "stroke" || family === "stableford") && f.groups > 0 && f.unplacedInFlights > 0) {
      warnings.push({
        says: `${playersAre(f.unplacedInFlights)} in the field but in no flight.`,
        fix: `Put them in one on ${screenName("/grouping")}`,
        href: "/grouping",
        screen: screenName("/grouping"),
        afterLaunch: "unlock",
      });
    }
  }
  const last = f.endOn || f.startOn;
  if (!launched && /^\d{4}-\d{2}-\d{2}$/.test(last) && last < f.today) {
    warnings.push({
      says: DATES_PASSED_UNLAUNCHED,
      fix: `Launch it or change its dates on ${screenName("/event")}`,
      href: "/event",
      screen: screenName("/event"),
      afterLaunch: "open",
    });
  }

  // A completed tournament needs nothing of its rounds: completing closed what was unplayed.
  const needsByRound = finished ? new Map<string, RoundNeed[]>() : roundNeedsOf(f, family, launched);

  const chip =
    step === "setting-up"
      ? `Setting up${underWayUnlaunched ? " · results in" : ""}`
      : step === "live"
        ? `Live${f.playSuspended ? " · Suspended" : ""}`
        : step === "play-over"
          ? "Play over"
          : "Completed";

  return {
    family,
    step,
    chip,
    chipDetail: step === "play-over" ? playOverWords(f, family) : "",
    underWayUnlaunched,
    journey: finished ? "results" : launched || anyResult ? "play" : current === null ? "launch" : "setup",
    setup: { steps, done: steps.filter((s) => s.done).length, of: steps.length, current },
    rounds: f.rounds
      .filter((r) => r.playing)
      .map((r) => ({
        id: r.id,
        label: r.label,
        state: r.closed ? "closed" : r.hasResult ? "under-way" : "not-started",
        needs: needsByRound.get(r.id) ?? [],
      })),
    nextAction,
    locks: locksOf(f, family),
    refusals,
    asks: { complete: refusals.complete === null && completing && "ask" in completing ? completing.ask : null },
    warnings,
  };
}

/* ------------------------------------------- what the actions ask (PR 4) */

/**
 * MAY A SCORE BE ENTERED — the machine's play refusal, for the eight doors into
 * scoring (PR 4). `playRefusal` holds the rule (no play before launch, unless
 * play has already begun); what it is told is THE ONE DEFINITION of "has
 * anybody played": a round's `hasResult`. `playRefusalFor` counted its own four
 * tables instead, and differed from it on a forfeit, a match card and a
 * winner recorded with no knockout round (D2). Retired in PR 4.
 *
 * Only `status` and the rounds are asked, so a caller on a hot path may hand
 * it a launched tournament with no rounds read: once launched, play is never
 * refused, whatever the rounds hold.
 */
export function playRefusalOf(f: Pick<TournamentFacts, "status" | "rounds">): string | null {
  return playRefusal({ status: f.status, anyResult: f.rounds.some((r) => r.hasResult) });
}

/** What a request to move a tournament's status is, asked of the machine (`setEventStatus`, PR 4). */
export type StatusRequest =
  | { kind: "launch" }
  | { kind: "complete"; asks: string | null }
  | { kind: "reopen" }
  | { kind: "refuse"; error: string };

/**
 * A STATUS IS MOVED, NOT SET — and the machine says whether this move may be
 * made. `statusMove` keeps the vocabulary (an unknown word is refused, a
 * launched tournament never goes back to setting up, there is one Setting up
 * step); everything past that is the machine's refusal for the move asked:
 * going live is Launch (`refusals.launch`), completing is Complete
 * (`refusals.complete`, and its question), and "live" on a launched tournament
 * is Reopen (`refusals.reopen`).
 *
 * So a draft can no longer be completed by this door, nor a completed
 * tournament completed twice: the dashboard never offered either, and the
 * action is a public endpoint.
 */
export function statusRequestOf(st: TournamentStatus, from: string, to: string): StatusRequest {
  const move = statusMove(from, to);
  if (move.kind === "refuse") return move;
  if (move.kind === "launch") return st.refusals.launch ? { kind: "refuse", error: st.refusals.launch } : { kind: "launch" };
  if (to === "completed") {
    return st.refusals.complete ? { kind: "refuse", error: st.refusals.complete } : { kind: "complete", asks: st.asks.complete };
  }
  return st.refusals.reopen ? { kind: "refuse", error: st.refusals.reopen } : { kind: "reopen" };
}

/** One round, as closing it is judged (`roundCloseCheck`). */
export interface RoundCloseFacts {
  /** "Round 2", or the round's own description. */
  label: string;
  /**
   * The field's players whose card in this round has scores on it and is not
   * yet final (`cardIsFinal`): not signed by the player, or — where the
   * committee accepts cards — not yet accepted. By name, in card order.
   */
  unsigned: readonly string[];
  /**
   * The committee accepts cards (`!allowsAutoConfirm`): a card waits on its
   * APPROVAL. Otherwise players sign, and it waits on a SIGNATURE. Said in
   * those words, as `cutBlockedSentence` says them.
   */
  staffApproves: boolean;
  /** Cards and match results in this round somebody has said are wrong. */
  disputed: number;
}

/** "Ann Lee’s", "Ann Lee’s and Bo Park’s", "Ann Lee’s, Bo Park’s and Cy Ode’s". */
function possessives(names: readonly string[]): string {
  return andList(names.map((n) => `${n}’s`));
}

/**
 * CLOSING A ROUND WITH CARDS OUTSTANDING (panel 8.1, TD Q4; PR 4).
 *
 *   disputed   REFUSED until the committee rules on it. A doubt about a score
 *              is the Committee's to decide (Rule 20.1c(4), Rule 20.2b);
 *              closing over it fixes a contested score into the round and
 *              turns on Play over with a result that is not final.
 *   unsigned   ASKED, naming who. A card not certified is the player's breach
 *              of Rule 3.3b(2), whose penalty — disqualification — is the
 *              COMMITTEE's to decide, not the app's: so the app asks rather
 *              than refuses, and the committee may close and chase the card.
 *
 * WHAT CLOSING DOES TO THAT CARD, said truly: nothing. The board does not
 * filter a card by its status, so an unapproved or unsigned card already
 * counts, and it can still be approved (`approveScorecard`) or signed
 * (`certifyPlayCard`) after the round is closed. The question says so in the
 * club's own terms — approved where the committee accepts cards, signed where
 * players do.
 *
 * Asked after the cut's own refusal (`strokeCutRefusal`), which stays: a round
 * a cut is made from waits for every card to be final, because closing it IS
 * making the cut.
 */
export function roundCloseCheck(r: RoundCloseFacts): { refuse: string } | { ask: string } | null {
  if (r.disputed > 0) {
    const one = r.disputed === 1;
    return {
      refuse: `${r.disputed} result${one ? "" : "s"} in ${r.label} ${one ? "is" : "are"} disputed, so the round can’t be closed yet. Settle ${one ? "it" : "them"} on Score entry, then close the round.`,
    };
  }
  const n = r.unsigned.length;
  if (n === 0) return null;
  const one = n === 1;
  const who = n <= 3 ? `${possessives(r.unsigned)} ${one ? "card isn’t" : "cards aren’t"}` : `${n} cards aren’t`;
  const after = r.staffApproves
    ? `You can still approve ${one ? "it" : "them"} afterwards.`
    : `${one ? "It" : "They"} can still be signed afterwards.`;
  return { ask: `${who} ${r.staffApproves ? "approved" : "signed"} yet. Close ${r.label} anyway? ${after}` };
}

/* ---------------------------------------------- what the screens draw (PR 3) */

/**
 * THE CHIP'S TONE, per step — one table, so the context bar and the dashboard's
 * status card cannot colour the same step two ways. "Play over" takes the
 * accent: it is the one step that is waiting on the organizer.
 */
export const STEP_TAG: Record<Step, string> = {
  "setting-up": "tag-neutral",
  live: "tag-accent-2",
  "play-over": "tag-accent",
  completed: "tag-neutral",
};

/**
 * THE SETUP RAIL, AS THE MACHINE SEES IT (PR 3) — the rail, its footer, the
 * journey card and the checklist all draw this, so a step cannot be "still to
 * do" on one of them while Launch is allowed on another (D1, D4).
 *
 * The guide's current step is the machine's: the first step that HOLDS
 * launch. A step that is open and holds nothing — a medal's flights, the money
 * answer, a second round's day — is `optional`: shown unticked, in its own
 * words, and never where the guide points. So `complete` is exactly "nothing
 * holds launch", which is what the panel ruled (8.2): optional steps never
 * hold the guide open.
 */
export function flowFromStatus(st: TournamentStatus, launched: boolean): SetupFlow | null {
  if (st.family === "casual") return null;
  const current = st.setup.current;
  const steps: SetupStep[] = st.setup.steps.map((s) => ({
    key: s.key,
    href: s.href,
    label: s.label,
    question: s.question,
    missing: s.missing,
    done: s.done,
    optional: s.optional,
    state: s.done ? "done" : current && s.key === current.key ? "current" : "todo",
  }));
  const complete = current === null;
  const readyToLaunch = complete && !launched;
  return {
    steps,
    current: current ? (steps.find((s) => s.key === current.key) ?? null) : null,
    doneCount: st.setup.done,
    complete,
    readyToLaunch,
    launched,
    launchBlocked: readyToLaunch ? st.refusals.launch : null,
    launch: launchDialogOf(st, launched),
  };
}

/**
 * WHAT THE LAUNCH DIALOG SAYS — the machine's refusal and its warnings, and the
 * rail's own count of what is open. Built from the status, so the dialog, the
 * button and the rail are one verdict.
 */
export function launchDialogOf(st: TournamentStatus, launched: boolean): LaunchCheck {
  return {
    refusal: launched ? null : st.refusals.launch,
    warnings: st.warnings.map((w) => ({ says: w.says, fix: w.fix, href: w.href, screen: w.screen, afterLaunch: w.afterLaunch })),
    stepsOpen: st.setup.steps.filter((s) => !s.done).length,
    steps: st.setup.of,
  };
}

/**
 * THE RAIL FOR A SET-UP SCREEN, from the setup side of the facts alone.
 *
 * The rail, its footer and the setup checklist ask only setup questions, so
 * they do not pay for the three facts a live tournament's whole state knows (a
 * knockout's draws, a cup's verdict, the review queue) — those decide play
 * over and Complete, which nothing here returns. "Today" is not asked either:
 * it only dates the "its dates have passed" warning, which the dashboard's
 * launch dialog says from the whole status.
 */
export function setupFlowOf(f: SetupSideFacts): SetupFlow | null {
  const st = tournamentStatus({ ...f, today: "", knockout: null, cupDecided: null, review: { pendingConfirmations: 0, disputed: 0 } });
  return flowFromStatus(st, isLaunched(f.status));
}

/**
 * WHAT THE DASHBOARD'S STATUS CARD DRAWS (`LifecycleBar`), as plain values a
 * client component can be handed: the chip and its tone, the lock, the one
 * next action with its refusal and way out, and the results-before-launch
 * notice. One builder, so the card cannot pick a second answer to any of them.
 */
export interface StatusCard {
  step: Step;
  /** "Setting up", "Setting up · results in", "Live · Suspended", "Play over", "Completed". */
  chip: string;
  /** The tone — `STEP_TAG[step]`. */
  tag: string;
  /** Under "Play over": what ended play, and that results are not released. */
  chipDetail: string;
  /** The blanket lock as the machine states it (`locks.details`) — scoped locks are PR 5. */
  locked: boolean;
  /** THE one button, with its refusal in place. */
  nextAction: NextAction | null;
  /** Results in on a tournament never launched (`underWayNotice`). */
  underWay: { title: string; detail: string } | null;
}

export function statusCardOf(f: TournamentFacts, st: TournamentStatus = tournamentStatus(f)): StatusCard {
  return {
    step: st.step,
    chip: st.chip,
    tag: STEP_TAG[st.step],
    chipDetail: st.chipDetail,
    locked: st.locks.details.locked,
    nextAction: st.nextAction,
    underWay: underWayNotice(f, st),
  };
}

/**
 * RESULTS ARE IN AND IT WAS NEVER LAUNCHED — the notice on the dashboard's
 * status card (it absorbs `lifecycleMismatch`'s words). Counted from each
 * round's `hasResult`, the one definition — so a knockout's recorded ties
 * count here, as they always did on the scoring gate (D2).
 */
export function underWayNotice(f: TournamentFacts, st: TournamentStatus): { title: string; detail: string } | null {
  if (!st.underWayUnlaunched) return null;
  const played = f.rounds.filter((r) => r.hasResult).map((r) => r.label || "A round");
  return {
    title: `${andList(played)} ${played.length === 1 ? "has" : "have"} results in, but this tournament hasn’t been launched`,
    detail:
      `Scoring works either way, so nothing is stuck — but ` +
      `${f.confirmed > 0 ? `the ${f.confirmed} in the field can` : "anyone in the field can"} ` +
      `already open the board and their card, on a tournament that still says it is setting up.`,
  };
}
