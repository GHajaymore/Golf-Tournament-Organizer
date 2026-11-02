import { LIGHT_GROUND } from "@/lib/themes";
import { landingTokens } from "@/lib/landing-palette";

/**
 * THE SITE REHAUL'S OWN STYLESHEET — DESIGN B, "the product on paper" (2026-11-02). `/new` only, a
 * preview beside today's `/`.
 *
 * The idea: a pale, airy page where the app itself is the hero. The ground is the app's own light
 * ground (`LIGHT_GROUND` in themes.ts — the warm paper every light screen of the app sits on), the
 * cards are that ground's surface, and the words are the landing palette's light tokens, each solved
 * to 7:1 or better against the darkest paper it is read on. The one colour is the logo's orange, as
 * text and as a mark, never as a ground. Real screens float in device frames with a deep, soft,
 * layered shadow; the features are a bento of real crops at unequal sizes.
 *
 * Type is crisp and moderate: Archivo at its normal width for headings (sentence case, tight), and
 * Atkinson Hyperlegible Next for text at 17px. Desktop h1 64px, phone h1 36-38px.
 *
 * Scoped under `.n-site`, every class prefixed `n-`. No colour is typed here as a hex: the grounds come
 * from LIGHT_GROUND and every other colour from `landingTokens("light")`, mixed. `black` appears only
 * for the physical devices and in shadows. The same colours on every width: there is no colour inside
 * a media query.
 *
 * Screens meant to be READ are flat, upright and still; only their frames and the light around them
 * are drawn. Motion is one page-load moment (the hero rises in, then the live moment plays once),
 * every part of it inside `prefers-reduced-motion: no-preference`.
 */
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
/* Atkinson draws its zero slashed, which reads as "Ø" in a price ("$49Ø"). The text face's figures
   come from Archivo instead: declared last, so for 0-9 it is asked first. */
@font-face {
  font-family: "Atkinson Next"; font-style: normal; font-display: swap; font-weight: 200 800;
  src: url(/new/fonts/archivo-latin-wdth-normal.woff2) format("woff2-variations");
  unicode-range: U+0030-0039;
}

/* The light tokens on the page itself, so the shared auth card and the lockup read them too. */
.thq.n-site {
  color-scheme: light;
${landingTokens("light", "  ")}
  --ground: ${LIGHT_GROUND.bg};
  --card: ${LIGHT_GROUND.surface};
  --logo-stick: var(--ink); --logo-cup: var(--ink-soft);
  --wash: color-mix(in srgb, var(--ink) 4%, transparent);
  --wash-2: color-mix(in srgb, var(--ink) 8%, transparent);
  --shadow: 0 1px 0 color-mix(in srgb, var(--ink) 4%, transparent), 0 24px 48px -28px color-mix(in srgb, var(--ink) 30%, transparent);
}
.n-site {
  --n-ground: ${LIGHT_GROUND.bg};
  --n-surface: ${LIGHT_GROUND.surface};
  --n-ink: ${LIGHT_GROUND.text};
  --n-soft: var(--ink-soft);
  --n-faint: var(--ink-faint);
  --n-orange: var(--brass);
  --n-orange-fill: var(--brass-ui);
  --n-on-orange: var(--on-accent);
  --n-hair: color-mix(in srgb, var(--n-ink) 9%, transparent);
  --n-line: color-mix(in srgb, var(--n-ink) 16%, transparent);
  --n-tint: color-mix(in srgb, var(--n-orange-fill) 7%, var(--n-surface));
  --n-sunk: color-mix(in srgb, var(--n-ink) 4%, var(--n-ground));
  /* the deep, soft shadow a floating device casts: a contact line, a near shade and a long far one */
  --n-float:
    0 0 0 1px color-mix(in srgb, var(--n-ink) 10%, transparent),
    0 2px 4px color-mix(in srgb, var(--n-ink) 6%, transparent),
    0 12px 24px -6px color-mix(in srgb, var(--n-ink) 10%, transparent),
    0 40px 70px -20px color-mix(in srgb, var(--n-ink) 22%, transparent),
    0 90px 140px -50px color-mix(in srgb, var(--n-ink) 30%, transparent);
  --n-card-shadow:
    0 0 0 1px var(--n-hair),
    0 1px 2px color-mix(in srgb, var(--n-ink) 5%, transparent),
    0 18px 40px -24px color-mix(in srgb, var(--n-ink) 22%, transparent);
  --n-display: "Archivo Board", system-ui, -apple-system, "Segoe UI", sans-serif;
  --n-text: "Atkinson Next", system-ui, -apple-system, "Segoe UI", sans-serif;
  --n-wrap: 1240px;
  --n-gut: clamp(16px, 4vw, 48px);
  --n-sec: clamp(80px, 10vw, 148px);
  --n-r: 28px;
  background: var(--n-ground);
  color: var(--n-ink);
  font: 400 17px/1.6 var(--n-text);
  overflow-x: clip;
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
}
.n-site *, .n-site *::before, .n-site *::after { box-sizing: border-box; }
.n-site :where(h1, h2, h3, h4, p, ul, ol, figure, dl, dd, blockquote) { margin: 0; padding: 0; }
.n-site :where(ul, ol) { list-style: none; }
.n-site a { color: inherit; }
.n-site img { display: block; max-width: 100%; height: auto; }
.n-site :focus-visible { outline: 3px solid var(--n-orange); outline-offset: 3px; border-radius: 6px; }
.n-site .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; margin: -1px; padding: 0; border: 0; }
.n-wrap { max-width: var(--n-wrap); margin: 0 auto; padding-left: max(var(--n-gut), env(safe-area-inset-left)); padding-right: max(var(--n-gut), env(safe-area-inset-right)); }
.n-skip { position: absolute; left: 12px; top: -60px; z-index: 50; background: var(--n-ink); color: var(--n-surface); padding: 10px 16px; border-radius: 8px; font-weight: 700; }
.n-skip:focus { top: 12px; }
.n-site :where(div, li, figure, section, a, span) { min-width: 0; }

