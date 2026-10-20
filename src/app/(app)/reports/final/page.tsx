import Link from "next/link";
import { requireScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { reportFor } from "@/lib/services/event-report";
import { FinalReport } from "@/components/FinalReport";
import { EventReport } from "@/components/EventReport";
import { ReportRecapEditor } from "@/components/ReportRecapEditor";
import { isLeaderboardPublic } from "@/lib/tournament-settings";
import { settingsOf } from "@/lib/services/tournament";

export const metadata = { title: "Final report" };

/**
 * ANY TOURNAMENT'S FINAL REPORT, in the console (2026-10-19): the page the club
 * sends round, with — for staff — the story to write above it and the link to
 * send. The same report as `/live/<token>/report`, from the same readers, so
 * what the organizer reads here is what everybody is sent. A cup's is also at
 * `/cup/report`, beside the cup.
 */
export default async function FinalReportPage() {
  const session = await requireScreen("reports");
  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";
  const [found, event] = await Promise.all([
    reportFor(session.eventId),
    prisma.event.findUnique({ where: { id: session.eventId } }),
  ]);
  const shareable = event && isLeaderboardPublic(settingsOf(event));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <Link href="/reports">← Reports &amp; export</Link>
        {found && shareable && (
          <Link href={`/live/${event!.shareToken}/report`} target="_blank">
            Open the report&rsquo;s public link
          </Link>
        )}
      </div>
      {!found ? (
        <>
          <h1 className="page-title">Final report</h1>
          <div className="card elev-sm" style={{ maxWidth: "62ch" }}>
            <p style={{ margin: 0, lineHeight: 1.6 }}>
              A casual round has no final report. Its result is on the round&rsquo;s own screen.
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
            {found.kind === "cup" ? (
              <FinalReport report={found.report} embedded />
            ) : (
              <EventReport report={found.report} embedded />
            )}
          </div>
        </>
      )}
    </div>
  );
}
