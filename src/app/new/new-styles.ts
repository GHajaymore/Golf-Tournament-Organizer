/**
 * THE SITE REHAUL'S OWN STYLESHEET (2026-11-01) — `/new` only, a preview beside today's `/`.
 *
 * The idea is the HAND-HUNG LEADERBOARD by the 18th green: tall boards, slotted letters, the
 * numbers that matter in colour. Its type is a condensed grotesque (Archivo at 62–75% width),
 * its surfaces are the brand's midnight navy and a cream "board", its one colour is the logo's
 * orange. Text is Atkinson Hyperlegible Next, drawn for low vision: the page is read by a club
 * secretary of 50+ at a desk and a captain on a phone in sun.
 *
 * Scoped under `.n-site`, every class prefixed `n-`. Colours are the landing palette's tokens
 * (`landingTokens`, written by LANDING_CSS on `.thq`), mixed, never typed as a hex. The fonts are
 * served from this origin (`public/new/fonts`, OFL-1.1), never fetched from another.
 *
 * Screens meant to be READ are flat, upright and still; only their frames and the light around them
 * are drawn. Every animation is inside `prefers-reduced-motion: no-preference`.
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
   come from Archivo at full width instead: declared last, so for 0-9 it is asked first. */
@font-face {
  font-family: "Atkinson Next"; font-style: normal; font-display: swap; font-weight: 200 800;
  src: url(/new/fonts/archivo-latin-wdth-normal.woff2) format("woff2-variations");
  unicode-range: U+0030-0039;
}

.n-site {
  --n-night: var(--ground);
  --n-night-2: color-mix(in srgb, var(--ground-2) 60%, var(--ground));
  --n-night-3: var(--ground-2);
  --n-cream: var(--ink);
  --n-cream-soft: var(--ink-soft);
  --n-faint: var(--ink-faint);
  --n-flag: var(--brass);
  --n-line: var(--line-2);
  --n-hair: var(--line);
  /* the cream board, and what is written on it */
  --n-board: var(--ink);
  --n-board-2: color-mix(in srgb, var(--ink) 88%, var(--ground));
  --n-board-ink: var(--ground);
  --n-board-soft: color-mix(in srgb, var(--ground) 76%, var(--ink));
  --n-board-rule: color-mix(in srgb, var(--ground) 16%, transparent);
  --n-burnt: var(--paper-accent);
  --n-display: "Archivo Board", "Arial Narrow", "Roboto Condensed", system-ui, sans-serif;
  --n-text: "Atkinson Next", system-ui, -apple-system, "Segoe UI", sans-serif;
  --n-wrap: 1280px;
  --n-gut: clamp(20px, 4vw, 56px);
  --n-sec: clamp(88px, 11vw, 168px);
  background: var(--n-night);
  color: var(--n-cream);
  font: 400 18px/1.6 var(--n-text);
  overflow-x: clip;
}
.n-site *, .n-site *::before, .n-site *::after { box-sizing: border-box; }
.n-site :where(h1, h2, h3, h4, p, ul, ol, figure, dl, dd, blockquote) { margin: 0; padding: 0; }
.n-site :where(ul, ol) { list-style: none; }
.n-site a { color: inherit; }
.n-site img { display: block; max-width: 100%; height: auto; }
.n-site :focus-visible { outline: 3px solid var(--n-flag); outline-offset: 3px; border-radius: 4px; }
.n-site .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; margin: -1px; padding: 0; border: 0; }
.n-wrap { max-width: var(--n-wrap); margin: 0 auto; padding-left: max(var(--n-gut), env(safe-area-inset-left)); padding-right: max(var(--n-gut), env(safe-area-inset-right)); }
.n-skip { position: absolute; left: 12px; top: -60px; z-index: 50; background: var(--n-flag); color: var(--n-night); padding: 10px 16px; border-radius: 6px; font-weight: 700; }
.n-skip:focus { top: 12px; }

/* ── type ── */
.n-display, .n-h2 {
  font-family: var(--n-display); font-stretch: 62%; font-weight: 800; text-transform: uppercase;
  line-height: .86; letter-spacing: -.005em; text-wrap: balance;
}
.n-h2 { font-size: clamp(46px, 7vw, 104px); }
.n-h3 { font: 700 clamp(24px, 2.3vw, 32px)/1.1 var(--n-display); font-stretch: 75%; letter-spacing: 0; text-wrap: balance; }
.n-lead { font-size: clamp(19px, 1.55vw, 22px); line-height: 1.5; color: var(--n-cream-soft); max-width: 36em; text-wrap: pretty; }
.n-site p { text-wrap: pretty; }
.n-num { font-variant-numeric: tabular-nums; }