/* ── type ── */
.n-display, .n-h2 {
  font-family: var(--n-display); font-stretch: 100%; font-weight: 720;
  letter-spacing: -.032em; line-height: 1.04; text-wrap: balance; color: var(--n-ink);
}
.n-h2 { font-size: clamp(30px, calc(1.6vw + 22px), 46px); line-height: 1.08; }
.n-h3 { font: 700 clamp(21px, calc(.6vw + 16px), 26px)/1.2 var(--n-display); letter-spacing: -.02em; text-wrap: balance; }
.n-lead { font-size: clamp(17px, calc(.3vw + 15.5px), 19px); line-height: 1.6; color: var(--n-soft); max-width: 38em; text-wrap: pretty; }
.n-site p { text-wrap: pretty; }
.n-num { font-variant-numeric: tabular-nums; }
.n-eyebrow { font: 700 13px/1.2 var(--n-text); letter-spacing: .08em; text-transform: uppercase; color: var(--n-orange); }

/* ── buttons ── */
.n-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 50px;
  padding: 0 24px; border-radius: 999px; font: 700 17px/1 var(--n-text); text-decoration: none;
  border: 1.5px solid transparent; transition: background-color .15s, color .15s, border-color .15s, box-shadow .15s;
}
.n-site .n-btn-go { background: var(--n-ink); color: var(--n-surface); box-shadow: 0 1px 0 color-mix(in srgb, var(--n-surface) 20%, transparent) inset, 0 8px 20px -10px color-mix(in srgb, var(--n-ink) 60%, transparent); }
.n-site .n-btn-go:hover { background: color-mix(in srgb, var(--n-ink) 86%, var(--n-orange-fill)); }
.n-site .n-btn-line { background: var(--n-surface); border-color: var(--n-line); color: var(--n-ink); }
.n-site .n-btn-line:hover { border-color: var(--n-ink); }
.n-site .n-link { color: var(--n-ink); text-decoration: underline; text-decoration-color: var(--n-orange); text-decoration-thickness: 2px; text-underline-offset: 5px; font-weight: 700; }
.n-site .n-link:hover { color: var(--n-orange); }

/* ── header ── */
.n-hdr { position: sticky; top: 0; z-index: 40; background: color-mix(in srgb, var(--n-ground) 82%, transparent); backdrop-filter: blur(16px) saturate(1.4); border-bottom: 1px solid var(--n-hair); }
.n-hdr-in { display: flex; align-items: center; gap: 28px; min-height: 68px; }
.n-hdr .lockup { display: inline-flex; text-decoration: none; flex: none; }
.n-nav { display: flex; gap: 26px; margin-right: auto; }
.n-nav a, .n-hdr-act > a:not(.n-btn) { font-size: 15.5px; font-weight: 600; text-decoration: none; color: var(--n-soft); white-space: nowrap; }
.n-nav a:hover, .n-hdr-act > a:not(.n-btn):hover { color: var(--n-ink); }
.n-hdr-act { display: flex; align-items: center; gap: 20px; }
.n-hdr-act .n-btn { min-height: 42px; padding: 0 18px; font-size: 15.5px; }
.n-hdr-act u { text-decoration-color: var(--n-orange); text-decoration-thickness: 2px; text-underline-offset: 4px; color: var(--n-ink); }
.n-menu { display: none; position: relative; }
.n-menu summary { list-style: none; cursor: pointer; display: grid; place-items: center; width: 46px; height: 46px; border: 1px solid var(--n-line); border-radius: 999px; background: var(--n-surface); }
.n-menu summary::-webkit-details-marker { display: none; }
.n-menu summary svg { width: 22px; height: 22px; stroke: currentColor; stroke-width: 2; fill: none; }
.n-menu-panel { position: absolute; right: 0; top: 56px; width: min(86vw, 320px); background: var(--n-surface); border-radius: 18px; padding: 10px; display: grid; gap: 2px; box-shadow: var(--n-float); }
.n-menu-panel a { padding: 13px 14px; border-radius: 10px; text-decoration: none; font-weight: 600; }
.n-menu-panel a:hover { background: var(--n-sunk); }
.n-menu-panel hr { border: 0; border-top: 1px solid var(--n-hair); margin: 6px 0; }
@media (max-width: 1080px) { .n-nav { display: none; } .n-hdr-act { margin-left: auto; } }
@media (max-width: 760px) { .n-hdr-act > a:not(.n-btn) { display: none; } .n-menu { display: block; } .n-hdr-act .n-btn { padding: 0 14px; } }
@media (max-width: 400px) { .n-hdr-act .n-btn { display: none; } }

