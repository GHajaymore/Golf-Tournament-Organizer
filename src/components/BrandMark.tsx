import { LOGO_SIZE } from "./Logo";

/**
 * The "TourneyHQ" wordmark lockup — gradient-foil "Tourney" paired with a
 * solid "HQ" badge chip (see .brand-mark / .brand-hq in globals.css).
 *
 * Owns its own typography. The heading font, weight and letter-spacing used to
 * be repeated inline at every call site, which meant two of them carried it
 * and two did not — so the same wordmark rendered in the body face on half the
 * screens it appeared on.
 */
export function BrandMark({
  /** Match the Logo it sits beside; the wordmark is set slightly larger so the
   *  cap height lines up with the mark rather than the box. */
  size = LOGO_SIZE.md,
  style,
}: {
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        fontFamily: "var(--font-heading)",
        fontWeight: 700,
        fontSize: size,
        letterSpacing: "-0.01em",
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span className="brand-mark">Tourney</span>
      <span className="brand-hq">HQ</span>
    </span>
  );
}
