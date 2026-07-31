/**
 * Flights brand mark — a golf ball on its flight path: the ball launched off the
 * tee along a dotted trajectory. A "flight" is both the ball's arc and a
 * tournament division, so the mark carries the name's double meaning. The
 * trajectory takes the accent; the ball and tee line use currentColor, so the
 * mark inherits and themes automatically.
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
      <path d="M4 25.5 H9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.45" />
      {/* ball flight path */}
      <path
        d="M7 25 Q14 6 26 8.5"
        stroke="var(--color-accent)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeDasharray="0.2 4"
        fill="none"
      />
      {/* ball in flight */}
      <circle cx="26" cy="8.5" r="3" fill="currentColor" />
    </svg>
  );
}
