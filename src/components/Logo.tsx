/**
 * Flights brand mark — a golf ball on its flight path toward the pin: the ball
 * launched off the tee along a dotted trajectory, landing at a flag. A
 * "flight" is both the ball's arc and a tournament division, so the mark
 * carries the name's double meaning, and the flag makes it unmistakably golf
 * at a glance. The trajectory takes the gold accent, the flag the fairway
 * green — the brand's two-tone signature in miniature. Ball/tee use
 * currentColor so the mark still themes cleanly wherever it's dropped.
 */
export function Logo({ size = 24, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      style={style}
    >
      {/* tee line / ground */}
      <path d="M3 26 H12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.4" />
      {/* flagstick + green */}
      <path d="M25.5 26 V9" stroke="var(--color-accent-2, currentColor)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M25.5 9 L20.5 11.3 L25.5 13.6 Z" fill="var(--color-accent-2, currentColor)" />
      <ellipse cx="25.5" cy="26.5" rx="5.5" ry="1.5" fill="var(--color-accent-2, currentColor)" opacity="0.18" />
      {/* ball flight path */}
      <path
        d="M6 25 Q13 5 24.5 11"
        stroke="var(--color-accent, currentColor)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeDasharray="0.2 4"
        fill="none"
      />
      {/* ball in flight */}
      <circle cx="15.2" cy="10.4" r="2.6" fill="currentColor" />
    </svg>
  );
}
