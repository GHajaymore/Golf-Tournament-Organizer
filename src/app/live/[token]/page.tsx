import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { NOINDEX } from "@/lib/site";
import { settingsOf } from "@/lib/services/tournament";
import { isLeaderboardPublic } from "@/lib/tournament-settings";
import { PublicBoard, boardEventOf } from "@/components/PublicBoard";

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
  return { title: `${event.name} — Leaderboard`, robots: NOINDEX };
}

export default async function PublicLeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ round?: string; screen?: string }>;
}) {
  const { token } = await params;
  const { round, screen } = await searchParams;
  /**
   * THE CLUBHOUSE SCREEN (2026-10-24): this same board, framed for a TV in the
   * bar — large type, nothing to press, a page at a time (`ClubhouseScreen`).
   * A MODE OF THIS PAGE rather than a page of its own, so it passes the same
   * credential check above, reads the same board, and draws it with the same
   * components below: it cannot show anything this board does not. Every
   * difference is chrome, and each is marked `clubhouse` where it is made.
   */
  const clubhouse = screen === "clubhouse";

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


  // What is drawn is `PublicBoard`, which `/play/board` draws too (2026-11-05).
  return <PublicBoard event={boardEventOf(event)} round={round} clubhouse={clubhouse} reportHref={`/live/${token}/report`} />;
}
