import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { loadEventState, parseMatchTiebreakers, settingsOf } from "@/lib/services/tournament";
import { resolveAttendance } from "@/lib/domain/attendance";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { StagesClient } from "@/components/StagesClient";
import { shapeOf, effectiveCapabilities } from "@/lib/tournament-shape";
import { unratedWarning } from "@/lib/services/handicaps";
import { SetupLockBanner } from "@/components/SetupLockBanner";

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
  const attendanceRows =
    attendanceMode === "everyone"
      ? []
      : await prisma.roundAttendance.findMany({ where: { eventId: session.eventId } });

  const stages = state.stages.map((s) => ({
    id: s.id,
    position: s.position,
    type: s.type,
    description: s.description,
    format: s.format,
    holes: s.holes,
    deadline: s.deadline,
    scoringBasis: s.scoringBasis,
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
    attendance:
      attendanceMode === "everyone"
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
      <StagesClient
        stages={stages}
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
