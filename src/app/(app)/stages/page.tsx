import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { loadEventState, parseMatchTiebreakers, playingStages, settingsOf } from "@/lib/services/tournament";
import { roundHandicapsFor, type RoundHandicapView } from "@/lib/services/round-handicap";
import { resolveAttendance, tracksPerRound, type AttendanceMode } from "@/lib/domain/attendance";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { entitlementForEvent } from "@/lib/services/entitlements";
import { StagesClient } from "@/components/StagesClient";
import { singleMatchFor, type SingleMatchView } from "@/lib/services/single-match";
import { resolveThirdPlace } from "@/lib/domain/third-place";
import type { ThirdPlaceView } from "@/components/StagesClient";
import { shapeOf, effectiveCapabilities } from "@/lib/tournament-shape";
import { unratedWarning } from "@/lib/services/handicaps";
import { SetupLockBanner } from "@/components/SetupLockBanner";
import { DescribeTournament } from "@/components/DescribeTournament";
import { findFormat, needsTeams, sideSizeRange } from "@/lib/formats";
import { teamEntryChoices, resolveTeamEntry, sideOnlyCost } from "@/lib/domain/team-entry";
import { effectiveAllowance, effectiveCountBest } from "@/lib/services/teams";
import type { RoundScoringInfo } from "@/components/RoundTeamScoring";

/**
 * What a team round costs its sides in strokes, or null where the question
 * doesn't arise — an individual round has no side to price.
 *
 * Each control appears only for a format that actually uses it: the split for
 * formats scored by per-player shares, the count only where separate balls
 * are aggregated. Offering either to a format that ignores it would be a
 * control with nothing behind it.
 */
function teamScoringFor(s: {
  format: string;
  handicapAllowance: number;
  allowanceWeights: number[];
  countBest: number;
  scoreInput: string;
}): RoundScoringInfo | null {
  if (!needsTeams(s.format)) return null;
  const f = findFormat(s.format);
  const declared = f.weightsBySideSize?.[f.sideSize] ?? null;
  return {
    // Whose card this round is written on. Derived from the format's `ball`
    // rather than stored, so a shared-ball round can never be offered
    // per-player entry — there was no individual ball to record.
    entryChoices: teamEntryChoices(s.format),
    entryMode: resolveTeamEntry(s.format, s.scoreInput) ?? "side-only",
    sideOnlyCost: sideOnlyCost(s.format),
    name: f.name,
    allowance: effectiveAllowance(s.format, s.handicapAllowance),
    recommendedAllowance: f.allowance,
    allowanceOverridden: s.handicapAllowance > 0,
    allowanceIsConvention: !!f.allowanceIsConvention,
    recommendedShares: declared,
    shares: s.allowanceWeights.length === f.sideSize ? s.allowanceWeights : declared,
    sharesOverridden: s.allowanceWeights.length === f.sideSize,
    countBest: f.engine === "team-aggregate" ? effectiveCountBest(s.format, s.countBest) : null,
    countBestOverridden: s.countBest > 0,
    maxSide: sideSizeRange(s.format).max,
  };
}

