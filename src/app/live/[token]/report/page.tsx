import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { NOINDEX } from "@/lib/site";
import { settingsOf } from "@/lib/services/tournament";
import { isLeaderboardPublic } from "@/lib/tournament-settings";
import { reportAudienceFor, reportFor } from "@/lib/services/event-report";
import { getSession } from "@/lib/auth";
import { FinalReport } from "@/components/FinalReport";
import { EventReport } from "@/components/EventReport";
import { DemoClubLabel } from "@/components/DemoClubLabel";

/**
 * A tournament's final report, for anybody holding the board's link — a
 * cup's (`FinalReport`) or any other's (`EventReport`).
 *
 * The same credential as `/live/<token>` and the same rule: the share token
 * and a public leaderboard, checked on every request, and one 404 for a wrong
 * token, an unpublished board and a casual round. It shows what the public
 * board shows — names, positions, scores, matches and points — and the names
 * of prize, skins and side-game winners; never what anybody won, never the
 * costs or the settle-up.
 *
 * ONE EXCEPTION, the player in the field (2026-10-21, by recommendation): the
 * players' Board links HERE, so somebody signed in with a place in this
 * tournament is shown the amounts and their own settle-up line first, as the
 * organizer's copy shows them (`reportAudienceFor`). A signed-out visitor, and
 * anybody signed in who is not in the field — the organizer checking the link
 * included — gets the public copy.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const event = await prisma.event.findUnique({
    where: { shareToken: token },
    select: { name: true, leaderboardVisibility: true },
  });
  if (!event || event.leaderboardVisibility !== "public") return { title: "Final report", robots: NOINDEX };
  return { title: `${event.name} — Final report`, robots: NOINDEX };
}

export default async function PublicFinalReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const event = await prisma.event.findUnique({ where: { shareToken: token } });
  if (!event || !isLeaderboardPublic(settingsOf(event))) notFound();
  const session = await getSession();
  const audience = await reportAudienceFor(event.id, session ? { email: session.email, staff: false } : null);
  const found = await reportFor(event.id, audience);
  if (!found) notFound();
  const footer = (
    <Link href={`/live/${token}`} className="fr-noprint">
      The live board
    </Link>
  );
  return found.kind === "cup" ? (
    <FinalReport report={found.report} footer={footer} />
  ) : (
    // The demo club's report says it is the demo's (it plays no cup, so only this one needs to).
    <EventReport report={found.report} footer={footer} notice={<DemoClubLabel organizationId={event.organizationId} />} />
  );
}
