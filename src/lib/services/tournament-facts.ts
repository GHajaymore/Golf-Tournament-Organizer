import "server-only";
import { cache } from "react";
import { prisma } from "../db";
import { roundLabel } from "../domain/round-label";
import { roundIsScheduled, type SetupFacts } from "../domain/setup-flow";
import { roundShapeMismatch } from "../domain/round-shape";
import { isMoneyMode } from "../domain/money-mode";
import { isUnnamed } from "../domain/tournament-name";
import { isStablefordRound } from "../domain/week-basis";
import { storedMatchIsOver } from "../domain/match";
import { bracketDraws } from "../domain/my-tie";
import { isFinished, isLaunched } from "../domain/lifecycle-state";
import { roundsWithResultsFrom } from "../domain/rounds-with-results";
import {
  drawFacts,
  setupFactsOf,
  type RoundFacts,
  type SetupSideFacts,
  type TournamentFacts,
} from "../domain/tournament-status";
import { isMatch } from "../tournament-shape";
import { isAttendanceMode, tracksPerRound } from "../domain/attendance";
import { generatesPairings, isKnockoutRound, isPlayingRound } from "../stage-types";
import { TEAM_FORMAT_NAMES } from "../formats";
import { roundsMissingCards } from "./round-card-lines";
import { teesInPlayFor } from "./handicaps";
import { unratedTeesFact } from "../domain/launch-check";
import { loadEventState } from "./tournament";
import { cupBoard } from "./cup";

/**
 * THE ONE READER of a tournament's state-machine facts (proposal 3 Nov, 2a).
 *
 * Plain tables, turned into the values `tournamentStatus` reads. Every rule it
 * needs is the existing one, called: a round's label is `roundLabel`,
 * "scheduled" is `roundIsScheduled`, "scorable" is `roundShapeMismatch`, "has
 * it been played" is `roundsWithResultsFrom` (the rule `loadEventState` builds
 * `roundsWithResults` with), "over" is `storedMatchIsOver`, the draws are
 * `bracketDraws`.
 *
 * `today` IS REQUIRED and is the club's day (`clubToday(zone)`), never the
 * server's — so the compiler lists every caller the day the rule grows.
 *
 * GROUPED, SO A CLUB COSTS WHAT ONE TOURNAMENT DOES (PR 2, panel 8.5). The
 * Engineer's condition: "The secretary's home calls it per running
 * tournament. Measure on the seeded club in PR 2. If the home exceeds today's
 * time by more than 20%, use the grouped query." Measured on the seeded club
 * (36 running tournaments, `tournament-facts-cost.audit.test.ts`): one read
 * per tournament took the home to 113–128% of its time, either side of the
 * line, and added 648 queries. So the batch is written ONCE, over a LIST of
 * tournaments — every query is `eventId: { in: [...] }`, grouped here by
 * tournament — and `tournamentFactsFor` is that list of one. There is no
 * second, per-tournament spelling to drift from it; the audit holds the list's
 * answer for each tournament equal to its answer alone. Grouped, the same home
 * took 97% of its time and 88 more queries, not 648 — what is left per
 * tournament is the card check (`roundsMissingCards`), whose event read
 * Prisma batches.
 *
 * THE SETUP SIDE IS THE SETUP FLOW'S READ (PR 2). `setupFlowFor` and
 * `launchCheckFor` had a read of their own (`setupFactsFor`, eight counts and
 * a list). They now take the setup side of this batch (`setupFactsFor` below,
 * through `setupFactsOf`), request-cached, so the dashboard — which asks both —
 * reads the tournament once.
 *
 * THREE FACTS ONLY THE TOURNAMENT'S WHOLE STATE KNOWS — the review queue
 * (pending and disputed results), a knockout's draws, and a cup's verdict —
 * are read from `loadEventState` / `cupBoard`, the builders every screen
 * already asks, and ONLY while the tournament is live: they decide whether play
 * is over and whether Complete is refused, which no other step asks. A
 * knockout's draws depend on who qualified, which is the standings, so a copy
 * here would be a second spelling of the qualifier — the thing
 * `a-bracket-is-seeded-from-its-qualifier.audit.test.ts` exists to hold to one.
 * `loadEventState` is the request's cached read: on the dashboard it is
 * already built, and on the home it is built for every running tournament with
 * an open round, so the measurement found it shared, not repeated.
 */
