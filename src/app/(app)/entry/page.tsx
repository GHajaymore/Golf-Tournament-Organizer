import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ScoreEntryClient, type EntryMatch } from "@/components/ScoreEntryClient";
import type { HoleResult } from "@/lib/domain";

export default async function EntryPage() {
  await requireScreen("entry");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const nameById = new Map(state.players.map((p) => [p.id, p.name]));
  const groupById = new Map(state.groups.map((g) => [g.id, g.name]));

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
        groupName: `Group ${groupById.get(m.groupId) ?? "—"}`,
        round: m.round,
        holes,
      };
    });

  return <ScoreEntryClient matches={matches} />;
}