/* ── buttons ── */
.n-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 54px;
  padding: 0 26px; border-radius: 6px; font: 700 18px/1 var(--n-text); text-decoration: none;
  border: 2px solid transparent; transition: background-color .15s, color .15s, border-color .15s;
}
.n-btn-go { background: var(--n-flag); color: var(--n-night); }
.n-btn-go:hover { background: var(--n-cream); }
.n-btn-line { border-color: color-mix(in srgb, var(--n-cream) 55%, transparent); color: var(--n-cream); }
.n-btn-line:hover { border-color: var(--n-cream); background: color-mix(in srgb, var(--n-cream) 8%, transparent); }
.n-on-board .n-btn-line { border-color: var(--n-board-ink); color: var(--n-board-ink); }
.n-link { color: var(--n-cream); text-decoration: underline; text-decoration-color: var(--n-flag); text-decoration-thickness: 2px; text-underline-offset: 5px; font-weight: 700; }
.n-link:hover { color: var(--n-flag); }

/* ── header ── */
.n-hdr { position: sticky; top: 0; z-index: 40; background: color-mix(in srgb, var(--n-night) 88%, transparent); backdrop-filter: blur(14px) saturate(1.2); border-bottom: 1px solid var(--n-hair); }
.n-hdr-in { display: flex; align-items: center; gap: 28px; min-height: 72px; }
.n-hdr .lockup { display: inline-flex; text-decoration: none; }
.n-nav { display: flex; gap: 26px; margin-right: auto; }
.n-nav a, .n-hdr-act > a:not(.n-btn) { font-size: 16px; font-weight: 600; text-decoration: none; color: var(--n-cream-soft); }
.n-nav a:hover, .n-hdr-act > a:not(.n-btn):hover { color: var(--n-cream); }
.n-hdr-act { display: flex; align-items: center; gap: 22px; }
.n-hdr-act .n-btn { min-height: 44px; padding: 0 18px; font-size: 16px; }
.n-hdr-act u { text-decoration-color: var(--n-flag); text-decoration-thickness: 2px; text-underline-offset: 4px; color: var(--n-cream); }
.n-menu { display: none; position: relative; }
.n-menu summary { list-style: none; cursor: pointer; display: grid; place-items: center; width: 48px; height: 48px; border: 1px solid var(--n-line); border-radius: 6px; }
.n-menu summary::-webkit-details-marker { display: none; }
.n-menu summary svg { width: 22px; height: 22px; stroke: currentColor; stroke-width: 2; fill: none; }
.n-menu-panel { position: absolute; right: 0; top: 58px; width: min(86vw, 320px); background: var(--n-night-3); border: 1px solid var(--n-line); border-radius: 8px; padding: 10px; display: grid; gap: 2px; box-shadow: 0 30px 60px -20px black; }
.n-menu-panel a { padding: 14px 14px; border-radius: 6px; text-decoration: none; font-weight: 600; }
.n-menu-panel a:hover { background: color-mix(in srgb, var(--n-cream) 8%, transparent); }
.n-menu-panel hr { border: 0; border-top: 1px solid var(--n-line); margin: 6px 0; }
@media (max-width: 1080px) { .n-nav { display: none; } .n-hdr-act { margin-left: auto; } }
@media (max-width: 760px) { .n-hdr-act > a:not(.n-btn) { display: none; } .n-menu { display: block; } .n-hdr-act .n-btn { padding: 0 14px; } }
@media (max-width: 400px) { .n-hdr-act .n-btn { display: none; } }

/* ═════════ HERO ═════════ */
.n-hero { position: relative; padding-top: clamp(32px, 4.4vw, 64px); isolation: isolate; }
.n-hero::before {
  /* one light, low behind the stage, like floodlights on a practice green at dusk */
  content: ""; position: absolute; z-index: -1; left: 50%; top: 46%; width: min(1500px, 170vw); aspect-ratio: 2.1; translate: -50% 0;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--n-flag) 26%, transparent), color-mix(in srgb, var(--n-night-3) 70%, transparent) 46%, transparent 72%);
  pointer-events: none;
}
.n-hero-top { text-align: center; display: grid; justify-items: center; }
.n-kicker { display: inline-flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 600; color: var(--n-cream-soft); text-decoration: none; padding: 8px 16px 8px 10px; border: 1px solid var(--n-line); border-radius: 999px; margin-bottom: clamp(22px, 3vw, 34px); }
.n-kicker:hover { border-color: var(--n-cream); color: var(--n-cream); }
.n-kicker i { width: 10px; height: 10px; border-radius: 50%; background: var(--n-flag); box-shadow: 0 0 0 4px color-mix(in srgb, var(--n-flag) 25%, transparent); }
.n-hero h1 { font-size: clamp(52px, 7vw, 112px); }
.n-hero h1 span { display: block; }
.n-hero h1 .n-h1-2 { color: var(--n-flag); }
.n-hero-sub { margin-top: clamp(22px, 2.6vw, 34px); max-width: 33em; font-size: clamp(19px, 1.7vw, 24px); line-height: 1.45; color: var(--n-cream-soft); }
.n-hero-sub b { color: var(--n-cream); font-weight: 700; }
.n-hero-go { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; margin-top: clamp(26px, 3vw, 38px); }
.n-hero-facts { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 26px; margin-top: 22px; font-size: 16px; color: var(--n-cream-soft); }
.n-hero-facts li { display: inline-flex; align-items: center; gap: 8px; }
.n-hero-facts li::before { content: ""; width: 14px; height: 8px; border-left: 2.5px solid var(--n-flag); border-bottom: 2.5px solid var(--n-flag); rotate: -45deg; translate: 0 -2px; }

