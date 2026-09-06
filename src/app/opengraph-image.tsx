import { ImageResponse } from "next/og";
import { Logo, LOGO_SIZE } from "@/components/Logo";
import { SHARE_CARD } from "@/lib/themes";

/**
 * The picture that unfurls when somebody shares TourneyHQ itself.
 *
 * There was none, and the omission was worse than a missing nicety: the root
 * metadata declares `twitter:card: summary_large_image`, which is a PROMISE of
 * a 1200x630 image. With no image behind it, every share of the marketing page
 * — X, LinkedIn, Slack, WhatsApp, iMessage — rendered a blank or broken card.
 * A link posted to a golf WhatsApp group is the product's main distribution,
 * and it was arriving with nothing on it.
 *
 * `/live/<token>` already had one, because a shared LEADERBOARD was understood
 * to need a preview. The site's own pages were never given the same thought.
 *
 * Next serves this for `/` and, being at the app root, for every page that does
 * not define its own — so `/privacy` and `/terms` inherit it rather than each
 * needing a card of their own.
 *
 * Dark ground always, like the leaderboard card: this renders in someone else's
 * chat client, not in a club's chosen theme.
 */

export const runtime = "nodejs";
export const alt = "TourneyHQ — golf tournament management, from the draw to the payout";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const { bg: BG, text: TEXT, muted: MUTED, accent: ACCENT, fairway: FAIRWAY, divider: DIVIDER } =
  SHARE_CARD;

/** The three things the product does, in the order a club meets them. */
const STEPS = ["The draw", "Live scoring", "The payout"];

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: BG,
          padding: "0 84px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* Drawn by the one component that draws it — colours passed in
              because Satori has no stylesheet to resolve `--logo-*` against.
              Redrawing the mark here is what brand-consistency.test.ts bans. */}
          <Logo size={LOGO_SIZE.shareHero} colors={{ flag: ACCENT, stick: TEXT, ball: FAIRWAY }} />
          <div style={{ display: "flex", fontSize: 68, fontWeight: 700, letterSpacing: -2 }}>
            <span style={{ color: TEXT }}>Tourney</span>
            <span style={{ color: ACCENT }}>HQ</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            color: TEXT,
            fontSize: 44,
            fontWeight: 600,
            letterSpacing: -1,
            marginTop: 30,
            maxWidth: 900,
            lineHeight: 1.25,
          }}
        >
          Golf tournament management, from the draw to the payout
        </div>

        <div style={{ display: "flex", color: MUTED, fontSize: 27, marginTop: 18, maxWidth: 880 }}>
          Flights, handicaps, brackets and live standings — and the settle-up at the end.
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            marginTop: 40,
            borderTop: `1px solid ${DIVIDER}`,
            paddingTop: 26,
          }}
        >
          {STEPS.map((s, i) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 20 }}>
              {i > 0 ? (
                <div style={{ display: "flex", width: 6, height: 6, borderRadius: 3, background: DIVIDER }} />
              ) : null}
              <div style={{ display: "flex", color: i === 1 ? ACCENT : MUTED, fontSize: 25, fontWeight: 600 }}>
                {s}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
