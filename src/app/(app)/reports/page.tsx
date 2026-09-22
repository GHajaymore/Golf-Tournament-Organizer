import { screenMetadataForEvent } from "@/lib/screen-metadata";
import { hasKnockoutStage } from "@/lib/stage-types";
import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, standingRows } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { ReportsClient } from "@/components/ReportsClient";
import { StatCard } from "@/components/PageHeader";
import { brandForEvent } from "@/lib/services/organization";
import { boardKind } from "@/lib/formats";
import { ManualRoundNotice } from "@/components/ManualRoundBoard";
import { TeamLeaderboard } from "@/components/TeamLeaderboard";
import { weekBasis, isStablefordRound } from "@/lib/domain/week-basis";
import { SkinsLeaderboard, NassauLeaderboard, ModifiedStablefordLeaderboard } from "@/components/PointsLeaderboard";
import { skinsBoard, nassauBoard, modifiedStablefordBoard } from "@/lib/services/points-standings";
import { teamStandings } from "@/lib/services/teams";
import { toParText } from "@/lib/domain";
import { holesPlayed } from "@/lib/domain/handicap";
import { snapshotStanding } from "@/lib/domain/lifecycle-state";
import { attendanceReport, attendanceCsvRows } from "@/lib/services/attendance-report";
import { AttendanceReport } from "@/components/AttendanceReport";

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
export const generateMetadata = () => screenMetadataForEvent("/reports");