/* the stage: the committee's laptop and a member's phone, one round */
.n-stage { position: relative; margin: clamp(40px, 4.4vw, 64px) auto 0; width: min(1180px, 100%); padding: 0 var(--n-gut); }
.n-laptop { position: relative; width: 86%; }
.n-lid { position: relative; background: black; border-radius: 18px 18px 6px 6px; padding: 1.6% 1.6% 2.4%; box-shadow: 0 0 0 1px color-mix(in srgb, var(--n-cream) 18%, transparent), 0 60px 120px -40px black, 0 30px 60px -30px color-mix(in srgb, var(--n-flag) 30%, transparent); }
.n-lid-screen { position: relative; overflow: hidden; border-radius: 4px; aspect-ratio: 16 / 10; background: var(--n-board); }
.n-base { height: clamp(10px, 1.4vw, 18px); margin: 0 -5.5%; border-radius: 0 0 22px 22px; background: linear-gradient(color-mix(in srgb, var(--n-cream) 40%, var(--n-night-3)), var(--n-night-3) 60%, black); box-shadow: 0 30px 50px -20px black; }
.n-base::after { content: ""; display: block; width: 14%; height: 40%; margin: 0 auto; border-radius: 0 0 10px 10px; background: color-mix(in srgb, black 35%, transparent); }
.n-phone { position: relative; background: black; border-radius: clamp(28px, 4.2vw, 50px); padding: clamp(6px, .8vw, 10px); box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--n-cream) 30%, transparent), 0 50px 90px -30px black; }
.n-phone-screen { position: relative; overflow: hidden; border-radius: clamp(22px, 3.5vw, 41px); aspect-ratio: 1179 / 2556; background: var(--n-board); }
.n-phone-screen img, .n-lid-screen img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.n-stage .n-phone { position: absolute; width: 27%; right: var(--n-gut); bottom: -7%; }
/* the live moment's layers (drawn over the screens, never into them) */
.n-lid-screen .n-frame, .n-phone-screen .n-frame { position: absolute; inset: 0; }
.n-frame { transition: opacity .7s ease; }
.n-frame.n-off { opacity: 0; }
.n-mark { position: absolute; border: 3px solid var(--n-flag); border-radius: 8px; box-shadow: 0 0 0 6px color-mix(in srgb, var(--n-flag) 22%, transparent); opacity: 0; transition: opacity .4s ease, top .9s cubic-bezier(.6,0,.2,1); pointer-events: none; }
.n-mark.n-show { opacity: 1; }
.n-tap { position: absolute; border-radius: 12px; pointer-events: none; opacity: 0; }
.n-tap.n-show { opacity: 1; box-shadow: 0 0 0 3px var(--n-flag), 0 0 0 10px color-mix(in srgb, var(--n-flag) 28%, transparent); }
.n-live { position: absolute; left: var(--n-gut); bottom: -3.5%; display: flex; align-items: center; gap: 14px; padding: 12px 18px; border-radius: 10px; background: color-mix(in srgb, var(--n-night-3) 92%, transparent); border: 1px solid var(--n-line); backdrop-filter: blur(10px); box-shadow: 0 20px 40px -16px black; font-size: 16px; }
.n-live b { font-weight: 700; color: var(--n-cream); }
.n-live .n-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--n-flag); flex: none; }
.n-live .n-big { font: 800 30px/1 var(--n-display); font-stretch: 62%; color: var(--n-flag); }
.n-replay { margin-left: 4px; background: none; border: 0; color: var(--n-cream-soft); font: 600 15px/1 var(--n-text); text-decoration: underline; text-underline-offset: 4px; cursor: pointer; padding: 8px 4px; min-height: 44px; }
.n-replay:hover { color: var(--n-cream); }
.n-caption { margin: clamp(70px, 9vw, 110px) auto 0; max-width: 46em; text-align: center; font-size: 16px; color: var(--n-faint); }
@media (prefers-reduced-motion: no-preference) {
  .n-tap.n-show { animation: n-press .9s ease-out both; }
  @keyframes n-press { 0% { transform: scale(1.25); opacity: 0; } 35% { transform: scale(.96); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
  .n-live .n-dot { animation: n-beat 2s ease-in-out infinite; }
  @keyframes n-beat { 50% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--n-flag) 0%, transparent); } 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--n-flag) 50%, transparent); } }
}
@media (max-width: 760px) {
  .n-hero-top { text-align: left; justify-items: start; }
  .n-hero-go, .n-hero-facts { justify-content: flex-start; }
  .n-kicker { font-size: 14px; line-height: 1.3; padding: 7px 12px 7px 9px; margin-bottom: 18px; }
  .n-hero-sub { font-size: 17px; margin-top: 16px; }
  .n-hero-go { margin-top: 22px; gap: 10px; }
  .n-hero-go .n-btn { flex: 1 1 0; padding: 0 8px; font-size: 15.5px; min-height: 52px; white-space: nowrap; }
  .n-hero h1 { font-size: clamp(44px, 12.4vw, 64px); }
  .n-sub-more { display: none; }
  .n-hero-facts { font-size: 15px; gap: 6px 18px; margin-top: 16px; }
  .n-stage { padding: 0; margin-top: 44px; }
  .n-laptop { width: 100%; }
  .n-stage .n-phone { position: relative; right: auto; bottom: auto; width: min(78%, 330px); margin: -22% auto 0; }
  .n-live { position: relative; left: auto; bottom: auto; margin: 22px 0 0; flex-wrap: wrap; }
  .n-caption { margin-top: 28px; text-align: left; }
}

