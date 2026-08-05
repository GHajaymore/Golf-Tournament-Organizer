/**
 * TourneyHQ brand mark — "holing out": the ball dropping into the cup beside
 * the flag, the payoff moment in golf and the moment this app is built
 * around (a score landing, standings updating live). Unambiguously golf —
 * no flight-path/wing shapes that could read as an airline mark. The flag
 * takes the fairway green, the ball takes currentColor (set to the brand
 * orange everywhere the mark is used) so it still themes cleanly wherever
 * it's dropped.
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
      {/* flagstick + flag */}
      <path d="M20 4 V18" stroke="var(--color-accent-2, currentColor)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 4.5 L27.5 7.5 L20 10.5 Z" fill="var(--color-accent-2, currentColor)" />
      {/* the cup */}
      <ellipse cx="16" cy="22" rx="8" ry="3.4" fill="var(--color-bg, #16181a)" stroke="var(--color-divider, #3c3f3a)" strokeWidth="1" />
      {/* ball dropping in */}
      <circle cx="12" cy="19.5" r="3.4" fill="currentColor" />
    </svg>
  );
}
