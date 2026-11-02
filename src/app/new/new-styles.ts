import { DARK_GROUND } from "@/lib/themes";

/**
 * THE SITE REHAUL, DESIGN C: THE DAY AS A SCROLL STORY (2026-11-02) — `/new` only, a preview
 * beside today's `/`.
 *
 * One idea: the tournament day told in order, "From Registration to Recognition." One phone stays
 * in view and its real screen changes as the reader passes each moment of the day; nothing is
 * scroll-jacked, the page scrolls as any page does, and below 768px the phone becomes a plain
 * sequence, a screen under each moment.
 *
 * ONE SET OF COLOURS: the ground, surface, text and greys are the app's own dark ground
 * (`DARK_GROUND` in `src/lib/themes.ts`, read here, never typed), so the page and the app's dark
 * screens are one material. The one colour is the logo's orange, the landing palette's `--brass`
 * (solved to 7:1 for text) and `--brass-ui` (a fill carrying `--on-accent`). Every device frame is
 * the same frame.
 *
 * TYPE at moderate sizes, sentence case: Archivo at its normal width for headings (h1 34-38px on a
 * phone, 64px on a laptop), Atkinson Hyperlegible Next at 17px for text. Both are served from this
 * origin (`public/new/fonts`, OFL-1.1).
 *
 * Screens meant to be READ are flat and upright, with one exception asked for by name: the hero's
 * board stands in a slight perspective. Every transition is inside
 * `prefers-reduced-motion: no-preference`; with reduced motion nothing moves.
 *
 * Scoped under `.n-site`, every class prefixed `n-`.
 */
const G = DARK_GROUND;
const [, grey1, grey2, grey3] = G.neutrals;

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

.n-site {
  /* the app's dark ground, re-declared for every shared component on the page (the sign-in card too) */
  --ground: ${G.bg};
  --ground-2: ${G.surface};
  --ink: ${G.text};
  --ink-soft: ${grey1};
  --ink-faint: ${grey2};
  --line: color-mix(in srgb, ${G.text} 13%, transparent);
  --line-2: color-mix(in srgb, ${G.text} 24%, transparent);
  --card: ${G.surface};
  --n-deep: color-mix(in srgb, ${G.bg} 62%, black);
  --n-raise: color-mix(in srgb, ${G.surface} 70%, ${G.bg});
  --n-quiet: ${grey3};
  --n-glow: color-mix(in srgb, var(--brass-ui) 22%, transparent);
  --n-device: color-mix(in srgb, ${G.bg} 35%, black);
  --n-device-edge: color-mix(in srgb, ${G.text} 26%, transparent);
  --n-head: "Archivo Board", "Segoe UI", system-ui, sans-serif;
  --n-text: "Atkinson Next", system-ui, -apple-system, "Segoe UI", sans-serif;
  --n-wrap: 1240px;
  --n-gut: clamp(16px, 4vw, 48px);
  --n-sec: clamp(72px, 9vw, 136px);
  --n-hdr: 68px;
  background: var(--ground);
  color: var(--ink);
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

/* ── type: moderate, sentence case ── */
.n-display, .n-h2, .n-h3 { font-family: var(--n-head); font-stretch: 100%; text-wrap: balance; color: var(--ink); }
.n-display { font-weight: 750; font-size: clamp(34px, calc(26px + 2.7vw), 64px); line-height: 1.04; letter-spacing: -.025em; }
.n-h2 { font-weight: 720; font-size: clamp(28px, calc(20px + 1.9vw), 46px); line-height: 1.08; letter-spacing: -.02em; }
.n-h3 { font-weight: 700; font-size: clamp(21px, calc(16px + .8vw), 27px); line-height: 1.18; letter-spacing: -.01em; }
.n-eyebrow { font: 700 14px/1.2 var(--n-text); letter-spacing: .08em; text-transform: uppercase; color: var(--brass); }
.n-lead { font-size: clamp(17px, calc(15px + .3vw), 19px); line-height: 1.55; color: var(--ink-soft); max-width: 38em; }
.n-num { font-variant-numeric: tabular-nums; }

/* ── buttons and links ── */
.n-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 52px;
  padding: 0 24px; border-radius: 999px; font: 700 17px/1 var(--n-text); text-decoration: none;
  border: 1.5px solid transparent;
}
.n-site .n-btn-go { background: var(--brass-ui); color: var(--on-accent); }
.n-site .n-btn-line { border-color: var(--line-2); color: var(--ink); background: color-mix(in srgb, var(--ink) 4%, transparent); }
.n-site .n-btn-line:hover { border-color: var(--ink); }
.n-site .n-link { color: var(--ink); text-decoration: underline; text-decoration-color: var(--brass); text-decoration-thickness: 2px; text-underline-offset: 5px; font-weight: 700; }
.n-site .n-link:hover { color: var(--brass); }
@media (prefers-reduced-motion: no-preference) {
  .n-btn { transition: background-color .15s, border-color .15s, filter .15s; }
  .n-site .n-btn-go:hover { filter: brightness(1.08); }
}