/* ═════════ SECTIONS ═════════ */
.n-sec { padding-top: var(--n-sec); }
.n-sec-head { display: grid; gap: clamp(18px, 2vw, 26px); max-width: 980px; }
.n-board-sec { margin-top: var(--n-sec); background: var(--n-board); color: var(--n-board-ink); padding: var(--n-sec) 0; }
.n-board-sec .n-lead { color: var(--n-board-soft); }
.n-board-sec .n-link { color: var(--n-board-ink); text-decoration-color: var(--n-burnt); }
.n-board-sec .n-link:hover { color: var(--n-burnt); }
.n-board-sec + .n-sec { padding-top: var(--n-sec); }

/* ── 1. the committee's desk ── */
.n-desk { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: clamp(32px, 5vw, 80px); align-items: center; }
.n-desk-list { display: grid; gap: 0; margin-top: clamp(26px, 3vw, 40px); border-top: 1px solid var(--n-line); }
.n-desk-list li { display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 4px 16px; padding: 20px 0; border-bottom: 1px solid var(--n-line); }
.n-desk-list .n-t { font: 800 30px/1 var(--n-display); font-stretch: 62%; color: var(--n-flag); grid-row: span 2; padding-top: 3px; }
.n-desk-list b { font-size: 19px; }
.n-desk-list p { color: var(--n-cream-soft); font-size: 17px; }
.n-desk .n-h2 { font-size: clamp(44px, 5.6vw, 84px); }
.n-desk-pic { position: relative; padding-bottom: 20%; margin-right: calc(-1 * max(var(--n-gut), (100vw - var(--n-wrap)) / 2 + var(--n-gut))); }
.n-desk-pic .n-lid { border-radius: 16px 0 0 6px; padding-right: 0; }
.n-desk-pic .n-lid-screen { border-radius: 4px 0 0 4px; }
.n-desk-pic .n-phone { position: absolute; width: 24%; left: -7%; bottom: 0; }
@media (max-width: 900px) {
  .n-desk { grid-template-columns: minmax(0, 1fr); }
  .n-desk-pic { margin-right: calc(-1 * var(--n-gut)); padding-bottom: 34%; }
  .n-desk-pic .n-phone { left: 4%; width: 30%; bottom: 0; }
}
@media (max-width: 600px) {
  .n-desk-pic { padding-bottom: 46%; }
  .n-desk-pic .n-phone { width: 40%; }
}

