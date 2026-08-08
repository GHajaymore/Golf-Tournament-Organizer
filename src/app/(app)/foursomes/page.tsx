import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, playingStages } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FoursomeMaker } from "@/components/FoursomeMaker";
import type { Standing } from "@/lib/domain/draw";

export default async function FoursomesPage() {
  await requireScreen("foursomes");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

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

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Manage</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Tee sheet</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Decide who plays together, what order they go off, and from which tee. Once a round has been
          played you can re-pair off the leaderboard and send the leaders out last.
        </p>
      </div>
      <FoursomeMaker
        players={state.confirmed.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, seed: p.seed }))}
        standings={standings}
        holes={holes}
      />
    </>
  );
}
