/**
 * TourneyHQ brand mark — "holing out": the ball dropping into the cup beside
 * the flag, the payoff moment in golf and the moment this app is built
 * around (a score landing, standings updating live). Unambiguously golf —
 * no flight-path/wing shapes that could read as an airline mark.
 *
 * ONE geometry, everywhere. The landing page used to draw its own copy with a
 * slightly larger cup, a thinner flagstick and the ball a half-unit lower, so
 * the logo above the sign-in button was quietly not the logo inside the app.
 * Nobody would name it, but it is the kind of thing that makes a product feel
 * assembled rather than made.
 *
 * Colours come from variables so the marketing page can keep its own palette
 * without keeping its own drawing:
 *
 *   --logo-flag   the pennant, and the stick unless overridden — ORANGE
 *   --logo-stick  the flagstick; defaults to the pennant's colour
 *   --logo-ball   the ball — GREEN
 *   --logo-rim    the cup's outline
 *   --logo-cup    the cup's fill; transparent where the ground is not flat
 *
 * Orange flag, green ball. It was the other way round, and the ball was not a
 * variable at all — it was `currentColor`, so it took whatever text colour it
 * happened to sit in. That made it near-white in the sidebar and on the
 * landing page while the generated app icons drew it in orange: the icon on a
 * home screen did not match the app it opened. A part of the mark that cannot
 * be set is a part of the mark that drifts.
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
} as const;

export function Logo({
  size = LOGO_SIZE.md,
  style,
}: {
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      /* Shifted 1.5 units so the ARTWORK is centred in the box, not merely the
         box in its container. The drawing spans y 3.1 (flagstick cap) to 25.9
         (cup including stroke) — an optical centre of 14.5 against a box centre
         of 16 — so every flex-centred lockup rendered the mark slightly high
         beside its wordmark. Corrected here rather than nudged per call site,
         so the landing page and the app sidebar cannot disagree. */
      viewBox="0 -1.5 32 32"
      fill="none"
      aria-hidden="true"
      style={style}
    >
      {/* flagstick + flag */}
      <path
        d="M20 4 V18"
        // Its own variable, falling back to the flag's colour. The app draws
        // stick and pennant in one colour; the programme palette draws the
        // stick in ink and lets only the pennant carry the orange. Collapsing
        // the two lost that two-tone the first time this was unified.
        stroke="var(--logo-stick, var(--logo-flag, var(--color-accent, currentColor)))"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M20 4.5 L27.5 7.5 L20 10.5 Z" fill="var(--logo-flag, var(--color-accent, currentColor))" />
      {/* the cup */}
      <ellipse
        cx="16"
        cy="22"
        rx="8"
        ry="3.4"
        fill="var(--logo-cup, var(--color-bg, #16181a))"
        stroke="var(--logo-rim, var(--color-divider, #3c3f3a))"
        strokeWidth="1"
      />
      {/* ball dropping in */}
      <circle cx="12" cy="19.5" r="3.4" fill="var(--logo-ball, var(--color-accent-2, currentColor))" />
    </svg>
  );
}
