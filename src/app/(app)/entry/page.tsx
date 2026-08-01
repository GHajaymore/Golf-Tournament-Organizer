import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, effectiveScoreStatus } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ScoreEntryClient, type EntryMatch } from "@/components/ScoreEntryClient";
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

  return <ScoreEntryClient matches={matches} isStaff={isStaff} />;
}