/* ═════════ HERO ═════════ */
.n-hero { position: relative; padding-top: clamp(24px, 3.6vw, 52px); isolation: isolate; }
.n-hero-top { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 24px clamp(32px, 5vw, 72px); align-items: end; }
.n-site .n-kicker { display: inline-flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; color: var(--n-soft); text-decoration: none; padding: 7px 16px 7px 10px; background: var(--n-surface); border-radius: 999px; box-shadow: var(--n-card-shadow); margin-bottom: 26px; }
.n-site .n-kicker:hover { color: var(--n-ink); }
.n-kicker i { width: 9px; height: 9px; border-radius: 50%; background: var(--n-orange-fill); box-shadow: 0 0 0 4px color-mix(in srgb, var(--n-orange-fill) 18%, transparent); flex: none; }
.n-tagline { font: 700 15px/1.2 var(--n-text); letter-spacing: .08em; text-transform: uppercase; color: var(--n-orange); margin-bottom: 14px; }
.n-hero h1 { font-size: clamp(34px, calc(2.4vw + 28px), 64px); line-height: 1.02; }
.n-hero h1 span { display: block; }
.n-hero h1 .n-h1-2 { color: var(--n-orange); }
.n-hero-sub { font-size: clamp(17px, calc(.3vw + 15.5px), 19px); line-height: 1.55; color: var(--n-soft); max-width: 30em; }
.n-hero-sub b { color: var(--n-ink); font-weight: 700; }
.n-hero-go { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
.n-hero-facts { display: flex; flex-wrap: wrap; gap: 6px 22px; margin-top: 20px; font-size: 15px; color: var(--n-soft); }
.n-hero-facts li { display: inline-flex; align-items: center; gap: 8px; }
.n-hero-facts li::before { content: ""; width: 11px; height: 6px; border-left: 2px solid var(--n-orange); border-bottom: 2px solid var(--n-orange); rotate: -45deg; translate: 0 -2px; flex: none; }

/* the plinth: one pale panel the devices stand on, lit from above */
.n-plinth {
  position: relative; margin-top: clamp(32px, 3.6vw, 52px); border-radius: clamp(24px, 3vw, 40px);
  padding: clamp(28px, 5vw, 72px) clamp(14px, 4vw, 64px) 0;
  background:
    radial-gradient(120% 90% at 50% 0%, var(--n-surface) 0%, transparent 70%),
    linear-gradient(180deg, var(--n-tint), var(--n-sunk));
  box-shadow: inset 0 0 0 1px var(--n-hair);
}
.n-stage { position: relative; margin: 0 auto; width: min(1080px, 100%); padding-bottom: clamp(36px, 5vw, 72px); }
.n-laptop { position: relative; width: 84%; }
.n-lid { position: relative; background: black; border-radius: 16px 16px 4px 4px; padding: 1.4% 1.4% 2.2%; box-shadow: var(--n-float); }
.n-lid-screen { position: relative; overflow: hidden; border-radius: 4px; aspect-ratio: 16 / 10; background: var(--n-surface); }
.n-base { position: relative; height: clamp(9px, 1.3vw, 16px); margin: 0 -5%; border-radius: 0 0 18px 18px; background: linear-gradient(color-mix(in srgb, var(--n-surface) 80%, var(--n-ink)), color-mix(in srgb, var(--n-ink) 30%, var(--n-surface)) 70%, color-mix(in srgb, var(--n-ink) 55%, var(--n-surface))); box-shadow: 0 30px 50px -18px color-mix(in srgb, var(--n-ink) 40%, transparent); }
.n-base::after { content: ""; display: block; width: 13%; height: 40%; margin: 0 auto; border-radius: 0 0 8px 8px; background: color-mix(in srgb, var(--n-ink) 22%, transparent); }
.n-phone { position: relative; background: black; border-radius: clamp(26px, 4vw, 46px); padding: clamp(5px, .7vw, 9px); box-shadow: var(--n-float); }
.n-phone-screen { position: relative; overflow: hidden; border-radius: clamp(21px, 3.3vw, 38px); aspect-ratio: 1179 / 2556; background: var(--n-surface); }
.n-phone-screen img, .n-lid-screen img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.n-stage .n-phone { position: absolute; width: 25%; right: 0; bottom: 0; }
/* the live moment's layers (drawn over the screens, never into them) */
.n-lid-screen .n-frame, .n-phone-screen .n-frame { position: absolute; inset: 0; }
.n-frame { transition: opacity .7s ease; }
.n-frame.n-off { opacity: 0; }
.n-mark { position: absolute; border: 3px solid var(--n-orange-fill); border-radius: 8px; box-shadow: 0 0 0 5px color-mix(in srgb, var(--n-orange-fill) 22%, transparent); opacity: 0; transition: opacity .4s ease, top .9s cubic-bezier(.6,0,.2,1); pointer-events: none; }
.n-mark.n-show { opacity: 1; }
.n-tap { position: absolute; border-radius: 12px; pointer-events: none; opacity: 0; }
.n-tap.n-show { opacity: 1; box-shadow: 0 0 0 3px var(--n-orange-fill), 0 0 0 10px color-mix(in srgb, var(--n-orange-fill) 26%, transparent); }
.n-live { position: absolute; left: 4%; bottom: clamp(10px, 2.4vw, 30px); display: flex; align-items: center; gap: 14px; padding: 12px 14px 12px 18px; border-radius: 18px; background: color-mix(in srgb, var(--n-surface) 92%, transparent); backdrop-filter: blur(12px); box-shadow: var(--n-float); font-size: 15px; color: var(--n-soft); }
.n-live b { font-weight: 700; color: var(--n-ink); }
.n-live .n-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--flag); flex: none; box-shadow: 0 0 0 4px color-mix(in srgb, var(--flag) 18%, transparent); }
.n-live .n-big { font: 750 30px/1 var(--n-display); letter-spacing: -.03em; color: var(--n-orange); }
.n-replay { margin-left: 2px; background: var(--n-sunk); border: 0; border-radius: 999px; color: var(--n-ink); font: 600 14px/1 var(--n-text); cursor: pointer; padding: 0 14px; min-height: 40px; }
.n-replay:hover { background: color-mix(in srgb, var(--n-ink) 9%, var(--n-ground)); }
.n-caption { margin: 22px auto 0; max-width: 52em; text-align: center; font-size: 15px; color: var(--n-faint); }
.n-kicker-after { display: none; }
/* THE ONE PAGE-LOAD MOMENT: the words settle, the plinth rises in, and the live moment plays once. */
@media (prefers-reduced-motion: no-preference) {
  .n-hero-top { animation: n-rise .7s cubic-bezier(.2,.7,.2,1) both; }
  .n-plinth { animation: n-rise .9s .12s cubic-bezier(.2,.7,.2,1) both; }
  @keyframes n-rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
  .n-tap.n-show { animation: n-press .9s ease-out both; }
  @keyframes n-press { 0% { transform: scale(1.25); opacity: 0; } 35% { transform: scale(.96); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
}
@media (max-width: 1000px) {
  .n-hero-top { grid-template-columns: minmax(0, 1fr); }
}
/* A PHONE: the live moment (the card, the tap, the board re-ranking) must be in the first screen of
   393 x 852. So the pill moves below it, the sub keeps its first and last sentence, the facts go
   (each is said again further down), and the member's phone leads the stage, the laptop after it. */
@media (max-width: 760px) {
  .n-hdr-in { min-height: 58px; }
  .n-hdr .lockup svg { max-height: 28px; }
  .n-hero { padding-top: 18px; }
  .n-hero-top { gap: 10px; }
  .n-hero-top .n-kicker { display: none; }
  .n-kicker-after { display: block; margin-top: 20px; }
  .n-kicker-after .n-kicker { font-size: 14.5px; line-height: 1.35; margin: 0; }
  .n-tagline { font-size: 12.5px; margin-bottom: 8px; }
  .n-hero h1 { font-size: clamp(32px, 9.4vw, 38px); line-height: 1.05; letter-spacing: -.03em; }
  .n-hero-sub { font-size: 16px; line-height: 1.45; }
  .n-sub-more { display: none; }
  .n-hero-go { margin-top: 14px; gap: 10px; width: 100%; }
  .n-hero-go .n-btn { flex: 1 1 0; padding: 0 8px; font-size: 15.5px; min-height: 46px; white-space: nowrap; }
  .n-hero-facts { display: none; }
  .n-plinth { margin: 18px calc(-1 * var(--n-gut)) 0; border-radius: 0; padding: 18px var(--n-gut) 0; }
  .n-stage { display: flex; flex-direction: column; padding-bottom: 28px; }
  .n-stage .n-phone { order: 1; position: relative; right: auto; bottom: auto; width: min(64%, 270px); margin: 0 auto; }
  .n-live { order: 2; position: relative; left: auto; bottom: auto; margin: 18px 0 0; flex-wrap: wrap; }
  .n-laptop { order: 3; width: 100%; margin-top: 28px; }
  .n-caption { text-align: left; }
}

/* A laptop screen on a phone is drawn at a third of its size: crop it to the part that matters
   (a square of the capture, at --cx across) so its words are half as large again. Never redrawn. */
@media (max-width: 600px) {
  .n-crop .n-lid-screen { aspect-ratio: 1 / 1; }
  .n-crop .n-lid-screen img { object-position: var(--cx, 50%) top; }
}

/* ═════════ SECTIONS ═════════ */
.n-sec { padding-top: var(--n-sec); }
.n-sec-head { display: grid; gap: 16px; max-width: 860px; }
.n-sec-head.n-center { margin: 0 auto; text-align: center; justify-items: center; }
/* A band: the same paper, one step whiter, edge to edge. */
.n-board-sec { margin-top: var(--n-sec); background: var(--n-surface); padding: var(--n-sec) 0; border-top: 1px solid var(--n-hair); border-bottom: 1px solid var(--n-hair); }
.n-board-sec + .n-sec { padding-top: var(--n-sec); }

/* ── 1. THE BENTO: the committee's desk, in real crops at unequal sizes ── */
.n-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: clamp(14px, 1.6vw, 22px); margin-top: clamp(36px, 4vw, 56px); }
.n-tile { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 22px; padding: clamp(22px, 2.4vw, 34px); border-radius: var(--n-r); background: var(--n-surface); box-shadow: var(--n-card-shadow); }
.n-tile-say { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 14px; align-items: baseline; max-width: 34em; }
.n-tile-say .n-t { grid-row: span 2; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--n-tint); color: var(--n-orange); font: 750 15px/1 var(--n-display); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--n-orange-fill) 22%, transparent); }
.n-tile-say b { font: 700 clamp(19px, calc(.4vw + 15px), 22px)/1.25 var(--n-display); letter-spacing: -.015em; }
.n-tile-say p { color: var(--n-soft); font-size: 16px; }
/* a window onto a capture: the screen is cropped and shown nearer its own size, never redrawn */
.n-win { position: relative; overflow: hidden; margin-top: auto; border-radius: 14px; background: var(--n-surface); box-shadow: var(--n-float); aspect-ratio: var(--ar, 16 / 10); }
/* --z is how many windows wide the capture is drawn; --fx and --fy are the fraction of the capture
   left above and to the left of the window (a translate in the image's own percentages). */
