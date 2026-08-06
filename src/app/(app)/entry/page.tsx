import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, effectiveScoreStatus, settingsOf } from "@/lib/services/tournament";
import { canEnterScores, allowsAutoConfirm } from "@/lib/tournament-settings";
import { redirect } from "next/navigation";
import { EntryModes, type EntryRound } from "@/components/EntryModes";
import { CourseSetupPrompt } from "@/components/CourseSetupPrompt";
import { prisma } from "@/lib/db";
import { resolveCourse, hasCourseData, needsCourseData } from "@/lib/courses";
import { courseForMatch, applyNine, type Nine } from "@/lib/services/course-resolution";
import type { HoleResult } from "@/lib/domain";
import { needsTeams, findFormat } from "@/lib/formats";
import { teamsForStage } from "@/lib/services/teams";
import { aggregateTeamCard, singleBallTeamCard } from "@/lib/domain/team";
import { TeamEntryClient, type TeamEntryRow } from "@/components/TeamEntryClient";

export default async function EntryPage() {
  const session = await requireScreen("entry");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";

  // The tournament decides whether players report their own scores. The save
  // actions enforce this too — this only keeps the screen honest.
  const settings = settingsOf(state.event);
  if (!canEnterScores(settings, session.viewRole)) redirect("/dashboard");

  // Only demand a course when the scoring actually uses one. A community
  // match-play league has no fixed venue — opponents play wherever suits them
  // before the deadline — and gross match play needs no par or stroke index to
  // record who won a hole.
  const scoringNeedsCourse = needsCourseData(
    (state.rrStages.length ? state.rrStages : state.stages).map((s) => ({
      format: s.format,
      scoringBasis: s.scoringBasis,
    })),
  );
  // Every course this tournament may be played on, so each match can be scored
  // against the card it was actually played on rather than the event's.
  const venues = await prisma.course.findMany({
    where: { events: { some: { eventId: session.eventId } } },
  });
  const venueById = new Map(venues.map((c) => [c.id, c]));
  /** One venue means the whole tournament is played there — nothing to pick. */
  const soleVenue = venues.length === 1 ? venues[0] : null;

  // A tournament with venues has course data even when the event itself names
  // no course — that's exactly the rotating or venue-less case.
  const courseKnown = hasCourseData(state.event) || venues.length > 0;
  if (scoringNeedsCourse && !courseKnown) {
    return <CourseSetupPrompt eventCourse={state.event.course} eventCity={state.event.city} isStaff={isStaff} />;
  }

  // A team round is entered differently enough that it gets its own screen
  // rather than a mode inside the individual one: the unit is a side, the card
  // count depends on the format, and there is no A/B slot to fill.
  const activeStage = state.activeStage ?? state.stages[0] ?? null;
  if (activeStage && needsTeams(activeStage.format)) {
    const format = findFormat(activeStage.format);
    const holeCount = activeStage.holes === 9 ? 9 : 18;
    const teams = await teamsForStage(session.eventId, activeStage.id, activeStage.format);
    const teamById = new Map(teams.map((t) => [t.id, t]));
    const stageMatches = state.matches.filter(
      (m) => m.stageId === activeStage.id && m.teamAId && m.teamBId,
    );
    const cards = await prisma.teamScorecard.findMany({
      where: { eventId: session.eventId, stageId: activeStage.id },
    });
    const strokesFor = (teamId: string, matchId: string, playerId: string): (number | null)[] => {
      const row = cards.find(
        (c) => c.teamId === teamId && c.matchId === matchId && c.playerId === playerId,
      );
      if (!row) return new Array(holeCount).fill(null);
      try {
        return JSON.parse(row.strokes) as (number | null)[];
      } catch {
        return new Array(holeCount).fill(null);
      }
    };

    const teamCourse = resolveCourse(state.event);
    const rows: TeamEntryRow[] = [];
    const pushRow = (teamId: string, matchId: string, opponentName?: string) => {
      const t = teamById.get(teamId);
      if (!t) return;
      const cardRows =
        format.ball === "single"
          ? [{ playerId: "", playerName: "", handicap: 0, strokes: strokesFor(teamId, matchId, "") }]
          : t.members.map((m) => ({
              playerId: m.playerId,
              playerName: m.name,
              handicap: m.handicap,
              strokes: strokesFor(teamId, matchId, m.playerId),
            }));
      const card =
        format.ball === "single"
          ? singleBallTeamCard(
              cardRows[0].strokes,
              teamCourse.pars.slice(0, holeCount),
              t.playingHandicap,
              teamCourse.strokeIndex.slice(0, holeCount),
            )
          : aggregateTeamCard(
              cardRows.map((c) => ({
                playerId: c.playerId,
                strokes: c.strokes,
                courseHandicap: c.handicap,
              })),
              teamCourse.pars.slice(0, holeCount),
              teamCourse.strokeIndex.slice(0, holeCount),
              format.allowance,
            );
      rows.push({
        teamId,
        teamName: t.name,
        matchId,
        opponentName,
        playingHandicap: t.playingHandicap,
        cards: cardRows,
        grossTotal: card.grossTotal,
        netTotal: card.netTotal,
        played: card.played,
      });
    };

    if (stageMatches.length > 0) {
      for (const m of stageMatches) {
        pushRow(m.teamAId, m.id, teamById.get(m.teamBId)?.name);
        pushRow(m.teamBId, m.id, teamById.get(m.teamAId)?.name);
      }
    } else {
      // No matches: a team stroke-play round, where every side returns one card
      // against the field rather than against an opponent.
      for (const t of teams) pushRow(t.id, "");
    }

    // A player sees only the sides they are on.
    //
    // Every row carries that side's running gross and net, so handing a player
    // the full set would hand them the leaderboard — including in a blind
    // event, which exists precisely to withhold it. Filtering here rather than
    // in the component because anything sent to a client component is in the
    // page source whether it is rendered or not.
    let visible = rows;
    if (!isStaff) {
      const me = await prisma.player.findFirst({
        where: { eventId: session.eventId, email: session.email },
        select: { id: true },
      });
      const mine = new Set(
        teams.filter((t) => t.members.some((m) => m.playerId === me?.id)).map((t) => t.id),
      );
      visible = rows.filter((r) => mine.has(r.teamId));
    }

    return (
      <>
        <p className="kicker">Manage</p>
        <h1 className="page-title">Score entry</h1>
        <TeamEntryClient
          round={`${activeStage.format}`}
          teams={visible}
          pars={courseKnown ? teamCourse.pars.slice(0, holeCount) : []}
          strokeIndex={courseKnown ? teamCourse.strokeIndex.slice(0, holeCount) : []}
          sharesOneCard={format.ball === "single"}
          holes={holeCount}
        />
      </>
    );
  }

  const nameById = new Map(state.players.map((p) => [p.id, p.name]));
  const handicapById = new Map(state.players.map((p) => [p.id, p.handicap]));
  const groupById = new Map(state.groups.map((g) => [g.id, g.position]));
  // resolveCourse falls back to a demo preset so scoring never crashes. That
  // fallback must not be *shown*: printing one course's par and stroke index
  // over a match played somewhere else is worse than showing nothing. With no
  // real course, the card renders hole numbers only.
  const course = resolveCourse(state.event);
  const pars = courseKnown ? course.pars : [];
  const yards = courseKnown ? course.yards : [];
  const strokeIndex = courseKnown ? course.strokeIndex : [];

  // A tournament can sequence more than one Round Robin round; build entry data
  // for each so staff/players can switch between them (e.g. fix Round 1 while
  // Round 2 is under way), defaulting to the active (latest) round.
  const rrStages = state.rrStages.length ? state.rrStages : state.stages.slice(0, 1);
  const rounds: EntryRound[] = await Promise.all(
    rrStages.map(async (stage, i) => {
      const holeCount = stage.holes === 9 ? 9 : 18;
      const netMode = stage.format === "Match Play" && stage.scoringBasis === "net";
      const stageCourse = stage.courseId ? venueById.get(stage.courseId) ?? null : null;

      const cards = await prisma.scorecard.findMany({ where: { eventId: session.eventId, stageId: stage.id } });
      const cardsByPlayer: Record<string, (number | null)[]> = {};
      for (const c of cards) {
        try {
          cardsByPlayer[c.playerId] = JSON.parse(c.strokes) as (number | null)[];
        } catch {
          cardsByPlayer[c.playerId] = [];
        }
      }

      const stageMatchIds = state.matches.filter((m) => m.stageId === stage.id).map((m) => m.id);
      const matchCards = stageMatchIds.length
        ? await prisma.matchScorecard.findMany({ where: { eventId: session.eventId, matchId: { in: stageMatchIds } } })
        : [];
      const matchStrokesByKey: Record<string, (number | null)[]> = {};
      for (const c of matchCards) {
        try {
          matchStrokesByKey[`${c.matchId}:${c.slot}`] = JSON.parse(c.strokes) as (number | null)[];
        } catch {
          matchStrokesByKey[`${c.matchId}:${c.slot}`] = [];
        }
      }

      const stageMatches = state.matches
        .filter((m) => m.stageId === stage.id)
        .sort((a, b) => a.round - b.round)
        .map((m) => {
          let holes: HoleResult[];
          try {
            holes = JSON.parse(m.holes) as HoleResult[];
          } catch {
            holes = new Array(holeCount).fill(null);
          }
          // match → round → event, then narrowed to the nine actually played.
          // The match's own nine wins over the round's, since a pairing that
          // chose its own venue also chose which half of it.
          const matchCourse = m.courseId ? venueById.get(m.courseId) ?? null : null;
          // A tournament with exactly one venue is played there, full stop —
          // no round or match ever needs to say so. Without this the event
          // level would fall through to its legacy course fields and find
          // nothing, because the venue lives in the course library instead.
          const resolved = courseForMatch(matchCourse, stageCourse ?? soleVenue, state.event);
          const nine = (matchCourse ? m.nine : stage.nine) as Nine;
          const card = resolved ? applyNine(resolved, nine, holeCount) : null;

          return {
            id: m.id,
            aId: m.playerAId,
            bId: m.playerBId,
            aName: nameById.get(m.playerAId) ?? "—",
            bName: nameById.get(m.playerBId) ?? "—",
            aHandicap: handicapById.get(m.playerAId) ?? 0,
            bHandicap: handicapById.get(m.playerBId) ?? 0,
            groupName: `Flight ${(groupById.get(m.groupId) ?? 0) + 1}`,
            round: m.round,
            holes,
            status: effectiveScoreStatus(m, allowsAutoConfirm(settings)),
            aStrokes: matchStrokesByKey[`${m.id}:A`] ?? new Array(holeCount).fill(null),
            bStrokes: matchStrokesByKey[`${m.id}:B`] ?? new Array(holeCount).fill(null),
            courseId: m.courseId,
            nine: m.nine,
            pars: card?.pars,
            yards: card?.yards,
            strokeIndex: card?.strokeIndex,
            courseName: card?.name,
          };
        });

      return {
        stageId: stage.id,
        label: `Round ${i + 1}`,
        matches: stageMatches,
        netMode,
        stroke: { holes: holeCount, stageId: stage.id, cardsByPlayer },
      };
    }),
  );

  const activeIndex = Math.max(
    0,
    rounds.findIndex((r) => r.stageId === state.activeStage?.id),
  );

  return (
    <EntryModes
      rounds={rounds}
      activeIndex={activeIndex}
      players={state.confirmed.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap }))}
      pars={pars}
      yards={yards}
      strokeIndex={strokeIndex}
      isStaff={isStaff}
      defaultMode={state.event.format === "stroke" ? "stroke" : "match"}
      courseKnown={courseKnown}
      isAdmin={session.viewRole === "admin"}
      venues={venues.map((v) => ({ id: v.id, name: v.name }))}
    />
  );
}