export default async function ReportsPage() {
  const session = await requireScreen("reports");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const brand = await brandForEvent(session.eventId);

  const { event } = state;
  const rows = standingRows(state);
  /**
   * THE ROUND ON SCREEN, not the event around it.
   *
   * Reports renders the SAME `LeaderboardTable` the console leaderboard does,
   * off the same `standingRows`. The leaderboard was moved onto `boardIsStroke`
   * when a stroke round inside a match event was found showing a player who had
   * shot 75 a row reading "0-0-0"; this screen was not, so the two printed the
   * same round differently — and this one also writes the CSV, where the column
   * set follows the same flag. Whoever reads the export to award a prize was
   * reading a different board from the one on the wall.
   *
   * The fifth board, found on 2026-09-12 by sweeping the readers of
   * `state.isStroke` after the fourth one shipped a blank score to production.
   */
  const isStroke = state.boardIsStroke;

  // `boardStage` rather than this screen's own `activeStage ?? stages[0]`,
  // which is the expression four boards each wrote for themselves and is
  // exactly how they came to disagree about which round was on screen.
  const activeStage = state.boardStage;
  const kind = boardKind(activeStage?.format);
  const holes = holesPlayed(activeStage?.holes);
  // The card THIS ROUND is played on, narrowed to the nine actually played and
  // re-ranked — Reports has to agree with the leaderboard about which holes a
  // stroke lands on, and with the player's own card about what par is.
  const course = state.strokeCourseFor(activeStage?.id ?? "");

  /**
   * WHETHER THIS SHEET MAY CALL ITSELF FINAL.
   *
   * It always did — "Final standings snapshot" was a constant. Read off the
   * demo tournament: a DRAFT, seven of thirty-three cards in, and twenty-six
   * rows of dashes, under the word Final. See `snapshotStanding`, and note
   * that this is the screen whose own comment calls itself "the one whose
   * output gets printed and pinned up".
   *
   * The NOTE applies to every board below, not just the two whose titles come
   * from here: a skins sheet printed mid-round is exactly as provisional, and
   * naming it "Skins — net" says nothing about that either way.
   */
  const standing = snapshotStanding({
    status: event.status,
    done: state.boardProgress.certified,
    total: state.boardProgress.total,
    unit: state.boardProgress.unit,
    /* A tournament with NO round has the same two zeroes as a round nobody
       has returned a card for, and they are not the same thing. This screen
       said "Nothing returned for this round yet" on a tournament whose Rounds
       screen was still asking for a first one. */
    hasRound: !!activeStage,
  });

  let board: React.ReactNode = null;
  let snapshotTitle = standing.title;
  let extraCsv: { label: string; desc: string; filename: string; rows: string[][] }[] = [];

  /**
   * WHO TURNED OUT — Ajay, 2026-09-21: "build the report of opt in/out."
   *
   * Read unconditionally rather than inside one of the format branches below,
   * because attendance has nothing to do with how a round is scored. A league
   * that scores by hand still has members who came and members who did not,
   * and that is the club most likely to want the spreadsheet.
   *
   * `attendanceReport` answers "this tournament does not track it" as a state
   * rather than an empty grid, so there is nothing to branch on here.
   */
  const attendance = await attendanceReport(state);

  if (kind === "team" && activeStage) {
    const teams = await teamStandings(
      session.eventId,
      activeStage.id,
      activeStage.format,
      course.pars,
      course.holeDifficulty,
      activeStage.scoringBasis,
      activeStage.handicapAllowance,
      activeStage.allowanceWeights,
      activeStage.countBest,
    );
    const stableford = isStablefordRound(activeStage.scoringBasis, activeStage.format);
    // The same rule, with the noun a team round needs — "Final standings" is
    // wrong about a side the same way "Final" is wrong about the day.
    snapshotTitle = snapshotStanding({
      status: event.status,
      done: state.boardProgress.certified,
      total: state.boardProgress.total,
      unit: state.boardProgress.unit,
      noun: "team standings",
    }).title;
    board = <TeamLeaderboard format={activeStage.format} basis={weekBasis(activeStage.scoringBasis, activeStage.format)} rows={teams} />;
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
    const skins = await skinsBoard(session.eventId, activeStage.id, holes, net, course.holeDifficulty);
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
      course.pars,
      course.holeDifficulty,
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
        <h1 className="page-title">Reports &amp; export</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Download standings and results, or print a snapshot.
        </p>
      </div>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Players" value={state.confirmed.length} icon="ph ph-users-three" />
        {/* One fact, counted once. This was a ternary on the event's format
            over two hand-built numbers; `boardProgress` already knows both the
            count and what it is counting. */}
        <StatCard
          label={
            state.boardProgress.unit === "cards"
              ? "Cards in"
              : // A team round returns SIDES, and this tile sits above the
                // sheet that gets printed and pinned up — the one that read
                // "Cards in 0/16" over eight finished foursomes, counting a
                // table the round never writes to against a field of players
                // nobody was asking about.
                state.boardProgress.unit === "sides"
                ? "Sides in"
                : // And a KNOCKOUT is counted in ties. This printed "Matches
                  // complete 0/0" over the seeded club's bracket with five
                  // ties decided — the same number the dashboard was printing
                  // until the rule moved into `boardProgress`, which is why
                  // this screen now gets it without knowing what a bracket is.
                  state.boardProgress.unit === "ties"
                  ? "Ties decided"
                  : // And a round the app does not score counts nothing: this
                    // tile printed "Cards in 0/16" directly above the notice
                    // that says the committee works the result out.
                    state.boardProgress.unit === "manual"
                    ? "Scored by hand"
                    : "Matches complete"
          }
          value={
            // "0/0" under "Scored by hand" is the fraction again, one word
            // later. There is no count to print for a round nothing counts.
            state.boardProgress.unit === "manual"
              ? "—"
              : `${state.boardProgress.certified}/${state.boardProgress.total}`
          }
          icon="ph ph-check-circle"
        />
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
        isStableford={isStablefordRound(activeStage?.scoringBasis, activeStage?.format)}
        eventName={event.name}
        brand={brand}
        scored={kind !== "manual"}
        /* The same rule the sidebar applies to the Bracket link, asked of the
           same two stage types — a medal that ends at the last round has no
           bracket to print. */
        hasBracket={hasKnockoutStage(state.stages)}
        /**
         * Whether a tee sheet has been SAVED for any round, because that is
         * what the printable cards are built from.
         *
         * "Scorecards — Open printable scorecards for the field" sends an
         * organizer to /scorecard, which redirects to the Tee sheet, where
         * `TeeSheetPrint` renders nothing at all until a sheet is saved. On
         * Demo Cup — four rounds, none drawn — that is a link promising
         * printed cards and delivering a pairing screen with no mention of
         * them. Read on 2026-09-11.
         *
         * Any round rather than the active one: the cards are printed per
         * round from the sheet screen, and an organizer who has drawn round 1
         * and is looking at round 2 has not lost the ability to print.
         */
        hasTeeSheet={state.stages.some((s) => {
          try {
            return ((JSON.parse(s.teeSheet || "{}") as { groups?: unknown[] }).groups ?? []).length > 0;
          } catch {
            return false;
          }
        })}
        snapshotTitle={snapshotTitle}
        snapshotNote={standing.note}
        board={board}
        extraCsv={extraCsv}
        /* Offered only where there is something to export — a tournament that
           does not track attendance has no sheet, and a download that comes
           back with one header row teaches an organizer the button is broken. */
        plainCsv={
          attendance.tracked
            ? {
                label: "Who turned out",
                desc: "Every player against every round, in or out, with the season totals.",
                filename: `${event.name}-attendance.csv`,
                rows: attendanceCsvRows(attendance),
              }
            : null
        }
      />
      {/* BELOW the exports, because it is the long one. An organizer opening
          Reports wants the standings sheet first; the attendance grid is what
          they scroll to in September. */}
      <div style={{ marginTop: 16 }}>
        <AttendanceReport report={attendance} />
      </div>
    </>
  );
}
