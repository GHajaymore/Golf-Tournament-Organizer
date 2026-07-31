/**
 * Brand mark — a flagstick with a wind-caught pennant over a putting-green arc,
 * with the ball at its base. The pennant takes the accent; the stick, ball and
 * green use currentColor, so the mark inherits and themes automatically.
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
      {/* putting-green arc */}
      <path
        d="M8 26.5 Q16 23.5 24 26.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.45"
      />
      {/* flagstick */}
      <path d="M13 5.5 V25.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      {/* wind-caught pennant */}
      <path
        d="M13 5.4 C18 6.6 21 4.4 24.5 6 C22.8 8.2 24 10.4 24.5 12.2 C21 10.6 18 12.8 13 11.6 Z"
        fill="var(--color-accent)"
      />
      {/* ball */}
      <circle cx="13" cy="26" r="2.5" fill="currentColor" />
    </svg>
  );
}
