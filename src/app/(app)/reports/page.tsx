import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, matchProgress, standingRows } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { ReportsClient } from "@/components/ReportsClient";
import { StatCard } from "@/components/PageHeader";
import { brandForEvent } from "@/lib/services/organization";
import { boardKind } from "@/lib/formats";
import { ManualRoundNotice } from "@/components/ManualRoundBoard";
import { TeamLeaderboard } from "@/components/TeamLeaderboard";
import { SkinsLeaderboard, NassauLeaderboard, ModifiedStablefordLeaderboard } from "@/components/PointsLeaderboard";
import { skinsBoard, nassauBoard, modifiedStablefordBoard } from "@/lib/services/points-standings";
import { teamStandings } from "@/lib/services/teams";
import { resolveCourse } from "@/lib/courses";
import { toParText } from "@/lib/domain";

/**
 * D8 of the 2026-08-12 audit. This page called `standingRows` unconditionally
 * while the leaderboard had four branches ahead of that same call, so the two
 * screens contradicted each other — and this is the one whose output gets
 * printed and pinned up. A team round exported the whole field at gross 0
 * through 0. A *manual* round printed a branded "Final standings snapshot"
 * with an Advancing column, for a format the leaderboard explicitly refuses to
 * score.
 *
 * The branch now comes from `boardKind`, which both screens share.
 */
export default async function ReportsPage() {
  const session = await requireScreen("reports");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const brand = await brandForEvent(session.eventId);

  const { event } = state;
  const progress = matchProgress(state);
  const rows = standingRows(state);
  const isStroke = state.isStroke;
  const cardsIn = state.strokeStandings.filter((s) => s.thru > 0).length;

  const activeStage = state.activeStage ?? state.stages[0] ?? null;
  const kind = boardKind(activeStage?.format);
  const holes = activeStage?.holes === 9 ? 9 : 18;
  const course = resolveCourse(event);

  let board: React.ReactNode = null;
  let snapshotTitle = "Final standings snapshot";
  let extraCsv: { label: string; desc: string; filename: string; rows: string[][] }[] = [];

  if (kind === "team" && activeStage) {
    const teams = await teamStandings(
      session.eventId,
      activeStage.id,
      activeStage.format,
      course.pars.slice(0, holes),
      course.strokeIndex.slice(0, holes),
      activeStage.scoringBasis,
      activeStage.handicapAllowance,
      activeStage.allowanceWeights,
      activeStage.countBest,
    );
    const stableford = activeStage.scoringBasis === "stableford";
    snapshotTitle = "Team standings snapshot";
    board = <TeamLeaderboard format={activeStage.format} stableford={stableford} rows={teams} />;
    extraCsv = [
      {
        label: "Team standings",
        desc: "Every side, ranked, with its players and score.",
        filename: `${event.name}-team-standings.csv`,
        rows: [
          ["Rank", "Team", "Players", "Playing handicap", "Thru", "Gross", stableford ? "Points" : "Net", "To par"],
          ...teams.map((t, i) => [
            String(i + 1),
            t.name,
            t.members.join(" / "),
            String(t.playingHandicap),
            String(t.played),
            String(t.gross),
            String(stableford ? t.points : t.net),
            toParText(t.toPar),
          ]),
        ],
      },
    ];
  } else if (kind === "skins" && activeStage) {
    const net = activeStage.scoringBasis !== "gross";
    const skins = await skinsBoard(session.eventId, activeStage.id, holes, net, course.strokeIndex.slice(0, holes));
    snapshotTitle = `Skins — ${net ? "net" : "gross"}`;
    board = <SkinsLeaderboard board={skins} net={net} />;
    extraCsv = [
      {
        label: "Skins results",
        desc: "Which hole each skin was won on, and by whom.",
        filename: `${event.name}-skins.csv`,
        rows: [
          ["Hole", "Winner", "Score", "Skins", "Carried"],
          ...skins.outcome.holes.map((h) => [
            String(h.hole),
            h.playerId ? (skins.nameById[h.playerId] ?? "") : "",
            h.score === null ? "" : String(h.score),
            String(h.value),
            h.carried ? "yes" : "",
          ]),
        ],
      },
    ];
  } else if (kind === "nassau" && activeStage) {
    const nassau = await nassauBoard(session.eventId, activeStage.id);
    snapshotTitle = "Nassau results";
    board = <NassauLeaderboard rows={nassau} />;
    extraCsv = [
      {
        label: "Nassau results",
        desc: "Front, back and overall for every match.",
        filename: `${event.name}-nassau.csv`,
        rows: [
          ["Match", "Front", "Back", "Overall", "Balance"],
          ...nassau.map((r) => {
            const seg = (key: "front" | "back" | "overall") => {
              const s = r.outcome.segments.find((x) => x.key === key);
              // A nine-hole round has one segment, so the other two are absent
              // rather than empty — an en dash, not a blank that reads as "0".
              if (!s) return "—";
              return s.result?.resultText || "in play";
            };
            return [
              `${r.aName} v ${r.bName}`,
              seg("front"),
              seg("back"),
              seg("overall"),
              String(r.outcome.balance),
            ];
          }),
        ],
      },
    ];
  } else if (kind === "modified-stableford" && activeStage) {
    const mod = await modifiedStablefordBoard(
      session.eventId,
      activeStage.id,
      course.pars.slice(0, holes),
      course.strokeIndex.slice(0, holes),
    );
    snapshotTitle = "Modified Stableford standings";
    board = <ModifiedStablefordLeaderboard rows={mod} />;
    extraCsv = [
      {
        label: "Modified Stableford",
        desc: "Every player, ranked on this round's points table.",
        filename: `${event.name}-modified-stableford.csv`,
        rows: [
          ["Rank", "Player", "Handicap", "Thru", "Gross", "Points"],
          ...mod.map((r, i) => [
            String(i + 1),
            r.name,
            String(r.handicap),
            String(r.played),
            String(r.gross),
            String(r.points),
          ]),
        ],
      },
    ];
  }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Results</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Reports &amp; export</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Download standings and results, or print a snapshot.
        </p>
      </div>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Players" value={state.confirmed.length} icon="ph ph-users-three" />
        {isStroke ? (
          <StatCard label="Cards in" value={`${cardsIn}/${state.confirmed.length}`} icon="ph ph-check-circle" />
        ) : (
          <StatCard label="Matches complete" value={`${progress.done}/${progress.total}`} icon="ph ph-check-circle" />
        )}
        <StatCard label="Flights" value={state.groups.length} icon="ph ph-squares-four" />
        <StatCard label="Advancing" value={state.advancingCount} icon="ph ph-flag-checkered" />
      </div>
      {kind === "manual" && (
        <div style={{ marginBottom: 16 }}>
          <ManualRoundNotice format={activeStage!.format} />
        </div>
      )}
      <ReportsClient
        rows={rows}
        isStroke={isStroke}
        isStableford={activeStage?.scoringBasis === "stableford"}
        eventName={event.name}
        brand={brand}
        scored={kind !== "manual"}
        snapshotTitle={snapshotTitle}
        board={board}
        extraCsv={extraCsv}
      />
    </>
  );
}