export async function tournamentFactsFor(eventId: string, today: string): Promise<TournamentFacts | null> {
  return (await tournamentFactsForMany([eventId], today)).get(eventId) ?? null;
}

/**
 * The facts for SEVERAL tournaments, in one batch — the home's read (PR 6
 * makes it a caller). A tournament that does not exist is simply absent.
 */
export async function tournamentFactsForMany(eventIds: readonly string[], today: string): Promise<Map<string, TournamentFacts>> {
  const core = await readCore(eventIds);
  const out = new Map<string, TournamentFacts>();
  for (const [id, c] of core) {
    out.set(id, await withLiveFacts(id, c, today));
  }
  return out;
}

/* ------------------------------------------------------------- the batch */

interface Core {
  facts: SetupSideFacts;
  /** The play-off for third: on, and its match (`round: 0`, `createThirdPlaceMatch`) over. */
  thirdPlace: { on: boolean; decided: boolean };
  hasBracket: boolean;
  hasCup: boolean;
}

/** One tournament's batch, once per request — the dashboard asks the flow and the gate. */
const readOne = cache(async (eventId: string): Promise<Core | null> => (await readCore([eventId])).get(eventId) ?? null);

/**
 * THE SETUP FLOW'S FACTS — `setupFactsOf` of the batch's setup side. Null when
 * the tournament does not exist; `match` when it is a casual round, which has
 * no rail (`setupFlowFor` answers null for one).
 */
export async function setupFactsFor(eventId: string): Promise<{ facts: SetupFacts; match: boolean } | null> {
  const c = await readOne(eventId);
  if (!c) return null;
  return { facts: setupFactsOf(c.facts), match: isMatch(c.facts.shape) };
}

/**
 * THE SETUP SIDE OF THE FACTS — what a set-up screen's rail is drawn from
 * (`setupFlowOf`, PR 3). The same request-cached batch as `setupFactsFor`, so
 * a screen asking both reads the tournament once. Null when it does not exist.
 */
export async function setupSideFactsFor(eventId: string): Promise<SetupSideFacts | null> {
  return (await readOne(eventId))?.facts ?? null;
}

/** Rows grouped by tournament, in the order they came. */
function byEvent<T extends { eventId: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.eventId);
    if (list) list.push(r);
    else out.set(r.eventId, [r]);
  }
  return out;
}

/** `groupBy(eventId)` counts as a lookup; a tournament with none counts 0. */
function counts(rows: ReadonlyArray<{ eventId: string; _count: number }>): (id: string) => number {
  const m = new Map(rows.map((r) => [r.eventId, r._count]));
  return (id) => m.get(id) ?? 0;
}

