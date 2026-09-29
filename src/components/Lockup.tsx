import { Logo, LOGO_SIZE, markSizeFor } from "./Logo";
import { BrandMark } from "./BrandMark";

/**
 * The space you SEE between the mark and the wordmark, as a share of the
 * wordmark's size: about 12px at LOGO_SIZE.lg.
 *
 * It used to be the CSS gap itself (size × 0.35), but the gap starts where the
 * mark's 32-unit box ends, and the flat mark's artwork ends at x 25.8 — about a
 * fifth of the box is empty on the right. At lg that added 8px of air to a 10px
 * gap, and the pair read as two things placed side by side (2026-09-29, "fix
 * the logo… designed better to suit all screens"). So the gap is now what is
 * left of the visible space after the mark's own air.
 */
const LOCKUP_VISIBLE_GAP = 0.42;
/** The empty share of the mark's box to the right of its artwork. */
const MARK_RIGHT_AIR = (32 - 25.8) / 32;
/** The emblem's disc and ring run almost to the box edge (r 15 + half the 1.1 ring). */
const EMBLEM_RIGHT_AIR = (32 - 31.55) / 32;

export function lockupGap(size: number, emblem = false): number {
  const mark = markSizeFor(size, emblem);
  return Math.max(2, Math.round(size * LOCKUP_VISIBLE_GAP - mark * (emblem ? EMBLEM_RIGHT_AIR : MARK_RIGHT_AIR)));
}

/**
 * THE TOURNEYHQ LOCKUP: the mark and the wordmark, stitched at one proportion.
 *
 * Every place that shows "the logo" draws it through here. The pair used to be
 * assembled by hand in five files, each with the mark's box set to the
 * wordmark's own number, so the mark came out about the height of a capital
 * letter beside it — "tiny", in Ajay's word (2026-09-27). The proportion lives
 * in `markSizeFor`; this only places the two side by side.
 *
 * `size` is the WORDMARK's size, a LOGO_SIZE step. The mark follows it.
 *
 * `markStyle` is passed to the mark untouched, for a page that maps its own
 * ground onto the `--logo-*` variables (the landing's open cup). It cannot
 * reach the mark's orange and green, which are TourneyHQ's own.
 */
export function Lockup({
  size = LOGO_SIZE.md,
  emblem = false,
  markStyle,
}: {
  size?: number;
  /** The display treatment — marketing surfaces only (decided 2026-09-24). */
  emblem?: boolean;
  markStyle?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: lockupGap(size, emblem),
        minWidth: 0,
        flex: "none",
      }}
    >
      <Logo size={markSizeFor(size, emblem)} emblem={emblem} style={{ flex: "none", ...markStyle }} />
      <BrandMark size={size} />
    </span>
  );
}
