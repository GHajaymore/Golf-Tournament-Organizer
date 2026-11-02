/**
 * THE COURSE ON THE HORIZON (design E): one parkland hole drawn as layered silhouettes — far hills,
 * a tree line, the near fairway and a green with its flag — that each hour of the page lights in
 * its own colours (`--e-far`, `--e-trees`, `--e-near`, `--e-green`, `--e-pin`, `--e-sun`).
 *
 * Drawn here, by hand, in vector: no generated image, nothing that could look made by a model, and
 * no words. It is decoration only (`aria-hidden`), set behind the words and never under a screen.
 * `variant` moves the sun: low on the left at first light, high at midday, low on the right at
 * golden hour, gone in the evening.
 */
export function Course({ variant, className = "" }: { variant: "dawn" | "golden" | "evening"; className?: string }) {
  const sun = variant === "dawn" ? { cx: 330, cy: 250, r: 70 } : variant === "golden" ? { cx: 1210, cy: 205, r: 84 } : null;
  return (
    <svg className={`e-course e-course-${variant} ${className}`} viewBox="0 0 1600 360" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`e-halo-${variant}`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="var(--e-sun)" stopOpacity=".95" />
          <stop offset=".35" stopColor="var(--e-sun)" stopOpacity=".42" />
          <stop offset="1" stopColor="var(--e-sun)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`e-rim-${variant}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--e-rim)" stopOpacity={variant === "golden" ? 0 : 0.9} />
          <stop offset="1" stopColor="var(--e-rim)" stopOpacity={variant === "golden" ? 0.9 : 0} />
        </linearGradient>
      </defs>
      {sun ? (
        <g className="e-sun">
          <circle cx={sun.cx} cy={sun.cy} r={sun.r * 4.2} fill={`url(#e-halo-${variant})`} />
          <circle cx={sun.cx} cy={sun.cy} r={sun.r * 0.55} fill="var(--e-sun-core)" />
        </g>
      ) : null}
      {/* far hills */}
      <path className="e-far" d="M0 250 C 140 214 260 222 380 236 C 520 252 600 206 760 200 C 900 196 1000 236 1120 232 C 1260 228 1360 196 1480 204 C 1540 208 1580 216 1600 222 L1600 360 L0 360 Z" />
      {/* the far hills' lit edge, toward the sun */}
      <path className="e-rim" d="M0 250 C 140 214 260 222 380 236 C 520 252 600 206 760 200 C 900 196 1000 236 1120 232 C 1260 228 1360 196 1480 204 C 1540 208 1580 216 1600 222" fill="none" stroke={`url(#e-rim-${variant})`} strokeWidth="2.2" />
      {/* the tree line: rounded crowns along the back of the hole */}
      <path className="e-trees" d="M0 286 C 20 262 44 258 62 270 C 74 248 104 246 116 264 C 132 244 166 248 172 270 C 196 256 222 262 230 278 C 260 270 300 276 318 288 L 640 296 C 660 278 690 276 700 290 C 714 266 750 264 760 284 C 782 270 808 276 812 292 L 1040 296 C 1056 272 1088 270 1098 288 C 1112 260 1150 258 1162 280 C 1180 262 1214 266 1222 284 C 1246 268 1276 272 1284 290 C 1310 278 1340 280 1352 292 L1600 290 L1600 360 L0 360 Z" />
      {/* the fairway sweeping to the green */}
      <path className="e-near" d="M0 330 C 220 300 420 302 640 314 C 820 324 980 304 1160 300 C 1330 296 1480 310 1600 318 L1600 360 L0 360 Z" />
      {/* the green, and its flag */}
      <ellipse className="e-green" cx="1010" cy="306" rx="96" ry="11" />
      <line className="e-pin" x1="1032" y1="304" x2="1032" y2="238" strokeWidth="2.4" strokeLinecap="round" />
      <path className="e-flag" d="M1033 239 L1062 247 L1033 256 Z" />
    </svg>
  );
}
