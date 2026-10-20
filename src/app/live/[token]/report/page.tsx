import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { NOINDEX } from "@/lib/site";
import { settingsOf } from "@/lib/services/tournament";
import { isLeaderboardPublic } from "@/lib/tournament-settings";
import { finalReport } from "@/lib/services/final-report";
import { FinalReport } from "@/components/FinalReport";

/**
 * A team cup's final report, for anybody holding the board's link.
 *
 * The same credential as `/live/<token>` and the same rule: the share token
 * and a public leaderboard, checked on every request, and one 404 for a wrong
 * token, an unpublished board and a tournament that is not a cup. It shows
 * what the public board shows — names, matches and points — and nothing else.
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
  const report = await finalReport(event.id);
  if (!report) notFound();
  return (
    <FinalReport
      report={report}
      footer={
        <Link href={`/live/${token}`} className="fr-noprint">
          The live board
        </Link>
      }
    />
  );
}
