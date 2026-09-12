import { screenMetadata } from "@/lib/screen-metadata";
import Link from "next/link";
import { requireState } from "@/lib/page-helpers";
import { scoringMismatch } from "@/lib/domain/scoring-mismatch";
import { isHeadToHead, isPlayingRound } from "@/lib/stage-types";
import { computeHighlights, standingRows, settingsOf } from "@/lib/services/tournament";
import { canSeeLeaderboard } from "@/lib/tournament-settings";
import { redirect } from "next/navigation";
import { entitlementForEvent } from "@/lib/services/entitlements";
import { prisma } from "@/lib/db";
import { CommentaryPanel } from "@/components/CommentaryPanel";
import { LeaderboardBoard } from "@/components/LeaderboardBoard";
import { LiveRefresh } from "@/components/LiveRefresh";
import { TeamLeaderboard } from "@/components/TeamLeaderboard";
import { SkinsLeaderboard, NassauLeaderboard, ModifiedStablefordLeaderboard } from "@/components/PointsLeaderboard";
import { skinsBoard, nassauBoard, modifiedStablefordBoard } from "@/lib/services/points-standings";
import { boardKind } from "@/lib/formats";
import { isMatch } from "@/lib/tournament-shape";
import { boardIntro, boardFootnote, boardShowsHighlights, boardShowsCommentary } from "@/lib/domain/board-copy";
import { ManualRoundBoard } from "@/components/ManualRoundBoard";
import { teamStandings } from "@/lib/services/teams";
import { resolveCourse } from "@/lib/courses";
import { cardForStage } from "@/lib/services/course-resolution";

function ago(d: Date): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const metadata = screenMetadata("/leaderboard");

