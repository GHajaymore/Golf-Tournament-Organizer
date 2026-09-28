import { Logo, LOGO_SIZE, markSizeFor } from "./Logo";
import { BrandMark } from "./BrandMark";

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
        gap: Math.round(size * 0.35),
        minWidth: 0,
        flex: "none",
      }}
    >
      <Logo size={markSizeFor(size, emblem)} emblem={emblem} style={{ flex: "none", ...markStyle }} />
      <BrandMark size={size} />
    </span>
  );
}