.n-site .n-win img { position: absolute; left: 0; top: 0; max-width: none; width: calc(var(--z, 1) * 100%); height: auto; transform: translate(calc(-1 * var(--fx, 0%)), calc(-1 * var(--fy, 0%))); }
.n-win-needs { --z: 1.3; --fx: 19%; --fy: 0%; }
.n-win-pace { --z: 1.65; --fx: 19%; --fy: 51.5%; }
.n-win-flights { --z: 1.25; --fx: 19%; --fy: 2%; }
.n-tile-bleed .n-win { margin-right: calc(-1 * clamp(22px, 2.4vw, 34px)); margin-bottom: calc(-1 * clamp(22px, 2.4vw, 34px)); border-radius: 14px 0 0 0; }
.n-tile-xl { grid-column: span 8; grid-row: span 2; background: linear-gradient(180deg, var(--n-surface) 40%, var(--n-tint)); }
.n-tile-xl .n-win { --ar: 16 / 10.4; }
.n-tile-tall { grid-column: span 4; grid-row: span 2; background: linear-gradient(180deg, var(--n-surface), var(--n-sunk)); }
.n-tile-tall .n-tile-phone { margin-top: auto; margin-bottom: calc(-1 * clamp(22px, 2.4vw, 34px)); padding: 0 6%; height: clamp(300px, 30vw, 420px); overflow: hidden; }
.n-tile-tall .n-phone { border-bottom-left-radius: 0; border-bottom-right-radius: 0; padding-bottom: 0; }
.n-tile-tall .n-phone-screen { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.n-tile-pace { grid-column: span 5; }
.n-tile-pace .n-win { --ar: 16 / 8; }
.n-tile-128 { grid-column: span 7; background: var(--n-ink); color: var(--n-surface); box-shadow: var(--n-float); }
.n-tile-128 .n-h3 { color: var(--n-surface); }
.n-tile-128 p { color: color-mix(in srgb, var(--n-surface) 82%, var(--n-ink)); font-size: 16px; margin-top: 10px; }
.n-tile-128 .n-num-big { font: 760 clamp(64px, 7vw, 96px)/.9 var(--n-display); letter-spacing: -.05em; color: color-mix(in srgb, var(--n-orange-fill) 50%, var(--n-surface)); }
.n-tile-128 .n-128-say { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 22px; align-items: end; }
.n-tile-128 .n-win { --ar: 16 / 8; box-shadow: 0 0 0 1px color-mix(in srgb, var(--n-surface) 14%, transparent), 0 30px 60px -20px black; }
/* On a wide screen a tile's window fills what its row leaves; the pace window holds the capture by
   its foot, so the table at the bottom of the dashboard is what shows. */
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

/* ── 2. THE DAY: a timeline you can press, and the phone it turns ── */
.n-day { margin-top: clamp(36px, 4vw, 56px); display: grid; grid-template-columns: minmax(0, 1fr) minmax(250px, 330px); gap: clamp(28px, 5vw, 80px); align-items: start; }
.n-slats { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; padding: 6px; background: var(--n-sunk); border-radius: 22px; box-shadow: inset 0 0 0 1px var(--n-hair); }
.n-slat {
  display: grid; align-content: space-between; gap: 14px; min-height: 118px; padding: 14px 12px; border-radius: 16px; border: 0; cursor: pointer; text-align: left;
  background: transparent; color: var(--n-ink); font: inherit; transition: background-color .2s, box-shadow .2s;
}
.n-slat .n-when { font: 720 clamp(20px, 1.7vw, 24px)/1 var(--n-display); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.n-slat .n-day-name { font: 600 13px/1.1 var(--n-text); color: var(--n-soft); display: block; margin-bottom: 5px; }
.n-slat .n-what { font-size: 14.5px; font-weight: 700; line-height: 1.2; color: var(--n-soft); }
.n-slat:hover { background: color-mix(in srgb, var(--n-surface) 60%, transparent); }
.n-slat[aria-selected="true"] { background: var(--n-surface); box-shadow: var(--n-card-shadow); }
.n-slat[aria-selected="true"] .n-what { color: var(--n-orange); }
.n-day-say { margin-top: clamp(26px, 3vw, 40px); min-height: 180px; }
.n-day-say .n-who { font: 700 13px/1.2 var(--n-text); letter-spacing: .08em; text-transform: uppercase; color: var(--n-orange); }
.n-day-say h3 { font: 720 clamp(26px, calc(1vw + 20px), 36px)/1.1 var(--n-display); letter-spacing: -.028em; margin: 10px 0 12px; }
.n-day-say p { font-size: 17px; max-width: 34em; color: var(--n-soft); }
.n-day-pane[hidden] { display: none; }
.n-day-phone .n-frame { position: absolute; inset: 0; transition: opacity .35s ease; }
.n-day-steps { display: none; }
@media (max-width: 900px) {
  .n-day { grid-template-columns: minmax(0, 1fr); }
  .n-slats { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
  .n-slats::-webkit-scrollbar { display: none; }
  .n-slat { flex: 0 0 116px; min-height: 104px; scroll-snap-align: start; }
  .n-day-phone { width: min(70%, 300px); margin: 0 auto; }
  .n-day-say { min-height: 0; }
}

/* ── 3. the whole club watches ── */
.n-watch { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 6fr); gap: clamp(28px, 5vw, 80px); align-items: end; }
.n-watch-big { font: 720 clamp(30px, calc(1.6vw + 22px), 46px)/1.08 var(--n-display); letter-spacing: -.032em; text-wrap: balance; }
.n-watch-big .n-t { display: block; color: var(--n-orange); font-variant-numeric: tabular-nums; }
.n-watch-row { display: flex; gap: clamp(14px, 2.4vw, 36px); align-items: flex-end; justify-content: center; margin-top: clamp(48px, 6vw, 84px); padding: clamp(36px, 5vw, 64px) clamp(14px, 4vw, 64px) 0; border-radius: clamp(24px, 3vw, 40px); background: linear-gradient(180deg, var(--n-sunk), var(--n-tint)); box-shadow: inset 0 0 0 1px var(--n-hair); }
.n-watch-row figure { flex: 0 1 300px; min-width: 0; }
.n-watch-row figure:nth-child(2) { margin-bottom: clamp(30px, 4vw, 60px); }
.n-watch-row figcaption { margin: 16px 0 clamp(24px, 3vw, 40px); font-size: 15px; color: var(--n-soft); }
.n-watch-row figcaption b { display: block; color: var(--n-ink); font-size: 16px; }
.n-try { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 20px; align-items: center; margin-top: 28px; padding: 18px; border-radius: 22px; background: var(--n-surface); box-shadow: var(--n-card-shadow); }
.n-try svg { width: 108px; height: 108px; border-radius: 10px; }
.n-try .n-qr-ground { fill: var(--n-surface); }
.n-try .n-qr-ink { fill: var(--n-ink); }
.n-try p { font-size: 15.5px; color: var(--n-soft); }
.n-try p b { display: block; color: var(--n-ink); font-size: 17px; }
.n-doors { display: flex; flex-wrap: wrap; gap: 10px 22px; margin-top: 20px; }
@media (max-width: 900px) {
  .n-watch { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 600px) {
  .n-watch-row { justify-content: flex-start; overflow-x: auto; scroll-snap-type: x mandatory; margin: 40px calc(-1 * var(--n-gut)) 0; border-radius: 0; padding: 30px var(--n-gut) 0; scrollbar-width: none; }
  .n-watch-row::-webkit-scrollbar { display: none; }
  .n-watch-row figure { flex: 0 0 min(62vw, 250px); scroll-snap-align: center; }
  .n-watch-row figure:nth-child(2) { margin-bottom: 0; }
}
@media (max-width: 640px) { .n-try { grid-template-columns: minmax(0, 1fr); } .n-try svg { display: none; } }

/* ── 4. any format, any field ── */
.n-formats { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: clamp(28px, 5vw, 72px); align-items: start; margin-top: clamp(32px, 4vw, 52px); }
.n-format-wall { display: flex; flex-wrap: wrap; gap: 10px; }
.n-format-wall li { padding: 10px 18px; border-radius: 999px; background: var(--n-ground); box-shadow: inset 0 0 0 1px var(--n-hair); font: 650 clamp(16px, 1.3vw, 18px)/1.2 var(--n-display); letter-spacing: -.01em; }
.n-format-wall li:nth-child(3n+1) { background: var(--n-tint); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--n-orange-fill) 20%, transparent); }
.n-runs { margin-top: 24px; display: flex; flex-wrap: wrap; gap: 8px 18px; }
.n-runs li { font-weight: 700; font-size: 15.5px; display: inline-flex; align-items: center; gap: 8px; }
.n-runs li::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--n-orange-fill); flex: none; }
@media (max-width: 900px) { .n-formats { grid-template-columns: minmax(0, 1fr); } }

