/**
 * THE FRONT DOOR'S OWN STYLESHEET (2026-10-11) — the page Ajay steered through
 * twenty-six prototypes in one evening: midnight navy, the logo's orange, a
 * serif headline, and the app's real screens.
 *
 * Everything here is scoped under `.m-home` (the page's <main>) and every class
 * carries the prefix `m-`, so nothing in it can reach the shared chrome
 * (`styles.ts`: the nav, the footer, /faq, the sign-in card) or the app's
 * global classes, and nothing there can reach in.
 *
 * COLOURS ARE THE PALETTE'S. The custom properties at the top (`--m-*`) are
 * each pointed at a token `landingTokens` generates and `landing-contrast.test`
 * grades; a tint or a glow is a `color-mix` of one of those tokens. Nothing is
 * written as a hex — only shadows use plain black, and the sheen on a phone's
 * glass plain white.
 *
 * THE RULE FOR SCREENS (measured, see `e2e/landing-screens.spec.ts`): a screen
 * that is meant to be READ is square to the eye and still — a tilted or drifting
 * picture is redrawn every frame and its small print goes soft. Depth belongs
 * to the layers behind (`.m-hero-desk`, `.m-phone.m-back`, `.m-wall`), which
 * are decorative and hidden from assistive technology.
 *
 * Motion is opt-in twice over: every animation sits inside
 * `prefers-reduced-motion: no-preference`, and anything that waits to arrive
 * is only hidden once the page's script has said it can watch for it
 * (`.m-armed`), so with no script the whole page is simply there.
 *
 * Ported from the prototype by `scratchpad/proto/port-css.mjs`; edit this file
 * from now on, not the prototype.
 */
