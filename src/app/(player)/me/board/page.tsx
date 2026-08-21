import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-helpers";
import { loadEventState, standingRows, settingsOf } from "@/lib/services/tournament";
import { canSeeLeaderboard } from "@/lib/tournament-settings";
import { PlayerLeaderboard } from "@/components/PlayerLeaderboard";
import { boardKind } from "@/lib/formats";

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

  // The same branch the console leaderboard, Reports and /live make (D8). A
  // player looking at their own board is the last person who should be shown a
  // ranking the app cannot actually compute for this round — they will read it
  // as where they stand.
  const kind = boardKind(stage?.format);
  if (kind !== "standard") {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>Board</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          {kind === "manual"
            ? "This round is scored by hand — the committee works out the result and posts it when it's settled."
            : kind === "team"
              ? "This round ranks teams rather than players. Ask your organizer for the team board."
              : "This round is scored a different way. Ask your organizer for the current standings."}
        </p>
      </div>
    );
  }

  const rows = standingRows(state);

  // Which row is theirs, by the registration email — the same linkage every
  // score guard uses, rather than matching on a name two people can share.
  const me = state.players.find(
    (p) => p.email.trim().toLowerCase() === session.email.trim().toLowerCase(),
  );

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
      {/* "Board", the word on the tab the player just tapped.
          This screen called itself "Board" in both of its refusal states and
          "Leaderboard" here, so the same page had two names depending on what
          it could show. Its sibling tabs both use their tab's own word — "My
          card", "Rules" — so this was also the one breaking the app's own
          convention. The kicker above already names the round, which is the
          part a player actually needs. */}
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 24, margin: "6px 0 18px" }}>
        Board
      </h1>

      <PlayerLeaderboard
        isStroke={state.isStroke}
        isStableford={stage?.scoringBasis === "stableford"}
        rows={rows}
        holes={holes}
        youId={me?.id ?? ""}
        // What the column actually measures, from the same place the board
        // totals it — the state now says, rather than the screen assuming.
        unit={state.isStroke ? state.strokeUnit : "match points"}
      />
    </div>
  );
}