/* ── header ── */
.n-hdr { position: sticky; top: 0; z-index: 40; background: color-mix(in srgb, var(--ground) 86%, transparent); backdrop-filter: blur(14px) saturate(1.2); border-bottom: 1px solid var(--line); }
.n-hdr-in { display: flex; align-items: center; gap: 28px; min-height: var(--n-hdr); }
.n-hdr .lockup { display: inline-flex; text-decoration: none; min-width: 0; }
.n-nav { display: flex; gap: 24px; margin-right: auto; }
.n-nav a, .n-hdr-act > a:not(.n-btn) { font-size: 16px; font-weight: 600; text-decoration: none; color: var(--ink-soft); }
.n-nav a:hover, .n-hdr-act > a:not(.n-btn):hover { color: var(--ink); }
.n-hdr-act { display: flex; align-items: center; gap: 20px; min-width: 0; }
.n-hdr-act .n-btn { min-height: 44px; padding: 0 18px; font-size: 16px; }
.n-hdr-act u { text-decoration-color: var(--brass); text-decoration-thickness: 2px; text-underline-offset: 4px; color: var(--ink); }
.n-menu { display: none; position: relative; }
.n-menu summary { list-style: none; cursor: pointer; display: grid; place-items: center; width: 46px; height: 46px; border: 1px solid var(--line-2); border-radius: 999px; }
.n-menu summary::-webkit-details-marker { display: none; }
.n-menu summary svg { width: 22px; height: 22px; stroke: currentColor; stroke-width: 2; fill: none; }
.n-menu-panel { position: absolute; right: 0; top: 56px; width: min(86vw, 320px); background: var(--ground-2); border: 1px solid var(--line-2); border-radius: 14px; padding: 10px; display: grid; gap: 2px; box-shadow: 0 30px 60px -20px black; }
.n-menu-panel a { padding: 14px; border-radius: 8px; text-decoration: none; font-weight: 600; }
.n-menu-panel a:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); }
.n-menu-panel hr { border: 0; border-top: 1px solid var(--line); margin: 6px 0; }
@media (max-width: 1080px) { .n-nav { display: none; } .n-hdr-act { margin-left: auto; } }
@media (max-width: 767px) { .n-site { --n-hdr: 60px; } .n-hdr-act > a:not(.n-btn) { display: none; } .n-menu { display: block; } .n-hdr-act .n-btn { padding: 0 14px; } .n-hdr .lockup svg { max-height: 30px; } }
@media (max-width: 400px) { .n-hdr-act .n-btn { display: none; } }

/* ═════════ THE DEVICES: one frame, one colour, everywhere ═════════ */
.n-phone { position: relative; background: var(--n-device); border-radius: clamp(26px, 3.6vw, 46px); padding: clamp(6px, .7vw, 9px); box-shadow: 0 0 0 1.5px var(--n-device-edge), inset 0 0 0 1px color-mix(in srgb, var(--ink) 8%, transparent), 0 44px 80px -34px black; }
.n-phone-screen { position: relative; overflow: hidden; border-radius: clamp(20px, 3vw, 38px); aspect-ratio: 1179 / 2556; background: var(--ground-2); }
.n-lid { position: relative; background: var(--n-device); border-radius: 16px 16px 6px 6px; padding: 1.4% 1.4% 2.2%; box-shadow: 0 0 0 1.5px var(--n-device-edge), 0 50px 100px -40px black; }
.n-lid-screen { position: relative; overflow: hidden; border-radius: 4px; aspect-ratio: 16 / 10; background: var(--ground-2); }
.n-phone-screen img, .n-lid-screen img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.n-frame { position: absolute; inset: 0; }
.n-frame.n-off { opacity: 0; }
.n-mark { position: absolute; border: 3px solid var(--brass-ui); border-radius: 8px; box-shadow: 0 0 0 6px color-mix(in srgb, var(--brass-ui) 24%, transparent); pointer-events: none; opacity: 0; }
.n-mark.n-show { opacity: 1; }
@media (max-width: 600px) {
  .n-crop .n-lid-screen { aspect-ratio: 1 / 1; }
  .n-crop .n-lid-screen img { object-position: var(--cx, 50%) top; }
}

