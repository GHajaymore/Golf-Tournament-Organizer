import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-helpers";
import { loadEventState, standingRows, settingsOf } from "@/lib/services/tournament";
import { canSeeLeaderboard } from "@/lib/tournament-settings";
import { PlayerLeaderboard } from "@/components/PlayerLeaderboard";

/**
 * The board, as a player reads it.
 *
 * The same PlayerLeaderboard the public share link renders — one component,
 * so a player checking the app and a spectator following the link cannot be
 * shown different standings.
 *
 * The tournament's own visibility setting still applies. A club that has not
 * published the leaderboard has not published it to its players either, and
 * hiding the tab while leaving the route open would be theatre.
 */
export default async function PlayBoardPage() {
  const session = await requireSession();
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  if (!canSeeLeaderboard(settingsOf(state.event), session.viewRole)) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>Board</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          The organizer hasn&rsquo;t published standings for this tournament yet.
        </p>
      </div>
    );
  }

  const stage = state.activeStage ?? state.stages[0] ?? null;
  const holes = stage?.holes === 9 ? 9 : 18;
  const rows = standingRows(state);

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "var(--color-neutral-400)",
        }}
      >
        {stage?.description?.trim() || stage?.type || "Standings"}
      </div>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 24, margin: "6px 0 18px" }}>
        Leaderboard
      </h1>

      <PlayerLeaderboard
        isStroke={state.isStroke}
        isStableford={stage?.scoringBasis === "stableford"}
        rows={rows}
        holes={holes}
      />
    </div>
  );
}
