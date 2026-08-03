import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, effectiveScoreStatus } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { EntryModes } from "@/components/EntryModes";
import { type EntryMatch } from "@/components/ScoreEntryClient";
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

  const matches: EntryMatch[] = [...state.rrMatches]
    .sort((a, b) => a.round - b.round)
    .map((m) => {
      let holes: HoleResult[];
      try {
        holes = JSON.parse(m.holes) as HoleResult[];
      } catch {
        holes = new Array(18).fill(null);
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

  // Stroke-play data: score the first round on the event's course pars.
  const strokeStage = state.stages[0];
  const strokeHoles = strokeStage?.holes ?? 18;
  const pars = findCourse(state.event.course).pars;
  const cards = strokeStage
    ? await prisma.scorecard.findMany({ where: { eventId: session.eventId, stageId: strokeStage.id } })
    : [];
  const cardsByPlayer: Record<string, (number | null)[]> = {};
  for (const c of cards) {
    try {
      cardsByPlayer[c.playerId] = JSON.parse(c.strokes) as (number | null)[];
    } catch {
      cardsByPlayer[c.playerId] = [];
    }
  }

  const stroke = {
    players: state.confirmed.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap })),
    pars,
    holes: strokeHoles,
    stageId: strokeStage?.id ?? "",
    cardsByPlayer,
  };

  return (
    <EntryModes
      matches={matches}
      isStaff={isStaff}
      stroke={stroke}
      defaultMode={state.event.format === "stroke" ? "stroke" : "match"}
    />
  );
}
