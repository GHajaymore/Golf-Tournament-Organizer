import { requireState } from "@/lib/page-helpers";
import { computeHighlights, standingRows, settingsOf } from "@/lib/services/tournament";
import { canSeeLeaderboard } from "@/lib/tournament-settings";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { CommentaryPanel } from "@/components/CommentaryPanel";
import { LeaderboardBoard } from "@/components/LeaderboardBoard";
import { TeamLeaderboard } from "@/components/TeamLeaderboard";
import { SkinsLeaderboard, NassauLeaderboard, ModifiedStablefordLeaderboard } from "@/components/PointsLeaderboard";
import { skinsBoard, nassauBoard, modifiedStablefordBoard } from "@/lib/services/points-standings";
import { boardKind } from "@/lib/formats";
import { ManualRoundBoard } from "@/components/ManualRoundBoard";
import { teamStandings } from "@/lib/services/teams";
import { resolveCourse } from "@/lib/courses";

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

  // A blind event hides standings from players until the organizer publishes.
  if (!canSeeLeaderboard(settingsOf(event), session.viewRole)) redirect("/dashboard");

  // A team round ranks sides, not players. In a scramble nobody has an
  // individual score to rank at all, and in a four-ball an individual score is
  // only half the story — so this is a different board, not a column change.
  const activeStage = state.activeStage ?? state.stages[0] ?? null;

  // `boardKind` holds the order these are checked in — manual first, before
  // teams and before any engine — because Reports and /live have to make the
  // same decision and used not to. See lib/formats.ts.
  const kind = boardKind(activeStage?.format);

  if (kind === "manual") {
    return <ManualRoundBoard format={activeStage!.format} />;
  }

  if (kind === "team" && activeStage) {
    const holeCount = activeStage.holes === 9 ? 9 : 18;
    const course = resolveCourse(event);
    const standings = await teamStandings(
      session.eventId,
      activeStage.id,
      activeStage.format,
      course.pars.slice(0, holeCount),
      course.strokeIndex.slice(0, holeCount),
      activeStage.scoringBasis,
      activeStage.handicapAllowance,
      activeStage.allowanceWeights,
      activeStage.countBest,
    );
    return (
      <TeamLeaderboard
        format={activeStage.format}
        stableford={activeStage.scoringBasis === "stableford"}
        rows={standings}
      />
    );
  }

  // Formats that read an ordinary card a different way. Each one already has
  // its scores where the standard boards keep them — a skins game is a stroke
  // card, a Nassau is a match card — so these only change the reading.
  if (activeStage) {
    const holes = activeStage.holes === 9 ? 9 : 18;
    const c = resolveCourse(event);

    if (kind === "skins") {
      const net = activeStage.scoringBasis !== "gross";
      const board = await skinsBoard(
        session.eventId, activeStage.id, holes, net, c.strokeIndex.slice(0, holes),
      );
      return <SkinsLeaderboard board={board} net={net} />;
    }
    if (kind === "nassau") {
      return <NassauLeaderboard rows={await nassauBoard(session.eventId, activeStage.id)} />;
    }
    if (kind === "modified-stableford") {
      const rows = await modifiedStablefordBoard(
        session.eventId, activeStage.id, c.pars.slice(0, holes), c.strokeIndex.slice(0, holes),
      );
      return <ModifiedStablefordLeaderboard rows={rows} />;
    }
  }

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