/* ── 5. money ── */
.n-money { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 5fr); gap: clamp(28px, 5vw, 80px); align-items: center; }
.n-money-pic { display: grid; justify-items: center; padding: clamp(32px, 5vw, 64px) 0; border-radius: clamp(24px, 3vw, 40px); background: radial-gradient(80% 70% at 50% 40%, var(--n-surface), transparent 75%), linear-gradient(180deg, var(--n-tint), var(--n-sunk)); box-shadow: inset 0 0 0 1px var(--n-hair); }
.n-money-pic .n-phone { width: min(310px, 72%); }
.n-coins { display: flex; gap: 6px; margin-top: 28px; flex-wrap: wrap; padding: 6px; background: var(--n-sunk); border-radius: 22px; box-shadow: inset 0 0 0 1px var(--n-hair); width: fit-content; max-width: 100%; }
.n-coin { min-width: 60px; min-height: 60px; padding: 6px 14px; display: grid; justify-items: center; align-content: center; gap: 3px; border-radius: 16px; border: 0; background: transparent; color: var(--n-ink); cursor: pointer; font: inherit; }
.n-coin b { font: 720 22px/1 var(--n-display); }
.n-coin span { font-size: 12.5px; color: var(--n-soft); }
.n-coin:hover { background: color-mix(in srgb, var(--n-surface) 60%, transparent); }
.n-coin[aria-selected="true"] { background: var(--n-surface); box-shadow: var(--n-card-shadow); }
.n-coin[aria-selected="true"] b { color: var(--n-orange); }
.n-money-say { margin-top: 16px; font-size: 16px; color: var(--n-soft); min-height: 1.6em; }
.n-also { margin-top: 24px; font-size: 15px; color: var(--n-faint); }
.n-money-pic .n-frame { position: absolute; inset: 0; transition: opacity .3s ease; }
.n-never { margin-top: 26px; padding: 18px 20px; background: var(--n-surface); border-radius: 18px; box-shadow: var(--n-card-shadow); font-size: 16.5px; color: var(--n-soft); }
.n-never b { color: var(--n-ink); }
@media (max-width: 900px) { .n-money { grid-template-columns: minmax(0, 1fr); } }

