/**
 * THE SITE REHAUL, DESIGN D: "FLOODLIT" (2026-11-02) — `/new` only, a preview beside today's `/`.
 *
 * Today's navy drama, made deeper: the ground is the landing's own midnight navy (`.thq`'s tokens
 * from `landing-palette.ts`, inherited, never typed here), and the depth comes from LIGHT, not
 * from type size. A green under evening floodlights behind the hero; a pool of light and real
 * shadows under every device (the light falls from the upper right, so every shadow falls down
 * and to the left); glass tiles with a lit top edge; a fine grain on the grounds, never on a screen.
 *
 * Built from three: the hero keeps today's drama (words left, devices right, one live moment);
 * C's scroll story is the spine; B's bento carries the committee's desk.
 *
 * The backdrops in `public/new/d` are made images of light and grass only (no screen, no person,
 * no text). Every screen is a real capture, framed and lit around its edges and never redrawn:
 * the only thing drawn over a screen is a faint sheen in its top corner and the moment's outline.
 *
 * TYPE: Archivo for headings (h1 34-64px, h2 28-44px), Atkinson Hyperlegible Next at 17px for text.
 * MOTION: one orchestrated moment (the hero's score going in, `HeroMoment`, played once, "Watch
 * again"); the story's screen changes as the reader passes each moment. Nothing else moves, and
 * under reduced motion nothing moves at all.
 *
 * Scoped under `.n-site`, every class prefixed `n-`.
 */

/** A fine film grain, drawn once as an SVG turbulence and laid over the grounds (never a screen). */
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E")`;

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
  /* the landing's navy ground and its solved inks are inherited from .thq; these are the depths */
  --n-deep: color-mix(in srgb, var(--ground) 52%, black);
  --n-raise: color-mix(in srgb, var(--ground-2) 55%, var(--ground));
  --n-glass: color-mix(in srgb, var(--ground-2) 58%, transparent);
  --n-glass-edge: color-mix(in srgb, var(--ink) 13%, transparent);
  --n-rim: inset 0 1px 0 color-mix(in srgb, white 13%, transparent);
  --n-flood: color-mix(in srgb, white 9%, transparent);
  /* the light a lit screen throws: warm white, never an orange neon halo (Ajay: "should not look artificial") */
  --n-glow: color-mix(in srgb, var(--ink) 9%, transparent);
  --n-quiet: color-mix(in srgb, var(--ink) 34%, var(--ground));
  --n-device: color-mix(in srgb, var(--ground) 32%, black);
  --n-device-edge: color-mix(in srgb, var(--ink) 24%, transparent);
  /* light from the upper right: a lit edge on the right and top, the shadow down and to the left */
  --n-lit-edge: inset -1px 1px 0 color-mix(in srgb, white 24%, transparent);
  --n-cast: -36px 56px 70px -34px black, -12px 18px 30px -16px color-mix(in srgb, black 70%, transparent);
  --n-head: "Archivo Board", "Segoe UI", system-ui, sans-serif;
  --n-text: "Atkinson Next", system-ui, -apple-system, "Segoe UI", sans-serif;
  --n-wrap: 1240px;
  --n-gut: clamp(16px, 4vw, 48px);
  --n-sec: clamp(72px, 9vw, 128px);
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
/* grain on a ground: a layer behind the section's content, never over a screen */
.n-grain::after { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; background-image: ${GRAIN}; background-size: 180px; opacity: .07; mix-blend-mode: overlay; }

/* ── type: moderate, sentence case ── */
.n-display, .n-h2, .n-h3 { font-family: var(--n-head); font-stretch: 100%; text-wrap: balance; color: var(--ink); }
.n-display { font-weight: 750; font-size: clamp(34px, calc(24px + 2.3vw), 56px); line-height: 1.03; letter-spacing: -.026em; }
.n-h2 { font-weight: 720; font-size: clamp(28px, calc(20px + 1.7vw), 44px); line-height: 1.08; letter-spacing: -.02em; }
.n-h3 { font-weight: 700; font-size: clamp(21px, calc(16px + .7vw), 26px); line-height: 1.18; letter-spacing: -.01em; }
.n-eyebrow { font: 700 14px/1.2 var(--n-text); letter-spacing: .08em; text-transform: uppercase; color: var(--brass); }
.n-lead { font-size: clamp(17px, calc(15.5px + .2vw), 18px); line-height: 1.6; color: var(--ink-soft); max-width: 38em; }
.n-num { font-variant-numeric: tabular-nums; }

/* ── buttons and links ── */
.n-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 52px;
  padding: 0 24px; border-radius: 999px; font: 700 17px/1 var(--n-text); text-decoration: none;
  border: 1.5px solid transparent;
}
.n-site .n-btn-go { background: var(--brass-ui); color: var(--on-accent); box-shadow: inset 0 1px 0 color-mix(in srgb, white 35%, transparent), 0 14px 34px -14px var(--n-glow); }
.n-site .n-btn-line { border-color: var(--line-2); color: var(--ink); background: color-mix(in srgb, var(--ground) 55%, transparent); backdrop-filter: blur(8px); }
.n-site .n-btn-line:hover { border-color: var(--ink); }
.n-site .n-link { color: var(--ink); text-decoration: underline; text-decoration-color: var(--brass); text-decoration-thickness: 2px; text-underline-offset: 5px; font-weight: 700; }
.n-site .n-link:hover { color: var(--brass); }
@media (prefers-reduced-motion: no-preference) {
  .n-btn { transition: background-color .15s, border-color .15s, filter .15s; }
  .n-site .n-btn-go:hover { filter: brightness(1.08); }
}

