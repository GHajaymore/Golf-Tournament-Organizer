import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, effectiveScoreStatus } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { EntryModes, type EntryRound } from "@/components/EntryModes";
import { prisma } from "@/lib/db";
import { findCourse } from "@/lib/courses";
import type { HoleResult } from "@/lib/domain";

export default async function EntryPage() {
  const session = await requireScreen("entry");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";

  const nameById = new Map(state.players.map((p) => [p.id, p.name]));
  const groupById = new Map(state.groups.map((g) => [g.id, g.position]));
  const pars = findCourse(state.event.course).pars;

  // A tournament can sequence more than one Round Robin round; build entry data
  // for each so staff/players can switch between them (e.g. fix Round 1 while
  // Round 2 is under way), defaulting to the active (latest) round.
  const rrStages = state.rrStages.length ? state.rrStages : state.stages.slice(0, 1);
  const rounds: EntryRound[] = await Promise.all(
    rrStages.map(async (stage, i) => {
      const stageMatches = state.matches
        .filter((m) => m.stageId === stage.id)
        .sort((a, b) => a.round - b.round)
        .map((m) => {
          let holes: HoleResult[];
          try {
            holes = JSON.parse(m.holes) as HoleResult[];
          } catch {
            holes = new Array(stage.holes === 9 ? 9 : 18).fill(null);
          }
          return {
            id: m.id,
            aId: m.playerAId,
            bId: m.playerBId,
            aName: nameById.get(m.playerAId) ?? "—",
            bName: nameById.get(m.playerBId) ?? "—",
            groupName: `Flight ${(groupById.get(m.groupId) ?? 0) + 1}`,
            round: m.round,
            holes,
            status: effectiveScoreStatus(m),
          };
        });

      const cards = await prisma.scorecard.findMany({ where: { eventId: session.eventId, stageId: stage.id } });
      const cardsByPlayer: Record<string, (number | null)[]> = {};
      for (const c of cards) {
        try {
          cardsByPlayer[c.playerId] = JSON.parse(c.strokes) as (number | null)[];
        } catch {
          cardsByPlayer[c.playerId] = [];
        }
      }

      return {
        stageId: stage.id,
        label: `Round ${i + 1}`,
        matches: stageMatches,
        stroke: { holes: stage.holes === 9 ? 9 : 18, stageId: stage.id, cardsByPlayer },
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
      isStaff={isStaff}
      defaultMode={state.event.format === "stroke" ? "stroke" : "match"}
    />
  );
}