/* ── 6. colours ── */
.n-themes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: clamp(14px, 2vw, 30px); margin-top: clamp(36px, 4vw, 56px); align-items: end; }
.n-themes figure:nth-child(even) { margin-bottom: clamp(20px, 3vw, 44px); }
.n-themes figcaption { margin-top: 14px; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; color: var(--n-soft); }
.n-themes figcaption i { width: 12px; height: 12px; border-radius: 50%; flex: none; }
@media (max-width: 900px) {
  .n-themes { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; margin: 36px calc(-1 * var(--n-gut)) 0; padding: 0 var(--n-gut) 30px; scrollbar-width: none; align-items: flex-end; }
  .n-themes::-webkit-scrollbar { display: none; }
  .n-themes figure { flex: 0 0 min(56vw, 230px); scroll-snap-align: start; }
}

/* ── 7. who it is for ── */
.n-for { margin-top: clamp(32px, 4vw, 52px); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(14px, 1.6vw, 22px); }
.n-for a { display: grid; align-content: start; gap: 14px; height: 100%; padding: clamp(22px, 2.4vw, 32px); border-radius: var(--n-r); background: var(--n-surface); box-shadow: var(--n-card-shadow); text-decoration: none; transition: box-shadow .2s, transform .2s; }
.n-for .n-who { font: 700 13px/1.2 var(--n-text); letter-spacing: .08em; text-transform: uppercase; color: var(--n-orange); }
.n-for p { color: var(--n-soft); font-size: 16px; }
.n-for p b { display: block; color: var(--n-ink); font: 720 22px/1.2 var(--n-display); letter-spacing: -.02em; margin-bottom: 8px; }
.n-for .n-go { margin-top: 6px; font-weight: 700; text-decoration: underline; text-decoration-color: var(--n-orange); text-decoration-thickness: 2px; text-underline-offset: 5px; }
.n-for a:hover { box-shadow: var(--n-float); }
@media (max-width: 860px) { .n-for { grid-template-columns: minmax(0, 1fr); } }

