import { requireState } from "@/lib/page-helpers";
import { computeHighlights, standingRows } from "@/lib/services/tournament";
import { prisma } from "@/lib/db";
import { CommentaryPanel } from "@/components/CommentaryPanel";
import { LeaderboardBoard } from "@/components/LeaderboardBoard";

function ago(d: Date): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function LeaderboardPage() {
  const { session, state } = await requireState();
  const { event } = state;
  const rows = standingRows(state);
  const highlights = computeHighlights(state);
  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";
  const commentary = await prisma.commentary.findMany({
    where: { eventId: session.eventId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const commentaryItems = commentary.map((c) => ({
    id: c.id,
    author: c.author,
    text: c.text,
    source: c.source,
    when: ago(c.createdAt),
  }));

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div>
          <div className="page-kicker">Overview</div>
          <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Live leaderboard</h2>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {state.isStroke
              ? state.activeStage?.scoringBasis === "stableford"
                ? "Overall standings across all flights · Stableford points (higher is better)."
                : "Overall standings across all flights · stroke play (gross / net / to-par)."
              : "Overall standings across all flights · match points breakdown."}
          </p>
        </div>
        <span className="tag tag-accent">
          <i className="ph-fill ph-circle" style={{ fontSize: 8, marginRight: 5 }} /> Updating live
        </span>
      </div>

      {highlights.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <span className="card-kicker" style={{ display: "block", marginBottom: 8 }}>Tournament highlights</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
            {highlights.map((h, i) => (
              <div key={i} className="card elev-sm" style={{ gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{h.icon}</span>
                  <span className="card-kicker">{h.title}</span>
                </div>
                <div style={{ fontSize: 13 }}>{h.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card elev-sm">
        <LeaderboardBoard isStroke={state.isStroke} isStableford={state.activeStage?.scoringBasis === "stableford"} rows={rows} isStaff={isStaff} />
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          {state.isStroke
            ? state.activeStage?.scoringBasis === "stableford"
              ? "Points are Stableford: 2 for a net par, +1 per stroke better, -1 per stroke worse, floored at 0. Advancing rows reflect the qualification cutoff."
              : "Net = gross minus handicap strokes received on the holes played; To-par is versus the holes played. Advancing rows reflect the qualification cutoff."
            : "Columns: P played, W won, ½ halved, L lost. Advancing rows reflect the current qualification cutoff and update live as scores are entered."}
        </p>
      </div>

      <div style={{ marginTop: 16 }}>
        <CommentaryPanel items={commentaryItems} canPost={isStaff} />
      </div>
    </>
  );
}
