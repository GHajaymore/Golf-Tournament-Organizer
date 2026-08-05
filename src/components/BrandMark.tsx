/**
 * The "TourneyHQ" wordmark lockup — gradient-foil "Tourney" paired with a
 * solid "HQ" badge chip (see .brand-mark / .brand-hq in globals.css).
 * Renders as one inline unit so it drops cleanly into a heading, a nav
 * label, or a footer credit at any font-size.
 */
export function BrandMark({ style }: { style?: React.CSSProperties }) {
  return (
    <span style={style}>
      <span className="brand-mark">Tourney</span>
      <span className="brand-hq">HQ</span>
    </span>
  );
}
