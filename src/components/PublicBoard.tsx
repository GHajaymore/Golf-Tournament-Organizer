import Link from "next/link";
import { notFound } from "next/navigation";
import type { Event } from "@prisma/client";
import { prisma } from "@/lib/db";
import { liveBoard } from "@/lib/services/live-board";
import { publicCopy } from "@/lib/services/public-names";
import {
  SkinsStandingsTable,
  NassauMatches,
  ModifiedStablefordTable,
  SKINS_NOTE,
  NASSAU_NOTE,
  MOD_STABLEFORD_NOTE,
} from "@/components/PointsLeaderboard";
import { PairTotalsTable, TeamStandingsTable, teamBoardNote } from "@/components/TeamLeaderboard";
import { EmbeddedBoard } from "@/components/EmbeddedBoard";
import { TeamMatchLeaderboard } from "@/components/TeamMatchLeaderboard";
import { PlayerLeaderboard } from "@/components/PlayerLeaderboard";
import { TheDraw } from "@/components/TheDraw";
import { KnockoutNews } from "@/components/KnockoutNews";
import { OrgBrand } from "@/components/OrgBrand";
import { LOGO_SIZE } from "@/components/Logo";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ClubhouseScreen } from "@/components/ClubhouseScreen";
import { DemoClubLabel } from "@/components/DemoClubLabel";
import { finalReportReady } from "@/lib/domain/event-page";
import { RoundPicker } from "@/components/RoundPicker";
import { cupBoard } from "@/lib/services/cup";
import { CupScoreboard } from "@/components/CupScoreboard";
import { PlaySuspendedBanner } from "@/components/PlaySuspendedBanner";
import { CommentaryFeed } from "@/components/CommentaryFeed";
import { PublicContests } from "@/components/PublicContests";
import { playStatusOf } from "@/lib/domain/play-status";
import { golfTermsForEvent } from "@/lib/services/organization";
import { isMatch } from "@/lib/tournament-shape";

/**
 * THE BOARD, DRAWN ONCE (2026-11-05) — for the two doors that open it.
 *
 * `/live/<token>` (anyone with the link, a board the organizer made public) and
 * `/play/board` (somebody holding a round code, where the organizer lets the
 * players see it) used to be one page and one door. They are two doors now and
 * must draw the SAME board, so what is drawn lives here and each page does
 * only its own gate: the token and the public setting, or the play session and
 * `mayOpenBoard`. Both come out the other side of `publicCopy`, so a player
 * whose entry says "Don't show my name on public pages" is withheld from
 * either (a code holder is not given more than the public is).
 *
 * What differs is data, not drawing: the final report's address is `/live`'s
 * (`reportHref`), and a code holder is given none, because the report page's
 * gate is the public setting and the code holder's door must not widen it.
 */

/**
 * What a spectator sees for a round the app does not score.
 *
 * The console has an organizer standing next to it who knows the app isn't
 * working the result out. This page does not — a table here is read as the
 * result by whoever opened the link, and there is nobody to correct it. So it
 * says plainly that there is no live board for this round and where the result
 * will come from.
 */
function PublicManualNotice() {
  return (
    <div
      style={{
        border: "1px solid var(--color-divider)",
        borderRadius: 12,
        padding: "22px 20px",
        textAlign: "center",
        lineHeight: 1.65,
      }}
    >
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>This round is scored by hand</p>
      <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--color-neutral-400)" }}>
        {/* No promise about WHEN: this also renders under "Final · these scores
            no longer change" on a finished tournament, where "posts it when it
            is settled" was a future tense over a result long since decided. */}
        There is no leaderboard for it here — the committee works out the result.
      </p>
    </div>
  );
}

/**
 * The fields of the tournament this board draws from. A page fetches the whole
 * row (settings, share token and all) to check its gate; what crosses into the
 * board is these six and nothing else (`public-surface.test.ts`).
 */
export type BoardEvent = Pick<Event, "id" | "status" | "shape" | "organizationId" | "playSuspendedAt" | "playSuspendedNote">;

export function boardEventOf(e: Event): BoardEvent {
  return {
    id: e.id,
    status: e.status,
    shape: e.shape,
    organizationId: e.organizationId,
    playSuspendedAt: e.playSuspendedAt,
    playSuspendedNote: e.playSuspendedNote,
  };
}