/* ── 8. pricing ── */
.n-plans { margin-top: clamp(36px, 4vw, 56px); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(14px, 1.6vw, 22px); align-items: stretch; }
.n-plan { padding: clamp(24px, 2.6vw, 34px); display: grid; align-content: start; gap: 14px; border-radius: var(--n-r); background: var(--n-ground); box-shadow: inset 0 0 0 1px var(--n-hair); }
.n-plan .n-tag { font-size: 14.5px; font-weight: 700; color: var(--n-soft); }
.n-plan h3 { font: 720 26px/1.1 var(--n-display); letter-spacing: -.02em; }
.n-price { font: 740 clamp(44px, 4.4vw, 58px)/.95 var(--n-display); letter-spacing: -.04em; font-variant-numeric: tabular-nums; display: flex; align-items: baseline; gap: 8px; }
.n-price small { font: 600 15px/1.2 var(--n-text); letter-spacing: 0; color: var(--n-soft); }
.n-plan .n-year { font-size: 14.5px; color: var(--n-soft); min-height: 1.5em; }
.n-plan ul { display: grid; gap: 8px; font-size: 15.5px; padding-top: 16px; border-top: 1px solid var(--n-hair); }
.n-plan li { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 8px; }
.n-plan li::before { content: ""; width: 11px; height: 6px; margin-top: 8px; border-left: 2px solid var(--n-orange); border-bottom: 2px solid var(--n-orange); rotate: -45deg; }
.n-plan .n-term { font-size: 13.5px; color: var(--n-soft); }
.n-plan .n-btn { width: 100%; }
.n-plan-pick { background: var(--n-ink); color: var(--n-surface); box-shadow: var(--n-float); }
.n-plan-pick .n-tag, .n-plan-pick .n-price small, .n-plan-pick .n-year { color: color-mix(in srgb, var(--n-surface) 80%, var(--n-ink)); }
.n-plan-pick ul { border-top-color: color-mix(in srgb, var(--n-surface) 16%, transparent); }
.n-plan-pick li::before { border-color: var(--n-surface); }
.n-site .n-plan-pick .n-btn-go { background: var(--n-surface); color: var(--n-ink); }
.n-site .n-plan-pick .n-btn-go:hover { background: var(--n-ground); }
.n-small { margin-top: 20px; font-size: 14.5px; color: var(--n-soft); max-width: 72em; }
.n-small a { color: inherit; }
.n-vs { margin-top: clamp(44px, 5vw, 72px); display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: clamp(28px, 4vw, 64px); align-items: center; padding: clamp(24px, 3vw, 40px); border-radius: var(--n-r); background: var(--n-ground); box-shadow: inset 0 0 0 1px var(--n-hair); }
.n-vs p { margin-top: 10px; color: var(--n-soft); font-size: 16px; }
.n-bars { display: grid; gap: 12px; }
.n-bars li { display: grid; grid-template-columns: 116px minmax(0, 1fr) 92px; gap: 14px; align-items: center; font-weight: 700; font-size: 15.5px; }
.n-bars .n-track { height: 30px; background: color-mix(in srgb, var(--n-ink) 6%, var(--n-surface)); border-radius: 999px; overflow: hidden; }
.n-bars .n-fill { display: block; height: 100%; border-radius: 999px; background: color-mix(in srgb, var(--n-ink) 34%, var(--n-surface)); }
.n-bars .n-us .n-fill { background: var(--n-orange-fill); }
.n-bars .n-amt { text-align: right; font-variant-numeric: tabular-nums; }
.n-saved { display: flex; gap: 28px; flex-wrap: wrap; margin-top: 10px; font-size: 15px; color: var(--n-soft); }
.n-saved b { font: 740 30px/1.05 var(--n-display); letter-spacing: -.03em; color: var(--n-orange); display: block; }
.n-more-links { display: flex; flex-wrap: wrap; gap: 12px 26px; margin-top: 28px; }
@media (max-width: 900px) {
  .n-plans { grid-template-columns: minmax(0, 1fr); }
  .n-vs { grid-template-columns: minmax(0, 1fr); }
  .n-bars li { grid-template-columns: 90px minmax(0, 1fr) 78px; gap: 10px; }
}