/* ── 2. THE DAY BOARD (the page's one bold device) ── */
.n-day { margin-top: clamp(40px, 5vw, 64px); display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 340px); gap: clamp(28px, 4vw, 64px); align-items: start; }
.n-slats { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; padding: 10px; background: var(--n-board-ink); border-radius: 8px; }
.n-slat {
  display: grid; align-content: space-between; gap: 18px; min-height: 148px; padding: 14px 12px 12px; border-radius: 4px; border: 0; cursor: pointer; text-align: left;
  background: var(--n-board); color: var(--n-board-ink); font: inherit;
  box-shadow: inset 0 -3px 0 var(--n-board-rule);
}
.n-slat .n-when { font: 800 clamp(28px, 2.6vw, 40px)/.9 var(--n-display); font-stretch: 62%; font-variant-numeric: tabular-nums; }
.n-slat .n-day-name { font: 700 13px/1.1 var(--n-text); color: var(--n-board-soft); display: block; margin-bottom: 4px; }
.n-slat .n-what { font-size: 15px; font-weight: 700; line-height: 1.2; }
.n-slat:hover { background: var(--n-board-2); }
.n-slat[aria-selected="true"] { background: var(--n-flag); color: var(--n-board-ink); box-shadow: none; }
.n-slat[aria-selected="true"] .n-day-name { color: var(--n-board-ink); }
.n-day-say { margin-top: clamp(28px, 3vw, 40px); min-height: 190px; }
.n-day-say .n-who { font-weight: 700; color: var(--n-burnt); font-size: 16px; }
.n-day-say h3 { font: 800 clamp(38px, 4.6vw, 64px)/.92 var(--n-display); font-stretch: 62%; text-transform: uppercase; margin: 8px 0 14px; }
.n-day-say p { font-size: 19px; max-width: 34em; color: var(--n-board-soft); }
.n-day-pane[hidden] { display: none; }
.n-day-phone .n-phone { box-shadow: 0 0 0 1.5px var(--n-board-rule), 0 40px 70px -30px color-mix(in srgb, var(--n-board-ink) 70%, transparent); }
.n-day-phone .n-frame { position: absolute; inset: 0; transition: opacity .35s ease; }
.n-day-steps { display: none; }
@media (max-width: 900px) {
  .n-day { grid-template-columns: minmax(0, 1fr); }
  .n-slats { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; margin: 0 calc(-1 * var(--n-gut)); border-radius: 0; padding: 8px var(--n-gut); scrollbar-width: none; }
  .n-slats::-webkit-scrollbar { display: none; }
  .n-slat { flex: 0 0 132px; min-height: 120px; scroll-snap-align: start; }
  .n-day-phone { width: min(76%, 320px); margin: 0 auto; }
  .n-day-say { min-height: 0; }
}

/* ── 3. the whole club watches ── */
.n-watch { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 6fr); gap: clamp(32px, 5vw, 80px); align-items: end; }
.n-watch-big { font: 800 clamp(52px, 8.4vw, 132px)/.84 var(--n-display); font-stretch: 62%; text-transform: uppercase; }
.n-watch-big .n-t { display: block; color: var(--n-flag); font-variant-numeric: tabular-nums; }
.n-watch-row { display: flex; gap: clamp(12px, 1.6vw, 22px); align-items: flex-end; margin-top: clamp(48px, 6vw, 84px); }
.n-watch-row figure { flex: 1 1 0; min-width: 0; }
.n-watch-row figure:nth-child(2) { translate: 0 -8%; }
.n-watch-row figcaption { margin-top: 14px; font-size: 16px; color: var(--n-cream-soft); }
.n-watch-row figcaption b { display: block; color: var(--n-cream); }
.n-try { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 22px; align-items: center; margin-top: 30px; padding: 22px; border: 1px solid var(--n-line); border-radius: 10px; background: var(--n-night-2); }
.n-try svg { width: 116px; height: 116px; border-radius: 6px; }
.n-try .n-qr-ground { fill: var(--n-cream); }
.n-try .n-qr-ink { fill: var(--n-night); }
.n-try p { font-size: 16px; color: var(--n-cream-soft); }
.n-try p b { display: block; color: var(--n-cream); font-size: 18px; }
.n-doors { display: flex; flex-wrap: wrap; gap: 10px 22px; margin-top: 22px; }
@media (max-width: 900px) {
  .n-watch { grid-template-columns: minmax(0, 1fr); }
  .n-watch-row { overflow-x: auto; scroll-snap-type: x mandatory; margin: 48px calc(-1 * var(--n-gut)) 0; padding: 30px var(--n-gut) 6px; scrollbar-width: none; }
  .n-watch-row::-webkit-scrollbar { display: none; }
  .n-watch-row figure { flex: 0 0 min(64vw, 260px); scroll-snap-align: start; }
}
@media (max-width: 640px) { .n-try svg { width: 92px; height: 92px; } .n-try { grid-template-columns: minmax(0, 1fr); } .n-try svg { display: none; } }

