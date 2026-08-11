import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, playingStages } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FoursomeMaker } from "@/components/FoursomeMaker";
import type { Standing } from "@/lib/domain/draw";
import { prisma } from "@/lib/db";
import { settingsOf } from "@/lib/services/tournament";
import { resolveAttendance, type AttendanceMode } from "@/lib/domain/attendance";
import { parseTeeSheet } from "@/lib/domain/tee-sheet";
import { shortDate } from "@/lib/domain/round-dates";
import { TeeSheetPrint } from "@/components/TeeSheetPrint";
import { resolveCourse } from "@/lib/courses";
import { brandForEvent } from "@/lib/services/organization";

export default async function FoursomesPage({
  searchParams,
}: {
  searchParams: Promise<{ round?: string }>;
}) {
  await requireScreen("foursomes");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const params = await searchParams;

  /**
   * Which round's sheet is being drawn.
   *
   * This screen used to read state.activeStage and nothing else, alone among
   * every round-scoped screen in the app — score entry, prizes, teams and the
   * weekly view all let an organizer choose. Three things followed: next
   * week's sheet could not be drawn ahead, last week's could not be reopened,
   * and — the real fault — activeStage is DERIVED, so as a tournament advanced
   * the page silently changed which round it was editing, with nothing on
   * screen to say so.
   */
  const rounds = playingStages(state.stages);
  const stage = rounds.find((s) => s.id === params.round) ?? state.activeStage ?? rounds[0] ?? null;

  /**
   * The current leaderboard, for re-pairing and for drawing the leaders out
   * last.
   *
   * Only players who have actually posted something count. Both standings
   * lists rank the whole field, including people who haven't teed off — taking
   * them wholesale would hand every player a position before a ball was
   * struck, and "leaders out last" would then draw the sheet off nothing but
   * alphabetical noise.
   */
  const standings: Standing[] = state.isStroke
    ? state.strokeStandings
        .filter((s) => s.thru > 0)
        .map((s) => ({ playerId: s.player.id, position: s.rank }))
    : state.overall
        .filter((r) => r.stats.played > 0)
        .map((r) => ({ playerId: r.player.id, position: r.rank }));

  const holes = playingStages(state.stages)[0]?.holes === 9 ? 9 : 18;

  // Printed cards come from the SAVED sheet, never the on-screen preview —
  // the preview reshuffles on every visit, and a card has to match what was
  // announced. No saved sheet, no print button.
  const savedSheet = stage ? parseTeeSheet(stage.teeSheet) : null;
  const course = resolveCourse(state.event);
  const brand = await brandForEvent(session.eventId);
  const nameOf = new Map(state.confirmed.map((p) => [p.id, p]));
  const printGroups = (savedSheet?.groups ?? []).map((g) => ({
    name: g.name,
    startHole: g.startHole,
    half: g.half,
    time: g.time,
    players: g.playerIds
      .map((id) => nameOf.get(id))
      .filter((pl): pl is NonNullable<typeof pl> => !!pl)
      .map((pl) => ({ name: pl.name, handicap: pl.handicap })),
  }));

  // A league tee sheet is drawn from the week's attendees, not the season's
  // roster. Outside league mode this filter is the identity — every confirmed
  // player is in, exactly as before.
  const attendanceMode = settingsOf(state.event).attendanceMode as AttendanceMode;
  let field = state.confirmed;
  let attendanceNote = "";
  if (attendanceMode !== "everyone" && stage) {
    const explicit = await prisma.roundAttendance.findMany({
      where: { eventId: session.eventId, stageId: stage.id },
    });
    const resolved = resolveAttendance(
      attendanceMode,
      state.confirmed.map((p) => p.id),
      explicit.map((e) => ({ playerId: e.playerId, status: e.status, decidedBy: e.decidedBy })),
    );
    const inIds = new Set(resolved.rows.filter((r) => r.status === "in").map((r) => r.playerId));
    field = state.confirmed.filter((p) => inIds.has(p.id));
    attendanceNote = `This week: ${resolved.in} in${resolved.inByDefault ? ` (${resolved.inByDefault} by default)` : ""} · ${resolved.out} out. The sheet below is drawn from the ${resolved.in} who are in.`;
  }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Manage</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Tee sheet</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Decide who plays together, what order they go off, and from which tee. Once a round has been
          played you can re-pair off the leaderboard and send the leaders out last.
        </p>
        {attendanceNote && (
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 12.5, fontWeight: 500 }}>
            {attendanceNote}
          </p>
        )}
      </div>
      <FoursomeMaker
        players={field.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, seed: p.seed }))}
        standings={standings}
        holes={holes}
        stageId={stage?.id ?? ""}
        savedAt={stage ? parseTeeSheet(stage.teeSheet)?.savedAt ?? "" : ""}
        published={stage?.teeSheetPublished ?? false}
        rounds={rounds.map((r, i) => ({
          id: r.id,
          label: r.playedOn ? `Round ${i + 1} · ${shortDate(r.playedOn)}` : `Round ${i + 1}`,
        }))}
        activeRoundId={stage?.id ?? ""}
      />
      <TeeSheetPrint
        groups={printGroups}
        clubName={brand?.name ?? ""}
        courseName={course.name || state.event.course}
        dates={state.event.dates}
        roundLabel={`Round ${Math.max(1, rounds.findIndex((r) => r.id === stage?.id) + 1)}`}
        pars={course.pars}
        strokeIndex={course.strokeIndex}
        holes={holes}
      />
    </>
  );
}
