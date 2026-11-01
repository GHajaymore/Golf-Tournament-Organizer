import Link from "next/link";
import { requireScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { reportAudienceFor, reportFor } from "@/lib/services/event-report";
import { FinalReport } from "@/components/FinalReport";
import { EventReport } from "@/components/EventReport";
import { ReportRecapEditor } from "@/components/ReportRecapEditor";
import { PrintReportButton } from "@/components/PrintReportButton";
import { ReportSettingsPanel } from "@/components/ReportSettingsPanel";
import { ReportForPlayersOnly } from "@/components/ReportForPlayersOnly";
import { isLeaderboardPublic } from "@/lib/tournament-settings";
import { settingsOf } from "@/lib/services/tournament";
import { reportAmountsOf, reportOpenToPublic, reportVisibilityOf } from "@/lib/domain/report-settings";

export const metadata = { title: "Final report" };

/**
 * ANY TOURNAMENT'S FINAL REPORT, in the console (2026-10-19): the page the club
 * sends round, with — for staff — the story to write above it and the link to
 * send. The same report as `/live/<token>/report`, from the same readers, so
 * what the organizer reads here is what everybody is sent. A cup's is also at
 * `/cup/report`, beside the cup.
 *
 * ITS SETTINGS LIVE HERE (2026-10-24): one line saying them in words beside
 * the link, Change, and "See it as the public does" (`?as=public`), which draws
 * the copy a visitor gets — names withheld, amounts as the setting says, or
 * the players-only message — inside the console.
 */
export default async function FinalReportPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const session = await requireScreen("reports");
  const { as } = await searchParams;
  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";
  const asPublic = isStaff && as === "public";
  // The organizer's copy carries the amounts and the whole settle-up; anybody
  // else who reaches this screen gets what they would on the link — see
  // `reportAudienceFor`.
  const audience = asPublic ? ({ kind: "public" } as const) : await reportAudienceFor(session.eventId, { email: session.email, staff: isStaff });
  const [found, event] = await Promise.all([
    reportFor(session.eventId, audience),
    prisma.event.findUnique({ where: { id: session.eventId } }),
  ]);
  const boardPublic = !!event && isLeaderboardPublic(settingsOf(event));
  const shareable = !!event && reportOpenToPublic(boardPublic, event.reportVisibility);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="no-print" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <Link href="/reports">← Reports &amp; export</Link>
        {found && <PrintReportButton />}
        {found && boardPublic && (
          <Link href={`/live/${event!.shareToken}/report`} target="_blank">
            Open the report&rsquo;s link
          </Link>
        )}
        {asPublic && <Link href="/reports/final">Back to your copy</Link>}
      </div>
      {found && isStaff && event && (
        <ReportSettingsPanel
          visibility={reportVisibilityOf(event.reportVisibility)}
          amounts={reportAmountsOf(event.reportAmounts)}
          boardPublic={boardPublic}
        />
      )}
      {!found ? (
        <>
          <h1 className="page-title">Final report</h1>
          <div className="card elev-sm" style={{ maxWidth: "62ch" }}>
            <p style={{ margin: 0, lineHeight: 1.6 }}>There is no report for this round yet.</p>
          </div>
        </>
      ) : (
        <>
          {isStaff && !boardPublic && !asPublic && (
            <p className="text-muted no-print" style={{ margin: 0, fontSize: 13.5, maxWidth: "70ch" }}>
              Only people signed in can see this tournament&rsquo;s leaderboard, so the report is for the players in it.
              To share it more widely, set <strong>Who can see the leaderboard</strong> to <strong>Anyone with the link</strong> in{" "}
              <Link href="/event">Tournament details</Link> → Players &amp; scoring.
            </p>
          )}
          {isStaff && !asPublic && (
            <div className="no-print">
              <ReportRecapEditor recap={event?.reportRecap ?? ""} />
            </div>
          )}
          {asPublic && (
            <p className="text-muted no-print" style={{ margin: 0, fontSize: 13.5 }}>
              This is the copy somebody who is not in the field is shown.
            </p>
          )}
          <div style={{ borderRadius: 14, overflow: "hidden" }}>
            {asPublic && !shareable ? (
              <ReportForPlayersOnly embedded />
            ) : found.kind === "cup" ? (
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