/* ── 4. any format, any field ── */
.n-formats { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: clamp(32px, 5vw, 72px); align-items: start; margin-top: clamp(40px, 5vw, 64px); }
.n-format-wall { display: flex; flex-wrap: wrap; gap: .1em .6em; font: 800 clamp(30px, 3.3vw, 50px)/1.02 var(--n-display); font-stretch: 62%; text-transform: uppercase; color: var(--n-board-ink); }
.n-format-wall li:nth-child(even) { color: var(--n-burnt); }
.n-runs { margin-top: 28px; display: flex; flex-wrap: wrap; gap: 8px; }
.n-runs li { padding: 8px 14px; border-radius: 4px; background: var(--n-board-2); font-weight: 700; font-size: 16px; }
.n-big128 { margin-top: clamp(64px, 8vw, 110px); display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 8fr); gap: clamp(28px, 4vw, 64px); align-items: center; }
.n-big128 .n-num-big { font: 800 clamp(110px, 15vw, 230px)/.8 var(--n-display); font-stretch: 62%; color: var(--n-burnt); }
.n-big128 p { margin-top: 18px; color: var(--n-board-soft); font-size: 19px; }
.n-big128 .n-lid { box-shadow: 0 0 0 1px var(--n-board-rule), 0 50px 90px -40px color-mix(in srgb, var(--n-board-ink) 80%, transparent); }
@media (max-width: 900px) { .n-formats, .n-big128 { grid-template-columns: minmax(0, 1fr); } }

/* ── 5. money ── */
.n-money { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 6fr); gap: clamp(32px, 5vw, 80px); align-items: center; }
.n-money-pic { display: grid; grid-template-columns: minmax(0, 1fr); justify-items: center; }
.n-money-pic .n-phone { width: min(330px, 80%); }
.n-coins { display: flex; gap: 8px; margin-top: 30px; flex-wrap: wrap; }
.n-coin { min-width: 64px; min-height: 64px; padding: 6px 14px; display: grid; justify-items: center; align-content: center; gap: 2px; border-radius: 6px; border: 1px solid var(--n-line); background: none; color: var(--n-cream); cursor: pointer; font: inherit; }
.n-coin b { font: 800 30px/1 var(--n-display); font-stretch: 62%; }
.n-coin span { font-size: 13px; color: var(--n-cream-soft); }
.n-coin[aria-selected="true"] { background: var(--n-flag); border-color: var(--n-flag); color: var(--n-night); }
.n-coin[aria-selected="true"] span { color: var(--n-night); }
.n-money-say { margin-top: 18px; font-size: 16px; color: var(--n-cream-soft); min-height: 1.6em; }
.n-also { margin-top: 26px; font-size: 16px; color: var(--n-faint); }
.n-money-pic .n-frame { position: absolute; inset: 0; transition: opacity .3s ease; }
.n-never { margin-top: 30px; padding: 20px 22px; border-left: 4px solid var(--n-flag); background: var(--n-night-2); border-radius: 0 8px 8px 0; font-size: 18px; }
.n-never b { color: var(--n-cream); }
@media (max-width: 900px) { .n-money { grid-template-columns: minmax(0, 1fr); } }

/* ── 6. colours ── */
.n-themes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: clamp(12px, 1.6vw, 22px); margin-top: clamp(40px, 5vw, 64px); }
.n-themes figcaption { margin-top: 12px; font-size: 16px; display: flex; align-items: center; gap: 8px; color: var(--n-cream-soft); }
.n-themes figcaption i { width: 12px; height: 12px; border-radius: 3px; flex: none; }
@media (max-width: 900px) {
  .n-themes { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; margin: 40px calc(-1 * var(--n-gut)) 0; padding: 0 var(--n-gut) 6px; scrollbar-width: none; }
  .n-themes::-webkit-scrollbar { display: none; }
  .n-themes figure { flex: 0 0 min(58vw, 230px); scroll-snap-align: start; }
}