/* ═════════ HERO: the words, and the live board standing on the desk ═════════ */
.n-hero { position: relative; isolation: isolate; overflow: clip; padding: clamp(28px, 5vw, 72px) 0 clamp(48px, 6vw, 88px);
  background:
    radial-gradient(60% 70% at 78% 42%, var(--n-glow), transparent 70%),
    radial-gradient(120% 90% at 50% 0%, var(--ground) 40%, var(--n-deep) 100%);
}
.n-hero-grid { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 5fr); gap: clamp(28px, 4vw, 72px); align-items: center; }
.n-hero-top { min-width: 0; }
.n-site .n-kicker { display: inline-flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; color: var(--ink-soft); text-decoration: none; padding: 7px 16px 7px 10px; border: 1px solid var(--line-2); border-radius: 999px; margin-bottom: 26px; max-width: 100%; }
.n-site .n-kicker:hover { border-color: var(--ink); color: var(--ink); }
.n-kicker i { width: 9px; height: 9px; border-radius: 50%; background: var(--brass-ui); box-shadow: 0 0 0 4px color-mix(in srgb, var(--brass-ui) 25%, transparent); flex: none; }
.n-tagline { font: 700 15px/1.2 var(--n-text); letter-spacing: .08em; text-transform: uppercase; color: var(--brass); margin-bottom: 16px; }
.n-hero h1 span { display: block; }
.n-hero h1 .n-h1-2 { color: var(--brass); }
.n-hero-sub { margin-top: 22px; max-width: 34em; font-size: clamp(17px, calc(15px + .35vw), 20px); line-height: 1.5; color: var(--ink-soft); }
.n-hero-sub b { color: var(--ink); font-weight: 700; }
.n-hero-go { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
.n-hero-facts { display: flex; flex-wrap: wrap; gap: 8px 22px; margin-top: 24px; font-size: 15.5px; color: var(--ink-soft); }
.n-hero-facts li { display: inline-flex; align-items: center; gap: 8px; }
.n-hero-facts li::before { content: ""; width: 12px; height: 7px; border-left: 2.5px solid var(--brass); border-bottom: 2.5px solid var(--brass); rotate: -45deg; translate: 0 -2px; flex: none; }

/* the stage: one phone, the live board, turned a few degrees toward the words */
.n-stage { position: relative; min-width: 0; display: grid; justify-items: center; perspective: 1600px; }
/* sized by the window's height too, so the phone and its line of facts sit whole in a laptop's first screen */
.n-stage .n-phone { width: min(340px, 82%, max(240px, calc((100svh - 330px) * .46))); transform: rotateY(-13deg) rotateX(5deg) rotateZ(1.2deg); transform-style: preserve-3d;
  box-shadow: 0 0 0 1.5px var(--n-device-edge), inset 0 0 0 1px color-mix(in srgb, var(--ink) 8%, transparent), -40px 60px 90px -40px black, 0 0 120px -30px var(--n-glow); }
.n-stage::after { /* the shadow it casts on the desk */
  content: ""; position: absolute; z-index: -1; left: 18%; right: 10%; bottom: -26px; height: 44px; border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, black 70%, transparent), transparent); }
