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
import { isFinished, isLaunched } from "./lifecycle-state";
import { setupFlow, type SetupFacts, type SetupFlow } from "./setup-flow";
import { completingCheckFor, finishRefusal, playRefusal } from "./phase-gate";
import type { BracketView } from "./bracket";
import { screenName } from "@/lib/nav";

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
  /** Playing rounds whose format needs a course card they lack (`roundsMissingCards`). */
  missingCards: { label: string; course: string }[];
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
}

export type NextKind = "launch" | "complete" | "reopen" | "draw" | "schedule";

export interface NextAction {
  kind: NextKind;
  label: string;
  href: string;
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
  afterLaunch: "open" | "unlock";
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
  /** Each round's own step — D8's "has this round started", answered from results only. */
  rounds: { id: string; label: string; state: "not-started" | "under-way" | "closed" }[];
  /** THE one button. Null only for a casual round, which is never on the home. */
  nextAction: NextAction | null;
  locks: Record<LockScope, Lock>;
  refusals: { launch: string | null; play: string | null; complete: string | null; reopen: string | null };
  warnings: StatusWarning[];
}

/* ------------------------------------------------------------- the rules */

const isWeekly = (t: string) => t === "Round Robin" || t === "Stroke Play Round";

/**
 * WHICH FAMILY — first match wins, in the proposal's order (section 2e).
 *
 * League is the sidebar's own test (`navForRole`'s `isLeague`: more than one
 * weekly round), so the family and the menu cannot disagree about what a
 * league is. See the report on PR 1 for what that does to a 36-hole medal.
 */
export function tournamentFamily(f: Pick<TournamentFacts, "shape" | "rounds" | "bracketMode">): Family {
  const types = f.rounds.map((r) => r.type);
  if (f.shape === "match") return "casual";
  if (types.includes("Team Session")) return "teamCup";
  if (types.filter(isWeekly).length > 1) return "league";
  if (types.includes("Bracket Stage")) return f.bracketMode === "flights" ? "flightedKnockout" : "knockout";
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

/** The facts the setup flow takes — the same values, so its steps are its own. */
function setupFactsOf(f: TournamentFacts): SetupFacts {
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
    straightKnockout: f.rounds.length > 0 && f.rounds[0].type === "Bracket Stage",
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
  if (family === "match") {
    const first = f.rounds.find((r) => r.playing);
    if (first && first.type === "Single Match Stage" && first.matches === 0) {
      holds.push({
        href: "/stages",
        refusal: `${first.label || "The match"} has no match made yet, so there is nothing to score. Make it on Rounds & formats, then launch.`,
      });
    }
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
  const undrawn = f.rounds.some((r) => r.drawsPairings && !r.cutFed && r.matches === 0);
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
      done = f.named && f.dated;
      missing = !f.dated ? "It needs its dates — mark them tentative if they are not fixed." : s.missing;
    } else if (s.key === "stages") {
      done = !holdsNow && (f.rounds.length === 1 || f.rounds.every((r) => r.scheduled));
      if (holdsNow && f.missingCards.length > 0 && playing.length > 0 && f.rounds.every((r) => r.scorable)) {
        missing = `${andList(f.missingCards.map((c) => c.label))} ${f.missingCards.length === 1 ? "has" : "have"} no course card to score against.`;
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
    return { key: s.key, href: s.href, label: s.label, question: s.question, missing, done, holds: holdsNow };
  });
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
  const blanket = isLaunched(f.status) && !f.configUnlocked;
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
    const results = f.rounds.some((r) => r.type === "Bracket Stage" && r.hasResult);
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
    ? "It has been launched already."
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
    ? "It is completed already."
    : !launched
      ? "It hasn’t been launched yet, so there is nothing to complete."
      : (finishRefusal({ pendingConfirmations: f.review.pendingConfirmations, disputed: f.review.disputed }) ??
        (completing && "refuse" in completing ? completing.refuse : null));
  const refusals = {
    launch: refusalLaunch,
    play: playRefusal({ status: f.status, anyResult }),
    complete: refusalComplete,
    reopen: finished ? null : "Only a completed tournament can be reopened.",
  };

  /* the one next action */
  let nextAction: NextAction | null = null;
  if (family !== "casual") {
    if (step === "completed") {
      nextAction = { kind: "reopen", label: "Reopen tournament", href: DASHBOARD, enabled: true, disabledBecause: null, wayOut: null, asks: null };
    } else if (step === "setting-up") {
      const enabled = refusals.launch === null;
      nextAction = {
        kind: "launch",
        label: underWayUnlaunched ? "Launch it — it’s being played" : "Launch tournament",
        href: DASHBOARD,
        enabled,
        disabledBecause: enabled ? null : refusals.launch,
        wayOut: enabled ? null : current ? { says: `Open ${current.label}`, href: current.href } : { says: "Open the dashboard", href: DASHBOARD },
        asks: null,
      };
    } else {
      const owedDraw =
        step === "live"
          ? f.rounds.find(
              (r, i) =>
                r.playing && r.drawsPairings && !r.closed && r.matches === 0 && (!r.cutFed || (i > 0 && f.rounds[i - 1].closed)),
            )
          : undefined;
      const week = step === "live" && family === "league" ? nextUnplayedWeek(f) : null;
      if (owedDraw) {
        nextAction = {
          kind: "draw",
          label: `Generate ${owedDraw.label || "the next round's"} pairings`,
          href: "/stages",
          enabled: true,
          disabledBecause: null,
          wayOut: null,
          asks: null,
        };
      } else if (week && !week.scheduled) {
        nextAction = { kind: "schedule", label: `Set ${week.label || "the next week"}’s day`, href: "/stages", enabled: true, disabledBecause: null, wayOut: null, asks: null };
      } else {
        const enabled = refusals.complete === null;
        nextAction = {
          kind: "complete",
          label: "Complete tournament",
          href: DASHBOARD,
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
      warnings.push({ says: w.says, fix: w.fix, href: w.href, afterLaunch: w.afterLaunch });
    }
    if ((family === "stroke" || family === "stableford") && f.groups > 0 && f.unplacedInFlights > 0) {
      warnings.push({
        says: `${playersAre(f.unplacedInFlights)} in the field but in no flight.`,
        fix: "Put them in one on Flights",
        href: "/grouping",
        afterLaunch: "unlock",
      });
    }
  }
  const last = f.endOn || f.startOn;
  if (!launched && /^\d{4}-\d{2}-\d{2}$/.test(last) && last < f.today) {
    warnings.push({ says: "Its dates have passed and it was never launched.", fix: "Launch it or change its dates on Tournament details", href: "/event", afterLaunch: "open" });
  }

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
      .map((r) => ({ id: r.id, label: r.label, state: r.closed ? "closed" : r.hasResult ? "under-way" : "not-started" })),
    nextAction,
    locks: locksOf(f, family),
    refusals,
    warnings,
  };
}