/* ── 9. questions ── */
.n-qa { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: clamp(28px, 5vw, 80px); margin-top: clamp(32px, 4vw, 52px); }
.n-every { display: grid; gap: 10px; margin-top: 20px; font-size: 16px; }
.n-every li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 8px; color: var(--n-soft); }
.n-every li::before { content: ""; width: 11px; height: 6px; margin-top: 9px; border-left: 2px solid var(--n-orange); border-bottom: 2px solid var(--n-orange); rotate: -45deg; }
.n-answers { display: grid; gap: 12px; }
.n-answer { padding: 22px 24px; border-radius: 20px; background: var(--n-surface); box-shadow: var(--n-card-shadow); display: grid; gap: 8px; }
.n-answer h3 { font: 700 20px/1.25 var(--n-display); letter-spacing: -.015em; }
.n-answer p { color: var(--n-soft); font-size: 16px; }
@media (max-width: 900px) { .n-qa { grid-template-columns: minmax(0, 1fr); } }

/* ── 10. follow along ── */
.n-follow { margin-top: clamp(32px, 4vw, 52px); display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: clamp(12px, 1.4vw, 18px); }
.n-follow a { display: grid; align-content: start; gap: 10px; padding: 24px; border-radius: 22px; background: var(--n-surface); box-shadow: var(--n-card-shadow); text-decoration: none; height: 100%; transition: box-shadow .2s; }
.n-follow svg { width: 26px; height: 26px; fill: currentColor; }
.n-follow .n-net { font: 720 20px/1.1 var(--n-display); letter-spacing: -.015em; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.n-follow .n-handle { font-size: 14.5px; color: var(--n-faint); }
.n-follow p { font-size: 15.5px; color: var(--n-soft); }
.n-follow a:hover { box-shadow: var(--n-float); }
.n-follow a:hover .n-net { color: var(--n-orange); }
@media (max-width: 900px) { .n-follow { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .n-follow { grid-template-columns: minmax(0, 1fr); } }

/* ── 11. the close ── */
.n-close { padding: var(--n-sec) 0; }
.n-close-grid { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: clamp(28px, 5vw, 72px); align-items: start; padding: clamp(28px, 4.4vw, 64px); border-radius: clamp(28px, 3vw, 44px); background: radial-gradient(90% 80% at 0% 0%, var(--n-surface), transparent 70%), linear-gradient(160deg, var(--n-tint), var(--n-sunk)); box-shadow: inset 0 0 0 1px var(--n-hair); }
.n-wrap.n-close-grid { max-width: calc(var(--n-wrap) - 2 * var(--n-gut)); }
.n-close .n-display { font-size: clamp(32px, calc(2vw + 24px), 54px); }
.n-close .n-display span { display: block; }
.n-close .n-display span + span { color: var(--n-orange); }
.n-close .n-lead { margin-top: 16px; }
.n-close-auth { scroll-margin-top: 90px; }
.n-stores { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
.n-site .n-store { display: inline-flex; align-items: center; gap: 10px; padding: 9px 18px 9px 14px; border-radius: 14px; text-decoration: none; min-height: 52px; background: var(--n-ink); color: var(--n-surface); }
.n-store small { display: block; font-size: 12px; opacity: .86; }
.n-store b { display: block; font-size: 16.5px; line-height: 1.1; }
.n-store svg { width: 22px; height: 22px; fill: currentColor; }
.n-stores-note { margin-top: 14px; font-size: 14.5px; color: var(--n-soft); max-width: 36em; }
.n-site .authpanel { max-width: none; border-radius: 22px; box-shadow: var(--n-float); background: var(--n-surface); }
@media (max-width: 900px) { .n-close-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 600px) { .n-wrap.n-close-grid { max-width: none; border-radius: 0; margin: 0; } }

/* ── footer ── */
.n-ftr { padding: 48px 0 40px; border-top: 1px solid var(--n-hair); }
.n-ftr-top { display: flex; flex-wrap: wrap; gap: 24px 48px; align-items: center; justify-content: space-between; }
.n-ftr .lockup { text-decoration: none; display: inline-flex; }
.n-ftr nav ul { display: flex; flex-wrap: wrap; gap: 10px 24px; }
.n-ftr nav a { text-decoration: none; font-weight: 600; font-size: 15px; color: var(--n-soft); }
.n-ftr nav a:hover { color: var(--n-ink); }
.n-socials { display: flex; gap: 8px; }
.n-socials a { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--n-surface); box-shadow: var(--n-card-shadow); color: var(--n-soft); }
.n-socials a:hover { color: var(--n-surface); background: var(--n-ink); }
.n-socials svg { width: 19px; height: 19px; fill: currentColor; }
.n-ftr-base { margin-top: 30px; padding-top: 22px; border-top: 1px solid var(--n-hair); display: flex; flex-wrap: wrap; gap: 10px 24px; font-size: 14px; color: var(--n-faint); }
.n-ftr-base a { color: var(--n-soft); }
.n-ftr-base button { font: inherit; color: var(--n-soft); }
.n-site .n-ftr-base .ed-note { margin: 0; padding: 0; }
`;
