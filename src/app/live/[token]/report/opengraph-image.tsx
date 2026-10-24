import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { reportCardInput, reportFor } from "@/lib/services/event-report";
import { reportCard } from "@/lib/domain/report-card";
import { Logo, LOGO_SIZE } from "@/components/Logo";
import { SHARE_CARD } from "@/lib/themes";

/**
 * THE REPORT'S OWN PREVIEW (2026-10-23). Until this file the report's link
 * unfurled as the board's picture — the standings, LIVE — after the event was
 * over. A report says who won, so its card does: the club's name large, the
 * event, CHAMPION (or "Leads" while it is played), the figure, one highlight,
 * and the TourneyHQ mark small at the foot.
 *
 * WHAT IT MAY SHOW IS DECIDED IN `reportCard`, NOT HERE — a board that is not
 * public gets a card naming nobody — and it is drawn from the PUBLIC copy of
 * the report, which carries no amount, so no setting can put one on it.
 */

export const runtime = "nodejs";
export const alt = "Golf tournament report on TourneyHQ";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const {
  bg: BG,
  surface: SURFACE,
  text: TEXT,
  muted: MUTED,
  accent: ACCENT,
  fairway: FAIRWAY,
  divider: DIVIDER,
} = SHARE_CARD;

function Mark({ size: s = LOGO_SIZE.share }: { size?: number }) {
  return <Logo size={s} colors={{ flag: ACCENT, stick: TEXT, ball: FAIRWAY }} />;
}

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const event = await prisma.event.findUnique({
    where: { shareToken: token },
    select: { id: true, leaderboardVisibility: true },
  });
  const visibility = event?.leaderboardVisibility ?? "";
  const found = event && visibility === "public" ? await reportFor(event.id, { kind: "public" }) : null;
  const card = reportCard(found ? reportCardInput(found) : null, visibility);

  if (card.kind === "private") {
    return new ImageResponse(
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          background: BG,
        }}
      >
        <Mark size={LOGO_SIZE.shareHero} />
        <div
          style={{
            display: "flex",
            fontSize: 66,
            fontWeight: 700,
            letterSpacing: -2,
          }}
        >
          <span style={{ color: TEXT }}>Tourney</span>
          <span style={{ color: ACCENT }}>HQ</span>
        </div>
        <div style={{ display: "flex", color: MUTED, fontSize: 26 }}>{card.subtitle}</div>
      </div>,
      size,
    );
  }

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: BG,
        padding: "48px 64px 36px",
      }}
    >
      {card.club ? (
        <div
          style={{
            display: "flex",
            color: ACCENT,
            fontSize: 40,
            fontWeight: 700,
            letterSpacing: 2,
          }}
        >
          {card.club.toUpperCase()}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          color: TEXT,
          fontSize: 50,
          fontWeight: 700,
          letterSpacing: -1,
          marginTop: 10,
        }}
      >
        {card.event}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: 34,
          padding: "26px 32px",
          borderRadius: 18,
          background: SURFACE,
          flexGrow: 1,
        }}
      >
        {card.label ? (
          <div
            style={{
              display: "flex",
              color: ACCENT,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 4,
            }}
          >
            {card.label.toUpperCase()}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            color: TEXT,
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: -1.5,
            marginTop: 6,
          }}
        >
          {card.names || "Results"}
        </div>
        {card.figure ? (
          <div style={{ display: "flex", color: TEXT, fontSize: 34, marginTop: 8 }}>{card.figure}</div>
        ) : null}
        {card.highlight ? (
          <div
            style={{
              display: "flex",
              color: MUTED,
              fontSize: 26,
              marginTop: 14,
            }}
          >
            {card.highlight}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 10,
          borderTop: `1px solid ${DIVIDER}`,
          paddingTop: 14,
          marginTop: 22,
        }}
      >
        <Mark size={LOGO_SIZE.share} />
        <div style={{ display: "flex", color: MUTED, fontSize: 22 }}>Results by TourneyHQ</div>
      </div>
    </div>,
    size,
  );
}
