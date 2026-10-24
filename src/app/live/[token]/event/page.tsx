import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { NOINDEX } from "@/lib/site";
import { settingsOf } from "@/lib/services/tournament";
import { isLeaderboardPublic } from "@/lib/tournament-settings";
import { liveBoard } from "@/lib/services/live-board";
import { cupBoard } from "@/lib/services/cup";
import { openRegistrationView, roundsLabelOf } from "@/lib/services/registration";
import { reportFor } from "@/lib/services/event-report";
import { OrgBrand } from "@/components/OrgBrand";
import { LOGO_SIZE } from "@/components/Logo";
import { PublicContests } from "@/components/PublicContests";
import { EventEntryPoster } from "@/components/EventEntryPoster";
import { PlaySuspendedBanner } from "@/components/PlaySuspendedBanner";
import { playStatusOf } from "@/lib/domain/play-status";
import { golfTermsForEvent } from "@/lib/services/organization";
import { isMatch } from "@/lib/tournament-shape";
import { formatDeadline } from "@/lib/deadline";
import { eventLinks, eventPhase, eventSections, finalReportReady, type EventSection } from "@/lib/domain/event-page";

/**
 * THE EVENT PAGE — ONE LINK A SECRETARY SENDS BEFORE AND AFTER THE DAY (2026-10-24).
 *
 * `/live/<token>/event`. It joins what already exists rather than repeating
 * any of it: the tournament's name, date, course and format; the entry link
 * and its QR poster while entries are open (`/register/<token>`, the form the
 * club already sends); the live board and the clubhouse screen on the day; the
 * final report's summary and link afterwards; and the contests' sponsors,
 * stored on the contests themselves. `domain/event-page.ts` decides what leads.
 *
 * A LINK, NOT AN EMAIL (the standing decision: no email except sign-up).
 *
 * THE BOARD'S CREDENTIAL AND THE BOARD'S RULE. The share token, and a board
 * set to "Anyone with the link", checked here on every request, uncached; a
 * wrong token, a board held from players (results not released) and a board
 * kept to players all answer the same 404 as `/live/<token>` — so the event
 * page can be switched off with the board, and never confirms a tournament
 * exists. What it shows of results is the PUBLIC report's: winners' names,
 * never what anybody won.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const event = await prisma.event.findUnique({
    where: { shareToken: token },
    select: { name: true, leaderboardVisibility: true },
  });
  // Never indexed, and the name kept out of the tab unless the board is public — as the board does.
  if (!event || event.leaderboardVisibility !== "public") return { title: "Event", robots: NOINDEX };
  return { title: event.name, robots: NOINDEX };
}

const kicker: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: "var(--color-accent-200)",
  margin: 0,
};

const card: React.CSSProperties = {
  border: "1px solid var(--color-divider)",
  borderRadius: 12,
  padding: "16px 16px",
  display: "grid",
  gap: 10,
  minWidth: 0,
};

const button: React.CSSProperties = { minHeight: 44, display: "inline-flex", alignItems: "center", fontWeight: 600 };

export default async function PublicEventPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // The credential check — the board's, uncached, on every request.
  const event = await prisma.event.findUnique({
    where: { shareToken: token },
    include: { stages: { select: { type: true, format: true }, orderBy: { position: "asc" } } },
  });
  if (!event || !isLeaderboardPublic(settingsOf(event))) notFound();

  const board = await liveBoard(event.id);
  if (!board) notFound();
  const [cup, entries, scoredRows] = await Promise.all([
    cupBoard(event.id),
    // Null unless the entry link is open and taking entries — the form's own judgement.
    openRegistrationView(event.registrationToken ?? ""),
    // Any result anywhere: a stroke card, a side's card, a knockout tie.
    Promise.all([
      prisma.scorecard.count({ where: { eventId: event.id } }),
      prisma.teamScorecard.count({ where: { eventId: event.id } }),
      prisma.bracketWinner.count({ where: { eventId: event.id } }),
    ]).then((counts) => counts.reduce((a, b) => a + b, 0)),
  ]);

  const phase = eventPhase(event.status, scoredRows > 0);
  const reportReady = finalReportReady({
    status: event.status,
    casual: isMatch(event.shape),
    cupVerdict: cup.ok ? cup.board.verdict.kind : null,
  });
  // The PUBLIC copy, always: this page is for anybody holding the link.
  const report = reportReady ? await reportFor(event.id, { kind: "public" }) : null;
  const sections = eventSections({ phase, entriesOpen: !!entries, reportReady: !!report });
  const links = eventLinks(token);
  const format = roundsLabelOf(event.stages);
  const { organizer } = await golfTermsForEvent(event.id);

  const block = (s: EventSection) => {
    if (s === "report" && report) {
      const r = report.report;
      return (
        <section key={s} aria-label="Final report" style={card}>
          <p style={kicker}>The result</p>
          {r.ribbon && <p style={{ margin: 0, fontSize: 20, fontWeight: 700, fontFamily: "var(--font-heading)", textWrap: "balance" }}>{r.ribbon}</p>}
          {r.story[0] && <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>{r.story[0]}</p>}
          <p style={{ margin: 0 }}>
            <Link href={links.report} className="btn btn-primary" style={button}>
              Read the final report
            </Link>
          </p>
        </section>
      );
    }
    if (s === "entries" && entries) {
      return (
        <section key={s} aria-label="Entries" style={card}>
          <p style={kicker}>Entries are open</p>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>
            {entries.waitlistOnly
              ? "The field is full — entering puts you on the waiting list."
              : entries.spotsLeft === null
                ? "Enter online — no account needed."
                : `${entries.spotsLeft} ${entries.spotsLeft === 1 ? "place" : "places"} left. Enter online — no account needed.`}
            {entries.regDeadline ? ` Entries close ${formatDeadline(entries.regDeadline, entries.locale)}.` : ""}
          </p>
          <p style={{ margin: 0 }}>
            <Link href={`/register/${entries.token}`} className="btn btn-primary" style={button}>
              Enter this tournament
            </Link>
          </p>
          <EventEntryPoster path={`/register/${entries.token}`} name={event.name} when={board.dates} where={board.venue} />
        </section>
      );
    }
    if (s === "board") {
      return (
        <section key={s} aria-label="Leaderboard" style={card}>
          <p style={kicker}>{phase === "during" ? "Live now" : "Leaderboard"}</p>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>
            {phase === "before"
              ? "Scores appear here once play begins, and update on their own."
              : phase === "during"
                ? "Follow the scores as they come in. The board updates on its own."
                : "The final standings."}
          </p>
          <p style={{ margin: 0 }}>
            <Link href={links.board} className={phase === "during" ? "btn btn-primary" : "btn btn-secondary"} style={button}>
              Open the leaderboard
            </Link>
          </p>
        </section>
      );
    }
    if (s === "clubhouse") {
      return (
        <section key={s} aria-label="Clubhouse screen" style={card}>
          <p style={kicker}>In the clubhouse</p>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>
            The same leaderboard for a TV: large type, a page at a time, updating on its own.
          </p>
          <p style={{ margin: 0 }}>
            <Link href={links.clubhouse} className="btn btn-secondary" style={button}>
              Open the clubhouse screen
            </Link>
          </p>
        </section>
      );
    }
    return null;
  };

  const facts = [board.dates, board.venue].filter(Boolean).join(" · ");

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
      <main style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <OrgBrand brand={board.brand} size={LOGO_SIZE.lg} tagline />
        </div>

        <PlaySuspendedBanner status={playStatusOf(event)} organizer={organizer} />

        <header style={{ marginBottom: 20 }}>
          <p style={kicker}>{phase === "after" ? "Finished" : phase === "during" ? "Under way" : "Coming up"}</p>
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
          {facts && <p style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.5 }}>{facts}</p>}
          <p style={{ margin: "4px 0 0", fontSize: 14, lineHeight: 1.5, color: "var(--color-neutral-400)" }}>{format}</p>
        </header>

        <div data-event-sections style={{ display: "grid", gap: 14 }}>{sections.map(block)}</div>

        {/* The contests and who sponsors them, across the whole tournament —
            the board's own reader, so this page and the board cannot disagree. */}
        <PublicContests eventId={event.id} stageId={null} />
      </main>
    </div>
  );
}
