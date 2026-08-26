import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { settingsOf } from "@/lib/services/tournament";
import { liveBoard } from "@/lib/services/live-board";
import { SkinsLeaderboard, NassauLeaderboard, ModifiedStablefordLeaderboard } from "@/components/PointsLeaderboard";
import { TeamLeaderboard } from "@/components/TeamLeaderboard";
import { isLeaderboardPublic } from "@/lib/tournament-settings";
import { PlayerLeaderboard } from "@/components/PlayerLeaderboard";
import { OrgBrand } from "@/components/OrgBrand";
import { LOGO_SIZE } from "@/components/Logo";
import { LiveRefresh } from "@/components/LiveRefresh";

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
        There is no live leaderboard for it — the committee works out the result and posts it when
        it is settled.
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
  // Don't leak a tournament's name through the tab title when it isn't public.
  if (!event || event.leaderboardVisibility !== "public") return { title: "Leaderboard" };
  return { title: `${event.name} — Live leaderboard` };
}

export default async function PublicLeaderboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

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
  const board = await liveBoard(event.id);
  if (!board) notFound();

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
          <OrgBrand brand={board.brand} size={LOGO_SIZE.lg} />
        </div>

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
              color: "var(--color-accent-400)",
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
            {[board.roundLabel, board.dates, board.venue].filter(Boolean).join(" · ")}
          </p>
        </header>

        {board.manualFormat ? (
          <PublicManualNotice />
        ) : board.teamRound ? (
          <TeamLeaderboard
            format={board.teamFormat}
            stableford={board.isStableford}
            rows={board.teamRows}
          />
        ) : board.kind === "skins" && board.skins ? (
          <SkinsLeaderboard board={board.skins} net={board.skinsNet} />
        ) : board.kind === "nassau" && board.nassau ? (
          <NassauLeaderboard rows={board.nassau} />
        ) : board.kind === "modified-stableford" && board.modStableford ? (
          <ModifiedStablefordLeaderboard rows={board.modStableford} />
        ) : (
          <PlayerLeaderboard
            isStroke={board.isStroke}
            isStableford={board.isStableford}
            rows={board.rows}
            holes={board.holeCount}
          />
        )}

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
        <LiveRefresh renderedAt={new Date().toISOString()} />
      </div>
    </div>
  );
}