/* ── 7. who it is for: three rows of the leaderboard ── */
.n-for { margin-top: clamp(36px, 4vw, 56px); border-top: 2px solid var(--n-cream); }
.n-for a { display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 5fr) minmax(0, 2fr); gap: 10px clamp(20px, 3vw, 48px); align-items: baseline; padding: clamp(24px, 3vw, 36px) 0; border-bottom: 1px solid var(--n-line); text-decoration: none; }
.n-for .n-who { font: 800 clamp(34px, 4.2vw, 62px)/.9 var(--n-display); font-stretch: 62%; text-transform: uppercase; }
.n-for p { color: var(--n-cream-soft); font-size: 18px; }
.n-for p b { display: block; color: var(--n-cream); font-size: 20px; margin-bottom: 4px; }
.n-for .n-go { justify-self: end; font-weight: 700; white-space: nowrap; text-decoration: underline; text-decoration-color: var(--n-flag); text-decoration-thickness: 2px; text-underline-offset: 5px; }
.n-for a:hover .n-who { color: var(--n-flag); }
@media (max-width: 760px) { .n-for a { grid-template-columns: minmax(0, 1fr); } .n-for .n-go { justify-self: start; } }

/* ── 8. pricing ── */
.n-plans { margin-top: clamp(40px, 5vw, 64px); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 2px solid var(--n-board-ink); border-radius: 8px; overflow: hidden; }
.n-plan { padding: clamp(24px, 2.6vw, 36px); display: grid; align-content: start; gap: 14px; }
.n-plan + .n-plan { border-left: 1px solid var(--n-board-rule); }
.n-plan .n-tag { font-size: 15px; font-weight: 700; color: var(--n-board-soft); }
.n-plan h3 { font: 800 40px/.9 var(--n-display); font-stretch: 62%; text-transform: uppercase; }
.n-price { font: 800 clamp(56px, 6vw, 84px)/.85 var(--n-display); font-stretch: 62%; font-variant-numeric: tabular-nums; display: flex; align-items: baseline; gap: 8px; }
.n-price small { font: 600 16px/1.2 var(--n-text); color: var(--n-board-soft); }
.n-plan .n-year { font-size: 15px; color: var(--n-board-soft); min-height: 1.5em; }
.n-plan ul { display: grid; gap: 8px; font-size: 16px; padding-top: 14px; border-top: 1px solid var(--n-board-rule); }
.n-plan li { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 8px; }
.n-plan li::before { content: ""; width: 12px; height: 7px; margin-top: 7px; border-left: 2.5px solid var(--n-burnt); border-bottom: 2.5px solid var(--n-burnt); rotate: -45deg; }
.n-plan .n-term { font-size: 14px; color: var(--n-board-soft); }
.n-plan .n-btn { width: 100%; }
.n-plan-pick { background: var(--n-board-ink); color: var(--n-cream); }
.n-plan-pick .n-tag, .n-plan-pick .n-price small, .n-plan-pick .n-year { color: var(--n-cream-soft); }
.n-plan-pick ul { border-top-color: var(--n-line); }
.n-plan-pick li::before { border-color: var(--n-flag); }
.n-small { margin-top: 22px; font-size: 15px; color: var(--n-board-soft); max-width: 70em; }
.n-small a { color: inherit; }
.n-vs { margin-top: clamp(48px, 6vw, 80px); display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: clamp(28px, 4vw, 64px); align-items: center; }
.n-vs p { margin-top: 12px; color: var(--n-board-soft); }
.n-bars { display: grid; gap: 14px; }
.n-bars li { display: grid; grid-template-columns: 120px minmax(0, 1fr) 96px; gap: 14px; align-items: center; font-weight: 700; font-size: 16px; }
.n-bars .n-track { height: 34px; background: var(--n-board-2); border-radius: 3px; overflow: hidden; }
.n-bars .n-fill { display: block; height: 100%; background: var(--n-board-soft); }
.n-bars .n-us .n-fill { background: var(--n-flag); }
.n-bars .n-amt { text-align: right; font-variant-numeric: tabular-nums; }
.n-saved { display: flex; gap: 28px; flex-wrap: wrap; margin-top: 8px; font-size: 16px; color: var(--n-board-soft); }
.n-saved b { font: 800 34px/1 var(--n-display); font-stretch: 62%; color: var(--n-burnt); display: block; }
.n-more-links { display: flex; flex-wrap: wrap; gap: 12px 26px; margin-top: 30px; }
@media (max-width: 900px) {
  .n-plans { grid-template-columns: minmax(0, 1fr); }
  .n-plan + .n-plan { border-left: 0; border-top: 1px solid var(--n-board-rule); }
  .n-vs { grid-template-columns: minmax(0, 1fr); }
  .n-bars li { grid-template-columns: 92px minmax(0, 1fr) 80px; gap: 10px; }
}