/* ── header ── */
.n-hdr { position: sticky; top: 0; z-index: 40; background: color-mix(in srgb, var(--ground) 78%, transparent); backdrop-filter: blur(16px) saturate(1.3); border-bottom: 1px solid var(--line); }
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

/* ═════════ THE DEVICES: one frame, lit from the upper right ═════════ */
.n-phone { position: relative; background: linear-gradient(225deg, color-mix(in srgb, var(--n-device) 70%, var(--ink)) 0%, var(--n-device) 18%); border-radius: clamp(26px, 3.6vw, 46px); padding: clamp(6px, .7vw, 9px);
  box-shadow: 0 0 0 1.5px var(--n-device-edge), var(--n-lit-edge), var(--n-cast); }
.n-phone-screen { position: relative; overflow: hidden; border-radius: clamp(20px, 3vw, 38px); aspect-ratio: 1179 / 2556; background: var(--ground-2); }
.n-lid { position: relative; background: linear-gradient(225deg, color-mix(in srgb, var(--n-device) 72%, var(--ink)) 0%, var(--n-device) 14%); border-radius: 16px 16px 6px 6px; padding: 1.4% 1.4% 2.2%;
  box-shadow: 0 0 0 1.5px var(--n-device-edge), var(--n-lit-edge), var(--n-cast); }
.n-lid-screen { position: relative; overflow: hidden; border-radius: 4px; aspect-ratio: 16 / 10; background: var(--ground-2); }
.n-phone-screen img, .n-lid-screen img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; }
/* a framed crop of a console capture: drawn --z screens wide, --fx/--fy of it left of and above the window */
.n-site .n-zoom img { inset: auto; left: 0; top: 0; max-width: none; width: calc(var(--z, 1) * 100%); height: auto; object-fit: initial; transform: translate(calc(-1 * var(--fx, 0%)), calc(-1 * var(--fy, 0%))); }
.n-zoom-story { --z: 1.55; --fx: 17%; --fy: 0%; }
/* the floodlight's sheen on the glass: the top-right corner only, faint, above the screen */
.n-phone-screen::after, .n-lid-screen::after { content: ""; position: absolute; inset: 0; z-index: 3; pointer-events: none; border-radius: inherit;
  background: linear-gradient(222deg, color-mix(in srgb, white 4%, transparent) 0%, transparent 18%); box-shadow: inset 0 0 0 1px color-mix(in srgb, black 22%, transparent); }
.n-base { height: clamp(9px, 1.2vw, 16px); margin: 0 -5%; border-radius: 0 0 20px 20px; background: linear-gradient(color-mix(in srgb, var(--ink) 42%, var(--n-device)), var(--n-device) 60%, black); box-shadow: inset 0 1px 0 color-mix(in srgb, white 30%, transparent), -30px 40px 50px -24px black; }
.n-base::after { content: ""; display: block; width: 14%; height: 40%; margin: 0 auto; border-radius: 0 0 10px 10px; background: color-mix(in srgb, black 35%, transparent); }
.n-frame { position: absolute; inset: 0; }
.n-frame.n-off { opacity: 0; }
.n-mark { position: absolute; z-index: 2; border: 3px solid var(--brass-ui); border-radius: 8px; box-shadow: 0 0 0 5px color-mix(in srgb, var(--brass-ui) 22%, transparent); pointer-events: none; opacity: 0; }
.n-mark.n-show { opacity: 1; }
.n-tap { position: absolute; z-index: 2; border-radius: 12px; pointer-events: none; opacity: 0; }
.n-tap.n-show { opacity: 1; box-shadow: 0 0 0 3px var(--brass-ui), 0 0 0 10px color-mix(in srgb, var(--brass-ui) 28%, transparent); }