.n-glass { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, color-mix(in srgb, white 12%, transparent), transparent 32%); }
.n-live { margin-top: 30px; display: flex; align-items: center; gap: 14px; padding: 12px 18px; border-radius: 14px; background: color-mix(in srgb, var(--ground-2) 92%, transparent); border: 1px solid var(--line-2); box-shadow: 0 20px 40px -16px black; font-size: 15.5px; max-width: 100%; }
.n-live b { font-weight: 700; color: var(--ink); }
.n-live > span:last-child { color: var(--ink-soft); min-width: 0; }
.n-live .n-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--brass-ui); flex: none; }
.n-live .n-big { font: 750 30px/1 var(--n-head); color: var(--brass); }
.n-caption { margin-top: clamp(40px, 5vw, 64px); max-width: 52em; font-size: 15px; color: var(--ink-faint); }
.n-kicker-after { display: none; }
@media (prefers-reduced-motion: no-preference) {
  .n-stage .n-phone { animation: n-arrive 1.1s cubic-bezier(.2,.7,.2,1) both .15s; }
  @keyframes n-arrive { from { opacity: 0; transform: rotateY(-24deg) rotateX(9deg) rotateZ(2deg) translateY(28px); } }
}
@media (max-width: 1000px) and (min-width: 768px) { .n-hero-grid { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); } }
/* A PHONE: words first, then the board, which must be in the first screen of 393 x 852 */
@media (max-width: 767px) {
  .n-hero { padding-top: 18px; }
  .n-hero-grid { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  .n-hero-top .n-kicker { display: none; }
  .n-kicker-after { display: block; margin-top: 26px; }
  .n-kicker-after .n-kicker { margin: 0; line-height: 1.35; }
  .n-tagline { font-size: 13.5px; margin-bottom: 10px; }
  .n-hero-sub { font-size: 17px; margin-top: 12px; }
  .n-sub-more { display: none; }
  .n-hero-go { margin-top: 18px; gap: 10px; }
  .n-hero-go .n-btn { flex: 1 1 0; padding: 0 10px; font-size: 16px; min-height: 48px; white-space: nowrap; min-width: 0; }
  .n-hero-facts { display: none; }
  .n-stage .n-phone { width: min(62%, 250px); transform: rotateY(-9deg) rotateX(4deg) rotateZ(1deg); }
  .n-live { margin-top: 22px; flex-wrap: wrap; }
  .n-caption { margin-top: 22px; }
}

/* ═════════ THE STORY: one phone in view, its screen turning with the day ═════════ */
.n-story-sec { padding-top: var(--n-sec); }
.n-story-head { display: grid; gap: 16px; max-width: 46em; }
.n-story { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(32px, 5vw, 96px); margin-top: clamp(16px, 3vw, 40px); }
.n-steps { min-width: 0; counter-reset: none; }
.n-step { min-height: 78vh; display: grid; align-content: center; gap: 12px; padding: 48px 0; border-top: 1px solid transparent; }
.n-step:first-child { min-height: 70vh; }
.n-step:last-child { min-height: 86vh; }
.n-ch { display: flex; align-items: baseline; gap: 14px; margin-bottom: 18px; font: 700 15px/1.2 var(--n-text); letter-spacing: .08em; text-transform: uppercase; color: var(--brass); scroll-margin-top: calc(var(--n-hdr) + 24px); }
.n-ch-n { font: 750 clamp(44px, 5vw, 68px)/.9 var(--n-head); letter-spacing: -.03em; color: transparent; -webkit-text-stroke: 1.5px var(--brass); text-transform: none; }
.n-stamp { display: flex; align-items: baseline; gap: 10px; font-size: 16px; color: var(--ink-faint); }
.n-stamp b { font: 700 22px/1 var(--n-head); color: var(--ink); }
.n-step .n-who { font-size: 15px; font-weight: 700; color: var(--ink-soft); padding: 3px 10px; border: 1px solid var(--line-2); border-radius: 999px; justify-self: start; }
.n-step h3 { font: 720 clamp(26px, calc(18px + 1.4vw), 40px)/1.1 var(--n-head); letter-spacing: -.02em; text-wrap: balance; }
.n-step p.n-say { font-size: 17px; color: var(--ink-soft); max-width: 30em; }
.n-step-phone { display: none; }

.n-story-dev { position: relative; min-width: 0; }
.n-story-pin { position: sticky; top: calc(var(--n-hdr) + 28px); height: calc(100svh - var(--n-hdr) - 56px); max-height: 820px; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: clamp(18px, 3vw, 44px); }
.n-story-pin .n-phone { width: min(330px, calc((100svh - var(--n-hdr) - 150px) * .4613)); justify-self: start; }
.n-story-pin .n-phone-screen .n-frame { will-change: opacity; }
.n-now { margin-top: 16px; font-size: 15px; color: var(--ink-soft); text-align: center; min-height: 1.6em; }
.n-now b { color: var(--ink); font-family: var(--n-head); }
.n-rail { display: grid; gap: 4px; position: relative; padding-left: 18px; }
.n-rail::before { content: ""; position: absolute; left: 4px; top: 10px; bottom: 10px; width: 2px; background: var(--line-2); border-radius: 2px; }
.n-rail::after { content: ""; position: absolute; left: 4px; top: 10px; width: 2px; height: calc((100% - 20px) * var(--p, 0)); background: var(--brass-ui); border-radius: 2px; }
.n-rail a { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 6px; align-items: baseline; padding: 8px 0; text-decoration: none; color: var(--ink-faint); font-size: 15px; font-weight: 600; position: relative; }
.n-rail a::before { content: ""; position: absolute; left: -18px; top: 15px; width: 10px; height: 10px; border-radius: 50%; background: var(--ground); border: 2px solid var(--line-2); }
.n-rail a span:first-child { font: 700 15px/1 var(--n-head); font-variant-numeric: tabular-nums; }
.n-rail a:hover { color: var(--ink); }
.n-rail .n-on a, .n-rail .n-done a { color: var(--ink); }
.n-rail .n-on a::before, .n-rail .n-done a::before { background: var(--brass-ui); border-color: var(--brass-ui); }
.n-rail .n-on a span:first-child { color: var(--brass); }
@media (prefers-reduced-motion: no-preference) {
  .n-story-pin .n-frame { transition: opacity .45s ease; }
  .n-rail::after { transition: height .45s ease; }
}
@media (max-width: 1100px) and (min-width: 768px) {
  .n-story { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; }
  .n-story-pin { grid-template-columns: minmax(0, 1fr); justify-items: center; align-content: center; }
  .n-story-pin .n-phone { justify-self: center; width: min(300px, calc((100svh - var(--n-hdr) - 200px) * .4613)); }
  .n-rail { display: none; }
}
/* NARROW: no sticky device; each moment carries its own screen, and the page simply scrolls */
@media (max-width: 767px) {
  .n-story { grid-template-columns: minmax(0, 1fr); }
  .n-story-dev { display: none; }
  .n-step, .n-step:first-child, .n-step:last-child { min-height: 0; padding: 40px 0 8px; }
  .n-step + .n-step { border-top-color: var(--line); }
  .n-ch-n { font-size: 44px; }
  .n-step-phone { display: block; width: min(76%, 300px); margin: 18px auto 0; }
}

/* ═════════ SECTIONS ═════════ */
.n-sec { padding-top: var(--n-sec); }
.n-band { margin-top: var(--n-sec); padding: var(--n-sec) 0; background: var(--n-raise); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.n-band + .n-sec { padding-top: var(--n-sec); }
.n-sec-head { display: grid; gap: 16px; max-width: 46em; }

/* ── the committee's desk ── */
.n-desk { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: clamp(32px, 5vw, 80px); align-items: center; }
.n-desk-list { display: grid; margin-top: 30px; border-top: 1px solid var(--line); }
.n-desk-list li { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 4px 14px; padding: 18px 0; border-bottom: 1px solid var(--line); }
.n-desk-list .n-t { font: 750 22px/1 var(--n-head); color: var(--brass); grid-row: span 2; padding-top: 2px; }
.n-desk-list b { font-size: 18px; }
.n-desk-list p { color: var(--ink-soft); font-size: 16.5px; }
.n-desk-pic { position: relative; padding-bottom: 18%; min-width: 0; }
.n-desk-pic .n-phone { position: absolute; width: 24%; left: -6%; bottom: 0; }
@media (max-width: 900px) {
  .n-desk { grid-template-columns: minmax(0, 1fr); }
  .n-desk-pic { padding-bottom: 30%; }
  .n-desk-pic .n-phone { left: 4%; width: 30%; }
}
@media (max-width: 600px) {
  .n-desk-pic { padding-bottom: 0; }
  .n-desk-pic .n-lid { display: none; }
  .n-desk-pic .n-phone { position: relative; left: auto; bottom: auto; width: min(76%, 300px); margin: 8px auto 0; }
}

/* ── the whole club watches ── */
.n-watch { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 6fr); gap: clamp(32px, 5vw, 80px); align-items: end; }
.n-watch-big { font: 720 clamp(30px, calc(20px + 2.4vw), 54px)/1.06 var(--n-head); letter-spacing: -.02em; text-wrap: balance; }
.n-watch-big .n-t { display: block; color: var(--brass); font-variant-numeric: tabular-nums; }
.n-watch-row { display: flex; gap: clamp(12px, 1.6vw, 22px); align-items: flex-end; margin-top: clamp(40px, 5vw, 72px); }
.n-watch-row figure { flex: 1 1 0; min-width: 0; }
.n-watch-row figcaption { margin-top: 14px; font-size: 15.5px; color: var(--ink-soft); }
.n-watch-row figcaption b { display: block; color: var(--ink); }
.n-try { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 20px; align-items: center; margin-top: 28px; padding: 20px; border: 1px solid var(--line-2); border-radius: 16px; background: var(--ground-2); }
.n-try svg { width: 108px; height: 108px; border-radius: 8px; }
.n-try .n-qr-ground { fill: var(--ink); }
.n-try .n-qr-ink { fill: var(--ground); }
.n-try p { font-size: 16px; color: var(--ink-soft); }
.n-try p b { display: block; color: var(--ink); font-size: 17px; }
.n-doors { display: flex; flex-wrap: wrap; gap: 10px 22px; margin-top: 22px; }
@media (max-width: 900px) { .n-watch { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 600px) {
  .n-watch-row { overflow-x: auto; scroll-snap-type: x mandatory; margin: 40px calc(-1 * var(--n-gut)) 0; padding: 0 var(--n-gut) 6px; scrollbar-width: none; }
  .n-watch-row::-webkit-scrollbar { display: none; }
  .n-watch-row figure { flex: 0 0 min(64vw, 260px); scroll-snap-align: start; }
}
@media (max-width: 640px) { .n-try { grid-template-columns: minmax(0, 1fr); } .n-try svg { display: none; } }

/* ── any format, any field ── */
.n-formats { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: clamp(32px, 5vw, 72px); align-items: start; margin-top: clamp(32px, 4vw, 56px); }
.n-format-wall { display: flex; flex-wrap: wrap; gap: 8px; }
.n-format-wall li { padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line-2); font-size: 16px; font-weight: 600; color: var(--ink); background: var(--ground); }
.n-runs { margin-top: 24px; display: flex; flex-wrap: wrap; gap: 8px; }
.n-runs li { padding: 6px 12px; border-radius: 8px; background: var(--ground-2); color: var(--ink-soft); font-weight: 600; font-size: 15.5px; }
.n-big128 { margin-top: clamp(56px, 7vw, 96px); display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 8fr); gap: clamp(28px, 4vw, 64px); align-items: center; }
.n-big128 .n-num-big { font: 750 clamp(72px, 9vw, 128px)/.85 var(--n-head); letter-spacing: -.04em; color: var(--brass); }
.n-big128 .n-h3 { margin-top: 14px; }
.n-big128 p { margin-top: 14px; color: var(--ink-soft); }
@media (max-width: 900px) { .n-formats, .n-big128 { grid-template-columns: minmax(0, 1fr); } }