export default async function StagesPage() {
  const session = await requireScreen("stages");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const locked = isSetupLocked(state.event);

  // League sign-up, resolved per round for the counts on each card. Declared
  // before the map that reads them — they used to sit below it, so every
  // render of this page threw "Cannot access 'attendanceMode' before
  // initialization". Because saving a score revalidates the whole layout,
  // that turned every score entry into a 500 and nothing could be entered.
  const attendanceMode = settingsOf(state.event).attendanceMode;
  const attendanceRows = tracksPerRound(attendanceMode as AttendanceMode)
    ? await prisma.roundAttendance.findMany({ where: { eventId: session.eventId } })
    : [];

  /**
   * A resolved view per Single Match Stage.
   *
   * Only those stages — every other kind has no entry, so the picker is
   * rendered by the presence of a view rather than by a second type check
   * that could drift from this one.
   */
  const singleMatches: Record<string, SingleMatchView> = {};
  for (const s of state.stages.filter((x) => x.type === "Single Match Stage")) {
    const view = await singleMatchFor(session.eventId, s.id);
    if (view) singleMatches[s.id] = view;
  }

  /**
   * The third-place view per Bracket Stage.
   *
   * Resolved from the winners bracket as it stands, so a corrected semi-final
   * changes who would play it — the same late reading the Single Match Stage
   * uses, and for the same reason.
   */
  const thirdPlaces: Record<string, ThirdPlaceView> = {};
  for (const s of state.stages.filter((x) => x.type === "Bracket Stage")) {
    const r = resolveThirdPlace(state.brackets.winners);
    const made = await prisma.match.count({ where: { eventId: session.eventId, stageId: s.id, round: 0 } });
    thirdPlaces[s.id] = {
      on: s.thirdPlace,
      problem: r.problem,
      aName: r.pairing?.a.name ?? "",
      bName: r.pairing?.b.name ?? "",
      made: made > 0,
    };
  }

  /**
   * What each player plays off, per round.
   *
   * Only for rounds the field actually plays — a handicap is something a card
   * is priced with, and a cut or a bracket seeding round has no card. Resolved
   * on the server through the same reader the board uses, so the number an
   * organizer is shown is the number their scores are being worked out from.
   */
  const roundHandicaps: Record<string, RoundHandicapView[]> = {};
  for (const s of playingStages(state.stages)) {
    roundHandicaps[s.id] = await roundHandicapsFor(session.eventId, s.id);
  }

  const stages = state.stages.map((s) => ({
    id: s.id,
    position: s.position,
    type: s.type,
    description: s.description,
    format: s.format,
    holes: s.holes,
    playedOn: s.playedOn,
    deadline: s.deadline,
    scoringBasis: s.scoringBasis,
    // How scores are RECORDED, as opposed to how they are scored. "" means
    // the round takes whatever its format declares.
    scoreInput: s.scoreInput,
    carryEnabled: s.carryForwardEnabled,
    carryPct: s.carryForwardPct,
    carryAsked: s.carryForwardAsked,
    cutEnabled: s.cutEnabled,
    cutMode: s.cutMode,
    cutCount: s.cutCount,
    cutPercent: s.cutPercent,
    cutScope: s.cutScope,
    deadlineOverride: s.deadlineOverride,
    optDeadline: s.optDeadline,
    // What a team round costs its sides in strokes. Computed here, on the
    // round, because these are settings *of the round* — they used to sit on
    // the Teams screen behind a second round selector, so a format was chosen
    // in one place and priced in another.
    teamScoring: teamScoringFor(s),
    handicaps: roundHandicaps[s.id] ?? [],
    attendance: !tracksPerRound(attendanceMode as AttendanceMode)
      ? null
      : (() => {
            const resolved = resolveAttendance(
              attendanceMode,
              state.confirmed.map((p) => p.id),
              attendanceRows
                .filter((r) => r.stageId === s.id)
                .map((r) => ({ playerId: r.playerId, status: r.status, decidedBy: r.decidedBy })),
            );
            return { in: resolved.in, out: resolved.out, inByDefault: resolved.inByDefault };
          })(),
    matchCount: state.matches.filter((m) => m.stageId === s.id).length,
    courseId: s.courseId,
    nine: s.nine,
  }));

  // Venues this tournament may be played on — more than one turns on the
  // per-round course picker.
  const venues = await prisma.course.findMany({
    where: { events: { some: { eventId: session.eventId } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Matches per player in a round robin = (largest flight size − 1).
  const flightSizes = state.groups.map(
    (g) => state.confirmed.filter((p) => p.groupId === g.id).length,
  );
  const rrMatchesPerPlayer = Math.max(0, (flightSizes.length ? Math.max(...flightSizes) : 0) - 1);

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Set up</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Rounds &amp; formats</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Sequence the tournament — add as many rounds as you need, each feeding the next.
        </p>
      </div>
      <SetupLockBanner locked={locked} isAdmin={session.viewRole === "admin"} />
      {/* Above the builder, because it is a way IN to the builder rather than
          an alternative to it — whatever it proposes lands as ordinary rounds
          on the cards below, editable like any other. */}
      {!locked && (
        <DescribeTournament
          available={(await entitlementForEvent(session.eventId, "aiAssist")).allowed}
        />
      )}
      <StagesClient
        stages={stages}
        singleMatches={singleMatches}
        thirdPlaces={thirdPlaces}
        venues={venues}
        activeStageId={state.activeStage?.id ?? null}
        handicapWarning={await unratedWarning(session.eventId, state.stages.find((s) => s.type === "Round Robin")?.scoringBasis ?? "gross")}
        chainsRounds={
          effectiveCapabilities(shapeOf(state.event.shape), {
            roundCount: state.stages.length,
            hasBracketStage: state.stages.some((s) => s.type === "Bracket Stage"),
          }).chainsRounds
        }
        matchTiebreakers={parseMatchTiebreakers(state.event.matchTiebreakers)}
        rrMatchesPerPlayer={rrMatchesPerPlayer}
        scoring={{
          winPts: state.scoring.winPts,
          tiePts: state.scoring.tiePts,
          lossPts: state.scoring.lossPts,
          holeRatioPts: state.scoring.holeRatioPts,
          bonusPts: state.scoring.bonusPts,
          maxPerMatch: state.scoring.maxPerMatch,
        }}
        tiebreakers={state.scoring.tiebreakers}
        qual={{
          mode: state.event.qualifyMode,
          perFlight: state.event.qualifyPerGroup,
          overall: state.event.qualifyOverall,
        }}
        flightCount={state.groups.length}
        confirmedCount={state.confirmed.length}
      />
    </>
  );
}
