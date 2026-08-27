/**
 * TourneyHQ brand mark — the pin monogram: a T whose stem is the flagstick,
 * with the pennant flying off it and the ball at its foot.
 *
 * It replaced a "holing out" drawing — ball, cup and flag in perspective —
 * that was designed at large size and never checked small. At 16px, which is
 * a browser tab and a home-screen icon, the cup ellipse thinned to nothing
 * and the mark read as a green dot beside a stick. A logo that only works
 * at 200px is a picture.
 *
 * This one carries two readings at once, which is most of what separates a
 * designed mark from a stock icon: the T of TourneyHQ, and the pin. It also
 * survives as a single-colour silhouette, which the old one did not — the cup
 * was defined by its outline, so flattening the palette erased it.
 *
 * ONE geometry, everywhere. The landing page used to draw its own copy with a
 * slightly larger cup and a thinner flagstick, so the logo above the sign-in
 * button was quietly not the logo inside the app. Nobody would name it, but it
 * is the kind of thing that makes a product feel assembled rather than made.
 *
 * Colours come from variables so the marketing page can keep its own palette
 * without keeping its own drawing:
 *
 *   --logo-flag   the pennant — ORANGE
 *   --logo-stick  the T itself; defaults to the TEXT colour, so the mark and
 *                 the wordmark beside it read as one lockup on either ground
 *   --logo-ball   the ball — GREEN
 *
 * There is no --logo-cup or --logo-rim any more: this mark has no cup. A
 * variable for a shape that does not exist is a promise the drawing cannot
 * keep.
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
      /* NO OPTICAL SHIFT, because none is needed any more.
         The drawing spans y 2.8 (the crossbar's cap) to 29.2 (the foot of the
         ball) — a centre of exactly 16, which is the box centre. The previous
         mark needed `viewBox="0 -1.5 32 32"` to correct for artwork that sat
         high in its own box; this one is built centred instead, which is the
         better fix because nothing downstream has to remember the correction.
         `scripts/gen-icons.mjs` therefore carries no translate either, and
         brand-consistency checks the two agree. */
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      style={style}
    >
      {/* The crossbar and the stem: a T, and the pin it is named for. */}
      <path
        d="M8 4.4 H24"
        // Its own variable, falling back to the flag's colour. The app draws
        // stick and pennant in one colour; the programme palette draws the
        // stick in ink and lets only the pennant carry the orange. Collapsing
        // the two lost that two-tone the first time this was unified.
        stroke={stick}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path d="M16 4.4 V20.5" stroke={stick} strokeWidth="3.2" strokeLinecap="round" />
      {/* the pennant, flying off the stem */}
      <path d="M17.3 7.4 L25.4 10.2 L17.3 13 Z" fill={flag} />
      {/* the ball, at the foot of the pin */}
      <circle cx="16" cy="25.9" r="3.3" fill={ball} />
    </svg>
  );
}
