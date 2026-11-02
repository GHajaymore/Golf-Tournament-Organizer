/**
 * THE COURSE ON THE HORIZON (design E): the far side of a parkland course seen against the sky —
 * a line of low hills and a tree line, softened by distance, with low mist over the turf and the
 * sun's light behind it. Each hour of the page lights it in its own colours (`--e-far`,
 * `--e-trees`, `--e-near`, `--e-sun`, `--e-mist`).
 *
 * Ajay, 2 Nov: "it should not look really artificial." So there is no drawn sun disc, no flag and
 * no hard outline: the shapes are blurred the way a far tree line is in real air, and the sun is
 * only its light, a soft glow behind the trees. Drawn here in vector; no words, `aria-hidden`, set
 * behind the words and never under a screen. The light sits on the right, behind the devices, at
 * first light and at golden hour alike; `variant` only changes its colours.
 */
export function Course({ variant, className = "" }: { variant: "dawn" | "golden"; className?: string }) {
  const sun = variant === "dawn" ? { cx: 1180, cy: 262 } : { cx: 1180, cy: 236 };
  const id = (n: string) => `e-${n}-${variant}`;
  return (
    <svg className={`e-course e-course-${variant} ${className}`} viewBox="0 0 1600 360" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={id("halo")} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="var(--e-sun-core)" stopOpacity=".95" />
          <stop offset=".18" stopColor="var(--e-sun)" stopOpacity=".7" />
          <stop offset=".55" stopColor="var(--e-sun)" stopOpacity=".22" />
          <stop offset="1" stopColor="var(--e-sun)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("mist")} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--e-mist)" stopOpacity="0" />
          <stop offset=".55" stopColor="var(--e-mist)" stopOpacity=".38" />
          <stop offset="1" stopColor="var(--e-mist)" stopOpacity="0" />
        </linearGradient>
        <filter id={id("far")} x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="3.2" /></filter>
        <filter id={id("near")} x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="1.1" /></filter>
      </defs>
      {/* the sun's light, just under the hills: no disc, only the glow it throws */}
      <ellipse cx={sun.cx} cy={sun.cy} rx="520" ry="200" fill={`url(#${id("halo")})`} />
      {/* far hills, softened by distance */}
      <path className="e-far" filter={`url(#${id("far")})`} d="M-20 254 C 140 226 260 232 380 242 C 520 254 600 222 760 218 C 900 214 1000 244 1120 240 C 1260 236 1360 214 1480 220 C 1540 223 1580 228 1620 232 L1620 380 L-20 380 Z" />
      {/* the tree line along the back of the hole: irregular crowns, slightly soft */}
      <path className="e-trees" filter={`url(#${id("near")})`} d="M-20 292 C 6 276 22 270 38 279 C 46 262 70 258 84 271 C 92 255 120 252 132 268 C 146 258 160 262 168 276 C 186 266 204 270 214 282 C 236 274 262 279 280 290 C 320 286 360 288 400 292 C 440 289 470 291 500 294 L 640 297 C 652 283 668 279 680 287 C 690 268 716 264 728 280 C 740 270 760 272 770 284 C 786 276 800 281 810 293 L 1030 296 C 1040 280 1060 275 1072 286 C 1080 264 1108 260 1120 276 C 1130 262 1152 262 1162 278 C 1176 266 1198 268 1206 282 C 1222 270 1248 272 1258 286 C 1276 278 1300 280 1312 290 C 1340 284 1370 288 1400 292 C 1460 290 1540 292 1620 291 L1620 380 L-20 380 Z" />
      {/* the turf in front, in shade */}
      <path className="e-near" d="M-20 326 C 220 304 420 306 640 316 C 820 324 980 308 1160 304 C 1330 300 1480 312 1620 318 L1620 380 L-20 380 Z" />
      {/* low mist lying over the fairway */}
      <rect x="-20" y="270" width="1640" height="70" fill={`url(#${id("mist")})`} />
    </svg>
  );
}