/* ═════════ HERO: the words, and the live moment under the floodlights ═════════ */
.n-hero { position: relative; isolation: isolate; overflow: clip; padding: clamp(32px, 5vw, 76px) 0 clamp(56px, 6vw, 96px); }
.n-flood { position: absolute; inset: 0; z-index: -2;
  /* the lamp itself sits just past the top-right edge: its beam comes in from off the frame, as a
     real floodlight's does in a photograph taken beside it (Ajay: "should not look artificial") */
  background:
    linear-gradient(90deg, var(--ground) 0%, color-mix(in srgb, var(--ground) 90%, transparent) 30%, color-mix(in srgb, var(--ground) 30%, transparent) 58%, transparent 80%),
    linear-gradient(180deg, color-mix(in srgb, var(--ground) 40%, transparent) 0%, transparent 20%, transparent 66%, var(--ground) 100%),
    url(/new/d/floodlit-green.w1920.webp) 82% 44% / auto 132% no-repeat,
    var(--n-deep);
}
.n-hero::after { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; background-image: ${GRAIN}; background-size: 180px; opacity: .08; mix-blend-mode: overlay; }
.n-hero > .n-wrap.n-hero-grid { max-width: 1360px; }
.n-hero-grid { display: grid; grid-template-columns: minmax(0, 4.6fr) minmax(0, 7.4fr); gap: clamp(28px, 3.4vw, 56px); align-items: center; }
.n-hero-top { min-width: 0; }
.n-site .n-kicker { display: inline-flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; color: var(--ink-soft); text-decoration: none; padding: 7px 16px 7px 10px; border: 1px solid var(--line-2); border-radius: 999px; margin-bottom: 26px; max-width: 100%; background: color-mix(in srgb, var(--ground) 60%, transparent); backdrop-filter: blur(8px); }
.n-site .n-kicker:hover { border-color: var(--ink); color: var(--ink); }
.n-kicker i { width: 9px; height: 9px; border-radius: 50%; background: var(--brass-ui); box-shadow: 0 0 0 4px color-mix(in srgb, var(--brass-ui) 25%, transparent); flex: none; }
.n-tagline { font: 700 14px/1.2 var(--n-text); letter-spacing: .1em; text-transform: uppercase; color: var(--brass); margin-bottom: 16px; }
.n-hero h1 span { display: block; }
.n-hero h1 .n-h1-2 { color: var(--brass); }
.n-hero-sub { margin-top: 22px; max-width: 32em; font-size: clamp(17px, calc(15.5px + .2vw), 18px); line-height: 1.55; color: var(--ink-soft); }
.n-hero-sub b { color: var(--ink); font-weight: 700; }
.n-hero-go { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
.n-hero-facts { display: flex; flex-wrap: wrap; gap: 8px 22px; margin-top: 24px; font-size: 15.5px; color: var(--ink-soft); }
.n-hero-facts li { display: inline-flex; align-items: center; gap: 8px; }
.n-hero-facts li::before { content: ""; width: 12px; height: 7px; border-left: 2.5px solid var(--brass); border-bottom: 2.5px solid var(--brass); rotate: -45deg; translate: 0 -2px; flex: none; }

/* the stage: the committee's laptop, a member's phone in front of it, both standing on the lit green */
.n-stage { position: relative; isolation: isolate; min-width: 0; display: grid; padding-bottom: 6px; }
.n-pool { position: absolute; z-index: -1; left: -14%; right: -8%; bottom: -14%; height: 46%; pointer-events: none; border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, white 16%, transparent), color-mix(in srgb, white 6%, transparent) 55%, transparent); filter: blur(8px); }
.n-laptop { position: relative; width: 94%; justify-self: end; }
.n-laptop .n-lid { box-shadow: 0 0 0 1.5px var(--n-device-edge), var(--n-lit-edge), var(--n-cast), 0 30px 120px -40px var(--n-glow); }
/* the phone stands in front of the laptop's lower-left corner, below the marked row, so neither hides the other's moment */
.n-stage .n-phone { position: absolute; z-index: 2; width: 21%; left: -3%; top: 50%; }
@media (min-width: 1101px) { .n-stage { padding-bottom: 70px; } }
.n-live { justify-self: end; margin-top: 30px; display: flex; align-items: center; gap: 14px; padding: 10px 12px 10px 18px; border-radius: 14px;
  background: var(--n-glass); backdrop-filter: blur(14px) saturate(1.2); border: 1px solid var(--n-glass-edge); box-shadow: var(--n-rim), 0 24px 44px -20px black; font-size: 15.5px; max-width: 100%; }
