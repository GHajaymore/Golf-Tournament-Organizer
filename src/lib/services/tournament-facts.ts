import "server-only";
import { prisma } from "../db";
import { roundLabel } from "../domain/round-label";
import { roundIsScheduled } from "../domain/setup-flow";
import { roundShapeMismatch } from "../domain/round-shape";
import { isMoneyMode } from "../domain/money-mode";
import { isUnnamed } from "../domain/tournament-name";
import { isStablefordRound } from "../domain/week-basis";
import { matchStrokeCards } from "../domain/match-cards";
import { storedMatchIsOver } from "../domain/match";
import { bracketDraws } from "../domain/my-tie";
import { isFinished, isLaunched } from "../domain/lifecycle-state";
import { drawFacts, type RoundFacts, type TournamentFacts } from "../domain/tournament-status";
import { generatesPairings, isKnockoutRound, isPlayingRound } from "../stage-types";
import { TEAM_FORMAT_NAMES } from "../formats";
import { roundsMissingCards } from "./round-card-lines";
import { loadEventState } from "./tournament";
import { cupBoard } from "./cup";

/**
 * THE ONE READER of a tournament's state-machine facts (proposal 3 Nov, 2a).
 *
 * One round of parallel queries over the plain tables, turned into the values
 * `tournamentStatus` reads. Every rule it needs is the existing one, called:
 * a round's label is `roundLabel`, "scheduled" is `roundIsScheduled`,
 * "scorable" is `roundShapeMismatch`, a match card's round is
 * `matchStrokeCards`, "over" is `storedMatchIsOver`, the draws are
 * `bracketDraws`.
 *
 * `today` IS REQUIRED and is the club's day (`clubToday(zone)`), never the
 * server's — so the compiler lists every caller the day the rule grows.
 *
 * THREE FACTS ONLY THE TOURNAMENT'S WHOLE STATE KNOWS — the review queue
 * (pending and disputed results), a knockout's draws, and a cup's verdict —
 * are read from `loadEventState` / `cupBoard`, the builders every screen
 * already asks, and ONLY while the tournament is live: they decide whether play
 * is over and whether Complete is refused, which no other step asks. A
 * tournament being set up, or completed, costs the one batch. On the dashboard
 * `loadEventState` is the request's cached read, so it costs nothing extra;
 * PR 2 measures the secretary's home, which calls this once per running
 * tournament (panel 8.5), and a grouped query is the fallback.
 *
 * NOT SWITCHED ON: nothing calls this yet (PR 1). Its audit test holds
 * `hasResult` to `roundsWithResults`.
 */
export async function tournamentFactsFor(eventId: string, today: string): Promise<TournamentFacts | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
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
    },
  });
  if (!event) return null;

  const [stages, confirmed, groups, venues, org, sides, unsided, unplaced, cards, teamCards, matches, matchCards, winners, missingCards] =
    await Promise.all([
      prisma.stage.findMany({
        where: { eventId },
        orderBy: { position: "asc" },
        select: {
          id: true,
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
      prisma.player.count({ where: { eventId, status: "confirmed" } }),
      // Flights, not match carriers — the setup flow's own count.
      prisma.group.count({ where: { eventId, isCarrier: false } }),
      prisma.eventCourse.count({ where: { eventId } }),
      prisma.organization.findUnique({ where: { id: event.organizationId }, select: { moneyMode: true } }),
      prisma.team.count({ where: { eventId } }),
      prisma.player.count({ where: { eventId, status: "confirmed", teamMemberships: { none: {} } } }),
      prisma.player.count({ where: { eventId, status: "confirmed", groupId: null } }),
      prisma.scorecard.findMany({ where: { eventId }, select: { stageId: true } }),
      prisma.teamScorecard.findMany({ where: { eventId }, select: { stageId: true } }),
      prisma.match.findMany({
        where: { eventId },
        select: { id: true, stageId: true, round: true, playerAId: true, playerBId: true, holes: true, forfeitedBy: true },
      }),
      prisma.matchScorecard.findMany({ where: { eventId }, select: { matchId: true, slot: true, strokes: true } }),
      prisma.bracketWinner.count({ where: { eventId } }),
      roundsMissingCards(eventId),
    ]);

  /**
   * HAS THIS ROUND BEEN PLAYED — `roundsWithResults`' four sources, the widest
   * of today's three spellings, so `resultsIn` and `playRefusalFor` can become
   * reads of it (PR 2). A Bracket Stage's results are `BracketWinner` rows keyed
   * by slot, not by round, so any winner marks every knockout round played.
   */
  const played = new Set<string>([
    ...[...cards, ...teamCards].filter((c) => c.stageId).map((c) => c.stageId),
    ...matchStrokeCards(matchCards, matches).map((c) => c.stageId),
    ...matches.filter((m) => /[1-9AaBbHh]/.test(m.holes) || m.forfeitedBy).map((m) => m.stageId),
    ...(winners > 0 ? stages.filter((s) => isKnockoutRound(s.type)).map((s) => s.id) : []),
  ]);

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

  const live = isLaunched(event.status) && !isFinished(event.status);
  const hasBracket = stages.some((s) => isKnockoutRound(s.type));
  const hasCup = stages.some((s) => s.type === "Team Session");
  const state = live ? await loadEventState(eventId) : null;

  /** The play-off for third: a `round: 0` Match in the Bracket Stage (`createThirdPlaceMatch`). */
  const thirdStage = stages.find((s) => isKnockoutRound(s.type) && s.thirdPlace);
  const thirdMatch = thirdStage ? matches.find((m) => m.stageId === thirdStage.id && m.round === 0) : undefined;

  let cupDecided: boolean | null = null;
  if (hasCup && live) {
    const board = await cupBoard(eventId, { staff: true });
    cupDecided = board.ok ? board.board.verdict.kind !== "open" : false;
  }

  return {
    today,
    status: event.status,
    legacyStatus: "",
    configUnlocked: event.configUnlocked,
    correction: null,
    shape: event.shape,
    named: !isUnnamed(event.name),
    dated: !!event.dates.trim(),
    venued: !!event.course.trim() || venues > 0,
    startOn: event.startOn,
    endOn: event.endOn,
    moneyAnswered: isMoneyMode(event.moneyMode.trim()) || isMoneyMode((org?.moneyMode ?? "").trim()),
    bracketMode: event.bracketMode,
    flightsConfirmed: event.flightsConfirmed,
    playSuspended: event.playSuspendedAt != null,
    confirmed,
    groups,
    unplacedInFlights: groups > 0 ? unplaced : 0,
    teams: { needed: stages.some((s) => TEAM_FORMAT_NAMES.includes(s.format)), sides, unsided },
    cup: hasCup ? { flights: groups, unplaced } : null,
    rounds,
    missingCards,
    knockout: hasBracket
      ? {
          draws: state ? bracketDraws(state.brackets).map(drawFacts) : [],
          thirdPlace: { on: !!thirdStage, decided: !!thirdMatch && storedMatchIsOver(thirdMatch) },
        }
      : null,
    cupDecided,
    review: state
      ? { pendingConfirmations: state.pendingConfirmations, disputed: state.reviewing.disputed }
      : { pendingConfirmations: 0, disputed: 0 },
  };
}