/* ── money ── */
.n-money { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 6fr); gap: clamp(32px, 5vw, 80px); align-items: center; }
.n-money > div { min-width: 0; }
.n-money-pic { display: grid; grid-template-columns: minmax(0, 1fr); justify-items: center; }
.n-money-pic .n-phone { width: min(320px, 80%); }
.n-coins { display: flex; gap: 8px; margin-top: 28px; flex-wrap: wrap; }
.n-coin { min-width: 64px; min-height: 60px; padding: 6px 14px; display: grid; justify-items: center; align-content: center; gap: 2px; border-radius: 12px; border: 1px solid var(--line-2); background: none; color: var(--ink); cursor: pointer; font: inherit; }
.n-coin b { font: 750 24px/1 var(--n-head); }
.n-coin span { font-size: 13px; color: var(--ink-soft); }
.n-coin[aria-selected="true"] { background: var(--brass-ui); border-color: var(--brass-ui); color: var(--on-accent); }
.n-coin[aria-selected="true"] span { color: var(--on-accent); }
.n-money-say { margin-top: 16px; font-size: 16px; color: var(--ink-soft); min-height: 1.6em; }
.n-also { margin-top: 24px; font-size: 15.5px; color: var(--ink-faint); }
.n-money-pic .n-frame { position: absolute; inset: 0; }
.n-never { margin-top: 26px; padding: 18px 20px; border-left: 3px solid var(--brass-ui); background: var(--ground-2); border-radius: 0 12px 12px 0; font-size: 17px; color: var(--ink-soft); }
.n-never b { color: var(--ink); }
@media (max-width: 900px) { .n-money { grid-template-columns: minmax(0, 1fr); } }

