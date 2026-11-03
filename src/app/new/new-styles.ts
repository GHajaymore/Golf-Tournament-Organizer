import { LIGHT, ON_SUN, SUN_FILL, type LightName } from "./day-light";

/**
 * THE SITE REHAUL, DESIGN E: "ONE DAY'S LIGHT" (2026-11-02) — `/new` only, a preview beside `/`.
 *
 * The page is the tournament day. Each section is painted in the light of its hour (`day-light.ts`):
 * first light behind the hero, the dark of the week before, a sunrise as the field arrives, the
 * bright middle of the day, the warm afternoon, golden hour over the course, and the prize-giving
 * in the evening. A section's first stretch blends from the light before it (`--e-from`), and no
 * word is drawn on a blend: words sit only on grounds the contrast test (`day-light.test.ts`) holds
 * to 7:1. Same colours at every width.
 *
 * DEPTH, not type size: layered gradient skies, a vector course on the horizon (`course.tsx`), soft
 * grain on the dark hours, glass where a label floats over a changing ground, and devices that cast
 * shadows in the colour of their light. Type: today's serif (Fraunces, the brand's) for the h1, h2
 * and the close; Atkinson Hyperlegible Next for text at 17-18px; Archivo for times and figures.
 * h1 at most 64px.
 *
 * Motion only under `prefers-reduced-motion: no-preference`: the putt draws once, the devices
 * arrive once, and where the browser can tie an animation to the scroll, the sun crosses the line
 * under the header. With reduced motion every light is simply there, a step per section.
 *
 * Every class here is prefixed `n-` (shared with design C's components) or `e-`.
 */

const vars = (l: (typeof LIGHT)[LightName]) =>
  [
    `--ground:${l.grounds[0]}`,
    `--e-g:${l.grounds[0]}`,
    `--ground-2:${l.panel}`,
    `--card:${l.panel}`,
    `--ink:${l.ink}`,
    `--ink-soft:${l.soft}`,
    `--ink-faint:${l.soft}`,
    `--brass:${l.accent}`,
    `--line:${l.line}`,
    `--line-2:color-mix(in srgb, ${l.ink} 26%, transparent)`,
    `--e-shadow:${l.dark ? "rgba(0,0,0,.55)" : "rgba(60,40,20,.22)"}`,
    `color:${l.ink}`,
  ].join(";");

const LIGHT_CSS = (Object.keys(LIGHT) as LightName[])
  .map(
    (n) =>
      `.e-l-${n}, .e-in-${n} { ${vars(LIGHT[n])}; }\n.e-from-${n} { --e-from:${LIGHT[n].grounds[0]}; }\n.e-prev-${n} { --e-prev:${LIGHT[n].grounds[0]}; }`,
  )
  .join("\n");

const N = LIGHT.night;
const D = LIGHT.dawn;
const G = LIGHT.golden;
const E = LIGHT.evening;

/* fine grain, drawn as a background layer (behind the words, never over them) */
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .05 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23g)'/%3E%3C/svg%3E")`;