.n-live b { font-weight: 700; color: var(--ink); }
.n-live > span:nth-child(3) { color: var(--ink-soft); min-width: 0; }
.n-live .n-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--brass-ui); flex: none; }
.n-live .n-big { font: 750 30px/1 var(--n-head); color: var(--brass); min-width: 2.2ch; }
.n-replay { margin-left: 6px; background: none; border: 0; color: var(--ink-soft); font: 600 15px/1 var(--n-text); text-decoration: underline; text-decoration-color: var(--brass); text-underline-offset: 4px; cursor: pointer; padding: 8px 6px; min-height: 44px; }
.n-replay:hover { color: var(--ink); }
.n-caption { margin-top: clamp(40px, 5vw, 64px); max-width: 52em; font-size: 15px; color: var(--ink-faint); }
.n-kicker-after { display: none; }
@media (prefers-reduced-motion: no-preference) {
  .n-stage .n-frame { transition: opacity .7s ease; }
  .n-mark { transition: opacity .4s ease; }
  .n-tap.n-show { animation: n-press .9s ease-out both; }
  @keyframes n-press { 0% { transform: scale(1.25); opacity: 0; } 35% { transform: scale(.96); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
}
@media (max-width: 1100px) and (min-width: 768px) {
  .n-hero-grid { grid-template-columns: minmax(0, 1fr); }
  .n-hero-top { max-width: 40em; }
  .n-stage { margin-top: 12px; }
  .n-laptop { width: 82%; }
  .n-stage .n-phone { width: 24%; left: 2%; }
}
/* A PHONE: words first, then the member's phone with the moment, then the laptop */
@media (max-width: 767px) {
  .n-hero { padding-top: 18px; }
  .n-flood {
    background:
      linear-gradient(180deg, var(--ground) 0%, color-mix(in srgb, var(--ground) 86%, transparent) 34%, color-mix(in srgb, var(--ground) 40%, transparent) 58%, color-mix(in srgb, var(--ground) 55%, transparent) 82%, var(--ground) 100%),
      url(/new/d/floodlit-green.w960.webp) 36% 100% / auto 74% no-repeat,
      var(--n-deep);
  }
  .n-hero-grid { grid-template-columns: minmax(0, 1fr); gap: 20px; }
  .n-hero-top .n-kicker { display: none; }
  .n-kicker-after { display: block; margin-top: 26px; }
  .n-kicker-after .n-kicker { margin: 0; line-height: 1.35; }
  .n-tagline { font-size: 13px; margin-bottom: 10px; }
  .n-hero-sub { font-size: 17px; margin-top: 12px; }
  .n-sub-more { display: none; }
  .n-hero-go { margin-top: 18px; gap: 10px; }
  .n-hero-go .n-btn { flex: 1 1 0; padding: 0 10px; font-size: 16px; min-height: 48px; white-space: nowrap; min-width: 0; }
  .n-hero-facts { display: none; }
  .n-stage { display: flex; flex-direction: column; }
  .n-stage .n-phone { order: 1; position: relative; left: auto; top: auto; width: min(64%, 250px); margin: 0 auto; }
  .n-live { order: 2; align-self: stretch; justify-content: flex-start; margin-top: 20px; flex-wrap: wrap; }
  .n-laptop { order: 3; width: 100%; margin-top: 30px; }
  .n-pool { bottom: auto; top: 30%; height: 40%; left: -20%; right: -20%; }
  .n-caption { margin-top: 22px; }
}

/* ═════════ THE STORY: one phone in a pool of light, its screen turning with the day ═════════ */
.n-story-sec { position: relative; isolation: isolate; padding-top: var(--n-sec);
  background: radial-gradient(60% 50% at 78% 30%, color-mix(in srgb, var(--ground-2) 70%, transparent), transparent 70%), var(--ground); }
.n-story-head { display: grid; gap: 16px; max-width: 46em; }
/* the stage is the point: a narrow column of words, a wide lit stage */
.n-story-sec > .n-wrap { max-width: 1360px; }
.n-story { display: grid; grid-template-columns: minmax(0, 360px) minmax(0, 1fr); gap: clamp(32px, 3.4vw, 56px); margin-top: clamp(16px, 3vw, 40px); }
.n-steps { min-width: 0; }
.n-step { min-height: 46vh; display: grid; align-content: center; gap: 10px; padding: 28px 0; }
.n-step:first-child { min-height: 50vh; }
.n-step:last-child { min-height: 66vh; }
.n-ch { display: flex; align-items: baseline; gap: 14px; margin-bottom: 18px; font: 700 14px/1.2 var(--n-text); letter-spacing: .1em; text-transform: uppercase; color: var(--brass); scroll-margin-top: calc(var(--n-hdr) + 24px); }
.n-ch-n { font: 750 clamp(40px, 4.4vw, 60px)/.9 var(--n-head); letter-spacing: -.03em; color: transparent; -webkit-text-stroke: 1.5px var(--brass); text-transform: none; }
.n-stamp { display: flex; align-items: baseline; gap: 10px; font-size: 16px; color: var(--ink-faint); }
.n-stamp b { font: 700 22px/1 var(--n-head); color: var(--ink); }
.n-step .n-who { font-size: 15px; font-weight: 700; color: var(--ink-soft); padding: 3px 10px; border: 1px solid var(--line-2); border-radius: 999px; justify-self: start; }
.n-step h3 { font: 720 clamp(26px, calc(18px + 1.2vw), 36px)/1.1 var(--n-head); letter-spacing: -.02em; text-wrap: balance; }
.n-step p.n-say { font-size: 17px; color: var(--ink-soft); max-width: 30em; }
.n-step-phone { display: none; }

.n-story-dev { position: relative; min-width: 0; }
.n-story-pin { position: sticky; top: calc(var(--n-hdr) + 28px); height: calc(100svh - var(--n-hdr) - 56px); max-height: 820px; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: clamp(18px, 3vw, 44px); }
.n-story-lit { position: relative; isolation: isolate; justify-self: start; }
/* a cone of floodlight from above, and the pool it makes under the phone */
.n-story-lit::before { content: ""; position: absolute; z-index: -1; left: 50%; top: -40%; width: 190%; height: 150%; translate: -50% 0; pointer-events: none;
  background: radial-gradient(38% 60% at 50% 30%, var(--n-flood), transparent 72%); }
.n-story-lit::after { content: ""; position: absolute; z-index: -1; left: -30%; right: -18%; bottom: -9%; height: 16%; border-radius: 50%; pointer-events: none;
  background: radial-gradient(closest-side, color-mix(in srgb, white 9%, transparent), transparent); }
/* the committee's laptop and a member's phone, one lit and forward, the other resting */
.n-story-lit { width: 100%; justify-self: stretch; padding: 0 0 6% 0; }
.n-story-desk { position: relative; width: min(90%, calc((100svh - var(--n-hdr) - 190px) * 1.52)); margin-left: 0; }
.n-story-lit > .n-phone { position: absolute; z-index: 2; right: -3%; bottom: 0; width: min(21%, calc((100svh - var(--n-hdr) - 190px) * .4613 * .62)); }
.n-story-pin .n-frame { will-change: opacity; }
.n-story-lit[data-active="phone"] .n-story-desk { opacity: .5; filter: saturate(.7) brightness(.75); }
.n-story-lit[data-active="laptop"] > .n-phone { opacity: .6; filter: saturate(.7) brightness(.75); }
.n-story-lit[data-active="laptop"] .n-story-desk .n-lid { box-shadow: 0 0 0 1.5px var(--n-device-edge), var(--n-lit-edge), var(--n-cast), 0 30px 110px -40px var(--n-glow); }
.n-story-lit[data-active="phone"] > .n-phone { box-shadow: 0 0 0 1.5px var(--n-device-edge), var(--n-lit-edge), var(--n-cast), 0 30px 90px -30px var(--n-glow); }
@media (prefers-reduced-motion: no-preference) {
  .n-story-desk, .n-story-lit > .n-phone { transition: opacity .45s ease, filter .45s ease; }
}
/* a console moment on a phone: a window onto its capture, drawn 3.2 windows wide, never shrunk whole */
.n-step-desk { display: none; }
.n-win-detail { --z: 3.2; --fx: 17%; --fy: 4%; --ar: 4 / 5; }
/* the chapters, as a row of stops above the stage */
.n-story-pin { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto; align-content: center; gap: clamp(20px, 3vh, 36px); }
.n-rail { display: flex; flex-wrap: wrap; gap: 8px; }
.n-rail a { display: inline-flex; gap: 8px; align-items: baseline; padding: 7px 12px; border: 1px solid var(--line); border-radius: 999px; text-decoration: none; color: var(--ink-faint); font-size: 14px; font-weight: 600; }
.n-rail a span:first-child { font: 700 14px/1 var(--n-head); font-variant-numeric: tabular-nums; }
.n-rail a:hover { color: var(--ink); }
.n-rail .n-done a { color: var(--ink-soft); }
.n-rail .n-on a { color: var(--ink); border-color: var(--brass-ui); background: color-mix(in srgb, var(--brass-ui) 14%, transparent); }
.n-rail .n-on a span:first-child { color: var(--brass); }
@media (prefers-reduced-motion: no-preference) {
  .n-story-pin .n-frame { transition: opacity .45s ease; }
}
@media (max-width: 1100px) and (min-width: 768px) {
  .n-story { gap: 28px; grid-template-columns: minmax(0, 4fr) minmax(0, 6fr); }
  .n-story-pin { grid-template-columns: minmax(0, 1fr); justify-items: center; align-content: center; }
  .n-story-desk { width: 76%; }
  .n-story-lit > .n-phone { width: 30%; }
  .n-rail { display: none; }
}
/* NARROW: no sticky device; each moment carries its own screen, and the page simply scrolls */
@media (max-width: 767px) {
  .n-story { grid-template-columns: minmax(0, 1fr); }
  .n-story-dev { display: none; }
  .n-step, .n-step:first-child, .n-step:last-child { min-height: 0; padding: 40px 0 8px; }
  .n-step + .n-step { border-top: 1px solid var(--line); }
  .n-ch-n { font-size: 40px; }
  .n-step-phone { display: block; width: min(72%, 280px); margin: 22px auto 10px; }
  .n-step-desk { display: block; margin: 22px 0 10px; }
}

/* ── the film's slot (drawn only behind ?slot=video until the film exists) ── */
.n-film-in { display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 8fr); gap: clamp(28px, 4vw, 64px); align-items: center; }
.n-film-frame { position: relative; }
.n-film-frame .n-lid { outline: 2px dashed var(--brass-ui); outline-offset: 10px; }
.n-film-note { margin-top: 22px; font-size: 15px; color: var(--ink-faint); }
@media (max-width: 900px) { .n-film-in { grid-template-columns: minmax(0, 1fr); } }

/* ═════════ SECTIONS ═════════ */
.n-sec { padding-top: var(--n-sec); }
.n-band { position: relative; isolation: isolate; margin-top: var(--n-sec); padding: var(--n-sec) 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
  background: radial-gradient(70% 55% at 50% 0%, color-mix(in srgb, white 5%, transparent), transparent 70%), var(--n-deep); }
.n-band::after { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; background-image: ${GRAIN}; background-size: 180px; opacity: .06; mix-blend-mode: overlay; }
.n-sec-head { display: grid; gap: 16px; max-width: 46em; }

/* ── 1. THE BENTO (from B), on glass: the committee's desk in real crops at unequal sizes ── */
.n-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: clamp(14px, 1.6vw, 20px); margin-top: clamp(36px, 4vw, 56px); }
.n-tile { position: relative; isolation: isolate; overflow: hidden; display: flex; flex-direction: column; gap: 22px; padding: clamp(22px, 2.4vw, 32px); border-radius: 22px;
  background: linear-gradient(165deg, color-mix(in srgb, var(--ground-2) 92%, white 3%), color-mix(in srgb, var(--ground-2) 40%, var(--ground)) 70%);
  border: 1px solid var(--n-glass-edge); box-shadow: var(--n-rim), 0 40px 80px -44px black; }