/* ── colours ── */
.n-themes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: clamp(12px, 1.6vw, 22px); margin-top: clamp(32px, 4vw, 56px); }
.n-themes figure { min-width: 0; }
.n-themes figcaption { margin-top: 12px; font-size: 15.5px; display: flex; align-items: center; gap: 8px; color: var(--ink-soft); }
.n-themes figcaption i { width: 12px; height: 12px; border-radius: 3px; flex: none; }
@media (max-width: 900px) {
  .n-themes { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; margin: 32px calc(-1 * var(--n-gut)) 0; padding: 0 var(--n-gut) 6px; scrollbar-width: none; }
  .n-themes::-webkit-scrollbar { display: none; }
  .n-themes figure { flex: 0 0 min(58vw, 230px); scroll-snap-align: start; }
}

/* ── who it is for ── */
.n-for { margin-top: clamp(28px, 3.5vw, 48px); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.n-for li { min-width: 0; }
.n-for a { height: 100%; display: grid; align-content: start; gap: 12px; padding: 26px 24px; border: 1px solid var(--line-2); border-radius: 18px; background: var(--ground-2); text-decoration: none; }
/* the accent is solved to 7:1 on the page, not on a lifted card, so a card's label is in the text colour */
.n-for .n-who { font: 700 15px/1.2 var(--n-text); letter-spacing: .08em; text-transform: uppercase; color: var(--ink); }
.n-for .n-who::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--brass-ui); margin-right: 10px; vertical-align: 2px; }
.n-for p { color: var(--ink-soft); font-size: 16.5px; }
.n-for p b { display: block; color: var(--ink); font: 700 22px/1.2 var(--n-head); margin-bottom: 6px; }
.n-for .n-go { font-weight: 700; text-decoration: underline; text-decoration-color: var(--brass); text-decoration-thickness: 2px; text-underline-offset: 5px; }
.n-for a:hover { border-color: var(--ink-faint); }
@media (max-width: 900px) { .n-for { grid-template-columns: minmax(0, 1fr); } }

