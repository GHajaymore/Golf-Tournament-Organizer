/**
 * TourneyHQ brand mark — "holing out": the ball dropping into the cup
 * beside the flag. The payoff moment in golf, and the moment this app is
 * built around — a score landing, standings moving.
 *
 * REBUILT, not redrawn. The idea was always right; the execution had four
 * faults, and every one of them only showed up when the mark was rendered
 * small rather than looked at large:
 *
 *  1. The cup was an ELLIPSE DEFINED BY ITS OUTLINE, at stroke-width 1. At
 *     16px — a browser tab, a home-screen icon — that hairline thinned to
 *     nothing and the mark read as a green dot beside a stick. It is now
 *     filled, so it survives being small and survives being flattened to
 *     one colour, which an outline-only shape never can.
 *  2. The weights disagreed: a 1.8 flagstick against a 1-unit cup rim. One
 *     drawing with two line weights reads as two drawings.
 *  3. The pin did not touch the hole. The stick stopped at y18 and the cup
 *     sat at y22, so the mark showed a flag NEAR a cup rather than a pin IN
 *     one. It is now planted through the rim.
 *  4. The ball overlapped the cup ambiguously — neither clearly in nor
 *     clearly out. It now breaks the near rim from above, which is what
 *     dropping in actually looks like.
 *
 * ONE geometry, everywhere. The landing page used to draw its own copy with
 * a slightly larger cup and a thinner flagstick, so the logo above the
 * sign-in button was quietly not the logo inside the app. Nobody would name
 * it, but it is the kind of thing that makes a product feel assembled
 * rather than made.
 *
 * Colours come from variables so the marketing page can keep its own
 * palette without keeping its own drawing:
 *
 *   --logo-flag   the pennant — ORANGE
 *   --logo-stick  the flagstick; defaults to the pennant's colour
 *   --logo-ball   the ball — GREEN
 *   --logo-cup    the cup, FILLED. A neutral by default so it reads as a
 *                 hole on either ground; `transparent` leaves the mark
 *                 open, which is what the programme palette wants.
 *
 * Orange flag, green ball. It was the other way round once, and the ball
 * was not a variable at all — it was `currentColor`, so it took whatever
 * text colour it sat in. A part of the mark that cannot be set is a part
 * that drifts.
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
  cup?: string;
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
  const stick = colors?.stick ?? colors?.flag ?? "var(--logo-stick, var(--logo-flag, var(--color-accent, currentColor)))";
  const ball = colors?.ball ?? "var(--logo-ball, var(--color-accent-2, currentColor))";
  const cup = colors?.cup ?? "var(--logo-cup, var(--color-neutral-800, currentColor))";
  return (
    <svg
      width={size}
      height={size}
      /* NO OPTICAL SHIFT, because the artwork is built centred.
         It spans y 4.9 (the flagstick's cap) to 27.1 (the foot of the cup) —
         a centre of exactly 16, which is the box centre. The first version
         of this mark needed `viewBox="0 -1.5 32 32"` to correct artwork that
         sat high in its own box, and `gen-icons.mjs` had to carry the same
         correction twice. Centring the drawing instead means nothing
         downstream has to remember it. */
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      style={style}
    >
      {/* The cup, FILLED rather than outlined — fault 1 above. Drawn first, so
          the pin is planted through it and the ball breaks its near rim. */}
      <ellipse cx="15.2" cy="23.6" rx="8.4" ry="3.5" fill={cup} />
      {/* The pin, THROUGH the rim rather than hovering beside it. At 2.4 it
          also matches the weight of everything else in the drawing. */}
      <path d="M18.6 6.1 V23.1" stroke={stick} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M18.6 6.3 L25.8 9.3 L18.6 12.3 Z" fill={flag} />
      {/* The ball, dropping in: it breaks the near rim from above, which is the
          one position that reads as falling rather than as resting alongside. */}
      <circle cx="11" cy="18.2" r="3.4" fill={ball} />
    </svg>
  );
}