export default async function LeaderboardPage() {
  const { session, state } = await requireState();
  const { event } = state;

  // A blind event hides standings from players until the organizer publishes.
  if (!canSeeLeaderboard(settingsOf(event), session.viewRole)) redirect("/dashboard");

  // A team round ranks sides, not players. In a scramble nobody has an
  // individual score to rank at all, and in a four-ball an individual score is
  // only half the story — so this is a different board, not a column change.
  const activeStage = state.boardStage;

  // `boardKind` holds the order these are checked in — manual first, before
  // teams and before any engine — because Reports and /live have to make the
  // same decision and used not to. See lib/formats.ts.
  const kind = boardKind(activeStage?.format);

  if (kind === "manual") {
    return <ManualRoundBoard format={activeStage!.format} />;
  }

  if (kind === "team" && activeStage) {
    // The nine actually played, re-ranked to 1..9 — not the first nine of an
    // eighteen-hole card still carrying eighteen-hole index numbers.
    const course = cardForStage(resolveCourse(event), activeStage);
    const standings = await teamStandings(
      session.eventId,
      activeStage.id,
      activeStage.format,
      course.pars,
      course.strokeIndex,
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
    const c = cardForStage(resolveCourse(event), activeStage);

    if (kind === "skins") {
      const net = activeStage.scoringBasis !== "gross";
      const board = await skinsBoard(
        session.eventId, activeStage.id, holes, net, c.strokeIndex,
      );
      return <SkinsLeaderboard board={board} net={net} />;
    }
    if (kind === "nassau") {
      return <NassauLeaderboard rows={await nassauBoard(session.eventId, activeStage.id)} />;
    }
    if (kind === "modified-stableford") {
      const rows = await modifiedStablefordBoard(
        session.eventId, activeStage.id, c.pars, c.strokeIndex,
      );
      return <ModifiedStablefordLeaderboard rows={rows} />;
    }
  }

  const rows = standingRows(state);
  /**
   * Whether the event's Scoring can rank what its rounds produce.
   *
   * Only the rounds the field PLAYS. Every stage type is one now — the
   * "Qualification Stage", which was a cut rather than a round and would have
   * reported a mismatch on a tournament with nothing wrong with it, was
   * removed on 2026-09-11. The filter stays because the DISTINCTION is the
   * point: a type that is not played must never be scored against.
   */
  const mismatch = scoringMismatch(
    state.event.format,
    state.stages
      .filter((s) => isPlayingRound(s.type))
      .map((s) => ({ type: s.type, headToHead: isHeadToHead(s.type) })),
  );
  const highlights = computeHighlights(state);
  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";
  /**
   * A quick round rather than a tournament. Same question `/entry` and
   * `/dashboard` already ask, under the same name.
   *
   * The TABLE is identical either way and deliberately so — where you stand is
   * exactly what a golfer wants afterwards, which is why `nav.ts` keeps this
   * screen for a casual round. What changes is the sentences around it: see
   * `board-copy.ts` for the four that were not true of a fourball.
   */
  const casualRound = isMatch(state.event.shape);
  const boardCopy = {
    // The ROUND this board is showing, not the event around it — the
    // footnote describes what is on screen. Its `stableford` neighbour has
    // always read the stage, which is half of the same question.
    isStroke: state.boardIsStroke,
    stableford: activeStage?.scoringBasis === "stableford",
    casual: casualRound,
  };
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
          // Wraps on a phone. The freshness label replaced a short "Updating
          // live" tag and is longer than it, so on a 393px screen the pair no
          // longer fits one line — and a space-between row that cannot wrap
          // does not shrink, it overflows. `layout.spec` measured 402px in a
          // 393px viewport.
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 20,
        }}
      >
        <div>
          <div className="page-kicker">Overview</div>
          <h1 style={{ fontSize: 27, margin: "5px 0 0" }}>Live leaderboard</h1>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {boardIntro(boardCopy)}
          </p>
        </div>
        {/* This was a STATIC badge reading "Updating live", on a page that did
            not update. `LiveRefresh` was mounted on the public spectator board
            and nowhere else, so the console screen actually called "Live
            leaderboard" changed only when somebody reloaded it — and said
            otherwise, in the interface, in an accent colour.

            The same component now, so the claim and the polling are the same
            code: it refreshes every 30s while the tab is visible, wakes on
            focus and on reconnect, and reports the age of what is on screen
            from a timestamp the SERVER stamped — so the label ageing IS the
            failure showing through, rather than a client clock ticking
            cheerfully over a dead connection. */}
        <LiveRefresh renderedAt={new Date().toISOString()} compact />
      </div>

      {boardShowsHighlights(casualRound) && highlights.length > 0 && (
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

      {/* WHY THE BOARD IS EMPTY, on the screen where somebody is looking at it
          being empty.

          Staff only, and deliberately: the remedy is a setting on Tournament
          details, so telling a player about it is telling them about a screen
          they cannot open. What a player sees is unchanged — which is still
          wrong, and the fix for them is the organizer acting on this.

          See `scoringMismatch` for the tournament this was measured on: four
          cards returned, and a match-points table of zeroes above them. */}
      {isStaff && mismatch && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            padding: "10px 12px",
            borderRadius: 10,
            marginBottom: 12,
            background: "var(--color-danger-bg)",
            border: "1px solid color-mix(in srgb, var(--color-danger) 40%, transparent)",
          }}
        >
          <p style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
            <b>Nothing here can be ranked.</b> {mismatch.message}{" "}
            <Link href="/event" style={{ color: "var(--color-accent)" }}>
              Tournament details
            </Link>
          </p>
        </div>
      )}

      <div className="card elev-sm">
        <LeaderboardBoard isStroke={state.boardIsStroke} isStableford={activeStage?.scoringBasis === "stableford"} rows={rows} isStaff={isStaff} />
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          {boardFootnote(boardCopy)}
        </p>
      </div>

      {boardShowsCommentary(casualRound) && (
        <div style={{ marginTop: 16 }}>
          <CommentaryPanel
            items={commentaryItems}
            canPost={isStaff}
            aiAvailable={(await entitlementForEvent(session.eventId, "aiAssist")).allowed}
          />
        </div>
      )}
    </>
  );
}