export const NEW_CSS = `
@font-face {
  font-family: "Archivo Board"; font-style: normal; font-display: swap;
  font-weight: 100 900; font-stretch: 62% 125%;
  src: url(/new/fonts/archivo-latin-wdth-normal.woff2) format("woff2-variations");
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
}
@font-face {
  font-family: "Atkinson Next"; font-style: normal; font-display: swap; font-weight: 200 800;
  src: url(/new/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2) format("woff2-variations");
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
}
/* Atkinson draws its zero slashed, which reads as "Ø" in a price. Its figures come from Archivo. */
@font-face {
  font-family: "Atkinson Next"; font-style: normal; font-display: swap; font-weight: 200 800;
  src: url(/new/fonts/archivo-latin-wdth-normal.woff2) format("woff2-variations");
  unicode-range: U+0030-0039;
}

${LIGHT_CSS}

.n-site {
  ${vars(E)};
  --brass-ui: ${SUN_FILL};
  --on-accent: ${ON_SUN};
  --n-glow: color-mix(in srgb, ${SUN_FILL} 30%, transparent);
  --n-device: #0b0d14;
  --n-device-edge: rgba(255,255,255,.22);
  --n-head: var(--font-poster, var(--font-display)), "Iowan Old Style", Georgia, serif;
  --n-fig: "Archivo Board", "Segoe UI", system-ui, sans-serif;
  --n-text: "Atkinson Next", system-ui, -apple-system, "Segoe UI", sans-serif;
  --n-wrap: 1240px;
  --n-gut: clamp(16px, 4vw, 48px);
  --n-sec: clamp(72px, 9vw, 132px);
  --n-hdr: 68px;
  --e-blend: clamp(64px, 8vw, 128px);
  background: ${E.grounds[1]};
  font: 400 17px/1.6 var(--n-text);
  overflow-x: clip;
}
.n-site *, .n-site *::before, .n-site *::after { box-sizing: border-box; }
.n-site :where(h1, h2, h3, h4, p, ul, ol, figure, dl, dd, blockquote) { margin: 0; padding: 0; }
.n-site :where(ul, ol) { list-style: none; }
.n-site a { color: inherit; }
.n-site img { display: block; max-width: 100%; height: auto; }
.n-site :focus-visible { outline: 3px solid var(--brass); outline-offset: 3px; border-radius: 4px; }
.n-site p { text-wrap: pretty; }
.n-wrap { max-width: var(--n-wrap); margin: 0 auto; padding-left: max(var(--n-gut), env(safe-area-inset-left)); padding-right: max(var(--n-gut), env(safe-area-inset-right)); }
.n-site .n-skip { position: absolute; left: 12px; top: -60px; z-index: 50; background: var(--brass-ui); color: var(--on-accent); padding: 10px 16px; border-radius: 8px; font-weight: 700; }
.n-site .n-skip:focus { top: 12px; }

/* ── type: moderate, with today's serif for the voice ── */
.e-h1, .n-h2, .n-h3, .n-display, .e-close-line, .e-sub { font-family: var(--n-head); text-wrap: balance; color: var(--ink); font-variation-settings: "opsz" 144; }
.e-h1 { font-weight: 560; font-size: clamp(40px, calc(22px + 2.9vw), 64px); line-height: 1.02; letter-spacing: -.02em; }
.n-h2 { font-weight: 560; font-size: clamp(30px, calc(20px + 1.7vw), 44px); line-height: 1.08; letter-spacing: -.015em; }
.e-h2-sm { font-size: clamp(26px, calc(18px + 1.3vw), 36px); }
.n-h3 { font-weight: 600; font-size: clamp(21px, calc(16px + .7vw), 26px); line-height: 1.2; letter-spacing: -.01em; }
.n-lead { font-size: clamp(17px, calc(15px + .25vw), 18.5px); line-height: 1.6; color: var(--ink-soft); max-width: 38em; }
.n-num { font-variant-numeric: tabular-nums; }
.n-tagline, .n-eyebrow { font: 700 13.5px/1.2 var(--n-text); letter-spacing: .14em; text-transform: uppercase; color: var(--brass); }

/* the chapter marker: the hour, and what the light is doing */
.e-hour { display: inline-flex; align-items: center; gap: 12px; font-size: 15.5px; color: var(--ink-soft); margin-bottom: 18px; flex-wrap: wrap; }
.e-hour b { font: 700 15px/1 var(--n-fig); letter-spacing: .02em; color: var(--ink); padding: 6px 10px; border-radius: 999px; border: 1px solid var(--line-2); background: color-mix(in srgb, var(--ground-2) 70%, transparent); }
.e-hour-sun { width: 12px; height: 12px; border-radius: 50%; background: ${SUN_FILL}; box-shadow: 0 0 0 4px color-mix(in srgb, ${SUN_FILL} 22%, transparent), 0 0 18px ${SUN_FILL}; flex: none; }

/* ── buttons and links ── */
.n-btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 52px; padding: 0 24px; border-radius: 999px; font: 700 17px/1 var(--n-text); text-decoration: none; border: 1.5px solid transparent; }
.n-site .n-btn-go { background: var(--brass-ui); color: var(--on-accent); box-shadow: 0 10px 30px -12px color-mix(in srgb, ${SUN_FILL} 70%, transparent), inset 0 1px 0 rgba(255,255,255,.35); }
.n-site .n-btn-line { border-color: var(--line-2); color: var(--ink); background: color-mix(in srgb, var(--ink) 5%, transparent); }
.n-site .n-btn-line:hover { border-color: var(--ink); }
.n-site .n-link { color: var(--ink); text-decoration: underline; text-decoration-color: ${SUN_FILL}; text-decoration-thickness: 2px; text-underline-offset: 5px; font-weight: 700; }
.n-site .n-link:hover { color: var(--brass); }
@media (prefers-reduced-motion: no-preference) {
  .n-btn { transition: background-color .15s, border-color .15s, filter .15s; }
  .n-site .n-btn-go:hover { filter: brightness(1.07); }
}

/* ── header: dark glass at every hour, and the day as a line of light under it ── */
.n-hdr { position: sticky; top: 0; z-index: 40; ${vars(N)}; background: color-mix(in srgb, ${N.grounds[0]} 84%, transparent); backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3); border-bottom: 1px solid var(--line); }
.n-hdr-in { display: flex; align-items: center; gap: 28px; min-height: var(--n-hdr); }
.n-hdr .lockup { display: inline-flex; text-decoration: none; min-width: 0; }
.n-nav { display: flex; gap: 24px; margin-right: auto; }
.n-nav a, .n-hdr-act > a:not(.n-btn) { font-size: 16px; font-weight: 600; text-decoration: none; color: var(--ink-soft); }
.n-nav a:hover, .n-hdr-act > a:not(.n-btn):hover { color: var(--ink); }
.n-hdr-act { display: flex; align-items: center; gap: 20px; min-width: 0; }
.n-hdr-act .n-btn { min-height: 44px; padding: 0 18px; font-size: 16px; }
.n-hdr-act u { text-decoration-color: ${SUN_FILL}; text-decoration-thickness: 2px; text-underline-offset: 4px; color: var(--ink); }
.n-menu { display: none; position: relative; }
.n-menu summary { list-style: none; cursor: pointer; display: grid; place-items: center; width: 46px; height: 46px; border: 1px solid var(--line-2); border-radius: 999px; }
.n-menu summary::-webkit-details-marker { display: none; }
.n-menu summary svg { width: 22px; height: 22px; stroke: currentColor; stroke-width: 2; fill: none; }
.n-menu-panel { position: absolute; right: 0; top: 56px; width: min(86vw, 320px); background: var(--ground-2); border: 1px solid var(--line-2); border-radius: 14px; padding: 10px; display: grid; gap: 2px; box-shadow: 0 30px 60px -20px black; }
.n-menu-panel a { padding: 14px; border-radius: 8px; text-decoration: none; font-weight: 600; }
.n-menu-panel a:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); }
.n-menu-panel hr { border: 0; border-top: 1px solid var(--line); margin: 6px 0; }
.e-daybar { position: absolute; left: 0; right: 0; bottom: -1px; height: 3px; background: linear-gradient(90deg, ${N.grounds[1]}, #5a3a78 12%, #f39a6a 22%, #fbe3cc 32%, #eef3f5 48%, #f2dfbf 66%, #f0a25a 78%, #9a3f22 88%, ${E.grounds[0]}); opacity: .9; }
.e-daybar span { position: absolute; top: 50%; left: 0; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; border-radius: 50%; background: #ffe2c0; box-shadow: 0 0 0 3px color-mix(in srgb, ${SUN_FILL} 45%, transparent), 0 0 16px ${SUN_FILL}; display: none; }
@supports (animation-timeline: scroll()) {
  @media (prefers-reduced-motion: no-preference) {
    .e-daybar span { display: block; animation: e-sun-cross linear both; animation-timeline: scroll(root); }
    @keyframes e-sun-cross { from { left: 0; } to { left: 100%; } }
  }
}
@media (max-width: 1080px) { .n-nav { display: none; } .n-hdr-act { margin-left: auto; } }
@media (max-width: 767px) { .n-site { --n-hdr: 60px; } .n-hdr-act > a:not(.n-btn) { display: none; } .n-menu { display: block; } .n-hdr-act .n-btn { padding: 0 14px; } .n-hdr .lockup svg { max-height: 30px; } }
@media (max-width: 400px) { .n-hdr-act .n-btn { display: none; } }

/* ═════════ THE LIGHT: each section in its hour ═════════ */
/* the ground is a real background-color too (the blend is an image over it), so anything that reads
   the colour behind a word, a person or legible.spec, finds the hour's own ground */
.e-sec { position: relative; isolation: isolate; background: linear-gradient(180deg, var(--e-from, var(--e-g)) 0, var(--e-g) var(--e-blend)); background-color: var(--e-g); }

/* ── tap targets: a link that is not set inline in a sentence is a 44px target ── */
.n-site .n-more-links a, .n-site .n-answers a, .n-site .n-doors a, .n-site .n-ftr-base a, .n-site .n-ftr nav a, .n-site .n-hero-facts a { display: inline-flex; align-items: center; min-height: 44px; }
.n-site .n-close-auth a[href="/play"] { min-height: 44px; }
@media (max-width: 999px) { .e-desk { display: none; } }
.e-sky { position: absolute; inset: 0; z-index: -1; pointer-events: none; }

/* ═════════ THE DEVICES: one frame everywhere; the shadow takes the colour of its hour ═════════ */
.n-phone { position: relative; background: var(--n-device); border-radius: clamp(26px, 3.6vw, 46px); padding: clamp(6px, .7vw, 9px); box-shadow: 0 0 0 1.5px var(--n-device-edge), inset 0 0 0 1px rgba(255,255,255,.08), 0 40px 70px -30px var(--e-shadow), 0 14px 24px -14px var(--e-shadow); }
.n-phone-screen { position: relative; overflow: hidden; border-radius: clamp(20px, 3vw, 38px); aspect-ratio: 1179 / 2556; background: #f4f2ec; }
.n-lid { position: relative; background: var(--n-device); border-radius: 16px 16px 8px 8px; padding: 1.3% 1.3% 2%; box-shadow: 0 0 0 1.5px var(--n-device-edge), 0 50px 90px -40px var(--e-shadow), 0 16px 30px -18px var(--e-shadow); }
.n-lid::after { content: ""; position: absolute; left: -4%; right: -4%; bottom: -12px; height: 12px; border-radius: 0 0 14px 14px; background: linear-gradient(#c9ccd4, #8d919c); box-shadow: 0 18px 30px -12px var(--e-shadow); }
.n-lid-screen { position: relative; overflow: hidden; border-radius: 4px; aspect-ratio: 16 / 10; background: #f4f2ec; }
.n-phone-screen img, .n-lid-screen img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.n-frame { position: absolute; inset: 0; }
.n-frame.n-off { opacity: 0; }
.n-mark { position: absolute; border: 3px solid var(--brass-ui); border-radius: 8px; box-shadow: 0 0 0 6px color-mix(in srgb, var(--brass-ui) 26%, transparent); pointer-events: none; opacity: 0; }
.n-mark.n-show { opacity: 1; }
/* glass: one soft sheen over a screen, a layer of the page and never part of the picture */
.n-glass { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(118deg, rgba(255,255,255,.16), rgba(255,255,255,0) 30%); }
/* a console screen on a phone-width page is a cropped detail, never a whole screen shrunk to nothing */
@media (max-width: 600px) {
  .n-crop .n-lid-screen { aspect-ratio: 1 / 1; }
  /* drawn 1.6 windows wide (sidebar off, words about 1.6 times larger); --cx is how far left it moves */
  /* a 16:10 capture covering a square is drawn 1.6 windows wide; --cx says which part shows. The
     picture's own box stays inside the window, so nothing reaches past the page's edge. */
  .n-crop .n-lid-screen img { object-fit: cover; object-position: var(--cx, 50%) top; }
}

/* ═════════ 06:12, FIRST LIGHT ═════════ */
/* the horizon sits inside the first screen of a laptop: the course is drawn under the devices */
.n-hero { --e-horizon: clamp(140px, 13vw, 200px); overflow: clip; padding: clamp(24px, 3.4vw, 48px) 0 var(--e-horizon); background: ${D.grounds[0]}; }
.e-sky-dawn {
  background:
    radial-gradient(44% 480px at 76% calc(100% - var(--e-horizon) * .42), rgba(255,184,128,.62), rgba(226,120,118,.32) 38%, rgba(120,62,130,.16) 64%, transparent 80%),
    linear-gradient(to top, #f6a477 0, #f6a477 calc(var(--e-horizon) * .35), #d47a74 calc(var(--e-horizon) * .52), #8a4a6e calc(var(--e-horizon) * .74), #3a2a5e calc(var(--e-horizon) * .96), ${D.grounds[2]} calc(var(--e-horizon) + 30px), ${D.grounds[1]} 62%, ${D.grounds[0]} 100%),
    ${GRAIN};
}
/* the last of the night: a scatter of stars, high and faint */
.e-sky-dawn::before { content: ""; position: absolute; inset: 0 0 45% 0; opacity: .55;
  background-image: radial-gradient(1.2px 1.2px at 12% 18%, #fff, transparent), radial-gradient(1px 1px at 28% 8%, #fff, transparent), radial-gradient(1.4px 1.4px at 46% 22%, #fff, transparent), radial-gradient(1px 1px at 63% 12%, #fff, transparent), radial-gradient(1.2px 1.2px at 81% 26%, #fff, transparent), radial-gradient(1px 1px at 92% 9%, #fff, transparent), radial-gradient(1px 1px at 37% 34%, #fff, transparent), radial-gradient(1px 1px at 7% 40%, #fff, transparent); }
.n-hero-grid { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 5fr); gap: clamp(28px, 4vw, 72px); align-items: center; position: relative; z-index: 1; }
.n-hero-top { min-width: 0; }
.n-site .n-kicker { display: inline-flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; color: var(--ink); text-decoration: none; padding: 7px 16px 7px 10px; border: 1px solid var(--line-2); border-radius: 999px; margin-bottom: 26px; max-width: 100%; background: color-mix(in srgb, var(--ground-2) 60%, transparent); backdrop-filter: blur(8px); }
.n-site .n-kicker:hover { border-color: var(--ink); }
.n-kicker i { width: 9px; height: 9px; border-radius: 50%; background: var(--brass-ui); box-shadow: 0 0 0 4px color-mix(in srgb, var(--brass-ui) 25%, transparent); flex: none; }
.n-hero .n-tagline { margin-bottom: 16px; }
.e-h1 > span { display: block; }
.e-hl { position: relative; color: var(--brass); white-space: nowrap; }
.e-putt { position: absolute; left: -2%; bottom: -.22em; width: 104%; height: .3em; overflow: visible; pointer-events: none; }
.e-putt path { fill: none; stroke: ${SUN_FILL}; stroke-width: 2.5; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.e-ball { position: absolute; right: calc(5.3% - .08em); bottom: -.16em; width: .16em; height: .16em; border-radius: 50%; background: #fff7ec; box-shadow: 0 0 10px rgba(255,220,180,.9); }
.e-sub { margin-top: 26px; font-weight: 500; font-size: clamp(21px, calc(15px + 1vw), 27px); line-height: 1.25; color: var(--ink); }
.e-sub span { display: block; }
.n-hero-sub { margin-top: 16px; max-width: 34em; font-size: clamp(17px, calc(15px + .25vw), 18.5px); line-height: 1.6; color: var(--ink-soft); }
.n-hero-sub b { color: var(--ink); font-weight: 700; }
.n-hero-go { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
.n-hero-facts { display: flex; flex-wrap: wrap; gap: 8px 22px; margin-top: 24px; font-size: 15.5px; color: var(--ink-soft); }
.n-hero-facts li { display: inline-flex; align-items: center; gap: 8px; }
.n-hero-facts li::before { content: ""; width: 12px; height: 7px; border-left: 2.5px solid var(--brass); border-bottom: 2.5px solid var(--brass); rotate: -45deg; translate: 0 -2px; flex: none; }

/* the stage: the live board standing in the first light, two more screens behind it as depth */
.e-stage { position: relative; min-width: 0; display: grid; justify-items: center; padding: 20px 0 0; }
.e-stage::before { content: ""; position: absolute; z-index: 0; left: 50%; top: 80%; width: 190%; height: 120%; transform: translate(-50%, -50%); background: radial-gradient(closest-side, rgba(255,190,132,.55), rgba(236,128,108,.32) 34%, rgba(150,72,140,.16) 62%, transparent); filter: blur(8px); pointer-events: none; }
/* THE PHOTOGRAPHS (Canva AI, 2 Nov, each judged as a believable photograph of real light on a real
   course): laid low and faint under the CSS light, never under a word that matters and never over a
   screen. Dawn: the band above the horizon, fading out upward. Golden hour: the whole sky. */
.e-photo { position: absolute; left: 0; right: 0; bottom: 0; z-index: -1; pointer-events: none; background-repeat: no-repeat; background-size: cover; }
.e-photo-dawn { height: calc(var(--e-horizon) + 280px); background-image: url(/new/e-dawn.w900.webp); background-position: center 64%; opacity: .32;
  -webkit-mask-image: linear-gradient(to top, #000 55%, transparent); mask-image: linear-gradient(to top, #000 55%, transparent); }
.e-photo-golden { top: 0; z-index: 0; background-image: url(/new/e-golden.w900.webp); background-position: center 20%; opacity: .34; }
@media (min-width: 901px) { .e-photo-dawn { background-image: url(/new/e-dawn.w1776.webp); } .e-photo-golden { background-image: url(/new/e-golden.w1776.webp); } }
/* the hour, floating at the top of the stage on glass */
.e-stage-hour { position: absolute; z-index: 5; top: 0; right: 0; padding: 6px 12px 6px 10px; border-radius: 999px; background: color-mix(in srgb, ${D.panel} 88%, transparent); border: 1px solid var(--line-2); backdrop-filter: blur(10px); }
.e-stage-hour .e-hour { margin: 0; color: var(--ink); }
.e-stage-hour .e-hour b { padding: 0; border: 0; background: none; }
.e-hero-caption { margin-bottom: clamp(36px, 5vw, 64px); }
.e-stage .e-front { position: relative; z-index: 3; width: min(320px, 74%, max(230px, calc((100svh - 330px) * .46))); }
.e-stage .e-front { box-shadow: 0 0 0 1.5px var(--n-device-edge), inset 0 0 0 1px rgba(255,255,255,.08), -30px 60px 90px -40px #000, 0 0 90px -20px rgba(255,150,90,.55); }
.e-decor { position: absolute; pointer-events: none; }
.n-win::-webkit-scrollbar { display: none; }
.e-desk { z-index: 1; width: 78%; left: 20%; top: 4%; transform: perspective(1400px) rotateY(-22deg) rotateX(6deg); transform-origin: left center; opacity: .5; filter: saturate(.75) brightness(.72); }
.e-back { z-index: 2; width: 52%; left: -4%; top: 16%; transform: rotate(-8deg); opacity: .85; filter: brightness(.8); }
.n-live { position: relative; z-index: 4; margin-top: -40px; display: flex; align-items: center; gap: 14px; padding: 12px 18px; border-radius: 16px; background: color-mix(in srgb, ${D.panel} 90%, transparent); backdrop-filter: blur(14px) saturate(1.3); -webkit-backdrop-filter: blur(14px) saturate(1.3); border: 1px solid var(--line-2); box-shadow: 0 20px 40px -16px #000; font-size: 15.5px; max-width: 100%; color: var(--ink); }
.n-live b { font-weight: 700; }
.n-live > span:last-child { color: var(--ink-soft); min-width: 0; }
.n-live .n-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--brass-ui); flex: none; box-shadow: 0 0 12px ${SUN_FILL}; }
.n-live .n-big { font: 750 30px/1 var(--n-fig); color: var(--brass); }
.n-caption { max-width: 52em; font-size: 15px; color: var(--ink-soft); }
.e-caption-left { margin-top: 26px; }
.n-kicker-after { display: none; }
@media (prefers-reduced-motion: no-preference) {
  .e-stage .e-front { animation: e-arrive 1.1s cubic-bezier(.2,.7,.2,1) both .15s; }
  .e-back { animation: e-arrive-back 1.1s cubic-bezier(.2,.7,.2,1) both .05s; }
  @keyframes e-arrive { from { opacity: 0; transform: translateY(34px); } }
  @keyframes e-arrive-back { from { opacity: 0; transform: rotate(-2deg) translate(30px, 26px); } }
  .e-putt path { stroke-dasharray: 260; stroke-dashoffset: 260; animation: e-draw 1.1s ease-out 1s forwards; }
  .e-ball { animation: e-drop .5s ease-out 2s both; }
  @keyframes e-draw { to { stroke-dashoffset: 0; } }
  @keyframes e-drop { from { opacity: 0; transform: translateX(-140%) scale(.6); } }
}
@media (max-width: 1000px) and (min-width: 768px) { .n-hero-grid { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); } }
/* A PHONE: words first, then the board, which must be in the first screen of 393 x 852 */
@media (max-width: 767px) {
  .n-hero { padding-top: 18px; --e-horizon: 120px; }
  .e-stage-hour { position: relative; justify-self: start; margin-bottom: 10px; }
  .n-hero-grid { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .n-hero-top .n-kicker { display: none; }
  .n-kicker-after { display: block; margin-top: 26px; position: relative; z-index: 1; }
  .n-kicker-after .n-kicker { margin: 0; line-height: 1.35; }
  .n-hero .n-tagline { font-size: 12.5px; margin-bottom: 10px; }
  .e-h1 { font-size: 37px; }
  .e-sub { margin-top: 16px; font-size: 20px; }
  .n-hero-sub { font-size: 17px; margin-top: 10px; }
  .n-sub-more { display: none; }
  .n-hero-go { margin-top: 18px; gap: 10px; }
  .n-hero-go .n-btn { flex: 1 1 0; padding: 0 10px; font-size: 16px; min-height: 48px; white-space: nowrap; min-width: 0; }
  .n-hero-facts { display: none; }
  .e-stage .e-front { width: min(60%, 240px); }
  .e-desk { display: none; }
  .e-back { width: 40%; left: 4%; top: 14%; }
  .n-live { margin-top: -30px; flex-wrap: wrap; }
}

/* ═════════ the course on the horizon (course.tsx), lit per hour ═════════ */
.e-course { position: absolute; left: 0; right: 0; bottom: 0; width: 100%; height: var(--e-horizon, 220px); z-index: 0; pointer-events: none; display: block; }
.e-course .e-far { fill: var(--e-far); } .e-course .e-trees { fill: var(--e-trees); } .e-course .e-near { fill: var(--e-near); }
.e-course-dawn { --e-far: #3e2a52; --e-trees: #1a1838; --e-near: ${N.grounds[0]}; --e-sun: #f6a477; --e-sun-core: #ffd9b8; --e-mist: #b9a3c4; }
.e-course-golden { --e-far: #8a3a22; --e-trees: #5a2214; --e-near: ${G.grounds[0]}; --e-sun: #f7b468; --e-sun-core: #ffe6b8; --e-mist: #f0b27c; }

/* ═════════ THE WEEK BEFORE, THEN SATURDAY MORNING (C's scroll story, in its light) ═════════ */
.n-story-sec { padding-top: var(--n-sec); overflow-x: clip; background: ${N.grounds[0]}; }
.n-story-head { display: grid; gap: 16px; max-width: 46em; }
.n-story-head .e-hour { margin-bottom: 0; }
.n-story { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(32px, 5vw, 96px); margin-top: clamp(16px, 3vw, 40px); }
.n-steps { min-width: 0; }
.n-step { position: relative; min-height: 78vh; display: grid; align-content: center; gap: 12px; padding: 48px 0; color: var(--ink); background-color: var(--e-g); background-image: linear-gradient(180deg, var(--e-prev, var(--e-g)) 0, var(--e-g) 150px); }
/* the band of the moment's light, the width of the page, behind everything in the story */
.n-step::before { content: ""; position: absolute; z-index: -1; top: 0; bottom: 0; left: -100vw; right: -100vw; background: linear-gradient(180deg, var(--e-prev, var(--e-g)) 0, var(--e-g) 150px); }
.n-step:first-child { min-height: 70vh; }
.n-step:last-child { min-height: 86vh; }
/* where the light turns (night to sunrise), the moment starts lower, so no word sits on the turn */
.n-step.e-turn { padding-top: 170px; }
.n-ch { display: flex; align-items: baseline; gap: 14px; margin-bottom: 18px; font: 700 14px/1.2 var(--n-text); letter-spacing: .12em; text-transform: uppercase; color: var(--brass); scroll-margin-top: calc(var(--n-hdr) + 24px); }
.n-ch-n { font: 750 clamp(40px, 4.4vw, 60px)/.9 var(--n-fig); letter-spacing: -.03em; color: transparent; -webkit-text-stroke: 1.5px var(--brass); text-transform: none; }
.n-stamp { display: flex; align-items: baseline; gap: 10px; font-size: 16px; color: var(--ink-soft); }
.n-stamp b { font: 700 22px/1 var(--n-fig); color: var(--ink); }
.n-step .n-who { font-size: 15px; font-weight: 700; color: var(--ink-soft); padding: 3px 10px; border: 1px solid var(--line-2); border-radius: 999px; justify-self: start; }
.n-step h3 { font: 560 clamp(26px, calc(18px + 1.3vw), 38px)/1.12 var(--n-head); letter-spacing: -.015em; text-wrap: balance; }
.n-step p.n-say { font-size: 17.5px; color: var(--ink-soft); max-width: 30em; }
.n-step-phone { display: none; }

.n-story-dev { position: relative; min-width: 0; }
.n-story-pin { position: sticky; top: calc(var(--n-hdr) + 28px); height: calc(100svh - var(--n-hdr) - 56px); max-height: 820px; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: clamp(18px, 3vw, 44px); }
.e-pin-dev { min-width: 0; }
.n-story-pin .n-phone { width: min(330px, 100%, calc((100svh - var(--n-hdr) - 160px) * .4613)); justify-self: start; --e-shadow: rgba(10,10,30,.5); }
.n-story-pin .n-phone-screen .n-frame { will-change: opacity; }
/* glass: the rail and the clock float over whichever band is behind them, in one fixed light */
.n-story-pin nav, .n-now { ${vars(N)}; background: color-mix(in srgb, ${N.grounds[0]} 80%, transparent); backdrop-filter: blur(14px) saturate(1.3); -webkit-backdrop-filter: blur(14px) saturate(1.3); border: 1px solid var(--line-2); border-radius: 16px; box-shadow: 0 20px 40px -20px rgba(0,0,0,.5); }
.n-story-pin nav { padding: 12px 16px 12px 8px; }
.n-now { margin-top: 16px; font-size: 15px; color: var(--ink-soft); text-align: center; min-height: 1.6em; padding: 8px 14px; }
.n-now b { color: var(--ink); font-family: var(--n-fig); }
.n-rail { display: grid; gap: 4px; position: relative; padding-left: 18px; }
.n-rail::before { content: ""; position: absolute; left: 4px; top: 10px; bottom: 10px; width: 2px; background: var(--line-2); border-radius: 2px; }
.n-rail::after { content: ""; position: absolute; left: 4px; top: 10px; width: 2px; height: calc((100% - 20px) * var(--p, 0)); background: var(--brass-ui); border-radius: 2px; }
.n-rail a { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 6px; align-items: baseline; padding: 8px 0; text-decoration: none; color: var(--ink-soft); font-size: 15px; font-weight: 600; position: relative; }
.n-rail a::before { content: ""; position: absolute; left: -18px; top: 15px; width: 10px; height: 10px; border-radius: 50%; background: ${N.grounds[0]}; border: 2px solid var(--line-2); }
.n-rail a span:first-child { font: 700 15px/1 var(--n-fig); font-variant-numeric: tabular-nums; }
.n-rail a:hover { color: var(--ink); }
.n-rail .n-on a, .n-rail .n-done a { color: var(--ink); }
.n-rail .n-on a::before, .n-rail .n-done a::before { background: var(--brass-ui); border-color: var(--brass-ui); }
.n-rail .n-on a span:first-child { color: var(--brass); }
@media (prefers-reduced-motion: no-preference) {
  .n-story-pin .n-frame { transition: opacity .45s ease; }
  .n-rail::after { transition: height .45s ease; }
}
@media (max-width: 1100px) and (min-width: 768px) {
  .n-story { gap: 32px; }
  .n-story-pin { grid-template-columns: minmax(0, 1fr); justify-items: center; align-content: center; }
  .n-story-pin .n-phone { justify-self: center; width: min(300px, calc((100svh - var(--n-hdr) - 210px) * .4613)); }
  .n-story-pin nav { display: none; }
}
@media (max-width: 767px) {
  .n-story { grid-template-columns: minmax(0, 1fr); }
  .n-story-dev { display: none; }
  .n-step, .n-step:first-child, .n-step:last-child { min-height: 0; padding: 40px 0 48px; }
  .n-step.e-turn { padding-top: 150px; }
  .n-ch-n { font-size: 42px; }
  .n-step-phone { display: block; width: min(76%, 300px); margin: 18px auto 0; }
}

/* ═════════ SECTIONS ═════════ */
.n-sec { padding: var(--n-sec) 0 0; }
.n-sec-head { display: grid; gap: 14px; max-width: 46em; }
.n-sec-head .e-hour { margin-bottom: 0; }

/* ── 11:42, the whole club watches (bright morning) ── */
#watch { padding-bottom: var(--n-sec); }
.n-watch { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 6fr); gap: clamp(32px, 5vw, 80px); align-items: end; }
.n-watch-big { font: 560 clamp(30px, calc(20px + 2vw), 50px)/1.08 var(--n-head); letter-spacing: -.015em; text-wrap: balance; }
.n-watch-big .n-t { display: block; color: var(--brass); font: 750 1em/1.1 var(--n-fig); font-variant-numeric: tabular-nums; }
.e-watch-row { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 2.4fr) minmax(0, 2.4fr); gap: clamp(14px, 2vw, 28px); align-items: end; margin-top: clamp(40px, 5vw, 72px); }
.e-watch-row figure { min-width: 0; }
.e-watch-row figcaption, .e-fig figcaption { margin-top: 18px; font-size: 15.5px; color: var(--ink-soft); }
.e-watch-row figcaption b, .e-fig figcaption b { display: block; color: var(--ink); }
.n-try { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 20px; align-items: center; margin-top: 28px; padding: 20px; border: 1px solid var(--line); border-radius: 18px; background: var(--card); box-shadow: 0 24px 50px -30px var(--e-shadow); }
.n-try svg { width: 108px; height: 108px; border-radius: 8px; }
.n-try .n-qr-ground { fill: #fff; }
.n-try .n-qr-ink { fill: #111; }
.n-try p { font-size: 16px; color: var(--ink-soft); }
.n-try p b { display: block; color: var(--ink); font-size: 17px; }
.n-doors { display: flex; flex-wrap: wrap; gap: 10px 22px; margin-top: 22px; }
@media (max-width: 900px) {
  .n-watch { grid-template-columns: minmax(0, 1fr); }
  .e-watch-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .e-watch-row .e-fig-lap { grid-column: 1 / -1; }
}
@media (max-width: 600px) { .e-watch-row figure:not(.e-fig-lap) .n-phone { width: 86%; margin: 0 auto; } }
@media (max-width: 640px) { .n-try { grid-template-columns: minmax(0, 1fr); } .n-try svg { display: none; } }

/* ── 12:30, midday: the committee's bento (from B), in full sun ── */
#desk { padding-bottom: var(--n-sec); }
/* the sun at its height: a bloom of white light over the bento, clear of the section's first stretch */
.e-sky-midday { background: radial-gradient(44% 300px at 72% 360px, rgba(255,255,255,.95), rgba(255,255,255,0) 100%), radial-gradient(30% 220px at 72% 360px, rgba(255,236,190,.5), transparent 100%); }
.n-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: clamp(14px, 1.6vw, 22px); margin-top: clamp(36px, 4vw, 56px); }
.n-tile { --e-pad: clamp(22px, 2.4vw, 34px); position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 22px; padding: var(--e-pad); border-radius: 22px; background: var(--card); box-shadow: 0 1px 0 rgba(255,255,255,.9) inset, 0 0 0 1px var(--line), 0 30px 60px -36px rgba(30,40,60,.35), 0 8px 18px -12px rgba(30,40,60,.18); min-width: 0; }
.n-tile-say { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 14px; align-items: baseline; max-width: 34em; }
.n-tile-say .n-t { grid-row: span 2; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: color-mix(in srgb, ${SUN_FILL} 18%, white); color: var(--brass); font: 750 15px/1 var(--n-fig); }
.n-tile-say b { font: 600 clamp(19px, calc(.4vw + 15px), 22px)/1.25 var(--n-head); letter-spacing: -.01em; }
.n-tile-say p { color: var(--ink-soft); font-size: 16px; }
/* a window onto a capture: the screen is cropped and shown nearer its own size, never redrawn */
/* a window onto a capture drawn larger than it: it scrolls sideways rather than spilling, so the
   real screen can be panned with a finger and nothing reaches past the page's edge */
.n-win { position: relative; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; overscroll-behavior-x: contain; margin-top: auto; border-radius: 14px; background: #f4f2ec; box-shadow: 0 0 0 1px var(--line), 0 20px 40px -24px rgba(30,40,60,.4); aspect-ratio: var(--ar, 16 / 10); }
.n-site .n-win img { position: absolute; left: 0; top: 0; max-width: none; width: calc(var(--z, 1) * 100%); height: auto; transform: translate(calc(-1 * var(--fx, 0%)), calc(-1 * var(--fy, 0%))); }
.n-win-needs { --z: 1.3; --fx: 19%; --fy: 0%; }
.n-win-draw { --z: 1.7; --fx: 18.5%; --fy: 52%; }
.n-win-flights { --z: 1.25; --fx: 19%; --fy: 2%; }
.n-win-list { --z: 1.24; --fx: 18%; --fy: 6%; }
.n-tile-bleed .n-win { margin-right: calc(-1 * var(--e-pad)); margin-bottom: calc(-1 * var(--e-pad)); border-radius: 14px 0 0 0; }
.n-tile-xl { grid-column: span 8; grid-row: span 2; background: linear-gradient(180deg, var(--card) 40%, #f1f5f8); background-color: var(--card); }
.n-tile-xl .n-win { --ar: 16 / 10.4; }
.n-tile-tall { grid-column: span 4; grid-row: span 2; background: linear-gradient(180deg, var(--card), #eef2f5); background-color: var(--card); }
.n-tile-tall .n-tile-phone { margin-top: auto; margin-bottom: calc(-1 * var(--e-pad)); padding: 0 6%; height: clamp(300px, 30vw, 420px); overflow: hidden; }
.n-tile-tall .n-phone { border-bottom-left-radius: 0; border-bottom-right-radius: 0; padding-bottom: 0; --e-shadow: rgba(30,40,60,.3); }
.n-tile-tall .n-phone-screen { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.n-tile-draw { grid-column: span 5; }
.n-tile-draw .n-win { --ar: 16 / 9; }
.n-tile-128 { grid-column: span 7; background: radial-gradient(80% 120% at 100% 0%, #24344a, #121b29); background-color: #121b29; color: #f3f5f8; }
.n-tile-128 .n-h3 { color: #f3f5f8; }
.n-tile-128 p { color: #c9d2dc; font-size: 16px; margin-top: 10px; }
.n-tile-128 .n-num-big { font: 760 clamp(60px, 6.5vw, 92px)/.9 var(--n-fig); letter-spacing: -.05em; color: #f9ae74; }
.n-tile-128 .n-128-say { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 22px; align-items: end; }
.n-tile-128 .n-win { --ar: 16 / 8; box-shadow: 0 0 0 1px rgba(255,255,255,.14), 0 30px 60px -20px #000; }
.n-tile-list { grid-column: span 12; display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 8fr); align-items: center; gap: clamp(20px, 3vw, 44px); }
.n-tile-list .n-win { --ar: 16 / 6.4; margin: 0; }
@media (min-width: 1001px) {
  .n-tile-xl .n-win { flex: 1 1 auto; aspect-ratio: auto; min-height: 340px; }
}
@media (max-width: 1000px) {
  .n-tile-xl { grid-column: span 12; grid-row: auto; }
  .n-tile-tall { grid-column: span 6; grid-row: auto; }
  .n-tile-draw { grid-column: span 6; }
  .n-tile-128 { grid-column: span 12; }
  .n-tile-list { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 680px) {
  .n-bento { grid-template-columns: minmax(0, 1fr); }
  .n-tile-xl, .n-tile-tall, .n-tile-draw, .n-tile-128, .n-tile-list { grid-column: auto; }
  .n-tile-xl .n-win { --ar: 1 / 1; --z: 2.1; }
  .n-tile-tall .n-tile-phone { height: 360px; padding: 0 12%; }
  .n-tile-draw .n-win { --ar: 1 / 1; --z: 2.2; }
  .n-tile-128 .n-128-say { grid-template-columns: minmax(0, 1fr); }
  .n-tile-128 .n-win { --ar: 1 / 1; --z: 2.4; }
  .n-tile-list .n-win { --ar: 1 / 1; --z: 2.3; }
}
.n-formats { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: clamp(32px, 5vw, 72px); align-items: start; margin-top: clamp(56px, 7vw, 96px); }
.n-formats > div { display: grid; gap: 16px; }
.n-format-wall { display: flex; flex-wrap: wrap; gap: 8px; }
.n-format-wall li { padding: 8px 14px; border-radius: 999px; font-size: 16px; font-weight: 600; color: var(--ink); background: var(--card); box-shadow: 0 0 0 1px var(--line), 0 6px 14px -10px rgba(30,40,60,.3); }
.n-runs { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; }
.n-runs li { padding: 6px 12px; border-radius: 8px; background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink-soft); font-weight: 600; font-size: 15.5px; }
@media (max-width: 900px) { .n-formats { grid-template-columns: minmax(0, 1fr); } }

/* ── 14:00, afternoon: the money ── */
#money { padding-bottom: var(--n-sec); }
.n-money { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 6fr); gap: clamp(32px, 5vw, 80px); align-items: center; }
.n-money > div { min-width: 0; }
.n-money .e-hour { margin-bottom: 18px; }
.n-money-pic { display: grid; grid-template-columns: minmax(0, 1fr); justify-items: center; position: relative; }
.n-money-pic::before { content: ""; position: absolute; inset: 10% -10%; background: radial-gradient(closest-side, rgba(255,200,130,.5), transparent); z-index: -1; }
.n-money-pic .n-phone { width: min(320px, 80%); }
.n-coins { display: flex; gap: 8px; margin-top: 28px; flex-wrap: wrap; }
.n-coin { min-width: 64px; min-height: 60px; padding: 6px 14px; display: grid; justify-items: center; align-content: center; gap: 2px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--card); color: var(--ink); cursor: pointer; font: inherit; }
.n-coin b { font: 750 24px/1 var(--n-fig); }
.n-coin span { font-size: 13px; color: var(--ink-soft); }
.n-coin[aria-selected="true"] { background: var(--brass-ui); border-color: var(--brass-ui); color: var(--on-accent); }
.n-coin[aria-selected="true"] span { color: var(--on-accent); }
.n-money-say { margin-top: 16px; font-size: 16px; color: var(--ink-soft); min-height: 1.6em; }
.n-also { margin-top: 24px; font-size: 15.5px; color: var(--ink-soft); }
.n-money-pic .n-frame { position: absolute; inset: 0; }
.n-never { margin-top: 26px; padding: 18px 20px; border-left: 3px solid var(--brass-ui); background: var(--card); border-radius: 0 12px 12px 0; font-size: 17px; color: var(--ink-soft); }
.n-never b { color: var(--ink); }
.e-ledger { margin-top: clamp(48px, 6vw, 88px); display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 8fr); gap: clamp(28px, 4vw, 64px); align-items: center; }
.e-ledger > div { min-width: 0; display: grid; gap: 12px; }
.e-ledger p { color: var(--ink-soft); }
.e-themes-line { margin-top: clamp(36px, 4vw, 56px); display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; font-size: 16px; color: var(--ink-soft); padding-top: 22px; border-top: 1px solid var(--line); }
.e-themes-line b { color: var(--ink); }
.e-themes-line span { display: inline-flex; align-items: center; gap: 8px; }
.e-themes-line i { width: 22px; height: 12px; border-radius: 6px; flex: none; box-shadow: 0 0 0 1px var(--line); }
@media (max-width: 900px) { .n-money, .e-ledger { grid-template-columns: minmax(0, 1fr); } }

/* ── 16:20, late afternoon: who it is for, pricing, questions ── */
#for { padding-bottom: var(--n-sec); }
#for > .n-wrap > .e-hour { display: flex; }
.n-for { margin-top: clamp(28px, 3.5vw, 48px); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.n-for li { min-width: 0; }
.n-for a { height: 100%; display: grid; align-content: start; gap: 12px; padding: 26px 24px; border-radius: 20px; background: var(--card); text-decoration: none; box-shadow: 0 0 0 1px var(--line), 0 24px 50px -34px var(--e-shadow); }
.n-for .n-who { font: 700 13.5px/1.2 var(--n-text); letter-spacing: .12em; text-transform: uppercase; color: var(--brass); }
.n-for p { color: var(--ink-soft); font-size: 16.5px; }
.n-for p b { display: block; color: var(--ink); font: 600 22px/1.2 var(--n-head); margin-bottom: 6px; }
.n-for .n-go { font-weight: 700; text-decoration: underline; text-decoration-color: ${SUN_FILL}; text-decoration-thickness: 2px; text-underline-offset: 5px; }
.n-for a:hover { box-shadow: 0 0 0 1.5px var(--ink-soft), 0 24px 50px -34px var(--e-shadow); }
@media (max-width: 900px) { .n-for { grid-template-columns: minmax(0, 1fr); } }
.e-pricing, .e-questions { margin-top: var(--n-sec); scroll-margin-top: 80px; }
.n-plans { margin-top: clamp(32px, 4vw, 56px); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.n-plan { min-width: 0; padding: clamp(22px, 2.4vw, 32px); display: grid; align-content: start; gap: 12px; border-radius: 20px; background: var(--card); box-shadow: 0 0 0 1px var(--line), 0 24px 50px -34px var(--e-shadow); }
.n-plan .n-tag { font-size: 15px; font-weight: 700; color: var(--ink-soft); }
.n-plan h3 { font: 600 28px/1.1 var(--n-head); }
.n-price { font: 750 clamp(44px, 4.4vw, 58px)/.9 var(--n-fig); letter-spacing: -.03em; font-variant-numeric: tabular-nums; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.n-price small { font: 600 16px/1.2 var(--n-text); letter-spacing: 0; color: var(--ink-soft); }
.n-plan .n-year { font-size: 15px; color: var(--ink-soft); min-height: 1.5em; }
.n-plan ul { display: grid; gap: 8px; font-size: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.n-plan li { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 8px; }
.n-plan li::before { content: ""; width: 12px; height: 7px; margin-top: 7px; border-left: 2.5px solid var(--brass); border-bottom: 2.5px solid var(--brass); rotate: -45deg; }
.n-plan .n-term { font-size: 14.5px; color: var(--ink-soft); }
.n-plan .n-btn { width: 100%; }
.n-plan-pick { box-shadow: 0 0 0 2px var(--brass-ui), 0 30px 60px -30px color-mix(in srgb, ${SUN_FILL} 55%, transparent); }
.n-small { margin-top: 22px; font-size: 15px; color: var(--ink-soft); max-width: 70em; }
.n-small a { color: inherit; }
.n-vs { margin-top: clamp(48px, 6vw, 80px); display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: clamp(28px, 4vw, 64px); align-items: center; }
.n-vs > div { min-width: 0; }
.n-vs p { margin-top: 12px; color: var(--ink-soft); }
.n-bars { display: grid; gap: 14px; }
.n-bars li { display: grid; grid-template-columns: 112px minmax(0, 1fr) 92px; gap: 14px; align-items: center; font-weight: 700; font-size: 16px; }
.n-bars .n-track { height: 30px; background: var(--card); border-radius: 999px; overflow: hidden; box-shadow: 0 0 0 1px var(--line); }
.n-bars .n-fill { display: block; height: 100%; background: color-mix(in srgb, var(--ink) 30%, var(--card)); border-radius: 999px; }
.n-bars .n-us .n-fill { background: var(--brass-ui); }
.n-bars .n-amt { text-align: right; font-variant-numeric: tabular-nums; }
.n-saved { display: flex; gap: 28px; flex-wrap: wrap; margin-top: 10px; font-size: 16px; color: var(--ink-soft); }
.n-saved b { font: 750 30px/1 var(--n-fig); color: var(--brass); display: block; }
.n-more-links { display: flex; flex-wrap: wrap; gap: 12px 26px; margin-top: 28px; }
@media (max-width: 900px) {
  .n-plans, .n-vs { grid-template-columns: minmax(0, 1fr); }
  .n-bars li { grid-template-columns: 88px minmax(0, 1fr) 78px; gap: 10px; }
}
.n-qa { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: clamp(32px, 5vw, 80px); margin-top: clamp(28px, 3.5vw, 48px); }
.n-qa > div { min-width: 0; }
.n-every { display: grid; gap: 10px; margin-top: 20px; font-size: 16.5px; }
.n-every li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 8px; color: var(--ink-soft); }
.n-every li::before { content: ""; width: 12px; height: 7px; margin-top: 8px; border-left: 2.5px solid var(--brass); border-bottom: 2.5px solid var(--brass); rotate: -45deg; }
.n-answers { display: grid; border-top: 1px solid var(--line); }
.n-answer { padding: 24px 0; border-bottom: 1px solid var(--line); display: grid; gap: 10px; }
.n-answer h3 { font: 600 22px/1.2 var(--n-head); }
.n-answer p { color: var(--ink-soft); }
@media (max-width: 900px) { .n-qa { grid-template-columns: minmax(0, 1fr); } }

/* ═════════ 17:40, GOLDEN HOUR: the sun low behind the green, the result in the long light ═════════ */
.e-golden { --e-horizon: 100%; background: ${G.grounds[0]}; padding-bottom: var(--n-sec); }
.e-golden-sky { position: relative; height: clamp(220px, 27vw, 400px);
  background: linear-gradient(180deg, ${LIGHT.late.grounds[0]} 0, #f6cf8e 26%, #f3a85e 52%, #e07a43 72%, #b9532d 88%, #9a3f22 100%); }
.e-golden-sky .e-course { height: 100%; }
.e-golden { background-image: radial-gradient(60% 380px at 78% calc(clamp(220px, 27vw, 400px) + 380px), rgba(255,160,80,.3), transparent 100%), linear-gradient(180deg, transparent 0, transparent clamp(220px, 27vw, 400px), ${G.grounds[0]} clamp(220px, 27vw, 400px), ${G.grounds[2]} 45%, ${G.grounds[1]} 100%), ${GRAIN}; }
.n-close.e-from-golden { --e-from: ${G.grounds[1]}; }
.e-final { display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 8fr); gap: clamp(28px, 4vw, 64px); align-items: start; margin-top: clamp(28px, 3.5vw, 52px); }
.e-final-say { min-width: 0; display: grid; gap: 16px; align-content: start; }
.e-final-say .e-hour { margin-bottom: 0; }
.e-final-facts { display: grid; gap: 10px; margin-top: 6px; }
.e-final-facts li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 8px; color: var(--ink-soft); }
.e-final-facts li::before { content: ""; width: 12px; height: 7px; margin-top: 8px; border-left: 2.5px solid var(--brass); border-bottom: 2.5px solid var(--brass); rotate: -45deg; }
.e-final-pics { position: relative; min-width: 0; display: grid; grid-template-columns: minmax(0, 2.6fr) minmax(0, 1fr); gap: clamp(14px, 2vw, 26px); align-items: end; }
.e-final-pics figure { min-width: 0; }
.e-final-pics figcaption { margin-top: 26px; font-size: 15.5px; }
.e-final-pics figcaption b { display: block; color: var(--ink); }
/* the player's phone stands in front of the laptop's corner, as one would on the desk */
.e-fig-final { margin-left: -16%; position: relative; z-index: 2; }
.e-fig-report figcaption { padding-right: 14%; }
/* the long light: a warm rim on the devices from the low sun on the right */
.e-golden .n-phone, .e-golden .n-lid { box-shadow: 0 0 0 1.5px rgba(255,210,150,.45), 14px 0 40px -18px rgba(255,170,90,.55), -40px 50px 80px -30px #000; }
.e-golden figcaption { color: var(--ink-soft); }
@media (max-width: 900px) { .e-final { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 600px) { .e-final-pics { grid-template-columns: minmax(0, 1fr); } .e-fig-final { margin: 0 auto; width: min(70%, 260px); } }

/* ═════════ 19:30, THE PRIZE-GIVING: the richest, darkest, warmest moment ═════════ */
.n-close { padding: var(--n-sec) 0; overflow: clip; background-image: linear-gradient(180deg, var(--e-from) 0, var(--e-g) var(--e-blend)), ${GRAIN}; background-color: var(--e-g); }
.e-lanterns { position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background:
    radial-gradient(28% 40% at 12% 30%, rgba(255,150,80,.22), transparent 70%),
    radial-gradient(22% 34% at 88% 70%, rgba(255,120,70,.18), transparent 70%),
    radial-gradient(60% 50% at 50% 115%, rgba(255,170,90,.16), transparent 70%); }
/* a string of lights across the top of the marquee */
.e-lanterns::before { content: ""; position: absolute; left: 0; right: 0; top: calc(var(--e-blend) + 10px); height: 26px; opacity: .85;
  background: radial-gradient(circle at 50% 60%, #ffd9a0 0 2.4px, rgba(255,190,110,.35) 3px, transparent 9px) 0 0 / 64px 26px repeat-x; }
.n-close-grid { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: clamp(32px, 5vw, 80px); align-items: start; padding-top: 30px; }
.n-close-grid > div { min-width: 0; }
.e-close-line { font-weight: 560; font-size: clamp(38px, calc(20px + 3vw), 64px); line-height: 1.02; letter-spacing: -.02em; }
.e-close-line span { display: block; }
.e-close-line span + span { color: var(--brass); }
.n-close .n-lead { margin-top: 18px; }
.n-close-auth { scroll-margin-top: 90px; }
.n-stores { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
.n-site .n-store { display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px; border: 1px solid var(--line-2); border-radius: 12px; text-decoration: none; min-height: 54px; }
.n-store small { display: block; font-size: 12.5px; color: var(--ink-soft); }
.n-store b { display: block; font-size: 17px; line-height: 1.1; }
.n-store svg { width: 22px; height: 22px; fill: currentColor; }
.n-stores-note { margin-top: 14px; font-size: 15px; color: var(--ink-soft); max-width: 36em; }
@media (max-width: 900px) { .n-close-grid { grid-template-columns: minmax(0, 1fr); } }

/* ── footer: night again ── */
.n-ftr { ${vars(E)}; padding: 52px 0 40px; border-top: 1px solid var(--line); background: ${E.grounds[1]}; }
.n-ftr-top { display: flex; flex-wrap: wrap; gap: 26px 48px; align-items: center; justify-content: space-between; }
.n-ftr .lockup { text-decoration: none; display: inline-flex; }
.n-ftr nav ul { display: flex; flex-wrap: wrap; gap: 10px 26px; }
.n-ftr nav a { text-decoration: none; font-weight: 600; font-size: 16px; color: var(--ink-soft); }
.n-ftr nav a:hover { color: var(--ink); }
.n-socials { display: flex; gap: 8px; }
.n-socials a { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 999px; border: 1px solid var(--line-2); color: var(--ink-soft); }
.n-socials a:hover { color: var(--on-accent); background: var(--brass-ui); border-color: var(--brass-ui); }
.n-socials svg { width: 20px; height: 20px; fill: currentColor; }
.n-ftr-base { margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 10px 26px; font-size: 14.5px; color: var(--ink-soft); }
.n-ftr-base a { color: var(--ink-soft); }
.n-ftr-base button { font: inherit; color: var(--ink-soft); }
.n-site .n-ftr-base .ed-note { margin: 0; padding: 0; }

/* the auth card from the shared chrome, seated in the evening */
.n-site .authpanel { max-width: none; }
`;