.n-tile-say { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 14px; align-items: baseline; max-width: 34em; }
.n-tile-say .n-t { grid-row: span 2; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: color-mix(in srgb, var(--brass-ui) 16%, transparent); color: var(--brass); font: 750 15px/1 var(--n-head); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brass-ui) 40%, transparent); }
.n-tile-say b { font: 700 clamp(19px, calc(.4vw + 15px), 21px)/1.25 var(--n-head); letter-spacing: -.015em; }
.n-tile-say p { color: var(--ink-soft); font-size: 16px; }
/* a window onto a capture: cropped and shown nearer its own size, never redrawn */
.n-win { position: relative; overflow: hidden; margin-top: auto; border-radius: 12px; background: var(--ground-2); aspect-ratio: var(--ar, 16 / 10);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 16%, transparent), var(--n-cast); }
.n-win::after { content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit; background: linear-gradient(222deg, color-mix(in srgb, white 4%, transparent), transparent 18%); }
/* --z: how many windows wide the capture is drawn; --fx/--fy: the share of it left above and to the left */
.n-site .n-win img { position: absolute; left: 0; top: 0; max-width: none; width: calc(var(--z, 1) * 100%); height: auto; transform: translate(calc(-1 * var(--fx, 0%)), calc(-1 * var(--fy, 0%))); }
.n-win-needs { --z: 1.3; --fx: 19%; --fy: 0%; }
.n-win-pace { --z: 1.65; --fx: 19%; --fy: 51.5%; }
.n-win-flights { --z: 1.25; --fx: 19%; --fy: 2%; }
.n-tile-bleed .n-win { margin-right: calc(-1 * clamp(22px, 2.4vw, 32px)); margin-bottom: calc(-1 * clamp(22px, 2.4vw, 32px)); border-radius: 12px 0 0 0; }
.n-tile-xl { grid-column: span 8; grid-row: span 2; }
.n-tile-xl::before { content: ""; position: absolute; z-index: -1; right: -10%; bottom: -30%; width: 80%; height: 80%; border-radius: 50%; background: radial-gradient(closest-side, var(--n-glow), transparent); pointer-events: none; }
.n-tile-xl .n-win { --ar: 16 / 10.4; }
.n-tile-tall { grid-column: span 4; grid-row: span 2; }
.n-tile-tall::before { content: ""; position: absolute; z-index: -1; left: 50%; top: 28%; width: 120%; height: 90%; translate: -50% 0; background: radial-gradient(40% 50% at 50% 40%, var(--n-flood), transparent 70%); pointer-events: none; }
.n-tile-tall .n-tile-phone { margin-top: auto; margin-bottom: calc(-1 * clamp(22px, 2.4vw, 32px)); padding: 0 8%; height: clamp(300px, 30vw, 420px); overflow: hidden; }
.n-tile-tall .n-phone { border-bottom-left-radius: 0; border-bottom-right-radius: 0; padding-bottom: 0; }
.n-tile-tall .n-phone-screen { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.n-tile-pace { grid-column: span 5; }
.n-tile-pace .n-win { --ar: 16 / 8; }
/* the 128: on lit turf at dusk (a made backdrop of grass and light, under a dark veil) */
.n-tile-128 { grid-column: span 7;
  background: linear-gradient(180deg, color-mix(in srgb, var(--n-deep) 78%, transparent), color-mix(in srgb, var(--n-deep) 52%, transparent)), url(/new/d/dusk-turf.w800.webp) center 70% / cover, var(--n-deep); }
.n-tile-128 p { color: var(--ink-soft); font-size: 16px; margin-top: 10px; }
.n-tile-128 .n-num-big { font: 760 clamp(64px, 6.6vw, 92px)/.9 var(--n-head); letter-spacing: -.05em; color: var(--brass); }
.n-tile-128 .n-128-say { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 22px; align-items: end; }
.n-tile-128 .n-win { --ar: 16 / 8; }
@media (min-width: 1001px) {
  .n-tile-xl .n-win, .n-tile-pace .n-win { flex: 1 1 auto; aspect-ratio: auto; min-height: 340px; }
  .n-tile-pace .n-win { min-height: 260px; }
  .n-site .n-tile-pace .n-win img { top: auto; bottom: 0; transform: translateX(calc(-1 * var(--fx))); }
}
@media (max-width: 1000px) {
  .n-tile-xl { grid-column: span 12; grid-row: auto; }
  .n-tile-tall { grid-column: span 6; grid-row: auto; }
  .n-tile-pace { grid-column: span 6; }
  .n-tile-128 { grid-column: span 12; }
}
@media (max-width: 680px) {
  .n-bento { grid-template-columns: minmax(0, 1fr); }
  .n-tile-xl, .n-tile-tall, .n-tile-pace, .n-tile-128 { grid-column: auto; }
  .n-tile-xl .n-win { --ar: 1 / 1; --z: 2.1; }
  .n-tile-tall .n-tile-phone { height: 360px; padding: 0 12%; }
  .n-tile-pace .n-win { --ar: 16 / 9; --z: 2.6; }
  .n-tile-128 .n-128-say { grid-template-columns: minmax(0, 1fr); }
  .n-tile-128 .n-win { --ar: 1 / 1; --z: 2.4; }
}

/* ── the whole club watches: three boards standing on lit turf ── */
.n-turf { position: relative; isolation: isolate; padding-bottom: clamp(56px, 6vw, 96px); }
.n-turf::before { content: ""; position: absolute; z-index: -1; left: 0; right: 0; bottom: 0; height: 64%; pointer-events: none;
  background: linear-gradient(180deg, var(--ground) 0%, color-mix(in srgb, var(--ground) 45%, transparent) 40%, color-mix(in srgb, var(--ground) 30%, transparent) 75%, var(--ground) 100%),
    url(/new/d/dusk-turf.w1600.webp) center 40% / cover no-repeat; }
.n-watch { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 6fr); gap: clamp(32px, 5vw, 80px); align-items: end; }
.n-watch-big { font: 720 clamp(28px, calc(19px + 2vw), 48px)/1.07 var(--n-head); letter-spacing: -.02em; text-wrap: balance; }
.n-watch-big .n-t { display: block; color: var(--brass); font-variant-numeric: tabular-nums; }
.n-watch-row { display: flex; gap: clamp(14px, 2vw, 32px); align-items: flex-end; justify-content: center; margin-top: clamp(40px, 5vw, 72px); }
.n-watch-row figure { flex: 0 1 300px; min-width: 0; }
.n-watch-row figure:nth-child(2) { translate: 0 -28px; }
.n-watch-row figcaption { margin-top: 18px; font-size: 15.5px; color: var(--ink-soft); }
.n-watch-row figcaption b { display: block; color: var(--ink); }
.n-try { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 20px; align-items: center; margin-top: 28px; padding: 18px; border: 1px solid var(--n-glass-edge); border-radius: 16px; background: var(--n-glass); box-shadow: var(--n-rim); }
.n-try svg { width: 104px; height: 104px; border-radius: 8px; }
.n-try .n-qr-ground { fill: var(--ink); }
.n-try .n-qr-ink { fill: var(--ground); }
.n-try p { font-size: 16px; color: var(--ink-soft); }
.n-try p b { display: block; color: var(--ink); font-size: 17px; }
.n-doors { display: flex; flex-wrap: wrap; gap: 10px 22px; margin-top: 22px; }
@media (max-width: 900px) { .n-watch { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 600px) {
  .n-watch-row { justify-content: flex-start; overflow-x: auto; scroll-snap-type: x mandatory; margin: 40px calc(-1 * var(--n-gut)) 0; padding: 0 var(--n-gut) 6px; scrollbar-width: none; }
  .n-watch-row::-webkit-scrollbar { display: none; }
  .n-watch-row figure { flex: 0 0 min(64vw, 260px); scroll-snap-align: start; }
  .n-watch-row figure:nth-child(2) { translate: none; }
}
@media (max-width: 640px) { .n-try { grid-template-columns: minmax(0, 1fr); } .n-try svg { display: none; } }

/* ── any format, any field ── */
.n-formats { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: clamp(32px, 5vw, 72px); align-items: start; margin-top: clamp(32px, 4vw, 56px); }
.n-format-wall { display: flex; flex-wrap: wrap; gap: 8px; }
.n-format-wall li { padding: 8px 14px; border-radius: 999px; border: 1px solid var(--n-glass-edge); font-size: 16px; font-weight: 600; color: var(--ink); background: var(--n-glass); box-shadow: var(--n-rim); }
.n-runs { margin-top: 24px; display: flex; flex-wrap: wrap; gap: 8px; }
.n-runs li { padding: 6px 12px; border-radius: 8px; background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink-soft); font-weight: 600; font-size: 15.5px; }
@media (max-width: 900px) { .n-formats { grid-template-columns: minmax(0, 1fr); } }

