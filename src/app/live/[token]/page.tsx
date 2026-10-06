import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { NOINDEX } from "@/lib/site";
import { settingsOf } from "@/lib/services/tournament";
import { liveBoard } from "@/lib/services/live-board";
import {
  SkinsStandingsTable,
  NassauMatches,
  ModifiedStablefordTable,
  SKINS_NOTE,
  NASSAU_NOTE,
  MOD_STABLEFORD_NOTE,
} from "@/components/PointsLeaderboard";
import { TeamStandingsTable, teamBoardNote } from "@/components/TeamLeaderboard";
import { EmbeddedBoard } from "@/components/EmbeddedBoard";
import { TeamMatchLeaderboard } from "@/components/TeamMatchLeaderboard";
import { isLeaderboardPublic } from "@/lib/tournament-settings";
import { PlayerLeaderboard } from "@/components/PlayerLeaderboard";
import { TheDraw } from "@/components/TheDraw";
import { OrgBrand } from "@/components/OrgBrand";
import { LOGO_SIZE } from "@/components/Logo";
import { LiveRefresh } from "@/components/LiveRefresh";
import { RoundPicker } from "@/components/RoundPicker";
import { cupBoard } from "@/lib/services/cup";
import { CupScoreboard } from "@/components/CupScoreboard";
import { PlaySuspendedBanner } from "@/components/PlaySuspendedBanner";
import { playStatusOf } from "@/lib/domain/play-status";
import { golfTermsForEvent } from "@/lib/services/organization";

/**
 * The public read-only leaderboard.
 *
 * Deliberately outside the (app) group: no session, no sidebar, no role. The
 * share token is the only credential, and it grants exactly one thing —
 * looking at the standings of one tournament.
 *
 * Nothing here may render contact details or anything a spectator shouldn't
 * see. The page shows names, positions and scores; that is the whole contract.
 */

// Standings move as scores come in, so this must never be served stale from
// the full route cache.
export const dynamic = "force-dynamic";

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

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const event = await prisma.event.findUnique({
    where: { shareToken: token },
    select: { name: true, leaderboardVisibility: true },
  });
  /**
   * NEVER INDEXED, whether or not the board is public.
   *
   * "Public" here means "anyone holding the link may read it" — it is not a
   * decision to publish members' names to the open web, and a club that ticks
   * it is not agreeing to that. This page shows names, positions and scores of
   * real people; the token keeps it out of a crawler's reach, but a board link
   * posted on a club website or passed through a link-preview service is a
   * fetch nothing else refuses.
   *
   * The tab title still hides the tournament's name on a non-public board, for
   * the separate reason that a title leaks through browser history and link
   * previews even when the body does not.
   */
  if (!event || event.leaderboardVisibility !== "public") {
    return { title: "Leaderboard", robots: NOINDEX };
  }
  return { title: `${event.name} — Live leaderboard`, robots: NOINDEX };
}

export default async function PublicLeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ round?: string }>;
}) {
  const { token } = await params;
  const { round } = await searchParams;

  /**
   * The credential check, on every request, uncached.
   *
   * The share token IS the credential and `leaderboardVisibility` IS the
   * permission, so neither may be answered from a cache. A club that
   * unpublishes its leaderboard is not asking to be unpublished within a
   * minute — it is asking now. One query is the right price for that, and it
   * is the one query the board cache must never absorb.
   *
   * Same response whether the token is wrong or the organizer has unpublished:
   * a 404 either way, so the link can be switched off without confirming that
   * the tournament exists.
   */
  const event = await prisma.event.findUnique({ where: { shareToken: token } });
  if (!event || !isLeaderboardPublic(settingsOf(event))) notFound();

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
  const board = await liveBoard(event.id, picked);
  if (!board) notFound();
  const cup = await cupBoard(event.id);

  return (
    <div
      id="player-theme"
      style={{
        colorScheme: board.colorScheme,
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        padding: "20px 16px 48px",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: board.themeStyleSheet }} />
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
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
              fontSize: 11,
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
                background: board.allIn ? "var(--color-neutral-400)" : "var(--color-accent)",
              }}
            />
            {board.allIn ? "Final" : "Live"}
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
          {board.rounds.length > 1 && !cup.ok && (
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

        {/* A TEAM CUP'S SCORE — the figure everybody following the trip opened
            this link for, and the whole of the board for a cup.

            The session's own board used to follow it: a pairs round robin
            table ("P W ½ L · PTS" for each pair) that ranks nothing a cup is
            decided on, under a "Showing Round 1 · Four-Ball" picker that
            chose between tables of it. The cup board already lists every
            match in every session. */}
        {cup.ok ? (
          <CupScoreboard board={cup.board} />
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
            <TeamStandingsTable basis={board.teamBasis} rows={board.teamRows} />
          </EmbeddedBoard>
        ) : board.kind === "skins" && board.skins ? (
          <EmbeddedBoard note={SKINS_NOTE(board.skinsNet)}>
            <SkinsStandingsTable board={board.skins} />
          </EmbeddedBoard>
        ) : board.kind === "nassau" && board.nassau ? (
          <EmbeddedBoard note={NASSAU_NOTE}>
            <NassauMatches rows={board.nassau} />
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

        {!cup.ok && board.draws.length > 0 && <TheDraw draws={board.draws} results={board.bracketResults} />}

        {/*
          Stamped HERE, outside the cache, on every request.

          This is the one value that must not be cached with the board. The
          label built on it tells a spectator how long since scores actually
          reached them, and a timestamp travelling inside the cached payload
          would report the CACHE's age instead of the RESPONSE's — so a board
          served from a minute-old entry would announce itself as "updated just
          now". That is precisely the lie the label exists to prevent, and it
          would have no visible symptom.
        */}
        <LiveRefresh renderedAt={new Date().toISOString()} final={board.allIn} />
      </div>
    </div>
  );
}
