/**
 * TourneyHQ brand mark — the standings flag.
 *
 * A pole carrying three bars of decreasing length. Read one way it is a
 * pennant on a flagstick; read the other it is a leaderboard, longest bar
 * at the top. Both readings are true of the product, which is the point:
 * the second meaning is about what the software DOES, not merely about
 * what the company is called.
 *
 * It replaced two earlier marks, and the reason both went is worth keeping.
 * The first drew "holing out" — ball, cup and flag in perspective — and was
 * designed at large size without ever being checked small: at 16px, which
 * is a browser tab and a home-screen icon, the cup ellipse thinned to
 * nothing and it read as a green dot beside a stick. The second was a T
 * monogram, which was legible but safe — it said the company's initial and
 * nothing about the game or the competition.
 *
 * Four other directions were drawn and rejected by rendering them rather
 * than by describing them, which is the only test that decides this: green
 * contours read as a speedometer, the Q-as-a-hole read as a magnifying
 * glass, and a scorecard box read as a camera. A mark cannot be argued out
 * of a collision like that — it either survives being looked at or it does
 * not.
 *
 * The swallowtail on the top bar is load-bearing. Without that notch the
 * mark is a bar chart and only a bar chart; with it, the flag reading comes
 * first and the standings reading second.
 *
 * ONE geometry, everywhere. The landing page used to draw its own copy, so
 * the logo above the sign-in button was quietly not the logo inside the
 * app. Nobody would name it, but it is the kind of thing that makes a
 * product feel assembled rather than made.
 *
 * Colours come from variables so the marketing page can keep its own
 * palette without keeping its own drawing:
 *
 *   --logo-flag   the leader's bar — ORANGE
 *   --logo-stick  the pole and the second bar; defaults to the TEXT colour,
 *                 so the mark and the wordmark read as one lockup
 *   --logo-ball   the third bar — GREEN
 *
 * There is no --logo-cup or --logo-rim: this mark has no cup. A variable
 * for a shape that does not exist is a promise the drawing cannot keep.
 */

/**
 * The only sizes the mark is drawn at.
 *
 * It was being called at 17, 19, 22 and 23 across five files — four sizes
 * chosen one at a time, none of them related. A mark that changes size on
 * every screen reads as inconsistency even when nobody can say why.
 */
export const LOGO_SIZE = {
  /** Beside a nav label or in a dense bar. */
  sm: 19,
  /** The default: a page header or a sign-in lockup. */
  md: 22,
  /** A hero or an empty state. */
  lg: 28,
  /**
   * The share-link card, which is a 1200x630 canvas rendered OUTSIDE the app.
   *
   * App sizes are illegible there — 22px on an image that arrives as a
   * thumbnail in a chat list is a smudge. Two sizes rather than one because
   * the card has two states: a lockup in its footer, and the mark standing
   * alone when there is nothing else the card may show.
   */
  share: 44,
  shareHero: 96,
} as const;

/**
 * Explicit colours, for a renderer with no stylesheet.
 *
 * The mark normally takes its colours from `--logo-*`, which is what lets one
 * drawing serve the app and the landing page. Satori — which turns this into
 * the share-card PNG — has no CSS custom properties to resolve, so it would
 * render the whole mark in the fallback colour.
 *
 * Passing them in keeps the alternative from happening, which is somebody
 * drawing the flagstick a second time in a file Satori can read. That is
 * exactly what `brand-consistency.test.ts` exists to prevent, and it caught it.
 */
export interface LogoColors {
  flag?: string;
  stick?: string;
  ball?: string;
}

export function Logo({
  size = LOGO_SIZE.md,
  style,
  colors,
}: {
  size?: number;
  style?: React.CSSProperties;
  colors?: LogoColors;
}) {
  const flag = colors?.flag ?? "var(--logo-flag, var(--color-accent, currentColor))";
  const stick = colors?.stick ?? "var(--logo-stick, var(--color-text, currentColor))";
  const ball = colors?.ball ?? "var(--logo-ball, var(--color-accent-2, currentColor))";
  return (
    <svg
      width={size}
      height={size}
      /* NO OPTICAL SHIFT, because none is needed.
         The drawing spans y 2.6 (the pole's top cap) to 29.4 (its bottom) —
         a centre of exactly 16, which is the box centre. An older mark
         needed `viewBox="0 -1.5 32 32"` to correct artwork that sat high in
         its own box; building it centred is the better fix, because nothing
         downstream has to remember the correction. `scripts/gen-icons.mjs`
         therefore carries no translate either, and brand-consistency asserts
         that neither of them does. */
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      style={style}
    >
      {/* The pole. Ink rather than orange: it belongs to the wordmark beside
          it, and leaving the pennant as the only accent stops the mark and the
          "HQ" competing for the same attention. */}
      <path d="M7.2 4.2 V27.8" stroke={stick} strokeWidth="3.2" strokeLinecap="round" />
      {/* The leader's bar, which is also the pennant. Swallow-tailed on
          purpose: that notch is the whole reason both readings survive — a
          plain rectangle here is a bar chart and nothing else. */}
      <path d="M9.4 6.6 h17.2 l-4 4.1 l4 4.1 H9.4 z" fill={flag} />
      {/* Second and third, shorter, because that is what a standing IS. The
          gaps are 2.8 units rather than 2.0: at 16px the tighter spacing let
          the two lower bars merge into one. */}
      <rect x="9.4" y="17.6" width="12.4" height="3.6" rx="1.8" fill={stick} />
      <rect x="9.4" y="24" width="7.6" height="3.6" rx="1.8" fill={ball} />
    </svg>
  );
}