export const HOME_CSS = `
.m-home {
  --m-ground: var(--ground); --m-ground-deep: color-mix(in srgb, var(--ground) 62%, black); --m-ground-rise: var(--ground-2);
  --m-on-ground: var(--ink); --m-on-ground-soft: var(--ink-soft); --m-line: var(--line-2);
  --m-hl: var(--brass); --m-label: var(--brass);
  --m-btn-bg: var(--ink); --m-btn-fg: var(--ground); --m-btn-hover: white;
  --m-sel-bg: var(--ink); --m-sel-fg: var(--ground); --m-sel-soft: color-mix(in srgb, var(--ground) 72%, var(--ink));
  --m-stick: var(--ink); --m-cup: var(--line-2);
  --m-word-1: var(--brass-hi); --m-word-2: var(--brass); --m-word-3: var(--brass-ui);
  --m-shot-shadow: rgba(0, 0, 0, 0.55);
  --m-paper: var(--paper); --m-ink: var(--paper-ink); --m-ink-soft: var(--paper-soft); --m-rule: color-mix(in srgb, var(--paper-ink) 18%, transparent);
  --m-flag: var(--brass-ui); --m-flag-ink: var(--paper-accent);
  --m-bar: color-mix(in srgb, var(--ink) 30%, transparent); --m-frame: black;
  --m-display: var(--font-poster, var(--font-display)), "Iowan Old Style", Georgia, serif;
  --m-body: var(--sans); --m-mono: var(--mono); --m-wrap: 1120px;
  /* the shared header's height: set from the header itself by the page's script, so a pinned row sits under it exactly */
  --m-hdr: 72px;
}
.m-home { margin: 0; background: var(--m-ground); color: var(--m-on-ground); font-family: var(--m-body); font-size: 17px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
.m-home * { box-sizing: border-box; }
.m-home [hidden] { display: none !important; }
.m-home img { display: block; max-width: 100%; height: auto; }
.m-home a { color: inherit; }
.m-home :focus-visible { outline: 3px solid var(--m-flag); outline-offset: 3px; border-radius: 4px; }
.m-home .m-wrap { max-width: var(--m-wrap); margin-inline: auto; padding-inline: 24px; }
@media (max-width: 600px) {
  .m-home .m-wrap { padding-inline: 16px; }
  .m-home { font-size: 16px; }
}
.m-home h1, .m-home h2, .m-home h3 { font-family: var(--m-display); font-weight: 560; letter-spacing: -0.018em; line-height: 1.05; margin: 0; text-wrap: balance; font-variation-settings: "opsz" 144; }
.m-home h1 { font-size: clamp(2.5rem, 5.6vw, 4.6rem); }
.m-home h2 { font-size: clamp(1.9rem, 4vw, 3rem); }
.m-home h3 { font-size: clamp(1.3rem, 2.1vw, 1.6rem); line-height: 1.15; font-variation-settings: "opsz" 48; }
.m-home p { margin: 0; }
.m-home .m-eyebrow { font-family: var(--m-mono); font-size: 0.75rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--m-label); }
.m-home .m-lead { font-size: clamp(1.05rem, 1.5vw, 1.2rem); color: var(--m-on-ground-soft); max-width: 54ch; }
.m-home .m-hl { color: var(--m-hl); }
.m-home .m-btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; font: 600 1rem/1 var(--m-body); padding: 15px 22px; border-radius: 999px; text-decoration: none; border: 1.5px solid transparent; cursor: pointer; white-space: nowrap; transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease; }
.m-home .m-btn:active { transform: translateY(1px); }
.m-home .m-btn.m-primary { background: var(--m-btn-bg); color: var(--m-btn-fg); position: relative; overflow: hidden; }
.m-home .m-btn.m-primary::after { content: ""; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 38%, rgba(255, 255, 255, 0.75) 50%, transparent 62%); transform: translateX(-130%); pointer-events: none; }
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-btn.m-primary:hover::after { transform: translateX(130%); transition: transform 0.7s ease; }
}
.m-home .m-btn.m-primary:hover { background: var(--m-btn-hover); }
.m-home .m-btn.m-line { border-color: var(--m-line); color: var(--m-on-ground); background: transparent; }
.m-home .m-btn.m-line:hover { border-color: var(--m-on-ground); }
.m-home .m-btn .m-arrow { font-family: var(--m-mono); }
.m-home .m-cta-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
@media (prefers-reduced-motion: reduce) {
  .m-home .m-btn { transition: none; }
}
.m-home .m-chapter { padding-block: clamp(64px, 8vw, 108px); }
.m-home .m-chapter .m-head { display: grid; gap: 14px; margin-bottom: clamp(30px, 4.5vw, 52px); max-width: 720px; }
.m-home .m-screen { border-radius: 16px; border: 1px solid var(--m-line); overflow: hidden; background: var(--paper); box-shadow: 0 40px 80px -40px var(--m-shot-shadow); }
.m-home .m-screen img { width: 100%; }
.m-home .m-phone { border-radius: 32px; border: 7px solid var(--m-frame); background: var(--m-frame); overflow: hidden; box-shadow: 0 30px 60px -28px var(--m-shot-shadow); }
.m-home .m-phone img { width: 100%; }
.m-home .m-hero { padding-block: clamp(40px, 6vw, 84px) 0; overflow: clip; position: relative; background: radial-gradient(900px 620px at 80% 40%, var(--m-ground-rise), transparent 68%); }
.m-home .m-hero > * { position: relative; z-index: 1; }
.m-home .m-hero::after { content: ""; position: absolute; z-index: 0; inset: 0; pointer-events: none; opacity: 0; transition: opacity 0.4s ease; background: radial-gradient(520px 520px at calc(var(--m-mx, 0.5) * 100%) calc(var(--m-my, 0.5) * 100%), color-mix(in srgb, var(--brass-ui) 13%, transparent), transparent 70%); }
.m-home .m-hero.m-lit::after { opacity: 1; }
.m-home body::before { content: ""; position: fixed; inset: 0; z-index: 50; pointer-events: none; opacity: 0.06; mix-blend-mode: overlay; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='220' height='220' filter='url(%23n)'/></svg>"); }
.m-home .m-progress { position: fixed; z-index: 60; top: 0; left: 0; right: 0; height: 3px; background: var(--m-hl); transform-origin: left; transform: scaleX(var(--m-p, 0)); pointer-events: none; }
.m-home .m-hero h1 .m-line { display: block; overflow: hidden; padding-bottom: 0.14em; margin-bottom: -0.14em; }
.m-home .m-hero h1 .m-line > span { display: inline-block; }
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-hero h1 .m-line > span { animation: m-up 0.95s cubic-bezier(0.2, 0.8, 0.2, 1) 0.1s both; }
  .m-home .m-hero h1 .m-line:nth-child(2) > span { animation-delay: 0.24s; }
}
@keyframes m-up { from { transform: translateY(108%); } to { transform: none; } }
.m-home .m-hero h1 { font-size: clamp(2.7rem, 6.2vw, 5.2rem); line-height: 0.98; }
.m-home .m-hero .m-sub { font-family: var(--m-display); font-weight: 500; font-size: clamp(1.3rem, 2.3vw, 1.75rem); line-height: 1.2; letter-spacing: -0.01em; font-variation-settings: "opsz" 48; max-width: 26ch; }
/* two sentences, two lines — said so, where it used to depend on whether "Your" happened to fit */
.m-home .m-hero .m-sub > span { display: block; text-wrap: balance; }
.m-home .m-hero-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 300px); grid-template-rows: auto 1fr; grid-template-areas: "copy phone" "try phone"; column-gap: clamp(28px, 5vw, 72px); row-gap: 30px; align-items: start; }
.m-home .m-hero-grid .m-copy { grid-area: copy; display: grid; gap: 20px; }
.m-home .m-hero .m-lead { max-width: 44ch; }
.m-home .m-rings { position: absolute; z-index: 0; left: 50%; top: 50%; width: 230%; height: 120%; transform: translate(-50%, -50%); pointer-events: none; }
.m-home .m-rings ellipse { fill: none; stroke: var(--m-line); stroke-width: 1; transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-rise { animation: m-rise 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
  .m-home .m-rise.m-d2 { animation-delay: 0.16s; }
  .m-home .m-rise.m-d3 { animation-delay: 0.24s; }
  .m-home .m-rise.m-d4 { animation-delay: 0.32s; }
  .m-home .m-rise.m-d5 { animation-delay: 0.42s; }
}
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-hero h1 .m-hl { background: linear-gradient(100deg, var(--m-hl) 42%, color-mix(in srgb, var(--brass-hi) 45%, white) 50%, var(--m-hl) 58%); background-size: 260% 100%; background-position: 120% 0; -webkit-background-clip: text; background-clip: text; color: transparent; animation: m-shine 1.8s ease 0.9s 1 both; }
  .m-home .m-armed { transition: transform 0.9s cubic-bezier(0.2, 0.7, 0.2, 1), opacity 0.7s ease; }
  .m-home .m-card.m-armed, .m-home .m-plan.m-armed, .m-home .m-colours.m-armed, .m-home .m-close.m-armed { transform: translateY(36px); opacity: 0.15; }
  .m-home .m-card.m-armed:nth-child(2), .m-home .m-plan.m-armed:nth-child(2) { transition-delay: 0.12s; }
  .m-home .m-card.m-armed:nth-child(3), .m-home .m-plan.m-armed:nth-child(3) { transition-delay: 0.24s; }
  .m-home .m-wide .m-screen.m-armed { transform: perspective(1600px) rotateX(14deg) translateY(40px) scale(0.95); transform-origin: 50% 100%; opacity: 0.5; transition-duration: 1.2s, 0.8s; }
  .m-home .m-moment.m-armed .m-time, .m-home .m-moment.m-armed .m-l1, .m-home .m-moment.m-armed .m-l2, .m-home .m-moment.m-armed .m-aside { opacity: 0; transform: translateY(22px); transition: transform 0.7s cubic-bezier(0.2, 0.7, 0.2, 1), opacity 0.6s ease; }
  .m-home .m-moment.m-armed .m-aside { display: block; transition-delay: 1.5s; }
  .m-home .m-moment.m-armed .m-l1 { transition-delay: 0.55s; }
  .m-home .m-moment.m-armed .m-l2 { transition-delay: 1.05s; }
  .m-home .m-bars.m-armed .m-fill { transform: scaleX(0); transform-origin: left; transition: transform 1.1s cubic-bezier(0.2, 0.7, 0.2, 1); }
  .m-home .m-bars.m-armed li:nth-child(2) .m-fill { transition-delay: 0.25s; }
  .m-home .m-bars.m-armed li:nth-child(3) .m-fill { transition-delay: 1.15s; transition-duration: 0.5s; }
  .m-home .m-bars.m-armed .m-amount { opacity: 0; transition: opacity 0.4s ease 0.9s; }
  .m-home .m-bars.m-armed li:nth-child(2) .m-amount { transition-delay: 1.1s; }
  .m-home .m-bars.m-armed li:nth-child(3) .m-amount { transition-delay: 1.55s; }
  .m-home .m-armed.m-in, .m-home .m-wide .m-screen.m-armed.m-in { transform: none; opacity: 1; }
  .m-home .m-moment.m-armed.m-in .m-time, .m-home .m-moment.m-armed.m-in .m-l1, .m-home .m-moment.m-armed.m-in .m-l2, .m-home .m-moment.m-armed.m-in .m-aside { opacity: 1; transform: none; }
  .m-home .m-bars.m-armed.m-in .m-fill { transform: scaleX(1); }
  .m-home .m-bars.m-armed.m-in .m-amount { opacity: 1; }
  .m-home .m-card .m-peek .m-phone { transition: transform 0.45s cubic-bezier(0.2, 0.7, 0.2, 1); }
  .m-home .m-card:hover .m-peek .m-phone { transform: translateY(-14px); }
}
@keyframes m-shine { from { background-position: 120% 0; } to { background-position: -20% 0; } }
@keyframes m-ripple { 0% { transform: scale(0.45); opacity: 0; } 18% { opacity: 1; } 100% { transform: scale(1.18); opacity: 0; } }
@keyframes m-rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
.m-home .m-tryline { grid-area: try; display: grid; gap: 12px; max-width: 470px; padding: 18px 20px; border: 1px solid var(--m-line); border-radius: 18px; background: var(--m-ground-deep); }
.m-home .m-tryline label { color: var(--m-on-ground-soft); font-size: 0.98rem; }
.m-home .m-tryline label b { color: var(--m-on-ground); font-weight: 600; }
.m-home .m-tryline .m-field { display: flex; flex-wrap: wrap; gap: 12px 14px; align-items: center; }
.m-home .m-tryline input { font: 600 1.15rem/1 var(--m-mono); letter-spacing: 0.14em; text-transform: uppercase; width: 12.5ch; box-sizing: content-box; padding: 13px 16px; border-radius: 12px; border: 1.5px solid var(--m-hl); background: var(--m-ground); color: var(--m-on-ground); }
.m-home .m-tryline input::placeholder { color: var(--m-on-ground-soft); opacity: 0.5; letter-spacing: 0.04em; text-transform: none; font-weight: 500; }
.m-home .m-tryline .m-hint { font: 500 0.95rem/1.2 var(--m-mono); letter-spacing: 0.1em; color: var(--m-on-ground-soft); }
.m-home .m-tryline .m-say { color: var(--m-hl); font-weight: 600; font-size: 0.98rem; }
.m-home .m-tryline .m-say:empty { display: none; }
@media (max-width: 900px) {
  .m-home .m-hero { background: radial-gradient(520px 420px at 50% 62%, var(--m-ground-rise), transparent 70%); }
  .m-home .m-hero-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; grid-template-areas: "copy" "phone" "try"; }
  .m-home .m-tryline { max-width: none; }
}
.m-home .m-ticker { margin-top: clamp(44px, 6vw, 76px); border-block: 1px solid var(--m-line); background: var(--m-ground-deep); overflow: hidden; font: 500 0.95rem/1 var(--m-mono); }
.m-home .m-ticker .m-row { display: flex; align-items: center; }
.m-home .m-ticker .m-live { flex: none; display: inline-flex; align-items: center; gap: 9px; padding: 15px 18px 15px 24px; background: var(--m-ground-deep); color: var(--m-on-ground); letter-spacing: 0.14em; text-transform: uppercase; font-size: 0.75rem; position: relative; z-index: 1; border-right: 1px solid var(--m-line); }
.m-home .m-ticker .m-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--m-hl); }
.m-home .m-ticker .m-track { display: flex; flex: none; gap: 0; white-space: nowrap; will-change: transform; }
.m-home .m-ticker .m-track span { padding: 15px 22px; color: var(--m-on-ground-soft); border-right: 1px solid var(--m-line); }
.m-home .m-ticker .m-track b { color: var(--m-on-ground); font-weight: 600; }
.m-home .m-ticker .m-track i { font-style: normal; color: var(--m-hl); font-weight: 600; margin-left: 8px; }
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-ticker .m-track { animation: m-slide 46s linear infinite; }
  .m-home .m-ticker:hover .m-track { animation-play-state: paused; }
  .m-home .m-ticker .m-dot { animation: m-pulse 1.6s ease-in-out infinite; }
}
@keyframes m-slide { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes m-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.m-home .m-proof { margin-top: 0; }
.m-home .m-proof ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.m-home .m-proof li { padding: 24px 20px 0 0; display: grid; gap: 4px; align-content: start; }
.m-home .m-proof li + li { padding-left: 20px; border-left: 1px solid var(--m-line); }
.m-home .m-proof b { font-family: var(--m-display); font-weight: 560; font-size: 1.4rem; line-height: 1.1; font-variation-settings: "opsz" 60; }
.m-home .m-proof span { font-size: 0.92rem; color: var(--m-on-ground-soft); }
@media (max-width: 800px) {
  .m-home .m-proof ul { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .m-home .m-proof li, .m-home .m-proof li + li { padding: 16px 12px 16px 0; border-left: 0; border-top: 1px solid var(--m-line); }
  .m-home .m-proof li:nth-child(-n+2) { border-top: 0; }
}
.m-home .m-times { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 36px; scrollbar-width: thin; }
.m-home .m-times button { flex: none; display: grid; gap: 2px; text-align: left; font: inherit; color: var(--m-on-ground-soft); background: transparent; border: 1px solid var(--m-line); border-radius: 12px; padding: 10px 14px; cursor: pointer; min-width: 112px; }
.m-home .m-times button b { font: 600 1.05rem/1.2 var(--m-mono); color: var(--m-on-ground); }
.m-home .m-times button span { font: 500 0.75rem/1.2 var(--m-mono); letter-spacing: 0.12em; text-transform: uppercase; }
.m-home .m-times button[aria-selected="true"] { background: var(--m-sel-bg); border-color: var(--m-sel-bg); color: var(--m-sel-soft); }
.m-home .m-times button[aria-selected="true"] b { color: var(--m-sel-fg); }
.m-home .m-times button { position: relative; overflow: hidden; }
@media (min-width: 900px) {
  /* The moments not yet reached step back, but stay readable: at 0.3 they were 2.3:1, below any floor. */
}
/* THE WHOLE COMPETITION, IN ORDER: one still row of the week's steps, at every width. It was a
   very large running tagline over a second running line on a wide screen, cut off at both edges
   and repeating the headline (Ajay, 2026-10-21: "fix this … the banner"); the phone's row was
   always the readable one, so every width has it now. */
.m-home .m-kinetic { padding: clamp(18px, 3vw, 40px) 16px clamp(26px, 4vw, 48px); }
.m-home .m-path { display: grid; gap: 14px; justify-items: center; text-align: center; }
.m-home .m-path .m-eyebrow { margin: 0; }
.m-home .m-path ol { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 6px; max-width: 46rem; }
.m-home .m-path li { display: inline-flex; align-items: center; gap: 6px; font: 500 0.92rem/1 var(--m-mono); letter-spacing: 0.02em; color: var(--m-on-ground-soft); }
.m-home .m-path li span { border: 1px solid var(--m-line); border-radius: 999px; padding: 8px 12px; background: var(--m-ground-rise); }
.m-home .m-path li.m-end span { border-color: var(--m-hl); color: var(--m-hl); font-weight: 600; }
/* the arrow FOLLOWS its step: a line that wraps then ends on an arrow, which reads as "and then",
   where an arrow leading each step left three of the four lines starting with one */
.m-home .m-path li:not(:last-child)::after { content: "→"; color: var(--m-hl); font-family: var(--m-mono); }
@media (min-width: 900px) {
  /* one line on a desktop: seven steps fit, and a sequence reads better unbroken */
  .m-home .m-path ol { max-width: none; flex-wrap: nowrap; }
  .m-home .m-path li { font-size: 1rem; }
  .m-home .m-path li span { padding: 10px 16px; }
}
@media (min-width: 900px) and (max-width: 1199px) {
  .m-home .m-path ol { flex-wrap: wrap; max-width: 46rem; }
}
.m-home .m-moment { padding-block: clamp(56px, 8vw, 110px); border-block: 1px solid var(--m-line); background: radial-gradient(700px 320px at 12% 50%, color-mix(in srgb, var(--brass-ui) 16%, transparent), transparent 70%), var(--m-ground-deep); }
.m-home .m-moment .m-big { font-family: var(--m-display); font-weight: 520; font-size: clamp(2.1rem, 5.6vw, 4.8rem); line-height: 1.03; letter-spacing: -0.02em; font-variation-settings: "opsz" 144; max-width: 17ch; text-wrap: balance; }
.m-home .m-moment .m-big { max-width: none; font-size: clamp(1.9rem, 5.2vw, 4.4rem); }
.m-home .m-moment .m-big > span { display: inline-block; }
.m-home .m-moment .m-big .m-l1, .m-home .m-moment .m-big .m-l2 { white-space: nowrap; }
.m-home .m-moment .m-big .m-time { font-family: var(--m-mono); font-weight: 500; color: var(--m-hl); letter-spacing: -0.03em; }
.m-home .m-moment .m-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 24px clamp(28px, 6vw, 80px); align-items: end; }
.m-home .m-moment p { color: var(--m-on-ground-soft); font-size: 1.08rem; max-width: 38ch; }
@media (max-width: 820px) {
  .m-home .m-moment .m-grid { grid-template-columns: minmax(0, 1fr); }
}
.m-home .m-wide { display: grid; gap: 26px; }
.m-home .m-wide .m-line { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px clamp(28px, 6vw, 80px); align-items: end; }
.m-home .m-wide .m-line p { color: var(--m-on-ground-soft); max-width: 46ch; }
.m-home .m-wide .m-screen { aspect-ratio: 16 / 9; }
.m-home .m-wide .m-screen img { height: 100%; object-fit: cover; object-position: 50% 0; }
@media (max-width: 760px) {
  .m-home .m-wide .m-line { grid-template-columns: minmax(0, 1fr); }
}
.m-home .m-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; margin-top: 18px; }
@media (max-width: 900px) {
  .m-home .m-cards { grid-template-columns: minmax(0, 1fr); }
}
.m-home .m-card { border: 1px solid var(--m-line); border-radius: 22px; background: var(--m-ground-rise); padding: 28px 26px 0; display: grid; gap: 12px; grid-template-rows: auto auto 1fr; overflow: hidden; }
.m-home .m-card p { color: var(--m-on-ground-soft); font-size: 0.98rem; }
.m-home .m-card .m-peek { align-self: end; margin-top: 16px; height: 300px; overflow: hidden; padding-inline: 12px; }
.m-home .m-card .m-peek .m-phone { border-bottom: 0; border-radius: 30px 30px 0 0; box-shadow: none; }
@media (max-width: 900px) {
  /* THE CUT FALLS AFTER THE POINT, AT ANY WIDTH (2026-10-13). A fixed 280px cut each picture a line
     short of what its card is about: the dashboard on "1 disputed result", the money on the label
     above the figure. A shape, not a height, so the cut is the same place in the picture on a 320px
     phone as on a 430px one: just past the first block of each screen. */
  .m-home .m-card .m-peek { height: auto; aspect-ratio: 1 / 1.26; max-width: 300px; margin-inline: auto; width: 100%; }
}
.m-home .m-colours { margin-top: 18px; border: 1px solid var(--m-line); border-radius: 22px; background: var(--m-ground-rise); padding: clamp(26px, 4vw, 52px); display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 250px); gap: clamp(28px, 6vw, 90px); align-items: center; overflow: hidden; }
.m-home .m-colours .m-text { display: grid; gap: 14px; align-content: start; min-width: 0; }
.m-home .m-colours .m-text p { color: var(--m-on-ground-soft); max-width: 44ch; }
.m-home .m-colours .m-drag { color: var(--m-on-ground); font-weight: 600; display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.m-home .m-colours .m-arrows { font-family: var(--m-mono); color: var(--m-hl); letter-spacing: -0.2em; padding-right: 0.2em; }
.m-home .m-schemes { list-style: none; margin: 10px 0 0; padding: 16px 0 0; border-top: 1px solid var(--m-line); display: flex; flex-wrap: wrap; gap: 10px 22px; font-size: 0.92rem; color: var(--m-on-ground-soft); }
.m-home .m-schemes li { display: inline-flex; align-items: center; gap: 8px; }
.m-home .m-schemes .m-dot { width: 12px; height: 12px; border-radius: 50%; border: 1px solid var(--m-line); }
.m-home .m-compare { position: relative; aspect-ratio: 9 / 15; touch-action: pan-y; }
.m-home .m-compare img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.m-home .m-compare .m-handle { position: absolute; z-index: 3; top: 0; bottom: 0; left: 50%; width: 2px; margin-left: -1px; background: var(--m-hl); pointer-events: none; }
.m-home .m-compare .m-knob { position: absolute; top: 50%; left: 50%; width: 38px; height: 38px; margin: -19px 0 0 -19px; border-radius: 50%; background: var(--m-hl); color: var(--ground); display: grid; place-items: center; font: 700 1rem/1 var(--m-mono); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4); }
.m-home .m-compare input[type="range"] { position: absolute; inset: 0; z-index: 4; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; }
.m-home .m-compare:focus-within { outline: 3px solid var(--m-flag); outline-offset: 3px; }
/* Under a finger the board scrolls with the page; only the knob drags it (LandingHomeEffects). */
@media (pointer: coarse) {
  .m-home .m-compare input[type="range"] { pointer-events: none; }
  .m-home .m-compare .m-knob { z-index: 5; pointer-events: auto; touch-action: none; cursor: ew-resize; }
  .m-home .m-compare .m-knob::after { content: ""; position: absolute; inset: -9px; border-radius: 50%; }
}
@media (max-width: 760px) {
  .m-home .m-colours { grid-template-columns: minmax(0, 1fr); }
  .m-home .m-colours .m-pic { max-width: 240px; margin-inline: auto; width: 100%; }
}
.m-home .m-plans { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
@media (max-width: 880px) {
  .m-home .m-plans { grid-template-columns: minmax(0, 1fr); }
}
.m-home .m-plan { border: 1px solid var(--m-line); border-radius: 22px; padding: 28px 26px; background: var(--m-ground-rise); display: grid; gap: 14px; align-content: start; }
.m-home .m-plan .m-who { font: 600 0.75rem/1.3 var(--m-mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--m-label); }
.m-home .m-plan .m-price { font-family: var(--m-display); font-weight: 560; font-size: 3rem; line-height: 1; font-variant-numeric: tabular-nums; }
.m-home .m-plan .m-price small { font: 400 0.95rem/1 var(--m-body); color: var(--m-on-ground-soft); margin-left: 6px; }
.m-home .m-plan .m-year { font-size: 0.9rem; color: var(--m-on-ground-soft); min-height: 1.4em; }
.m-home .m-plan ul { margin: 0; padding: 16px 0 0; list-style: none; border-top: 1px solid var(--m-line); display: grid; gap: 8px; font-size: 0.96rem; color: var(--m-on-ground-soft); }
.m-home .m-plan .m-term { font-size: 0.86rem; color: var(--m-on-ground-soft); }
.m-home .m-plan.m-pick { background: var(--m-paper); color: var(--m-ink); border-color: var(--m-paper); }
.m-home .m-plan.m-pick .m-who { color: var(--m-flag-ink); }
.m-home .m-plan.m-pick .m-price small, .m-home .m-plan.m-pick ul, .m-home .m-plan.m-pick .m-year { color: var(--m-ink-soft); }
.m-home .m-plan.m-pick ul { border-top-color: var(--m-rule); }
.m-home .m-plan.m-pick .m-btn { background: var(--m-ink); color: var(--m-paper); }
.m-home .m-versus { margin-top: clamp(36px, 5vw, 56px); display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); gap: 24px clamp(28px, 6vw, 80px); align-items: center; }
.m-home .m-versus .m-say { display: grid; gap: 10px; }
.m-home .m-versus .m-say p { color: var(--m-on-ground-soft); max-width: 40ch; }
.m-home .m-versus a { text-decoration-color: var(--m-hl); text-underline-offset: 4px; }
.m-home .m-bars { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
.m-home .m-bars li { display: grid; grid-template-columns: 7.5em minmax(0, 1fr) 4.2em; gap: 14px; align-items: center; font-size: 0.98rem; }
.m-home .m-bars .m-track { height: 14px; border-radius: 999px; background: transparent; }
.m-home .m-bars .m-fill { display: block; height: 100%; border-radius: 999px; background: var(--m-bar); min-width: 6px; }
.m-home .m-bars .m-us .m-fill { background: var(--m-hl); }
.m-home .m-bars .m-amount { font-family: var(--m-mono); font-variant-numeric: tabular-nums; text-align: right; }
.m-home .m-bars .m-us { font-weight: 600; }
@media (max-width: 760px) {
  .m-home .m-versus { grid-template-columns: minmax(0, 1fr); }
  .m-home .m-bars li { grid-template-columns: 6.6em minmax(0, 1fr) 3.8em; gap: 10px; }
}
.m-home .m-small { font-size: 0.86rem; color: var(--m-on-ground-soft); max-width: 86ch; margin-top: 22px; }
.m-home .m-close { border: 1px solid var(--m-line); border-radius: 28px; background: var(--m-ground-rise); padding: clamp(40px, 7vw, 84px) clamp(22px, 5vw, 72px); display: grid; gap: 22px; justify-items: start; position: relative; overflow: hidden; }
.m-home .m-close > * { position: relative; z-index: 1; }
.m-home .m-close::before { content: ""; position: absolute; z-index: 0; right: -10%; top: 50%; width: 60%; height: 160%; transform: translateY(-50%); background: radial-gradient(closest-side, color-mix(in srgb, var(--brass-ui) 26%, transparent), transparent); pointer-events: none; }
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-close .m-rings ellipse { animation: m-ripple 7s ease-out infinite; }
  .m-home .m-close .m-rings ellipse:nth-child(2) { animation-delay: 1.75s; }
  .m-home .m-close .m-rings ellipse:nth-child(3) { animation-delay: 3.5s; }
  .m-home .m-close .m-rings ellipse:nth-child(4) { animation-delay: 5.25s; }
}
.m-home .m-close .m-rings { position: absolute; z-index: 0; left: 86%; top: 50%; width: 62%; height: 240%; }
.m-home .m-close h2 { font-size: clamp(2.2rem, 5.2vw, 4rem); }
.m-home .m-hero-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 320px); column-gap: clamp(60px, 9vw, 150px); }
@media (min-width: 900px) {
  .m-home #round .m-times { margin-bottom: 26px; }
}
.m-home .m-moment { position: relative; overflow: hidden; }
.m-home .m-moment .m-wrap { position: relative; z-index: 2; }
.m-home .m-wall { position: absolute; z-index: 1; top: 50%; right: -12%; width: 60%; height: 190%; transform: translateY(-50%) perspective(1500px) rotateX(46deg) rotateZ(-24deg); transform-origin: 60% 50%; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; pointer-events: none; -webkit-mask-image: radial-gradient(closest-side, black 55%, transparent 100%); mask-image: radial-gradient(closest-side, black 55%, transparent 100%); }
.m-home .m-wall .m-col { display: grid; gap: 18px; align-content: start; }
.m-home .m-wall img { width: 100%; border-radius: 16px; box-shadow: 0 24px 40px -18px rgba(0, 0, 0, 0.8); aspect-ratio: 9 / 16; object-fit: cover; object-position: top; }
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-wall .m-col { animation: m-drift 38s linear infinite; }
  .m-home .m-wall .m-col:nth-child(even) { animation-direction: reverse; animation-duration: 46s; }
}
@keyframes m-drift { from { transform: translateY(0); } to { transform: translateY(-50%); } }
.m-home .m-moment .m-grid { grid-template-columns: minmax(0, 1fr); max-width: 52%; }
@media (max-width: 820px) {
  .m-home .m-moment .m-grid { max-width: none; }
  .m-home .m-wall { position: relative; top: auto; right: auto; width: 150%; height: 300px; margin: 28px 0 -40px -25%; transform: perspective(900px) rotateX(46deg) rotateZ(-24deg); }
}
.m-home .m-phone { position: relative; box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--ink) 26%, var(--ground)), 0 30px 60px -28px var(--m-shot-shadow); }
.m-home .m-phone::after { content: ""; position: absolute; inset: 0; z-index: 5; pointer-events: none; border-radius: inherit; background: linear-gradient(118deg, rgba(255, 255, 255, 0.09) 0%, rgba(255, 255, 255, 0) 20%, rgba(255, 255, 255, 0) 78%, rgba(255, 255, 255, 0.04) 100%); }
.m-home .m-card .m-peek .m-phone { box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--ink) 26%, var(--ground)), 0 50px 100px -30px rgba(0, 0, 0, 0.8); }
.m-home .m-hero-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 330px); column-gap: clamp(70px, 11vw, 190px); }
@media (max-width: 900px) {
  .m-home .m-hero-grid { grid-template-columns: minmax(0, 1fr); column-gap: 0; }
}
.m-home .m-facts3 { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 0.93rem; color: var(--m-on-ground-soft); }
.m-home .m-facts3 li { display: inline-flex; align-items: center; gap: 9px; }
.m-home .m-facts3 li::before { content: ""; width: 6px; height: 11px; border: solid var(--m-hl); border-width: 0 2px 2px 0; transform: rotate(45deg) translateY(-2px); }
.m-home .m-news { justify-self: start; display: inline-flex; align-items: center; gap: 10px; font-size: 0.9rem; text-decoration: none; color: var(--m-on-ground-soft); padding: 6px 14px 6px 6px; border: 1px solid var(--m-line); border-radius: 999px; background: color-mix(in srgb, var(--m-ground-rise) 60%, transparent); }
.m-home .m-news b { font: 600 0.75rem/1 var(--m-mono); letter-spacing: 0.1em; text-transform: uppercase; background: var(--m-hl); color: var(--ground); padding: 5px 8px; border-radius: 999px; }
.m-home .m-news:hover { color: var(--m-on-ground); border-color: var(--m-on-ground); }
.m-home .m-runs { list-style: none; margin: clamp(26px, 4vw, 44px) 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 10px; }
.m-home .m-runs li { font-size: 0.95rem; padding: 9px 15px; border: 1px solid var(--m-line); border-radius: 999px; color: var(--m-on-ground-soft); }
.m-home .m-runs li b { color: var(--m-on-ground); font-weight: 600; }
.m-home .m-hero::before { content: ""; position: absolute; z-index: 0; inset: -25% -10%; pointer-events: none; background: radial-gradient(38% 46% at 72% 28%, color-mix(in srgb, var(--flag) 20%, transparent), transparent 70%), radial-gradient(34% 44% at 90% 72%, color-mix(in srgb, var(--brass-ui) 22%, transparent), transparent 70%), radial-gradient(30% 40% at 52% 88%, color-mix(in srgb, var(--ink-soft) 16%, transparent), transparent 70%); filter: blur(30px); }
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-hero::before { animation: m-weather 20s ease-in-out infinite alternate; }
}
@keyframes m-weather { from { transform: translate3d(-3%, -2%, 0) rotate(-4deg) scale(1); } to { transform: translate3d(4%, 3%, 0) rotate(5deg) scale(1.12); } }
.m-home .m-card { position: relative; }
.m-home .m-card::after { content: ""; position: absolute; inset: 0; z-index: 3; pointer-events: none; opacity: 0; transition: opacity 0.3s ease; background: radial-gradient(420px 420px at var(--m-gx, 50%) var(--m-gy, 50%), rgba(255, 255, 255, 0.13), transparent 60%); }
@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .m-home .m-card.m-armed.m-in:hover { transform: perspective(1000px) rotateX(var(--m-rx, 0deg)) rotateY(var(--m-ry, 0deg)) translateY(-4px); transition: transform 0.18s ease-out; }
  .m-home .m-card:hover::after { opacity: 1; }
}
@property --m-spin { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
.m-home .m-plan.m-pick { position: relative; }
.m-home .m-plan.m-pick::before { content: ""; position: absolute; inset: -3px; border-radius: 25px; padding: 3px; pointer-events: none; background: conic-gradient(from var(--m-spin), var(--m-hl), color-mix(in srgb, var(--brass-hi) 45%, white) 12%, transparent 30%, transparent 70%, var(--m-hl)); -webkit-mask: linear-gradient(black 0 0) content-box, linear-gradient(black 0 0); -webkit-mask-composite: xor; mask: linear-gradient(black 0 0) content-box exclude, linear-gradient(black 0 0); }
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-plan.m-pick::before { animation: m-spin 6s linear infinite; }
}
@keyframes m-spin { to { --m-spin: 360deg; } }
.m-home .m-tryline .m-say { min-height: 1.5em; }
.m-home .m-tryline .m-say:empty { display: block; }
.m-home .m-tryline input.m-typing::placeholder { letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; opacity: 0.95; color: var(--m-on-ground); }
.m-home .m-hero h1 { position: relative; }
.m-home .m-putt { position: absolute; overflow: visible; pointer-events: none; height: 0.3em; }
.m-home .m-putt path { fill: none; stroke: var(--m-hl); stroke-width: 2.5; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.m-home .m-putt .m-hole { fill: var(--m-ground-deep); stroke: var(--m-on-ground-soft); stroke-width: 1.2; vector-effect: non-scaling-stroke; }
.m-home .m-putt .m-ball { fill: var(--ink); offset-path: path("M2 14 C 55 0, 130 30, 190 12"); offset-distance: 100%; opacity: 0; }
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-putt path { stroke-dasharray: var(--m-putt-len, 600); stroke-dashoffset: var(--m-putt-len, 600); animation: m-draw 1.1s ease-out 1.5s forwards; }
  .m-home .m-putt .m-ball { animation: m-roll 1.5s cubic-bezier(0.3, 0.6, 0.3, 1) 1.6s both; }
}
@keyframes m-draw { to { stroke-dashoffset: 0; } }
@keyframes m-roll { 0% { offset-distance: 0%; opacity: 1; } 85% { offset-distance: 97%; opacity: 1; transform: scale(1); } 100% { offset-distance: 100%; opacity: 0; transform: scale(0.4); } }
@media (min-width: 821px) {
  .m-home .m-wall { transform: translateY(-50%) perspective(1500px) rotateX(calc(46deg + var(--m-wy, 0) * 5deg)) rotateZ(calc(-24deg + var(--m-wx, 0) * 5deg)); transition: transform 0.4s ease-out; }
}
.m-home .m-close .m-pin { position: absolute; z-index: 0; left: 86%; top: 50%; width: 210px; height: 230px; transform: translate(-50%, -50%); pointer-events: none; overflow: visible; }
.m-home .m-close .m-pin path, .m-home .m-close .m-pin ellipse, .m-home .m-close .m-pin line { fill: none; stroke: var(--m-on-ground); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.m-home .m-close .m-pin .m-cloth { fill: var(--m-hl); stroke: var(--m-hl); }
.m-home .m-close .m-pin .m-cupline { stroke: var(--m-on-ground-soft); }
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-close.m-armed .m-pin line { stroke-dasharray: 150; stroke-dashoffset: 150; transition: stroke-dashoffset 0.9s ease-out 0.35s; }
  .m-home .m-close.m-armed .m-pin .m-cupline { stroke-dasharray: 240; stroke-dashoffset: 240; transition: stroke-dashoffset 0.9s ease-out 0.1s; }
  .m-home .m-close.m-armed .m-pin .m-cloth { opacity: 0; transform: scaleX(0); transform-origin: 105px 38px; transition: opacity 0.4s ease 1.1s, transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) 1.1s; }
  .m-home .m-close.m-armed.m-in .m-pin line, .m-home .m-close.m-armed.m-in .m-pin .m-cupline { stroke-dashoffset: 0; }
  .m-home .m-close.m-armed.m-in .m-pin .m-cloth { opacity: 1; transform: none; animation: m-wave 3.2s ease-in-out 1.8s infinite; }
}
@keyframes m-wave { 0%, 100% { transform: skewY(0deg); } 50% { transform: skewY(-5deg) scaleX(0.94); } }
@media (max-width: 760px) {
  .m-home .m-close .m-pin { left: 82%; width: 120px; height: 140px; opacity: 0.5; }
}
.m-home .m-head .m-runs { margin-top: 8px; }
.m-home .m-wide .m-screen { position: relative; }
.m-home .m-spots { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.m-home .m-spot { position: absolute; display: inline-flex; align-items: center; gap: 9px; margin: -9px 0 0 -9px; pointer-events: auto; }
.m-home .m-spot i { flex: none; width: 18px; height: 18px; border-radius: 50%; background: var(--m-hl); border: 3px solid white; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35); }
.m-home .m-spot b { font: 600 0.86rem/1.2 var(--m-body); color: var(--ink); background: color-mix(in srgb, var(--ground) 92%, transparent); padding: 8px 12px; border-radius: 10px; white-space: nowrap; opacity: 0; transform: translateX(-6px); transition: opacity 0.3s ease, transform 0.3s ease; box-shadow: 0 12px 24px -10px rgba(0, 0, 0, 0.6); }
.m-home .m-spot.m-on b, .m-home .m-spot:hover b { opacity: 1; transform: none; }
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-spot.m-on i { animation: m-ping 1.5s ease-out infinite; }
}
@keyframes m-ping { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--brass-ui) 70%, transparent), 0 2px 10px rgba(0, 0, 0, 0.35); } 100% { box-shadow: 0 0 0 16px color-mix(in srgb, var(--brass-ui) 0%, transparent), 0 2px 10px rgba(0, 0, 0, 0.35); } }
@media (max-width: 899px) {
  .m-home .m-spots { display: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-head.m-armed > * { opacity: 0; transform: translateY(20px); transition: opacity 0.6s ease, transform 0.75s cubic-bezier(0.2, 0.7, 0.2, 1); }
  .m-home .m-head.m-armed > *:nth-child(2) { transition-delay: 0.08s; }
  .m-home .m-head.m-armed > *:nth-child(3) { transition-delay: 0.16s; }
  .m-home .m-head.m-armed.m-in > * { opacity: 1; transform: none; }
}
.m-home .m-ticker { position: relative; }
.m-home .m-ticker.m-flash::after { content: ""; position: absolute; inset: 0; z-index: 2; pointer-events: none; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--brass-ui) 30%, transparent), transparent); animation: m-sweep 1.2s ease-out 1 both; }
@keyframes m-sweep { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
.m-home .m-hues { position: absolute; left: 0; right: 0; bottom: 0; height: 12px; z-index: 3; pointer-events: none; }
.m-home .m-hues i { position: absolute; top: 0; bottom: 0; }
.m-home .m-compare .m-handle { background: rgba(255, 255, 255, 0.9); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.18); }
.m-home { background-image: repeating-linear-gradient(112deg, color-mix(in srgb, var(--ink) 1.3%, transparent) 0 110px, transparent 110px 220px); background-attachment: fixed; }
.m-home .m-bars li.m-saved { margin-top: 12px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 28px; padding-top: 22px; border-top: 1px solid var(--m-line); align-items: start; }
.m-home .m-saved div { display: grid; gap: 4px; }
.m-home .m-saved b { font-family: var(--m-display); font-weight: 560; font-size: clamp(1.9rem, 3.4vw, 2.8rem); line-height: 1; color: var(--m-hl); font-variant-numeric: tabular-nums; }
.m-home .m-saved span { color: var(--m-on-ground-soft); font-size: 0.95rem; }
@media (max-width: 760px) {
  .m-home .m-bars li.m-saved { grid-template-columns: minmax(0, 1fr); }
}
.m-home #start { position: relative; }
.m-home #start::before { content: ""; position: absolute; z-index: 0; left: 0; right: 0; bottom: -40%; height: 150%; pointer-events: none; background: radial-gradient(60% 55% at 50% 100%, color-mix(in srgb, var(--brass-ui) 32%, transparent), color-mix(in srgb, var(--brass-ui) 8%, transparent) 45%, transparent 70%); }
.m-home #start .m-wrap { position: relative; z-index: 1; }
.m-home .m-kinetic { position: relative; z-index: 1; }
.m-home .m-wide .m-screen { border-color: color-mix(in srgb, var(--ink) 22%, transparent); box-shadow: 0 -1px 0 0 rgba(255, 255, 255, 0.28), 0 70px 120px -50px rgba(0, 0, 0, 0.95), 0 36px 150px -36px color-mix(in srgb, var(--brass-ui) 34%, transparent), 0 -30px 130px -60px color-mix(in srgb, var(--flag) 30%, transparent); transition-property: transform, opacity, box-shadow; }
@media (hover: hover) {
  .m-home .m-wide .m-screen.m-in:hover { box-shadow: 0 -1px 0 0 rgba(255, 255, 255, 0.4), 0 80px 130px -50px rgba(0, 0, 0, 0.95), 0 40px 170px -30px color-mix(in srgb, var(--brass-ui) 50%, transparent), 0 -30px 140px -56px color-mix(in srgb, var(--flag) 40%, transparent); }
}
.m-home .m-colours .m-pic { position: relative; }
.m-home .m-colours .m-pic::before { content: ""; position: absolute; z-index: 0; inset: 18% -30% -14%; background: radial-gradient(closest-side, color-mix(in srgb, var(--brass-ui) 26%, transparent), transparent); pointer-events: none; }
.m-home .m-colours .m-pic .m-phone { position: relative; z-index: 1; box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--ink) 34%, var(--ground)), 0 0 0 9px color-mix(in srgb, var(--ink) 4%, transparent), 0 50px 90px -30px rgba(0, 0, 0, 0.9); }
.m-home .m-card .m-peek { position: relative; }
.m-home .m-card .m-peek::before { content: ""; position: absolute; z-index: 0; inset: 12% -10% -30%; background: radial-gradient(closest-side, color-mix(in srgb, var(--brass-ui) 20%, transparent), transparent); pointer-events: none; opacity: 0.55; transition: opacity 0.4s ease; }
.m-home .m-card:hover .m-peek::before { opacity: 1; }
.m-home .m-card .m-peek .m-phone { position: relative; z-index: 1; }
.m-home .m-close .m-rings { width: 660px; height: 660px; top: calc(50% + 80px); }
@media (max-width: 899px) {
  .m-home .m-kinetic { padding: 6px 16px 30px; }
  .m-home .m-path ol { max-width: 30rem; }
}
@media (max-width: 760px) {
  .m-home .m-close .m-rings { display: none; }
  .m-home .m-close { padding-top: 96px; }
  .m-home .m-close .m-pin { left: auto; right: 22px; top: 18px; width: 70px; height: 78px; transform: none; opacity: 1; }
  .m-home .m-close::before { right: -30%; top: 0; width: 110%; height: 70%; transform: translateY(-45%); }
}
.m-home .m-pin { display: contents; }
.m-home .m-world { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: clamp(14px, 2.2vw, 30px); align-items: start; padding-top: 22px; }
.m-home .m-wphone { position: relative; margin: 0; display: grid; gap: 16px; }
.m-home .m-wphone:nth-child(2), .m-home .m-wphone:nth-child(4) { margin-top: 38px; }
.m-home .m-wphone:nth-child(3) { margin-top: 76px; }
.m-home .m-wphone .m-phone { aspect-ratio: 393 / 800; box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--ink) 34%, var(--ground)), 0 0 0 8px color-mix(in srgb, var(--ink) 4%, transparent), 0 50px 90px -34px rgba(0, 0, 0, 0.9), 0 26px 110px -26px color-mix(in srgb, var(--brass-ui) 22%, transparent); border-radius: 26px; border-width: 5px; }
.m-home .m-wphone .m-phone img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
.m-home .m-wphone .m-coin { position: absolute; z-index: 6; top: -18px; right: -12px; width: 54px; height: 54px; border-radius: 50%; display: grid; place-items: center; font: 600 1.45rem/1 var(--m-display); color: var(--ground); background: radial-gradient(circle at 34% 28%, color-mix(in srgb, var(--brass-hi) 60%, white), var(--brass-ui) 62%, color-mix(in srgb, var(--brass-ui) 78%, black)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ground) 90%, transparent), 0 12px 26px -8px color-mix(in srgb, var(--brass-ui) 70%, transparent); }
.m-home .m-wphone figcaption { display: grid; gap: 4px; text-align: center; }
.m-home .m-wphone figcaption b { font: 600 1.02rem/1.2 var(--m-body); color: var(--m-on-ground); }
.m-home .m-wphone figcaption span { font: 500 0.75rem/1 var(--m-mono); letter-spacing: 0.14em; text-transform: uppercase; color: var(--m-label); }
.m-home .m-world-also { margin-top: 34px; justify-content: center; }
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-world.m-armed .m-wphone { opacity: 0; transform: translateY(46px); transition: opacity 0.5s ease, transform 0.8s cubic-bezier(0.2, 0.7, 0.2, 1); transition-delay: calc(var(--m-i) * 90ms); }
  .m-home .m-world.m-armed.m-in .m-wphone { opacity: 1; transform: none; }
  .m-home .m-world.m-armed .m-coin { transform: scale(0) rotate(-140deg); transition: transform 0.7s cubic-bezier(0.2, 0.9, 0.2, 1.4); transition-delay: calc(var(--m-i) * 90ms + 420ms); }
  .m-home .m-world.m-armed.m-in .m-coin { transform: none; }
}
@media (max-width: 899px) {
  .m-home .m-world { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; margin-inline: -16px; padding: 40px 16px 10px; gap: 18px; scrollbar-width: none; }
  .m-home .m-world::-webkit-scrollbar { display: none; }
  .m-home .m-wphone, .m-home .m-wphone:nth-child(n) { flex: 0 0 58%; max-width: 250px; margin-top: 0; scroll-snap-align: center; }
  /* the coin PERCHES on the corner: at this size the old one sat over the two buttons in the app's own header */
  .m-home .m-wphone .m-coin { right: -8px; top: -30px; width: 46px; height: 46px; font-size: 1.25rem; }
  .m-home .m-world-also { justify-content: flex-start; }
}
@media (max-width: 899px) {
  /* THE SCREEN TAKES WHAT THE WORDS LEAVE (2026-10-13). It was a fixed 46% of the pin, and the words a
     box as tall as whatever was left over — so on a tall phone the picture stopped half-way down a
     phone it had room to show, and a band of nothing sat between the last line and the rail. Now the
     words are as tall as the longest of the seven (they share one grid cell), the rail has its strip
     at the foot, and the picture has all the rest, at any height. */
}
/* a short phone (an SE, a landscape-ish browser bar): the screen gives up height to the words, and the
   words keep clear of the flag standing at the end of the rail */
.m-home img { image-rendering: auto; }
.m-home .m-btn .m-short { display: none; }
.m-home .m-dock { display: none; }
@media (max-width: 899px) {
  .m-home .m-hero .m-lead { display: none; }
  .m-home .m-hero .m-cta-row { flex-wrap: nowrap; }
  .m-home .m-hero .m-cta-row .m-btn { flex: 1 1 0; padding-inline: 12px; }
  .m-home .m-btn .m-long { display: none; }
  .m-home .m-btn .m-short { display: inline; }
  .m-home .m-news { font-size: 0.84rem; }
  .m-home .m-runs { gap: 8px; }
  .m-home .m-runs li { font-size: 0.88rem; padding: 7px 12px; }
  .m-home #round .m-times { display: none; }
  .m-home .m-moment { display: flex; flex-direction: column-reverse; padding-bottom: 0; }
  .m-home .m-moment .m-big > span { display: block; }
  .m-home .m-moment .m-big .m-l1, .m-home .m-moment .m-big .m-l2 { white-space: normal; }
  .m-home .m-wall { margin: 34px 0 -70px -22%; height: 330px; }
  .m-home .m-wide .m-screen { aspect-ratio: 5 / 4; }
  .m-home .m-wide .m-screen img { transform: scale(1.9); transform-origin: 2% 96%; }
  .m-home .m-dock { display: flex; gap: 10px; position: fixed; z-index: 40; left: 0; right: 0; bottom: 0; padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px)); background: color-mix(in srgb, var(--m-ground-deep) 95%, transparent); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); border-top: 1px solid var(--m-line); transform: translateY(110%); visibility: hidden; transition: transform 0.3s ease, visibility 0s linear 0.3s; }
  /* out of sight is also out of reach: slid off the screen it still took keyboard focus */
  .m-home .m-dock.m-up { transform: none; visibility: visible; transition: transform 0.3s ease, visibility 0s; }
  .m-home .m-dock .m-btn { flex: 1 1 0; padding: 13px 12px; font-size: 0.95rem; }
}
@media (prefers-reduced-motion: reduce) {
  .m-home .m-dock { transition: none; }
}
/* ── what the real page adds to the prototype ── */
/* the round-code box is a demonstration; a real code goes through the real door */
.m-home .m-realcode { display: block; margin-top: 12px; font-size: 0.95rem; color: var(--m-on-ground-soft); }
.m-home .m-realcode a { color: var(--m-on-ground); text-decoration: underline; text-underline-offset: 3px; }

/* the three things under the plans that open: the plans side by side, the two platforms beside us, every feature */
.m-home .m-more { margin-top: clamp(28px, 4vw, 48px); display: grid; gap: 12px; }
.m-home .m-more > details { border: 1px solid var(--m-line); border-radius: 18px; background: var(--m-ground-rise); overflow: hidden; }
.m-home .m-more > details > summary { list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; font: 600 1.08rem/1.3 var(--m-body); color: var(--m-on-ground); min-height: 48px; }
.m-home .m-more > details > summary::-webkit-details-marker { display: none; }
.m-home .m-more > details > summary > span { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; }
.m-home .m-more > details > summary small { font: 500 0.75rem/1 var(--m-mono); letter-spacing: 0.14em; text-transform: uppercase; color: var(--m-label); }
.m-home .m-more > details > summary::after { content: "+"; font: 400 1.6rem/1 var(--m-mono); color: var(--m-hl); transition: transform 0.25s ease; }
.m-home .m-more > details[open] > summary::after { transform: rotate(45deg); }
.m-home .m-more > details > .m-in { padding: 4px 24px 26px; }
@media (max-width: 600px) { .m-home .m-more > details > summary { padding: 18px 16px; } .m-home .m-more > details > .m-in { padding: 0 12px 20px; } }

/* what is on its way, said as on its way */
.m-home .m-soon { margin-top: 26px; display: flex; flex-wrap: wrap; gap: 10px 12px; align-items: center; color: var(--m-on-ground-soft); font-size: 0.95rem; }
.m-home .m-soon b { font: 600 0.75rem/1 var(--m-mono); letter-spacing: 0.14em; text-transform: uppercase; color: var(--m-label); }
.m-home .m-soon span { border: 1px dashed var(--m-line); border-radius: 999px; padding: 8px 14px; }

/* the closing panel carries the real sign-up and sign-in form */
.m-home .m-close .m-auth { width: 100%; max-width: 460px; margin-top: 6px; }
.m-home .m-close .m-stores { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 4px; }
.m-home .m-close .m-stores-note { color: var(--m-on-ground-soft); font-size: 0.92rem; max-width: 52ch; }
.m-home .m-close .m-close-copy, .m-home .m-close .m-close-more { display: grid; gap: 18px; justify-items: start; }
/* beside the form on a wide screen: the words above, the stores beneath, the form the full height of both */
@media (min-width: 900px) {
  .m-home .m-close { grid-template-columns: minmax(0, 1fr) minmax(0, 460px); grid-template-rows: 1fr 1fr; column-gap: clamp(32px, 6vw, 90px); row-gap: 28px; align-items: start; }
  .m-home .m-close .m-close-copy { grid-column: 1; grid-row: 1; align-self: end; }
  .m-home .m-close .m-close-more { grid-column: 1; grid-row: 2; align-self: start; }
  .m-home .m-close .m-auth { grid-column: 2; grid-row: 1 / span 2; margin-top: 0; align-self: center; }
  .m-home .m-close .m-pin, .m-home .m-close .m-rings { display: none; }
}
/* ── every readable screen is shown whole, at its own shape, square and still ──
   The prototype cropped screens to a frame (object-fit: cover), scaled one up on a phone, and tilted a
   card toward the pointer. A cropped or scaled capture is not the screen, and a turned one blurs. */
/* screens that take turns share one grid cell, so each keeps the capture's own shape */
.m-home .m-compare { display: grid; aspect-ratio: auto; }
.m-home .m-compare img { position: static; inset: auto; grid-area: 1 / 1; width: 100%; height: auto; object-fit: fill; transform: none; }
/* single screens: the frame takes its height from the picture */
.m-home .m-wphone .m-phone { aspect-ratio: auto; }
.m-home .m-wphone .m-phone img { height: auto; object-fit: fill; }
/* the organizer's laptop screen, whole; on a narrow screen its place is taken by the same organizer on a phone,
   because a laptop screen shrunk to a phone's width is four-pixel text */
.m-home .m-wide .m-screen { aspect-ratio: auto; }
.m-home .m-wide .m-screen img { height: auto; object-fit: fill; transform: none; }
.m-home .m-wide .m-twin { display: none; }
@media (max-width: 899px) {
  .m-home .m-wide .m-screen { display: none; }
  .m-home .m-wide .m-twin { display: block; width: min(70vw, 270px); margin-inline: auto; }
}
/* a card lifts under the pointer; it does not turn (its screen is one you read) */
@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .m-home .m-card.m-armed.m-in:hover { transform: translateY(-4px); }
}
/* THE SECOND PHONE IS A PHONE, NOT A THUMBNAIL (Ajay, 2026-10-12: "the other screen looks tiny").
   It was cropped short and turned in depth, which shrank it twice. Now it is nearly the size of the
   first, whole, tilted flat, and half behind it — still scenery, still marked so. */
/* ON A PHONE THE PAIR IS CENTRED AS A PAIR (Ajay, 2026-10-13: "the two screenshots are coming left of
   the screen with gap on the right"). The front phone was centred and nudged 26px, with the second
   hung 62% out to its left — right for a laptop, where the organizer's screen fills the right-hand
   side, and lopsided here, where that screen is not drawn. The second phone now shows half of itself
   to the left, and the pair is moved right by half of that: a quarter of the front phone's own width,
   so it is centred at every width without a number per phone. */
/* ── EVERYONE CAN WATCH: the demo club (2026-10-24) ──
   The words and the button; beside them on a laptop, the QR for the visitor's own phone. A phone
   has no use for a code to scan with itself, so there the QR gives way to a plain link. */
.m-home .m-watch-grid { display: grid; gap: clamp(28px, 5vw, 64px); grid-template-columns: minmax(0, 1fr); align-items: center; }
.m-home .m-watch-copy { display: grid; gap: 18px; justify-items: start; max-width: 680px; }
.m-home .m-watch-links { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 18px; }
.m-home .m-watch-links a { display: inline-flex; align-items: center; min-height: 44px; color: var(--m-on-ground); text-decoration: underline; text-underline-offset: 4px; }
.m-home .m-watch-note { color: var(--m-on-ground-soft); font-size: 0.92rem; }
.m-home .m-qr { display: none; margin: 0; }
.m-home .m-qr svg { display: block; width: 200px; height: 200px; border-radius: 12px; }
.m-home .m-qr .m-qr-ground { fill: var(--m-paper); }
.m-home .m-qr .m-qr-ink { fill: var(--m-ink); }
.m-home .m-qr figcaption { display: grid; gap: 4px; margin-top: 12px; max-width: 220px; font-size: 0.92rem; color: var(--m-on-ground-soft); }
.m-home .m-qr figcaption b { color: var(--m-on-ground); }
@media (min-width: 900px) {
  .m-home .m-watch-grid { grid-template-columns: minmax(0, 1fr) auto; }
  .m-home .m-qr { display: block; }
  .m-home .m-watch-links .m-watch-card { display: none; }
}
/* ── WHO IT'S FOR: three doors, each a card that is wholly its link ── */
.m-home .m-doors { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 900px) { .m-home .m-doors { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.m-home .m-door { display: grid; gap: 10px; align-content: start; padding: 24px; border: 1px solid var(--m-line); border-radius: 16px; background: var(--m-ground-rise); color: var(--m-on-ground); text-decoration: none; min-width: 0; transition: border-color 0.15s ease; }
.m-home .m-door:hover { border-color: var(--m-on-ground); }
.m-home .m-door .m-what { font-family: var(--m-mono); font-size: 0.75rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--m-label); }
.m-home .m-door p { color: var(--m-on-ground-soft); }
.m-home .m-door .m-go { margin-top: 6px; font-weight: 600; min-height: 24px; }
/* ── ON EVERY PLAN, and three short answers ── */
.m-home .m-every-grid { display: grid; gap: clamp(32px, 5vw, 64px); grid-template-columns: minmax(0, 1fr); }
@media (min-width: 900px) { .m-home .m-every-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.m-home .m-every-grid h2 { margin: 14px 0 22px; }
.m-home .m-checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.m-home .m-checks li { display: flex; gap: 12px; align-items: baseline; }
.m-home .m-checks .m-tick { color: var(--m-hl); font-weight: 700; flex: none; }
.m-home .m-answers { display: grid; gap: 22px; align-content: start; }
.m-home .m-answer { display: grid; gap: 8px; padding-bottom: 20px; border-bottom: 1px solid var(--m-line); }
.m-home .m-answer p { color: var(--m-on-ground-soft); }
.m-home .m-answer a { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; font-weight: 600; justify-self: start; }
/* The closing glow reaches below its section on purpose, and that reach was scrollable: the page ran
   some 250px past the footer into nothing. Clipped where the page's main part ends, with clip and not hidden, so nothing
   that sticks while scrolling loses the viewport it sticks to. */
.m-home { overflow-y: clip; }
/* ── THE HERO'S STAGE (2026-11-01, hero-stage.tsx) ──
   Ajay, 1 Nov: "make it real impressive, keep up with the latest trend" — and only if it beats the stage it
   replaces, whose strength was large, lit devices. A laptop built in CSS 3D (lid, screen, aluminium deck),
   turned and lit, with the organizer's live leaderboard on it; in front, the player's phone in a real frame
   (titanium rim, side keys, glass), as large as before or larger; behind both, an AI-made plinth and glow
   (hero-scene). The phone a visitor READS stands square and still once it has arrived; only the laptop,
   which is scenery, is turned. Glass, rim light and the light on the changed row are layers over the
   pictures, never in them. */
.m-home .m-hero-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 340px); column-gap: clamp(40px, 5vw, 76px); }
.m-home .m-rig { grid-area: phone; align-self: start; position: relative; width: 100%; padding-top: 44px; }
.m-home .m-rig::before { content: ""; position: absolute; z-index: 0; left: 50%; top: 52%; width: 190%; height: 95%; transform: translate(-50%, -50%); background: radial-gradient(closest-side, color-mix(in srgb, var(--brass-ui) 30%, transparent), transparent); filter: blur(18px); pointer-events: none; }
.m-home .m-scene { position: absolute; z-index: 0; left: -70%; top: 30%; width: 360%; pointer-events: none; opacity: 0.95; -webkit-mask-image: radial-gradient(60% 62% at 52% 58%, black 55%, transparent 100%); mask-image: radial-gradient(60% 62% at 52% 58%, black 55%, transparent 100%); }
.m-home .m-scene img { width: 100%; }

/* the laptop: scenery, turned in 3D */
.m-home .m-laptop { position: absolute; z-index: 1; left: 30%; top: -3%; width: 880px; transform-style: preserve-3d; transform-origin: 0 50%; transform: perspective(2200px) rotateY(-21deg) rotateX(5deg); }
.m-home .m-lid { position: relative; padding: 13px 13px 20px; border-radius: 20px; background: linear-gradient(180deg, color-mix(in srgb, var(--ink) 9%, black), black 18%); box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--ink) 30%, black), 0 0 0 3px color-mix(in srgb, var(--ink) 10%, black), inset 0 1px 0 color-mix(in srgb, var(--ink) 22%, transparent), 50px 60px 90px -30px rgba(0, 0, 0, 0.85); }
.m-home .m-lid::before { content: ""; position: absolute; top: 5px; left: 50%; width: 5px; height: 5px; margin-left: -2.5px; border-radius: 50%; background: color-mix(in srgb, var(--ink) 18%, black); }
.m-home .m-lid-screen { position: relative; display: grid; border-radius: 6px; overflow: hidden; background: var(--paper); }
.m-home .m-lid-screen img, .m-home .m-hand-screen img { grid-area: 1 / 1; width: 100%; opacity: 0; }
.m-home .m-lid-screen img.m-on, .m-home .m-hand-screen img.m-on { opacity: 1; z-index: 2; }
.m-home .m-lid-screen img.m-was, .m-home .m-hand-screen img.m-was { opacity: 1; z-index: 1; }
.m-home .m-sheen { position: absolute; inset: 0; z-index: 4; pointer-events: none; background: linear-gradient(105deg, rgba(255, 255, 255, 0) 30%, rgba(255, 255, 255, 0.13) 44%, rgba(255, 255, 255, 0) 58%); background-size: 260% 100%; background-position: 100% 0; mix-blend-mode: screen; }
.m-home .m-deck { position: absolute; left: -7%; top: calc(100% - 3px); width: 114%; height: 470px; transform-origin: 50% 0; transform: rotateX(88deg); border-radius: 6px 6px 26px 26px; background: linear-gradient(180deg, color-mix(in srgb, var(--ink) 62%, black) 0%, color-mix(in srgb, var(--ink) 44%, black) 8%, color-mix(in srgb, var(--ink) 30%, black) 100%); box-shadow: inset 0 2px 0 color-mix(in srgb, var(--ink) 80%, white), 0 0 0 1px color-mix(in srgb, var(--ink) 20%, black); }
.m-home .m-deck::before { content: ""; position: absolute; left: 50%; top: 0; width: 18%; height: 10px; margin-left: -9%; border-radius: 0 0 10px 10px; background: color-mix(in srgb, var(--ink) 26%, black); }

/* the phone: read, so square and still once it has arrived */
.m-home .m-hand { position: relative; z-index: 3; padding: 3px; border-radius: 56px; background: linear-gradient(150deg, color-mix(in srgb, var(--ink) 62%, black) 0%, color-mix(in srgb, var(--ink) 18%, black) 10%, color-mix(in srgb, var(--ink) 9%, black) 45%, color-mix(in srgb, var(--ink) 20%, black) 82%, color-mix(in srgb, var(--brass-ui) 75%, black) 100%); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 10%, black), inset 0 1px 0 color-mix(in srgb, var(--ink) 40%, transparent), 0 70px 110px -30px rgba(0, 0, 0, 0.9), 40px 30px 140px -30px color-mix(in srgb, var(--brass-ui) 48%, transparent), -30px -20px 120px -50px color-mix(in srgb, var(--ink) 30%, transparent); }
.m-home .m-hand::after { content: ""; position: absolute; z-index: -2; left: 6%; right: 6%; bottom: -46px; height: 64px; border-radius: 50%; background: radial-gradient(closest-side, rgba(0, 0, 0, 0.75), transparent); filter: blur(6px); }
.m-home .m-keys { position: absolute; inset: 0; pointer-events: none; }
.m-home .m-keys::before, .m-home .m-keys::after { content: ""; position: absolute; width: 4px; border-radius: 2px; background: color-mix(in srgb, var(--ink) 40%, black); }
.m-home .m-keys::before { left: -3px; top: 19%; height: 58px; width: 3px; box-shadow: 0 72px 0 color-mix(in srgb, var(--ink) 40%, black); }
.m-home .m-keys::after { right: -3px; top: 26%; height: 92px; width: 3px; }
.m-home .m-hand-screen { position: relative; display: grid; border: 9px solid black; border-radius: 53px; overflow: hidden; background: var(--paper); }
.m-home .m-hand-screen::after { content: ""; position: absolute; inset: 0; z-index: 5; pointer-events: none; border-radius: inherit; background: linear-gradient(122deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 26%, rgba(255, 255, 255, 0) 82%, rgba(255, 255, 255, 0.05) 100%); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); }

/* the moment: a press on the card, a light on the row that moved */
.m-home .m-tap { position: absolute; z-index: 4; border-radius: 14px; opacity: 0; pointer-events: none; box-shadow: 0 0 0 3px var(--m-hl), 0 0 30px 6px color-mix(in srgb, var(--m-hl) 45%, transparent); }
.m-home .m-row-light { position: absolute; z-index: 3; border-radius: 12px; opacity: 0; pointer-events: none; box-shadow: 0 0 0 2.5px color-mix(in srgb, var(--m-hl) 90%, transparent), 0 0 34px 6px color-mix(in srgb, var(--m-hl) 40%, transparent); }
.m-home .m-lid-screen .m-row-light { border-radius: 4px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--m-hl) 90%, transparent), 0 0 46px 10px color-mix(in srgb, var(--m-hl) 40%, transparent); }
.m-home .m-rig.m-moved .m-row-light { opacity: 1; }
.m-home .m-chip { position: absolute; z-index: 6; left: -30%; bottom: 7%; display: inline-flex; align-items: center; gap: 10px; white-space: nowrap; font-size: 0.92rem; color: var(--m-on-ground); padding: 11px 16px; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--ink) 20%, transparent); background: color-mix(in srgb, var(--m-ground-deep) 74%, transparent); -webkit-backdrop-filter: blur(16px) saturate(1.3); backdrop-filter: blur(16px) saturate(1.3); box-shadow: 0 24px 44px -18px rgba(0, 0, 0, 0.85), inset 0 1px 0 color-mix(in srgb, var(--ink) 14%, transparent); }
.m-home .m-chip b { font-weight: 600; }
.m-home .m-chip .m-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--m-hl); box-shadow: 0 0 0 4px color-mix(in srgb, var(--m-hl) 25%, transparent); }
.m-home .m-count { display: inline-block; font-variant-numeric: tabular-nums; font-weight: 600; }
.m-home .m-toast { position: absolute; z-index: 6; right: -46%; top: -6px; display: inline-flex; align-items: center; gap: 10px; white-space: nowrap; font: 500 0.9rem/1 var(--m-body); color: var(--ground); background: var(--ink); padding: 11px 15px; border-radius: 999px; box-shadow: 0 20px 40px -14px rgba(0, 0, 0, 0.85); opacity: 0; transform: translateY(10px) scale(0.94); pointer-events: none; }
.m-home .m-toast b { font: 600 0.88rem/1 var(--m-mono); padding: 5px 8px; border-radius: 999px; background: var(--ground); color: var(--ink); }
.m-home .m-rig.m-told .m-toast { opacity: 1; transform: none; }
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-lid-screen img, .m-home .m-hand-screen img { transition: opacity 0.55s ease; }
  .m-home .m-lid-screen img { transition-delay: 0.3s; }
  .m-home .m-row-light { transition: opacity 0.5s ease 0.45s; }
  .m-home .m-rig.m-moved.m-playing .m-row-light { animation: m-glow 1.8s ease-out 0.45s 1 both; }
  .m-home .m-rig.m-tapping .m-tap { animation: m-press 0.9s ease-out 1 both; }
  .m-home .m-toast { transition: opacity 0.35s ease, transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1.25); }
  .m-home .m-count.m-bump { animation: m-bump 0.8s ease 1; }
  .m-home .m-laptop { animation: m-swing 1.4s cubic-bezier(0.2, 0.8, 0.2, 1) 0.05s both; }
  .m-home .m-hand { animation: m-lift 1.15s cubic-bezier(0.2, 0.8, 0.2, 1) 0.2s both; }
  .m-home .m-scene { animation: m-rise 1.4s ease 0s both; }
  .m-home .m-chip { animation: m-rise 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) 1.1s both; }
  .m-home .m-chip .m-dot { animation: m-pulse 1.6s ease-in-out infinite; }
  .m-home .m-sheen { animation: m-glint 9s ease-in-out 2s infinite; }
  .m-home .m-rig.m-asleep .m-chip .m-dot, .m-home .m-rig.m-asleep .m-sheen { animation-play-state: paused; }
}
@keyframes m-swing { from { opacity: 0; transform: perspective(1900px) rotateY(-64deg) rotateX(14deg) translateX(120px); } to { opacity: 1; transform: perspective(2200px) rotateY(-21deg) rotateX(5deg); } }
@keyframes m-lift { from { opacity: 0; transform: perspective(1300px) rotateX(24deg) rotateY(-20deg) translateY(90px) scale(0.92); } to { opacity: 1; transform: none; } }
@keyframes m-press { 0% { opacity: 0; transform: scale(1.25); } 30% { opacity: 1; transform: scale(0.97); } 100% { opacity: 0; transform: scale(1); } }
@keyframes m-glow { 0% { opacity: 0; } 25% { opacity: 1; box-shadow: 0 0 0 3px var(--m-hl), 0 0 60px 16px color-mix(in srgb, var(--m-hl) 60%, transparent); } 100% { opacity: 1; } }
@keyframes m-bump { 0% { color: var(--m-hl); transform: translateY(-6px); } 100% { transform: none; } }
@keyframes m-glint { 0%, 70% { background-position: 100% 0; } 100% { background-position: -60% 0; } }
@media (min-width: 1181px) {
  .m-home .m-rig { left: -80px; }
}
@media (max-width: 1180px) and (min-width: 900px) {
  .m-home .m-laptop { width: 640px; left: 50%; }
}
@media (max-width: 899px) {
  .m-home .m-hero-grid { grid-template-columns: minmax(0, 1fr); column-gap: 0; }
  .m-home .m-rig { max-width: min(80vw, 330px); margin: 18px auto 34px; padding-top: 30px; }
  .m-home .m-rig::before { width: 170%; height: 80%; }
  .m-home .m-laptop, .m-home .m-scene { display: none; }
  .m-home .m-hand { padding: 2.5px; border-radius: 48px; }
  .m-home .m-hand-screen { border-radius: 45.5px; border-width: 7px; }
  .m-home .m-chip { left: 50%; bottom: -22px; translate: -50% 0; font-size: 0.84rem; padding: 10px 14px; }
  .m-home .m-toast { right: auto; left: 50%; top: -18px; translate: -50% 0; font-size: 0.82rem; }
}
/* ── THE WEEK, ONE STEP AT A TIME (2026-11-01; "Landing story section - redesign spec", option b) ──
   It replaces the pinned story a phone was held in for five screens (Ajay, 30 Oct: "my friends just
   stopped there without scrolling down"). One frame in the page's own flow: a row of seven slides that
   snaps sideways, a seven-part bar and "2 of 7" in plain sight, ‹ › at 48px. Nothing is sticky or
   pinned, a vertical swipe on it scrolls the page, and the markup is the same with or without script,
   so the page is the height it loads at. The screens are read: they move only sideways, in the row. */
.m-home .m-week { position: relative; }
.m-home .m-week-bar { display: flex; gap: 6px; margin-bottom: 22px; }
.m-home .m-week-bar i { position: relative; flex: 1 1 0; height: 4px; border-radius: 2px; overflow: hidden; background: color-mix(in srgb, var(--m-on-ground) 20%, transparent); }
.m-home .m-week-bar i::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: var(--m-hl); transform-origin: left; transform: scaleX(0); }
.m-home .m-week-bar i.m-done::after, .m-home .m-week-bar i.m-on::after { transform: none; }
.m-home .m-week-row { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; overscroll-behavior-x: contain; scrollbar-width: none; touch-action: pan-x pan-y; }
.m-home .m-week-row::-webkit-scrollbar { display: none; }
.m-home .m-slide { flex: 0 0 100%; min-width: 0; scroll-snap-align: start; scroll-snap-stop: always; display: grid; grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: clamp(32px, 7vw, 110px); align-items: center; padding: 6px 4px 40px; }
.m-home .m-slide .m-phone { width: 100%; box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--ink) 30%, var(--ground)), 0 50px 100px -34px rgba(0, 0, 0, 0.85), 0 26px 90px -30px color-mix(in srgb, var(--brass-ui) 32%, transparent); }
.m-home .m-slide-words { display: grid; gap: 14px; align-content: center; }
.m-home .m-slide-words .m-what { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; font: 600 0.75rem/1.3 var(--m-mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--m-on-ground-soft); }
.m-home .m-of { color: var(--m-on-ground); letter-spacing: 0.08em; }
.m-home .m-slide-words .m-clock { font: 500 clamp(2.6rem, 5.4vw, 4.6rem)/1 var(--m-mono); color: var(--m-hl); letter-spacing: -0.03em; }
.m-home .m-slide-words h3 { font-size: clamp(1.6rem, 3vw, 2.5rem); max-width: 18ch; }
.m-home .m-slide-words p:last-child { color: var(--m-on-ground-soft); font-size: clamp(1rem, 1.4vw, 1.15rem); max-width: 42ch; }
.m-home .m-week-keys { display: flex; gap: 12px; justify-content: flex-end; margin-top: 4px; }
.m-home .m-key { display: inline-grid; place-items: center; width: 48px; height: 48px; padding: 0; border-radius: 50%; border: 1.5px solid var(--m-on-ground-soft); background: var(--m-ground-rise); color: var(--m-on-ground); font: 500 1.6rem/1 var(--m-body); cursor: pointer; }
.m-home .m-key:hover { border-color: var(--m-on-ground); }
.m-home .m-key[disabled] { opacity: 0.35; cursor: default; }
.m-home .m-hold span { display: block; width: 12px; height: 14px; border-inline: 4px solid currentColor; }
.m-home .m-hold.m-paused span { width: 0; height: 0; border: solid transparent; border-width: 8px 0 8px 13px; border-left-color: currentColor; margin-left: 4px; }
@media (prefers-reduced-motion: no-preference) {
  .m-home .m-week-row { scroll-behavior: smooth; }
  .m-home .m-week-bar i.m-on.m-timing::after { animation: m-fill var(--m-step, 7s) linear 1 both; }
}
@keyframes m-fill { from { transform: scaleX(0); } to { transform: none; } }
@media (max-width: 899px) {
  .m-home .m-slide { grid-template-columns: minmax(0, 1fr); gap: 20px; align-items: start; padding-bottom: 28px; }
  .m-home .m-slide .m-phone { order: 2; width: min(58vw, 240px); margin-inline: auto; }
  .m-home .m-slide-words { gap: 8px; }
  .m-home .m-slide-words .m-clock { font-size: 2.4rem; }
  .m-home .m-slide-words h3 { font-size: 1.45rem; }
  .m-home .m-week-keys { justify-content: center; }
}
`;