/* ── money ── */
.n-money { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 6fr); gap: clamp(32px, 5vw, 80px); align-items: center; }
.n-money > div { min-width: 0; }
.n-money-pic { position: relative; isolation: isolate; display: grid; grid-template-columns: minmax(0, 1fr); justify-items: center; }
.n-money-pic::before { content: ""; position: absolute; z-index: -1; inset: -10% 0; background: radial-gradient(40% 46% at 50% 45%, var(--n-glow), transparent 72%); pointer-events: none; }
.n-money-pic .n-phone { width: min(310px, 78%); }
.n-coins { display: flex; gap: 8px; margin-top: 28px; flex-wrap: wrap; }
.n-coin { min-width: 64px; min-height: 60px; padding: 6px 14px; display: grid; justify-items: center; align-content: center; gap: 2px; border-radius: 12px; border: 1px solid var(--n-glass-edge); background: var(--n-glass); box-shadow: var(--n-rim); color: var(--ink); cursor: pointer; font: inherit; }
.n-coin b { font: 750 24px/1 var(--n-head); }
.n-coin span { font-size: 13px; color: var(--ink-soft); }
.n-coin[aria-selected="true"] { background: var(--brass-ui); border-color: var(--brass-ui); color: var(--on-accent); }
.n-coin[aria-selected="true"] span { color: var(--on-accent); }
.n-money-say { margin-top: 16px; font-size: 16px; color: var(--ink-soft); min-height: 1.6em; }
.n-also { margin-top: 24px; font-size: 15.5px; color: var(--ink-faint); }
.n-never { margin-top: 26px; padding: 18px 20px; border-left: 3px solid var(--brass-ui); background: var(--n-glass); border-radius: 0 12px 12px 0; font-size: 17px; color: var(--ink-soft); }
.n-never b { color: var(--ink); }
@media (max-width: 900px) { .n-money { grid-template-columns: minmax(0, 1fr); } }