export async function PublicBoard({
  event,
  round,
  clubhouse,
  reportHref,
}: {
  /** The tournament, already checked by the page that calls this; the six fields drawn from, never the row (`boardEventOf`). */
  event: BoardEvent;
  /** `?round=`, unchecked: it is validated here against this tournament's own rounds. */
  round?: string;
  clubhouse: boolean;
  /** Where the final report is, or null when this door does not open it. */
  reportHref: string | null;
}) {
  /**
   * And everything else from one computation the crowd shares.
   *
   * Measured at 20.7 database queries per request before this: every spectator
   * commissioning their own copy of an answer identical to their neighbour's,
   * thirty seconds apart, for five hours. See services/live-board.ts.
   */
  /**
   * WHICH ROUND — the picked one, if it is one of THIS tournament's (Ajay,
   * 2026-09-27). Checked here, uncached and only when asked, because the round
   * is part of the board's cache key: a made-up id must fall back to the
   * board's own round rather than become an entry of its own.
   */
  const picked =
    round && (await prisma.stage.findFirst({ where: { id: round, eventId: event.id }, select: { id: true } }))
      ? round
      : "";
  // Signed out, so a player whose entry says "Don't show my name on public
  // pages" is withheld from everything drawn here (`publicCopy`, 2026-10-24).
  const board = await publicCopy(event.id, await liveBoard(event.id, picked));
  if (!board) notFound();
  const cup = await publicCopy(event.id, await cupBoard(event.id));
  // Whether there is a final report to link: one rule, shared with the event page.
  const reportReady = finalReportReady({
    status: event.status,
    casual: isMatch(event.shape),
    cupVerdict: cup.ok ? cup.board.verdict.kind : null,
  });

  // The club's mark, a suspension, and the tournament's name: the top of the
  // board, and the top of the clubhouse screen.
  const head = (
      <>
        {/* The demo club says so, on the board and on the clubhouse screen alike. */}
        <DemoClubLabel organizationId={event.organizationId} large={clubhouse} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          {/* lg, the scale's hero size. This board is the club's shopfront
              — the link that goes on the clubhouse screen and to families —
              and the club's own mark led it at the same size it uses beside a
              nav label. The same argument as the landing lockup: on the one
              page whose job is to say whose competition this is, the mark
              should not read as chrome. */}
          <OrgBrand brand={board.brand} size={LOGO_SIZE.lg} tagline />
        </div>

        {/* Read off the event row above, which is uncached, so a suspension
            shows on the next refresh rather than after the board's cache. */}
        <PlaySuspendedBanner
          status={playStatusOf(event)}
          organizer={(await golfTermsForEvent(event.id)).organizer}
        />

        <header style={{ marginBottom: 22 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              // 13px, the label floor (2026-10-06): this is the board a club
              // sends its members, read on a phone like the player app.
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "var(--color-accent-200)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: board.official ? "var(--color-neutral-400)" : "var(--color-accent)",
              }}
            />
            {/* Final only once the committee has closed the round — see
                `official`. Every card complete is "All in": the scores are
                there and still unofficial. */}
            {board.official ? "Final" : board.allIn ? "All in" : "Live"}
          </div>
          <h1
            style={{
              fontSize: 30,
              lineHeight: 1.12,
              margin: "8px 0 0",
              fontFamily: "var(--font-heading)",
              fontWeight: "var(--font-heading-weight)" as unknown as number,
              textWrap: "balance",
            }}
          >
            {board.name}
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5, color: "var(--color-neutral-400)" }}>
            {[cup.ok ? "" : board.roundLabel, board.dates, board.venue].filter(Boolean).join(" · ")}
          </p>
          {/* Every round, not only the latest — the same picker the console
              leaderboard has. Renders nothing where choosing changes nothing,
              which on a cup is everything: its board is every session at once. */}
          {/* Not on the clubhouse screen: nobody can choose from across a bar. */}
          {board.rounds.length > 1 && !cup.ok && !clubhouse && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--color-neutral-400)" }}>Showing</span>
              <RoundPicker
                rounds={board.rounds}
                activeStageId={board.shownStageId}
                label="Which round the leaderboard shows"
                style={{ minWidth: 0, maxWidth: "100%" }}
              />
            </div>
          )}
        </header>
      </>
  );

  // Everything below the name: the same on the board and on the clubhouse
  // screen, but for the buttons, which a TV has nobody to press.
  const rest = (
      <>
        {/* A FINISHED TOURNAMENT'S REPORT (2026-10-19): the whole of it on one
            page, which is what somebody opening this link after the day came
            for. A cup's button sits with the cup board below; a casual round
            has no report. */}
        {!cup.ok && reportReady && !clubhouse && reportHref && (
          <p style={{ margin: "0 0 18px" }}>
            <Link
              href={reportHref}
              className="btn btn-primary"
              style={{ minHeight: 44, display: "inline-flex", alignItems: "center", fontWeight: 600 }}
            >
              Read the final report
            </Link>
          </p>
        )}

        {/* What the committee has said, above the scores it is about. Read on every request, not from the
            board's cache: a line posted is a line the next refresh shows. */}
        <CommentaryFeed eventId={event.id} organizer={(await golfTermsForEvent(event.id)).organizer} />

        {/* A TEAM CUP'S SCORE — the figure everybody following the trip opened
            this link for, and the whole of the board for a cup.

            The session's own board used to follow it: a pairs round robin
            table ("P W ½ L · PTS" for each pair) that ranks nothing a cup is
            decided on, under a "Showing Round 1 · Four-Ball" picker that
            chose between tables of it. The cup board already lists every
            match in every session. */}
        {cup.ok ? (
          <>
            {/* The cup is decided: the whole of it, on one page to send round.
                ABOVE the board, as a button, because once the result is in it
                is what a member opening this link has come for. */}
            {reportReady && !clubhouse && reportHref && (
              <p style={{ margin: "0 0 14px" }}>
                <Link
                  href={reportHref}
                  className="btn btn-primary"
                  style={{ minHeight: 44, display: "inline-flex", alignItems: "center", fontWeight: 600 }}
                >
                  Read the final report
                </Link>
              </p>
            )}
            <CupScoreboard board={cup.board} />
          </>
        ) : board.straightKnockout ? (
          /* A knockout from the first tee: the draw IS the board. Its
             match-points table ranks everybody on nothing (see #633). */
          board.draws.length > 0 ? null : (
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
              The draw appears here as soon as the organizer makes it.
            </p>
          )
        ) : board.manualFormat ? (
          <PublicManualNotice />
        ) : board.kind === "team-match" ? (
          /* A round robin of team matches is decided on the matches, not on
             the cards — see `boardKindForRound`. The console board makes the
             same branch, so a member and an organizer read the same order. */
          <TeamMatchLeaderboard
            format={board.teamFormat}
            rows={board.teamMatchRows}
            system={board.pointsSystem}
          />
        ) : /* The next four without their console heading — this page's
               `<h1>` is the tournament's name. See EmbeddedBoard. */
        board.teamRound ? (
          <EmbeddedBoard note={teamBoardNote(board.teamFormat, board.teamRows.length, board.teamBasis)}>
            {board.pairTotals && <PairTotalsTable totals={board.pairTotals} />}
            <TeamStandingsTable basis={board.teamBasis} rows={board.teamRows} roundClosed={board.official} />
          </EmbeddedBoard>
        ) : board.kind === "skins" && board.skins ? (
          <EmbeddedBoard note={SKINS_NOTE(board.skinsNet)}>
            <SkinsStandingsTable board={board.skins} roundClosed={board.official} />
          </EmbeddedBoard>
        ) : board.kind === "nassau" && board.nassau ? (
          <EmbeddedBoard note={NASSAU_NOTE}>
            <NassauMatches rows={board.nassau} roundClosed={board.official} />
          </EmbeddedBoard>
        ) : board.kind === "modified-stableford" && board.modStableford ? (
          <EmbeddedBoard note={MOD_STABLEFORD_NOTE}>
            <ModifiedStablefordTable rows={board.modStableford} />
          </EmbeddedBoard>
        ) : (
          <PlayerLeaderboard
            isStroke={board.isStroke}
            isStableford={board.isStableford}
            rows={board.rows}
            holes={board.holeCount}
            cutNote={board.cutNote}
            unit={board.unit}
          />
        )}

        {/* A knockout opens on its news — the latest results, who is still in and
            what is still to play — and then the drawing (the panel, 2026-10-23). */}
        {!cup.ok && board.knockoutNews && <KnockoutNews news={board.knockoutNews} />}
        {!cup.ok && board.draws.length > 0 && <TheDraw draws={board.draws} results={board.bracketResults} printTitle={board.name} />}

        {/* Closest to the pin, long drive, and who sponsors them — for the round
            on show, or every round on a cup's all-sessions board. */}
        <PublicContests eventId={event.id} stageId={cup.ok ? null : board.shownStageId || null} />
      </>
  );

  const refresh = (
        /*
          Stamped HERE, outside the cache, on every request.

          This is the one value that must not be cached with the board. The
          label built on it tells a spectator how long since scores actually
          reached them, and a timestamp travelling inside the cached payload
          would report the CACHE's age instead of the RESPONSE's — so a board
          served from a minute-old entry would announce itself as "updated just
          now". That is precisely the lie the label exists to prevent, and it
          would have no visible symptom.

          The clubhouse screen polls through this same component, so a TV
          refreshes on exactly the board's cadence (POLL_MS).
        */
        <LiveRefresh
          renderedAt={new Date().toISOString()}
          final={board.official}
          allIn={board.allIn}
          knockout={board.knockoutRound}
          compact={clubhouse}
        />
  );

  return (
    <div
      id="player-theme"
      style={{
        colorScheme: board.colorScheme,
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        padding: clubhouse ? 0 : "20px 16px 48px",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: board.themeStyleSheet }} />
      {clubhouse ? (
        // Renders its own <main>, filling the screen.
        <ClubhouseScreen head={head} foot={refresh}>
          {rest}
        </ClubhouseScreen>
      ) : (
        /* THE PAGE'S MAIN LANDMARK (2026-10-08). The console and the player
           app each have one; the board a club sends every member had none, so
           a screen reader had no way to jump to the scores. */
        <main style={{ maxWidth: 720, margin: "0 auto" }}>
          {head}
          {rest}
          {refresh}
        </main>
      )}
    </div>
  );
}