async function readCore(eventIds: readonly string[]): Promise<Map<string, Core>> {
  const ids = [...new Set(eventIds)];
  const out = new Map<string, Core>();
  if (ids.length === 0) return out;
  const events = await prisma.event.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      dates: true,
      startOn: true,
      endOn: true,
      course: true,
      shape: true,
      status: true,
      configUnlocked: true,
      moneyMode: true,
      bracketMode: true,
      flightsConfirmed: true,
      playSuspendedAt: true,
      organizationId: true,
      teePolicy: true,
      defaultTeeId: true,
      courseId: true,
      courseMode: true,
      // A league by its KIND (PR 3): what it is called, its league table, its weekly sign-up.
      playKind: true,
      leaguePoints: true,
      attendanceMode: true,
    },
  });
  if (events.length === 0) return out;
  const found = events.map((e) => e.id);
  const inEvents = { eventId: { in: found } };

  const [stageRows, confirmedRows, groupRows, venueRows, orgs, sideRows, unsidedRows, unplacedRows, cardRows, teamCardRows, matchRows, matchCardRows, winnerRows, missing] =
    await Promise.all([
      /**
       * THE ROUNDS THEMSELVES, not a count of them — two steps ask a question of
       * each round ("when is it?", "has it got fixtures?"). Ordered, because
       * `roundLabel` numbers a round by where it sits among the others.
       */
      prisma.stage.findMany({
        where: inEvents,
        orderBy: { position: "asc" },
        select: {
          id: true,
          eventId: true,
          type: true,
          format: true,
          scoringBasis: true,
          position: true,
          playedOn: true,
          deadline: true,
          cutEnabled: true,
          teeSheet: true,
          closedAt: true,
          thirdPlace: true,
        },
      }),
      prisma.player.groupBy({ by: ["eventId"], where: { ...inEvents, status: "confirmed" }, _count: true }),
      /**
       * FLIGHTS, not every Group row: a match carrier is a player-less row a
       * play-off creates to hold its fixture, and counting it passed the
       * flights step on a phantom.
       */
      prisma.group.groupBy({ by: ["eventId"], where: { ...inEvents, isCarrier: false }, _count: true }),
      prisma.eventCourse.groupBy({ by: ["eventId"], where: inEvents, _count: true }),
      // The club's money answer, which the tournament inherits unless it says otherwise.
      prisma.organization.findMany({
        where: { id: { in: [...new Set(events.map((e) => e.organizationId))] } },
        select: { id: true, moneyMode: true },
      }),
      prisma.team.groupBy({ by: ["eventId"], where: inEvents, _count: true }),
      prisma.player.groupBy({ by: ["eventId"], where: { ...inEvents, status: "confirmed", teamMemberships: { none: {} } }, _count: true }),
      prisma.player.groupBy({ by: ["eventId"], where: { ...inEvents, status: "confirmed", groupId: null }, _count: true }),
      // Has a round been played: which rounds hold a card, not the cards.
      prisma.scorecard.groupBy({ by: ["eventId", "stageId"], where: inEvents }),
      prisma.teamScorecard.groupBy({ by: ["eventId", "stageId"], where: inEvents }),
      prisma.match.findMany({
        where: inEvents,
        select: { id: true, eventId: true, stageId: true, round: true, playerAId: true, playerBId: true, holes: true, forfeitedBy: true },
      }),
      prisma.matchScorecard.findMany({ where: inEvents, select: { eventId: true, matchId: true, slot: true, strokes: true } }),
      prisma.bracketWinner.groupBy({ by: ["eventId"], where: inEvents, _count: true }),
      // The launch gate's card fact, from the same reader the launch action refuses on.
      Promise.all(found.map(async (id) => [id, await roundsMissingCards(id)] as const)).then((pairs) => new Map(pairs)),
    ]);

  const stagesOf = byEvent(stageRows);
  /**
   * THE LAUNCH DIALOG'S TEE FACT (setup audit item 5): which rounds score off a
   * handicap and which tees cannot give one. Tees are read only for a
   * tournament with such a round — a gross medal needs no rating.
   */
  const roundsOf = (id: string) => {
    const all = stagesOf.get(id) ?? [];
    return all.filter((s) => isPlayingRound(s.type)).map((s) => ({ label: roundLabel(all, s.id), scoringBasis: s.scoringBasis }));
  };
  // ONE batch of tee reads for every tournament that has a round off a handicap
  // (not one query per tournament), resolved by the one tee resolver.
  const needTees = events.filter((e) => roundsOf(e.id).some((r) => r.scoringBasis !== "gross"));
  const inPlay = await teesInPlayFor(needTees);
  const unratedOf = new Map(
    needTees.map((e) => {
      const p = inPlay.get(e.id);
      return [e.id, unratedTeesFact({ rounds: roundsOf(e.id), tees: p?.tees ?? [], fixedCourse: !!p?.hasCourse && !p?.open })] as const;
    }),
  );
  const cardsOf = byEvent([...cardRows, ...teamCardRows]);
  const matchesOf = byEvent(matchRows);
  const matchCardsOf = byEvent(matchCardRows);
  const confirmedIn = counts(confirmedRows);
  const groupsIn = counts(groupRows);
  const venuesIn = counts(venueRows);
  const sidesIn = counts(sideRows);
  const unsidedIn = counts(unsidedRows);
  const unplacedIn = counts(unplacedRows);
  const winnersIn = counts(winnerRows);
  const orgMoney = new Map(orgs.map((o) => [o.id, o.moneyMode]));

  for (const event of events) {
    const id = event.id;
    const stages = stagesOf.get(id) ?? [];
    const matches = matchesOf.get(id) ?? [];
    const groups = groupsIn(id);
    const unplaced = unplacedIn(id);
    const played = roundsWithResultsFrom({
      stages,
      cards: cardsOf.get(id) ?? [],
      matchCards: matchCardsOf.get(id) ?? [],
      matches,
      bracketWinners: winnersIn(id),
    });

    const rounds: RoundFacts[] = stages.map((s) => {
      const own = matches.filter((m) => m.stageId === s.id && m.round !== 0);
      const strokeRound =
        isPlayingRound(s.type) && !generatesPairings(s.type) && !isKnockoutRound(s.type) && s.type !== "Team Session" && !s.cutEnabled;
      return {
        id: s.id,
        label: roundLabel(stages, s.id),
        type: s.type,
        format: s.format,
        position: s.position,
        playing: isPlayingRound(s.type),
        stableford: isStablefordRound(s.scoringBasis, s.format),
        scorable: roundShapeMismatch(s.type, s.format) === null,
        scheduled: roundIsScheduled(s.playedOn, s.deadline),
        drawsPairings: generatesPairings(s.type),
        cutFed: s.cutEnabled,
        matches: own.length,
        matchesOver: own.filter((m) => storedMatchIsOver(m)).length,
        // The launch dialog's own question: asked only of a round the field turns up for together.
        teeSheetSaved: strokeRound ? !!s.teeSheet.trim() : null,
        hasResult: played.has(s.id),
        closed: s.closedAt != null,
      };
    });

    const hasCup = stages.some((s) => s.type === "Team Session");
    const thirdStage = stages.find((s) => isKnockoutRound(s.type) && s.thirdPlace);
    const thirdMatch = thirdStage ? matches.find((m) => m.stageId === thirdStage.id && m.round === 0) : undefined;

    out.set(id, {
      facts: {
        status: event.status,
        legacyStatus: "",
        configUnlocked: event.configUnlocked,
        correction: null,
        shape: event.shape,
        league:
          event.playKind === "league" ||
          event.leaguePoints.trim() !== "" ||
          (isAttendanceMode(event.attendanceMode) && tracksPerRound(event.attendanceMode)),
        named: !isUnnamed(event.name),
        dated: !!event.dates.trim(),
        venued: !!event.course.trim() || venuesIn(id) > 0,
        startOn: event.startOn,
        endOn: event.endOn,
        moneyAnswered: isMoneyMode(event.moneyMode.trim()) || isMoneyMode((orgMoney.get(event.organizationId) ?? "").trim()),
        bracketMode: event.bracketMode,
        flightsConfirmed: event.flightsConfirmed,
        playSuspended: event.playSuspendedAt != null,
        confirmed: confirmedIn(id),
        groups,
        unplacedInFlights: groups > 0 ? unplaced : 0,
        teams: { needed: stages.some((s) => TEAM_FORMAT_NAMES.includes(s.format)), sides: sidesIn(id), unsided: unsidedIn(id) },
        cup: hasCup ? { flights: groups, unplaced } : null,
        rounds,
        missingCards: missing.get(id) ?? [],
        unratedTees: unratedOf.get(id) ?? null,
      },
      thirdPlace: { on: !!thirdStage, decided: !!thirdMatch && storedMatchIsOver(thirdMatch) },
      hasBracket: stages.some((s) => isKnockoutRound(s.type)),
      hasCup,
    });
  }
  return out;
}

/** The three facts only a live tournament's whole state knows — see the note on `tournamentFactsFor`. */
async function withLiveFacts(eventId: string, c: Core, today: string): Promise<TournamentFacts> {
  const live = isLaunched(c.facts.status) && !isFinished(c.facts.status);
  const state = live ? await loadEventState(eventId) : null;

  let cupDecided: boolean | null = null;
  if (c.hasCup && live) {
    const board = await cupBoard(eventId, { staff: true });
    cupDecided = board.ok ? board.board.verdict.kind !== "open" : false;
  }

  return {
    ...c.facts,
    today,
    knockout: c.hasBracket
      ? { draws: state ? bracketDraws(state.brackets).map(drawFacts) : [], thirdPlace: c.thirdPlace }
      : null,
    cupDecided,
    review: state
      ? { pendingConfirmations: state.pendingConfirmations, disputed: state.reviewing.disputed }
      : { pendingConfirmations: 0, disputed: 0 },
  };
}