/* ── 9. questions ── */
.n-qa { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: clamp(32px, 5vw, 80px); margin-top: clamp(40px, 5vw, 64px); }
.n-every { display: grid; gap: 10px; margin-top: 24px; font-size: 17px; }
.n-every li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 8px; color: var(--n-cream-soft); }
.n-every li::before { content: ""; width: 12px; height: 7px; margin-top: 8px; border-left: 2.5px solid var(--n-flag); border-bottom: 2.5px solid var(--n-flag); rotate: -45deg; }
.n-answers { display: grid; gap: 0; border-top: 1px solid var(--n-line); }
.n-answer { padding: 26px 0; border-bottom: 1px solid var(--n-line); display: grid; gap: 10px; }
.n-answer h3 { font: 700 clamp(26px, 2.4vw, 34px)/1.05 var(--n-display); font-stretch: 75%; }
.n-answer p { color: var(--n-cream-soft); }
@media (max-width: 900px) { .n-qa { grid-template-columns: minmax(0, 1fr); } }

/* ── 10. follow along ── */
.n-follow { margin-top: clamp(36px, 4vw, 56px); display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; border-top: 1px solid var(--n-line); border-bottom: 1px solid var(--n-line); }
.n-follow a { display: grid; align-content: start; gap: 14px; padding: 28px 24px 30px; text-decoration: none; min-height: 100%; }
.n-follow li + li a { border-left: 1px solid var(--n-line); }
.n-follow svg { width: 34px; height: 34px; fill: currentColor; }
.n-follow .n-net { font: 800 34px/.9 var(--n-display); font-stretch: 62%; text-transform: uppercase; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.n-follow .n-handle { font-size: 15px; color: var(--n-faint); }
.n-follow p { font-size: 16px; color: var(--n-cream-soft); }
.n-follow a:hover { background: var(--n-night-2); }
.n-follow a:hover .n-net { color: var(--n-flag); }
@media (max-width: 900px) { .n-follow { grid-template-columns: repeat(2, minmax(0, 1fr)); } .n-follow li:nth-child(3) a { border-left: 0; } .n-follow li:nth-child(n+3) a { border-top: 1px solid var(--n-line); } }
@media (max-width: 520px) { .n-follow { grid-template-columns: minmax(0, 1fr); } .n-follow li + li a { border-left: 0; border-top: 1px solid var(--n-line); } }

/* ── 11. the close ── */
.n-close { padding: var(--n-sec) 0; margin-top: var(--n-sec); background: var(--n-night-2); border-top: 1px solid var(--n-hair); }
.n-close-grid { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: clamp(32px, 5vw, 80px); align-items: start; }
.n-close .n-display { font-size: clamp(46px, 6.2vw, 100px); }
.n-close .n-display span { display: block; }
.n-close .n-display span + span { color: var(--n-flag); }
.n-close .n-lead { margin-top: 26px; }
.n-close-auth { scroll-margin-top: 90px; }
.n-stores { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 30px; }
.n-store { display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px; border: 1px solid var(--n-line); border-radius: 8px; text-decoration: none; min-height: 54px; }
.n-store small { display: block; font-size: 12px; color: var(--n-cream-soft); }
.n-store b { display: block; font-size: 17px; line-height: 1.1; }
.n-store svg { width: 22px; height: 22px; fill: currentColor; }
.n-stores-note { margin-top: 14px; font-size: 15px; color: var(--n-cream-soft); max-width: 36em; }
@media (max-width: 900px) { .n-close-grid { grid-template-columns: minmax(0, 1fr); } }

/* ── footer ── */
.n-ftr { padding: 56px 0 40px; border-top: 1px solid var(--n-hair); }
.n-ftr-top { display: flex; flex-wrap: wrap; gap: 26px 48px; align-items: center; justify-content: space-between; }
.n-ftr .lockup { text-decoration: none; display: inline-flex; }
.n-ftr nav ul { display: flex; flex-wrap: wrap; gap: 10px 26px; }
.n-ftr nav a { text-decoration: none; font-weight: 600; font-size: 16px; color: var(--n-cream-soft); }
.n-ftr nav a:hover { color: var(--n-cream); }
.n-socials { display: flex; gap: 8px; }
.n-socials a { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 6px; border: 1px solid var(--n-line); color: var(--n-cream-soft); }
.n-socials a:hover { color: var(--n-night); background: var(--n-flag); border-color: var(--n-flag); }
.n-socials svg { width: 20px; height: 20px; fill: currentColor; }
.n-ftr-base { margin-top: 34px; padding-top: 24px; border-top: 1px solid var(--n-hair); display: flex; flex-wrap: wrap; gap: 10px 26px; font-size: 14px; color: var(--n-faint); }
.n-ftr-base a { color: var(--n-cream-soft); }
.n-ftr-base button { font: inherit; color: var(--n-cream-soft); }
.n-site .n-ftr-base .ed-note { margin: 0; padding: 0; }

/* the auth card from the shared chrome, seated on this page */
.n-site .authpanel { max-width: none; }
`;
