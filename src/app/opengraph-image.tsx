import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Logo, markSizeFor } from "@/components/Logo";
import { DARK_GROUND, SHARE_CARD } from "@/lib/themes";

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
 *
 * THE LOCKUP IS THE STANDARD ONE (2026-09-27). This card used to set "Tourney"
 * in plain text and "HQ" in the club accent colour, with a teal flag — none of
 * which is the TourneyHQ lockup, and it is the most-seen picture of the brand
 * outside the app. Now: the orange flag and green ball; the orange "Tourney"
 * wordmark (the dark-ground gradient stops); the solid orange HQ chip in the
 * chip's own ink, at 0.42 of the wordmark with a 10px floor, padded and rounded
 * in the same proportions as `.brand-hq`; and the mark drawn at the lockup's
 * mark-to-wordmark proportion. Satori has no stylesheet, so it cannot use the
 * <Lockup> component; the colours come from SHARE_CARD, which
 * share-card-brand.test.ts pins to globals.css.
 *
 * ONE DISCLOSED DIFFERENCE: the wordmark is set in Geist, not the app's heading
 * face (Fraunces). Satori reads TTF/OTF/WOFF, but next/font emits Fraunces only
 * as WOFF2, and adding a font file or a subsetting toolchain was not approved.
 * Geist ships with the app (node_modules/geist), so it is read from disk here —
 * no network at build time. Everything else matches the lockup.
 */

export const runtime = "nodejs";
export const alt = "TourneyHQ — golf tournament management, from the draw to the payout";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const { bg: BG, text: TEXT, muted: MUTED, divider: DIVIDER, fairway: FAIRWAY } = SHARE_CARD;
const { flag: FLAG, flagLight: FLAG_LIGHT, flagDeep: FLAG_DEEP, onFlag: ON_FLAG } = SHARE_CARD;
/** The cup, in the app's own dark-ground neutral-800 — what the mark draws it in on screen. */
const CUP = DARK_GROUND.neutrals[7];

/**
 * The lockup's proportions, from the lockup's own rule: `markSizeFor` sizes the
 * mark from the wordmark (the flat mark's artwork fills ~70% of its box, so the
 * box is drawn larger for the mark to stand as tall as the word). If that ratio
 * ever changes, this card follows it without anyone having to remember.
 */
const WORDMARK = 66;
const MARK = markSizeFor(WORDMARK);
const CHIP = Math.max(10, Math.round(WORDMARK * 0.42));

/** The three things the product does, in the order a club meets them. */
const STEPS = ["The draw", "Live scoring", "The payout"];

const GEIST = join(process.cwd(), "node_modules", "geist", "dist", "fonts", "geist-sans");

export default async function Image() {
  const [regular, semibold, bold] = await Promise.all(
    ["Geist-Regular.ttf", "Geist-SemiBold.ttf", "Geist-Bold.ttf"].map((f) => readFile(join(GEIST, f))),
  );

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
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: Math.round(WORDMARK * 0.3) }}>
          {/* Drawn by the one component that draws the mark — colours passed in
              because Satori has no stylesheet to resolve `--logo-*` against.
              Redrawing the mark here is what brand-consistency.test.ts bans. */}
          <Logo size={MARK} colors={{ flag: FLAG, stick: TEXT, ball: FAIRWAY, cup: CUP }} />
          <div style={{ display: "flex", alignItems: "flex-start" }}>
            <span
              style={{
                fontSize: WORDMARK,
                fontWeight: 700,
                letterSpacing: -0.01 * WORDMARK,
                lineHeight: 1,
                backgroundImage: `linear-gradient(115deg, ${FLAG_LIGHT} 0%, ${FLAG} 45%, ${FLAG_DEEP} 100%)`,
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Tourney
            </span>
            <span
              style={{
                fontSize: CHIP,
                fontWeight: 700,
                letterSpacing: 0.04 * CHIP,
                lineHeight: 1,
                color: ON_FLAG,
                background: FLAG,
                padding: `${Math.round(0.22 * CHIP)}px ${Math.round(0.4 * CHIP)}px`,
                borderRadius: Math.round(0.35 * CHIP),
                // The lockup's gap is 0.2em of the chip. Geist's "y" carries far
                // more right-side bearing than the Fraunces "y" the app sets, so
                // at 0.2em the visible gap came out ~3x the lockup's (measured on
                // the rendered PNG); the chip is pulled in by the difference.
                marginLeft: Math.round(0.2 * CHIP) - Math.round(0.42 * CHIP),
                marginTop: Math.round(0.06 * WORDMARK),
              }}
            >
              HQ
            </span>
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
              <div style={{ display: "flex", color: i === 1 ? FLAG : MUTED, fontSize: 25, fontWeight: 600 }}>
                {s}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: semibold, weight: 600, style: "normal" },
        { name: "Geist", data: bold, weight: 700, style: "normal" },
      ],
    },
  );
}