/* ── colours ── */
.n-themes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: clamp(12px, 1.6vw, 22px); margin-top: clamp(32px, 4vw, 56px); }
.n-themes figure { min-width: 0; }
.n-themes figcaption { margin-top: 14px; font-size: 15.5px; display: flex; align-items: center; gap: 8px; color: var(--ink-soft); }
.n-themes figcaption i { width: 12px; height: 12px; border-radius: 3px; flex: none; }
@media (max-width: 900px) {
  .n-themes { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; margin: 32px calc(-1 * var(--n-gut)) 0; padding: 0 var(--n-gut) 6px; scrollbar-width: none; }
  .n-themes::-webkit-scrollbar { display: none; }
  .n-themes figure { flex: 0 0 min(58vw, 230px); scroll-snap-align: start; }
}

/* ── who it is for ── */
.n-for { margin-top: clamp(28px, 3.5vw, 48px); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.n-for li { min-width: 0; }
.n-for a { height: 100%; display: grid; align-content: start; gap: 12px; padding: 26px 24px; border: 1px solid var(--n-glass-edge); border-radius: 20px; background: linear-gradient(165deg, var(--ground-2), color-mix(in srgb, var(--ground-2) 40%, var(--ground))); box-shadow: var(--n-rim), 0 30px 60px -40px black; text-decoration: none; }
.n-for .n-who { font: 700 14px/1.2 var(--n-text); letter-spacing: .08em; text-transform: uppercase; color: var(--ink); }
.n-for .n-who::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--brass-ui); margin-right: 10px; vertical-align: 2px; }
.n-for p { color: var(--ink-soft); font-size: 16.5px; }
.n-for p b { display: block; color: var(--ink); font: 700 21px/1.2 var(--n-head); margin-bottom: 6px; }
.n-for .n-go { font-weight: 700; text-decoration: underline; text-decoration-color: var(--brass); text-decoration-thickness: 2px; text-underline-offset: 5px; }
.n-for a:hover { border-color: var(--ink-faint); }
@media (max-width: 900px) { .n-for { grid-template-columns: minmax(0, 1fr); } }

