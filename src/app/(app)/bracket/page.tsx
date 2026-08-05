import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { canSeeLeaderboard } from "@/lib/tournament-settings";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { BracketClient } from "@/components/BracketClient";

export default async function BracketPage() {
  const session = await requireScreen("bracket");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  // Seeding is a direct read on the standings, so a blind event hides the
  // bracket from players for the same reason it hides the leaderboard.
  if (!canSeeLeaderboard(settingsOf(state.event), session.viewRole)) redirect("/dashboard");

  const bw = await prisma.bracketWinner.findMany({ where: { eventId: session.eventId } });
  const results: Record<string, string> = {};
  for (const w of bw) if (w.result) results[w.key] = w.result;
  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";

  return (
    <BracketClient
      winners={state.brackets.winners}
      consolation={state.brackets.consolation}
      results={results}
      readOnly={!isStaff}
    />
  );
}
