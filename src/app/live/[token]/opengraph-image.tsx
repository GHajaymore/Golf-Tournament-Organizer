import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { liveBoard } from "@/lib/services/live-board";
import { resultsCard, type BoardForCard } from "@/lib/domain/results-card";
import { Logo, LOGO_SIZE } from "@/components/Logo";
import { SHARE_CARD } from "@/lib/themes";

/**
 * The picture that unfurls when somebody shares a leaderboard link.
 *
 * A club posts its board to a WhatsApp group on a Sunday evening whether we
 * help or not. Until now that link previewed as a bare URL; now it previews as
 * the standings, with the club's name on it. That is the whole marketing
 * mechanism — no button to press, no image to save, nothing anybody has to
 * remember to do.
 *
 * WHAT IT MAY SHOW IS DECIDED IN `resultsCard`, NOT HERE. This file renders
 * whatever it is handed. The rule it exists to respect is that a preview is
 * fetched and cached by servers the club never chose, so a tournament whose
 * board is not public gets a card with no names, no scores and no tournament
 * name — see the tests in results-card.test.ts, which assert the absence
 * rather than trusting this file to remember.
 *
 * Dark ground always. The card renders in someone else's chat app, not in the
 * club's theme, and `auto` resolves dark in this product anyway.
 */

export const runtime = "nodejs";
export const alt = "Live golf leaderboard on TourneyHQ";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const { bg: BG, surface: SURFACE, text: TEXT, muted: MUTED, accent: ACCENT, fairway: FAIRWAY, divider: DIVIDER } =
  SHARE_CARD;

/**
 * The mark, from the one component that draws it.
 *
 * Colours are passed explicitly because Satori has no stylesheet to resolve
 * `--logo-*` against. Drawing it again here instead is what
 * brand-consistency.test.ts exists to stop, and it stopped it.
 */
function Mark({ size: s = LOGO_SIZE.share }: { size?: number }) {
  return (
    <Logo
      size={s}
      colors={{ flag: ACCENT, stick: TEXT, ball: FAIRWAY }}
    />
  );
}

function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Mark />
      <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>
        <span style={{ color: TEXT }}>Tourney</span>
        <span style={{ color: ACCENT }}>HQ</span>
      </div>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const event = await prisma.event.findUnique({
    where: { shareToken: token },
    select: { id: true, leaderboardVisibility: true },
  });

  /**
   * The board is fetched through the SAME cached reader the page uses, so a
   * link pasted into a busy group chat — where a dozen clients each fetch the
   * preview at once — costs the database nothing beyond what the page already
   * paid.
   */
  const board = event?.leaderboardVisibility === "public" ? await liveBoard(event.id) : null;
  const club = board?.brand?.name ?? "";

  const card = resultsCard(
    board ? ({ ...board, rows: board.rows } as unknown as BoardForCard) : null,
    event?.leaderboardVisibility ?? "",
    club,
  );

  if (card.kind === "private") {
    return new ImageResponse(
      (
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
          <div style={{ display: "flex", fontSize: 66, fontWeight: 700, letterSpacing: -2 }}>
            <span style={{ color: TEXT }}>Tourney</span>
            <span style={{ color: ACCENT }}>HQ</span>
          </div>
          <div style={{ display: "flex", color: MUTED, fontSize: 26 }}>{card.subtitle}</div>
        </div>
      ),
      size,
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BG,
          padding: "40px 56px",
        }}
      >
        {/* Club and tournament */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 780 }}>
            {card.club ? (
              <div style={{ display: "flex", color: ACCENT, fontSize: 22, fontWeight: 600, letterSpacing: 1 }}>
                {card.club.toUpperCase()}
              </div>
            ) : null}
            <div style={{ display: "flex", color: TEXT, fontSize: 52, fontWeight: 700, letterSpacing: -1.5 }}>
              {card.event}
            </div>
            {card.subtitle ? (
              <div style={{ display: "flex", color: MUTED, fontSize: 24 }}>{card.subtitle}</div>
            ) : null}
          </div>
          {card.live ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "rgba(242,135,46,0.16)",
                borderRadius: 999,
                padding: "10px 20px",
              }}
            >
              <div style={{ display: "flex", width: 12, height: 12, borderRadius: 6, background: ACCENT }} />
              <div style={{ display: "flex", color: ACCENT, fontSize: 20, fontWeight: 700, letterSpacing: 1 }}>
                LIVE
              </div>
            </div>
          ) : null}
        </div>

        {/* The standings */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 22, flexGrow: 1 }}>
          {card.rows.map((r, i) => (
            <div
              key={r.rank + r.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 22,
                padding: "11px 20px",
                borderRadius: 12,
                // The leader gets the emphasis, the way the board gives it.
                background: i === 0 ? SURFACE : "transparent",
                borderBottom: i === 0 ? "none" : `1px solid ${DIVIDER}`,
              }}
            >
              <div style={{ display: "flex", color: MUTED, fontSize: 28, width: 44, fontWeight: 600 }}>{r.rank}</div>
              <div
                style={{
                  color: TEXT,
                  fontSize: 34,
                  fontWeight: i === 0 ? 700 : 500,
                  flexGrow: 1,
                }}
              >
                {r.name}
              </div>
              {r.thru ? <div style={{ display: "flex", color: MUTED, fontSize: 24 }}>{r.thru}</div> : null}
              <div
                style={{
                  color: i === 0 ? ACCENT : TEXT,
                  fontSize: 34,
                  fontWeight: 700,
                  width: 130,
                  textAlign: "right",
                }}
              >
                {r.score}
              </div>
            </div>
          ))}
          {card.rows.length === 0 ? (
            <div style={{ display: "flex", color: MUTED, fontSize: 30, paddingTop: 18 }}>
              No scores in yet — the board goes live as cards come in.
            </div>
          ) : null}
        </div>

        {/* Footer: whose product this is, and how much field is not shown */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `1px solid ${DIVIDER}`,
            paddingTop: 16,
          }}
        >
          <Wordmark />
          {card.more > 0 ? (
            /* One text node, not four. Satori refuses a div with more than one
               child unless it declares a display, and `+{n} more {word}` is
               four children — which fails at render time only, so it would
               have shipped as a broken preview nobody in the app ever sees. */
            <div style={{ display: "flex", color: MUTED, fontSize: 24 }}>
              {`+${card.more} more ${card.more === 1 ? "player" : "players"}`}
            </div>
          ) : null}
        </div>
      </div>
    ),
    size,
  );
}