/* ── pricing ── */
.n-plans { margin-top: clamp(32px, 4vw, 56px); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; align-items: stretch; }
.n-plan { position: relative; min-width: 0; padding: clamp(22px, 2.4vw, 30px); display: grid; align-content: start; gap: 12px; border: 1px solid var(--n-glass-edge); border-radius: 20px; background: linear-gradient(170deg, var(--ground-2), var(--ground) 75%); box-shadow: var(--n-rim), 0 30px 60px -40px black; }
.n-plan .n-tag { font-size: 15px; font-weight: 700; color: var(--ink-soft); }
.n-plan h3 { font: 720 26px/1.1 var(--n-head); }
.n-price { font: 750 clamp(42px, 4.2vw, 56px)/.9 var(--n-head); letter-spacing: -.03em; font-variant-numeric: tabular-nums; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.n-price small { font: 600 16px/1.2 var(--n-text); letter-spacing: 0; color: var(--ink-soft); }
.n-plan .n-year { font-size: 15px; color: var(--ink-soft); min-height: 1.5em; }
.n-plan ul { display: grid; gap: 8px; font-size: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.n-plan li { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 8px; }
.n-plan li::before { content: ""; width: 12px; height: 7px; margin-top: 7px; border-left: 2.5px solid var(--brass); border-bottom: 2.5px solid var(--brass); rotate: -45deg; }
.n-plan .n-term { font-size: 14.5px; color: var(--ink-faint); }
.n-plan .n-btn { width: 100%; }
.n-plan-pick { border: 1.5px solid var(--brass-ui); box-shadow: var(--n-rim), 0 0 0 6px color-mix(in srgb, var(--brass-ui) 8%, transparent), 0 40px 90px -40px var(--n-glow); }
.n-small { margin-top: 22px; font-size: 15px; color: var(--ink-faint); max-width: 70em; }
.n-small a { color: inherit; }
.n-vs { margin-top: clamp(48px, 6vw, 80px); display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: clamp(28px, 4vw, 64px); align-items: center; }
.n-vs > div { min-width: 0; }
.n-vs p { margin-top: 12px; color: var(--ink-soft); }
.n-bars { display: grid; gap: 14px; }
.n-bars li { display: grid; grid-template-columns: 112px minmax(0, 1fr) 92px; gap: 14px; align-items: center; font-weight: 700; font-size: 16px; }
.n-bars .n-track { height: 28px; background: color-mix(in srgb, var(--ink) 5%, transparent); border-radius: 999px; overflow: hidden; border: 1px solid var(--line); }
.n-bars .n-fill { display: block; height: 100%; background: var(--n-quiet); border-radius: 999px; }
.n-bars .n-us .n-fill { background: var(--brass-ui); }
.n-bars .n-amt { text-align: right; font-variant-numeric: tabular-nums; }
.n-saved { display: flex; gap: 28px; flex-wrap: wrap; margin-top: 10px; font-size: 16px; color: var(--ink-soft); }
.n-saved b { font: 750 28px/1 var(--n-head); color: var(--brass); display: block; }
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
.n-answer h3 { font: 700 21px/1.2 var(--n-head); }
.n-answer p { color: var(--ink-soft); }
@media (max-width: 900px) { .n-qa { grid-template-columns: minmax(0, 1fr); } }

/* ── follow along ── */
.n-follow { margin-top: clamp(28px, 3.5vw, 48px); display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; max-width: 820px; }
.n-follow li { min-width: 0; }
.n-follow a { height: 100%; display: grid; align-content: start; gap: 10px; padding: 22px; text-decoration: none; border: 1px solid var(--n-glass-edge); border-radius: 20px; background: var(--n-glass); box-shadow: var(--n-rim); }
.n-follow svg { width: 28px; height: 28px; fill: currentColor; }
.n-follow .n-net { font: 700 21px/1.1 var(--n-head); display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.n-follow p { font-size: 16px; color: var(--ink-soft); }
.n-follow a:hover { border-color: var(--ink-faint); }
.n-follow a:hover .n-net { color: var(--brass); }
@media (max-width: 520px) { .n-follow { grid-template-columns: minmax(0, 1fr); } }

/* ── the close: back under the floodlights ── */
.n-close { position: relative; isolation: isolate; padding: var(--n-sec) 0; margin-top: var(--n-sec); border-top: 1px solid var(--line);
  background:
    linear-gradient(90deg, var(--n-deep) 0%, color-mix(in srgb, var(--n-deep) 88%, transparent) 45%, color-mix(in srgb, var(--n-deep) 60%, transparent) 100%),
    linear-gradient(180deg, var(--n-deep) 0%, transparent 30%, transparent 70%, var(--n-deep) 100%),
    url(/new/d/floodlit-green.w1920.webp) 30% 76% / auto 132% no-repeat,
    var(--n-deep); }
.n-close::after { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; background-image: ${GRAIN}; background-size: 180px; opacity: .07; mix-blend-mode: overlay; }
.n-close-grid { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: clamp(32px, 5vw, 80px); align-items: start; }
.n-close-grid > div { min-width: 0; }
.n-close .n-display span { display: block; }
.n-close .n-display span + span { color: var(--brass); }
.n-close .n-lead { margin-top: 18px; }
.n-close-auth { scroll-margin-top: 90px; }
.n-stores { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
.n-site .n-store { display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px; border: 1px solid var(--line-2); border-radius: 12px; text-decoration: none; min-height: 54px; background: color-mix(in srgb, var(--n-deep) 60%, transparent); }
.n-store small { display: block; font-size: 12.5px; color: var(--ink-soft); }
.n-store b { display: block; font-size: 17px; line-height: 1.1; }
.n-store svg { width: 22px; height: 22px; fill: currentColor; }
.n-stores-note { margin-top: 14px; font-size: 15px; color: var(--ink-soft); max-width: 36em; }
@media (max-width: 900px) {
  .n-close-grid { grid-template-columns: minmax(0, 1fr); }
  .n-close { background:
    linear-gradient(180deg, var(--n-deep) 0%, color-mix(in srgb, var(--n-deep) 75%, transparent) 30%, var(--n-deep) 62%),
    url(/new/d/floodlit-green.w960.webp) 36% 0 / auto 52% no-repeat,
    var(--n-deep); }
}

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

/* the auth card from the shared chrome, seated on glass */
.n-site .authpanel { max-width: none; }
`;
