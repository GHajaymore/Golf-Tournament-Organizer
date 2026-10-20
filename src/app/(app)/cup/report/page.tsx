import Link from "next/link";
import { requireScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { finalReport } from "@/lib/services/final-report";
import { FinalReport } from "@/components/FinalReport";
import { ReportRecapEditor } from "@/components/ReportRecapEditor";
import { isLeaderboardPublic } from "@/lib/tournament-settings";
import { settingsOf } from "@/lib/services/tournament";

export const metadata = { title: "Final report" };

/**
 * THE CUP'S FINAL REPORT, in the console (2026-10-19): the page the club sends
 * round, with — for staff — the story to write above it and the link to send.
 *
 * It is the SAME report as `/live/<token>/report`, from the same published
 * board, so what the organizer reads here is what everybody is sent.
 */
export default async function CupReportPage() {
  const session = await requireScreen("cup");
  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";
  const [report, event] = await Promise.all([
    finalReport(session.eventId),
    prisma.event.findUnique({ where: { id: session.eventId } }),
  ]);
  const shareable = event && isLeaderboardPublic(settingsOf(event));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <Link href="/cup">← Team cup</Link>
        {report && shareable && (
          <Link href={`/live/${event!.shareToken}/report`} target="_blank">
            Open the report&rsquo;s public link
          </Link>
        )}
      </div>
      {!report ? (
        <>
          <h1 className="page-title">Final report</h1>
          <div className="card elev-sm" style={{ maxWidth: "62ch" }}>
            <p style={{ margin: 0, lineHeight: 1.6 }}>
              The final report is for a team cup. It appears once the cup has its two teams and a session of matches —
              see <Link href="/cup">Team cup</Link>.
            </p>
          </div>
        </>
      ) : (
        <>
          {isStaff && !shareable && (
            <p className="text-muted" style={{ margin: 0, fontSize: 13.5, maxWidth: "70ch" }}>
              The report has no link to send yet: only people signed in can see this tournament&rsquo;s leaderboard. To
              share it, set <strong>Who can see the leaderboard</strong> to <strong>Anyone with the link</strong> in{" "}
              <Link href="/event">Tournament details</Link> → Players &amp; scoring.
            </p>
          )}
          {isStaff && <ReportRecapEditor recap={event?.reportRecap ?? ""} />}
          <div style={{ borderRadius: 14, overflow: "hidden" }}>
            <FinalReport report={report} embedded />
          </div>
        </>
      )}
    </div>
  );
}