/* ── pricing ── */
.n-plans { margin-top: clamp(32px, 4vw, 56px); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.n-plan { min-width: 0; padding: clamp(22px, 2.4vw, 32px); display: grid; align-content: start; gap: 12px; border: 1px solid var(--line-2); border-radius: 18px; background: var(--ground); }
.n-plan .n-tag { font-size: 15px; font-weight: 700; color: var(--ink-soft); }
.n-plan h3 { font: 720 28px/1.1 var(--n-head); }
.n-price { font: 750 clamp(44px, 4.6vw, 60px)/.9 var(--n-head); letter-spacing: -.03em; font-variant-numeric: tabular-nums; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.n-price small { font: 600 16px/1.2 var(--n-text); letter-spacing: 0; color: var(--ink-soft); }
.n-plan .n-year { font-size: 15px; color: var(--ink-soft); min-height: 1.5em; }
.n-plan ul { display: grid; gap: 8px; font-size: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.n-plan li { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 8px; }
.n-plan li::before { content: ""; width: 12px; height: 7px; margin-top: 7px; border-left: 2.5px solid var(--brass); border-bottom: 2.5px solid var(--brass); rotate: -45deg; }
.n-plan .n-term { font-size: 14.5px; color: var(--ink-faint); }
.n-plan .n-btn { width: 100%; }
.n-plan-pick { border: 2px solid var(--brass-ui); box-shadow: 0 30px 60px -36px var(--n-glow); }
.n-small { margin-top: 22px; font-size: 15px; color: var(--ink-faint); max-width: 70em; }
.n-small a { color: inherit; }
.n-vs { margin-top: clamp(48px, 6vw, 80px); display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: clamp(28px, 4vw, 64px); align-items: center; }
.n-vs > div { min-width: 0; }
.n-vs p { margin-top: 12px; color: var(--ink-soft); }
.n-bars { display: grid; gap: 14px; }
.n-bars li { display: grid; grid-template-columns: 112px minmax(0, 1fr) 92px; gap: 14px; align-items: center; font-weight: 700; font-size: 16px; }
.n-bars .n-track { height: 30px; background: var(--ground); border-radius: 999px; overflow: hidden; border: 1px solid var(--line); }
.n-bars .n-fill { display: block; height: 100%; background: var(--n-quiet); border-radius: 999px; }
.n-bars .n-us .n-fill { background: var(--brass-ui); }
.n-bars .n-amt { text-align: right; font-variant-numeric: tabular-nums; }
.n-saved { display: flex; gap: 28px; flex-wrap: wrap; margin-top: 10px; font-size: 16px; color: var(--ink-soft); }
.n-saved b { font: 750 30px/1 var(--n-head); color: var(--brass); display: block; }
.n-more-links { display: flex; flex-wrap: wrap; gap: 12px 26px; margin-top: 28px; }
@media (max-width: 900px) {
  .n-plans { grid-template-columns: minmax(0, 1fr); }
  .n-vs { grid-template-columns: minmax(0, 1fr); }
  .n-bars li { grid-template-columns: 88px minmax(0, 1fr) 78px; gap: 10px; }
}

/* ── questions ── */
.n-qa { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: clamp(32px, 5vw, 80px); margin-top: clamp(32px, 4vw, 56px); }
.n-qa > div { min-width: 0; }
.n-every { display: grid; gap: 10px; margin-top: 20px; font-size: 16.5px; }
.n-every li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 8px; color: var(--ink-soft); }
.n-every li::before { content: ""; width: 12px; height: 7px; margin-top: 8px; border-left: 2.5px solid var(--brass); border-bottom: 2.5px solid var(--brass); rotate: -45deg; }
.n-answers { display: grid; border-top: 1px solid var(--line); }
.n-answer { padding: 24px 0; border-bottom: 1px solid var(--line); display: grid; gap: 10px; }
.n-answer h3 { font: 700 22px/1.2 var(--n-head); }
.n-answer p { color: var(--ink-soft); }
@media (max-width: 900px) { .n-qa { grid-template-columns: minmax(0, 1fr); } }

/* ── follow along ── */
.n-follow { margin-top: clamp(28px, 3.5vw, 48px); display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.n-follow li { min-width: 0; }
.n-follow a { height: 100%; display: grid; align-content: start; gap: 10px; padding: 22px; text-decoration: none; border: 1px solid var(--line-2); border-radius: 18px; background: var(--ground-2); }
.n-follow svg { width: 28px; height: 28px; fill: currentColor; }
.n-follow .n-net { font: 700 21px/1.1 var(--n-head); display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.n-follow .n-handle { font-size: 15px; color: var(--ink-faint); overflow-wrap: anywhere; }
.n-follow p { font-size: 16px; color: var(--ink-soft); }
.n-follow a:hover { border-color: var(--ink-faint); }
.n-follow a:hover .n-net { color: var(--brass); }
@media (max-width: 900px) { .n-follow { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .n-follow { grid-template-columns: minmax(0, 1fr); } }

/* ── the close ── */
.n-close { padding: var(--n-sec) 0; margin-top: var(--n-sec); border-top: 1px solid var(--line);
  background: radial-gradient(70% 80% at 20% 0%, var(--n-glow), transparent 70%), var(--n-deep); }
.n-close-grid { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: clamp(32px, 5vw, 80px); align-items: start; }
.n-close-grid > div { min-width: 0; }
.n-close .n-display span { display: block; }
.n-close .n-display span + span { color: var(--brass); }
.n-close .n-lead { margin-top: 18px; }
.n-close-auth { scroll-margin-top: 90px; }
.n-stores { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
.n-site .n-store { display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px; border: 1px solid var(--line-2); border-radius: 12px; text-decoration: none; min-height: 54px; }
.n-store small { display: block; font-size: 12.5px; color: var(--ink-soft); }
.n-store b { display: block; font-size: 17px; line-height: 1.1; }
.n-store svg { width: 22px; height: 22px; fill: currentColor; }
.n-stores-note { margin-top: 14px; font-size: 15px; color: var(--ink-soft); max-width: 36em; }
@media (max-width: 900px) { .n-close-grid { grid-template-columns: minmax(0, 1fr); } }

/* ── footer ── */
.n-ftr { padding: 52px 0 40px; border-top: 1px solid var(--line); background: var(--n-deep); }
.n-ftr-top { display: flex; flex-wrap: wrap; gap: 26px 48px; align-items: center; justify-content: space-between; }
.n-ftr .lockup { text-decoration: none; display: inline-flex; }
.n-ftr nav ul { display: flex; flex-wrap: wrap; gap: 10px 26px; }
.n-ftr nav a { text-decoration: none; font-weight: 600; font-size: 16px; color: var(--ink-soft); }
.n-ftr nav a:hover { color: var(--ink); }
.n-socials { display: flex; gap: 8px; }
.n-socials a { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 999px; border: 1px solid var(--line-2); color: var(--ink-soft); }
.n-socials a:hover { color: var(--on-accent); background: var(--brass-ui); border-color: var(--brass-ui); }
.n-socials svg { width: 20px; height: 20px; fill: currentColor; }
.n-ftr-base { margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 10px 26px; font-size: 14.5px; color: var(--ink-faint); }
.n-ftr-base a { color: var(--ink-soft); }
.n-ftr-base button { font: inherit; color: var(--ink-soft); }
.n-site .n-ftr-base .ed-note { margin: 0; padding: 0; }

/* the auth card from the shared chrome, seated on this page */
.n-site .authpanel { max-width: none; }
`;
