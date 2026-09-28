import { landingTokens } from "@/lib/landing-palette";

/**
 * The front door's stylesheet, shared by `/` and `/faq`, scoped under `.thq`.
 *
 * Redesigned 2026-09-27 ("modern and professional", Ajay): the ground moved
 * from the warm lacquer to the PRODUCT's own neutral near-black, so the page a
 * visitor lands on and the app they sign into read as one thing. The rule that
 * holds it together is unchanged — TEAL is identity (marks, rules, buttons),
 * GREEN is meaning (live, under par, money coming your way), and ORANGE is the
 * TourneyHQ lockup and nothing else.
 *
 * EVERY COLOUR IS GENERATED. The tokens come from `landing-palette.ts`, which
 * solves each foreground against the backgrounds it is read on;
 * `landing-contrast.test.ts` grades both grounds and reads this file to prove
 * no colour here is written by hand. The few surfaces between the generated
 * ones (a raised card, a selected tab) are MIXED from those tokens rather than
 * picked, so they move with the palette when it is retuned. `black` appears
 * only in shadows and in the phone bezel and store badges, which are physical
 * objects that stay dark on either ground.
 *
 * Animation baselines live behind `.thq-js` (added by LandingEffects on mount),
 * so with JavaScript off the page is fully visible rather than stuck at
 * opacity 0 — and every tab, toggle and slider here is a native control, so it
 * works without JavaScript too.
 */
export const LANDING_CSS = `
.thq, .thq * { box-sizing: border-box; }
.thq {
${landingTokens("dark", "  ")}
  --bg: var(--ground);
  --bg-2: color-mix(in srgb, var(--ground) 50%, var(--ground-2));
  --surface: var(--ground-2);
  --surface-2: color-mix(in srgb, var(--ground-2) 94%, var(--ink));
  --surface-3: color-mix(in srgb, var(--ground-2) 88%, var(--ink));
  --line-3: color-mix(in srgb, var(--ink) 30%, transparent);
  --wash: color-mix(in srgb, var(--ink) 3%, transparent);
  --wash-2: color-mix(in srgb, var(--ink) 6%, transparent);
  --accent-a08: color-mix(in srgb, var(--brass-ui) 8%, transparent);
  --accent-a16: color-mix(in srgb, var(--brass-ui) 16%, transparent);
  --accent-a22: color-mix(in srgb, var(--brass-ui) 22%, transparent);
  --accent-a45: color-mix(in srgb, var(--brass-ui) 45%, transparent);
  --flag-a: color-mix(in srgb, var(--flag) 12%, transparent);
  --bezel: color-mix(in srgb, var(--ink-faint) 34%, black);
  --shadow-sm: 0 1px 2px rgba(0,0,0,.3);
  --shadow: 0 0 0 1px var(--line-2), 0 2px 4px rgba(0,0,0,.2), 0 24px 48px -16px rgba(0,0,0,.6);
  --shadow-xl: 0 0 0 1px var(--line-2), 0 30px 80px -20px rgba(0,0,0,.8), 0 0 120px -40px var(--accent-a22);
  --sans: var(--font-geist-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
  --mono: var(--font-geist-mono), ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  /* Display only — the hero and the closing line. Golf sets its own type in
     engraved serifs; a serif in a score column, read in sun, is a worse board. */
  --display: var(--font-display), "Hoefler Text", "Iowan Old Style", Georgia, "Times New Roman", serif;
  --ease: cubic-bezier(.32,.72,0,1);
  --wrap: 1200px;
  --r-lg: 18px; --r-xl: 24px;
  font: 400 16px/1.6 var(--sans); background: var(--bg); color: var(--ink);
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  overflow-x: clip; min-height: 100vh;
}
@media (prefers-color-scheme: light) {
  .thq {
    color-scheme: light;
${landingTokens("light", "    ")}
    --bezel: color-mix(in srgb, var(--ink-faint) 30%, black);
    --shadow: 0 0 0 1px var(--line-2), 0 2px 4px rgba(0,0,0,.06), 0 24px 48px -20px rgba(0,0,0,.22);
    --shadow-xl: 0 0 0 1px var(--line-2), 0 30px 80px -24px rgba(0,0,0,.28), 0 0 120px -40px var(--accent-a22);
  }
}
.thq :where(h1,h2,h3,h4,p,ul,figure,dl,dd) { margin: 0; padding: 0; }
.thq a { color: inherit; text-decoration: none; }
.thq svg { display: block; flex: none; }
.thq img { max-width: 100%; }
.thq :focus-visible { outline: 2px solid var(--brass-ui); outline-offset: 3px; border-radius: 6px; }
.thq .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; margin: -1px; padding: 0; border: 0; }
.thq .wrap { max-width: var(--wrap); margin: 0 auto; padding-left: max(24px, env(safe-area-inset-left)); padding-right: max(24px, env(safe-area-inset-right)); }
@media (max-width: 640px) { .thq .wrap { padding-left: max(16px, env(safe-area-inset-left)); padding-right: max(16px, env(safe-area-inset-right)); } }
.thq .i { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.thq .i-sm { width: 16px; height: 16px; }

/* ── type ── */
.thq .eyebrow { display: inline-flex; align-items: center; gap: 8px; min-height: 30px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--wash); font: 500 12.5px/1.2 var(--sans); color: var(--ink-soft); }
.thq .eyebrow i { width: 6px; height: 6px; border-radius: 50%; background: var(--brass); box-shadow: 0 0 12px var(--brass); }
.thq .kick { font: 600 12px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--brass); }
.thq .h1 { font: 600 clamp(34px, calc(8vw + 8px), 92px)/.96 var(--display); letter-spacing: -.035em; text-wrap: balance; }
.thq .h2 { font: 600 clamp(32px, 4.2vw, 54px)/1.04 var(--sans); letter-spacing: -.04em; text-wrap: balance; }
.thq .h3 { font: 600 19px/1.3 var(--sans); letter-spacing: -.015em; }
.thq .lead { font-size: clamp(17px, 1.4vw, 19px); line-height: 1.6; color: var(--ink-soft); max-width: 620px; }
.thq .accent { color: var(--brass); }
.thq .grad { background: linear-gradient(100deg, var(--brass-hi) 0%, var(--brass-ui) 55%, color-mix(in srgb, var(--brass-ui) 78%, var(--ground)) 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.thq .muted { color: var(--ink-soft); }
.thq .sec { padding: 104px 0; position: relative; }
@media (max-width: 768px) { .thq .sec { padding: 72px 0; } }
.thq .sec-head { display: grid; gap: 18px; margin-bottom: 48px; max-width: 740px; }
.thq .sec-head.center { margin-left: auto; margin-right: auto; text-align: center; justify-items: center; }
.thq .sec-head.center .lead { margin: 0 auto; }
.thq .divider { height: 1px; background: linear-gradient(90deg, transparent, var(--line-2), transparent); }
.thq .paper { background: var(--bg-2); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }

/* ── buttons ── */
.thq .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 18px; border-radius: 10px; border: 1px solid transparent; font: 600 14.5px/1 var(--sans); letter-spacing: -.01em; cursor: pointer; white-space: nowrap; transition: background .15s, color .15s, border-color .15s, box-shadow .2s, transform .15s var(--ease); }
.thq .btn-solid { background: var(--brass-ui); color: var(--on-accent); box-shadow: inset 0 1px 0 color-mix(in srgb, white 35%, transparent), 0 0 0 1px var(--accent-a45), 0 8px 24px -8px var(--accent-a45); }
.thq .btn-solid:hover { background: var(--brass-hi); transform: translateY(-1px); }
.thq .btn-ghost { background: var(--wash); border-color: var(--line-2); color: var(--ink); }
.thq .btn-ghost:hover { border-color: var(--line-3); background: var(--wash-2); }
.thq .btn-lg { min-height: 52px; padding: 0 24px; font-size: 15.5px; border-radius: 12px; }
.thq .btn .arr { transition: transform .2s var(--ease); }
.thq .btn:hover .arr { transform: translateX(3px); }
@media (hover: none) { .thq .btn-solid:hover { transform: none; } }

/* ── segmented controls: native radios, styled as tabs ── */
.thq .seg { display: inline-flex; flex-wrap: wrap; justify-content: center; gap: 4px; padding: 5px; border-radius: 14px; background: var(--surface); border: 1px solid var(--line); }
.thq .tab { position: relative; min-height: 44px; padding: 0 16px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font: 600 14px/1.2 var(--sans); color: var(--ink-soft); cursor: pointer; transition: background .18s, color .18s; }
.thq .tab .i { width: 16px; height: 16px; }
.thq .tab:hover { color: var(--ink); }
.thq .tab:has(input:checked) { background: var(--surface-3); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-2), var(--shadow-sm); }
.thq .tab:has(input:checked) .i { color: var(--brass); }
.thq .tab:has(input:focus-visible) { outline: 2px solid var(--brass-ui); outline-offset: 2px; }
.thq .seg.solid .tab:has(input:checked) { background: var(--brass-ui); color: var(--on-accent); box-shadow: none; }
.thq .seg.solid .tab:has(input:checked) .i { color: inherit; }

/* ── lockup ── */
.thq .lockup { display: inline-flex; align-items: center; min-height: 44px; flex: none; }

/* ── nav ── */
.thq .nav { position: sticky; top: 0; z-index: 50; background: color-mix(in srgb, var(--ground) 60%, transparent); backdrop-filter: saturate(1.6) blur(16px); -webkit-backdrop-filter: saturate(1.6) blur(16px); border-bottom: 1px solid transparent; transition: border-color .2s, background .2s; }
/* The app's design-system .nav rule pads its bar sideways; here the .wrap inside
   already carries the page gutter, so taking both doubled it on a phone and
   pushed a 320px nav 14px off-screen. */
.thq .nav { padding-left: 0; padding-right: 0; }
.thq .nav.scrolled { border-bottom-color: var(--line); background: color-mix(in srgb, var(--ground) 84%, transparent); }
.thq .nav-in { display: flex; align-items: center; justify-content: space-between; height: 68px; gap: 24px; }
.thq .nav-links { display: flex; gap: 4px; font: 500 14px/1 var(--sans); color: var(--ink-soft); }
.thq .nav-links a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 12px; border-radius: 8px; transition: color .15s, background .15s; }
.thq .nav-links a:hover, .thq .nav-links a[aria-current="page"] { color: var(--ink); background: var(--wash-2); }
.thq .nav-act { display: flex; gap: 8px; }
.thq .nav-act .btn { font-size: 14px; padding: 0 16px; }
@media (max-width: 960px) { .thq .nav-links { display: none; } }
.thq .nav-menu { display: none; position: relative; }
@media (max-width: 960px) { .thq .nav-menu { display: block; } }
.thq .nav-menu > summary { list-style: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 10px; border: 1px solid var(--line-2); background: var(--wash); color: var(--ink); cursor: pointer; }
.thq .nav-menu > summary::-webkit-details-marker { display: none; }
.thq .nav-menu > summary .i { width: 20px; height: 20px; }
.thq .nav-menu[open] > summary { background: var(--surface-3); }
.thq .nav-menu .menu-panel { position: absolute; right: 0; top: calc(100% + 10px); min-width: 230px; display: grid; padding: 8px; border-radius: 14px; border: 1px solid var(--line-2); background: var(--surface); box-shadow: var(--shadow-xl); z-index: 60; }
.thq .nav-menu .menu-panel a { display: flex; align-items: center; min-height: 44px; padding: 0 14px; border-radius: 10px; font: 500 15px/1 var(--sans); color: var(--ink-soft); }
.thq .nav-menu .menu-panel a:hover, .thq .nav-menu .menu-panel a[aria-current="page"] { background: var(--wash-2); color: var(--ink); }
.thq .nav-menu .menu-panel hr { border: 0; border-top: 1px solid var(--line); margin: 6px 4px; }
@media (max-width: 420px) { .thq .nav-act .btn-ghost { display: none; } }
/* 320px (iPhone SE): the logo keeps its brand step, so the room comes from the
   buttons — the menu button made the row 14px too wide there. */
@media (max-width: 360px) { .thq .nav-act { gap: 4px; } .thq .nav-act .btn { padding: 0 8px; font-size: 13.5px; } .thq .nav-in { gap: 6px; } }

/* ── hero ── */
.thq .hero { position: relative; padding: 96px 0 0; overflow: hidden; isolation: isolate; }
.thq .hero::before { content: ""; position: absolute; inset: 0; z-index: -1; background: radial-gradient(60% 50% at 50% 0%, var(--accent-a22), transparent 70%); }
.thq .hero::after { content: ""; position: absolute; inset: 0; z-index: -1; background-image: radial-gradient(color-mix(in srgb, var(--ink) 9%, transparent) 1px, transparent 1px); background-size: 28px 28px; mask-image: radial-gradient(70% 60% at 50% 20%, black, transparent 75%); -webkit-mask-image: radial-gradient(70% 60% at 50% 20%, black, transparent 75%); }
.thq .hero-copy { display: grid; justify-items: center; text-align: center; gap: 26px; max-width: 900px; margin: 0 auto; }
.thq .hero .lead { text-align: center; max-width: 680px; }
.thq .verbs { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 18px; font: 500 12.5px/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); }
.thq .verbs span { display: inline-flex; align-items: center; gap: 18px; }
.thq .verbs span + span::before { content: ""; width: 4px; height: 4px; border-radius: 50%; background: var(--line-3); }
/* One line on a phone: wrapped, it left "Crown it" alone on the second. */
@media (max-width: 600px) { .thq .verbs { gap: 6px 10px; font-size: 11.5px; letter-spacing: .08em; flex-wrap: nowrap; } .thq .verbs span { gap: 10px; } }
@media (max-width: 360px) { .thq .verbs { font-size: 10.5px; letter-spacing: .06em; } }
.thq .cta-row { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
.thq .proof { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 22px; font-size: 13.5px; color: var(--ink-soft); }
.thq .proof span { display: inline-flex; align-items: center; gap: 7px; }
.thq .proof .i { color: var(--flag); width: 16px; height: 16px; }
.thq .showcase { position: relative; margin: 72px auto 0; max-width: 1120px; padding: 0 0 0 40px; }
.thq .showcase::before { content: ""; position: absolute; left: 10%; right: 10%; top: 10%; height: 70%; background: radial-gradient(closest-side, var(--accent-a22), transparent); filter: blur(40px); z-index: -1; }
.thq .showcase .phone { position: absolute; left: -6px; bottom: -40px; width: 216px; z-index: 2; }
@media (max-width: 1000px) { .thq .showcase { padding: 0; } .thq .showcase .phone { display: none; } }
@media (max-width: 700px) {
  /* On a phone the desktop console shrinks to a stamp nobody can read; the
     player's own screen, at the size it is actually used, says more. */
  .thq .showcase .window { display: none; }
  .thq .showcase .phone { display: block; position: static; width: min(300px, 78vw); margin: 0 auto; }
}
@media (max-height: 520px) and (orientation: landscape) { .thq .hero { padding-top: 48px; } .thq .sec { padding: 64px 0; } .thq .showcase { margin-top: 40px; } .thq .h1 { font-size: clamp(34px, 6vw, 56px); } }

/* ── product frames: a browser window and a phone ── */
.thq .window { border-radius: 16px 16px 0 0; background: var(--surface); box-shadow: var(--shadow-xl); overflow: hidden; border: 1px solid var(--line-2); border-bottom: 0; }
.thq .win-bar { display: flex; align-items: center; gap: 14px; height: 42px; padding: 0 16px; background: var(--bg-2); border-bottom: 1px solid var(--line); }
.thq .dots { display: flex; gap: 7px; }
.thq .dots i { width: 11px; height: 11px; border-radius: 50%; background: var(--surface-3); }
.thq .url { flex: 1; max-width: 340px; margin: 0 auto; height: 26px; border-radius: 7px; background: var(--surface); border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; gap: 7px; font: 500 12px/1 var(--mono); color: var(--ink-faint); }
.thq .url .i { width: 12px; height: 12px; }
.thq .win-pad { width: 47px; }
@media (max-width: 600px) { .thq .url { display: none; } }
.thq .win-shot { display: block; width: 100%; height: auto; background: var(--bg); }
.thq .phone { border-radius: 34px; padding: 8px; background: linear-gradient(160deg, var(--bezel), color-mix(in srgb, var(--bezel) 40%, black)); box-shadow: 0 0 0 1px color-mix(in srgb, white 12%, transparent), 0 40px 80px -20px rgba(0,0,0,.85), 0 20px 30px -10px rgba(0,0,0,.5); }
.thq .phone .scr { border-radius: 27px; background: var(--bg); overflow: hidden; position: relative; }
.thq .phone .scr img { display: block; width: 100%; height: auto; }
.thq .real-note { display: flex; align-items: center; justify-content: center; gap: 8px; font: 500 12.5px/1.3 var(--mono); color: var(--ink-faint); margin-top: 22px; text-align: center; }
.thq .real-note i { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--flag); box-shadow: 0 0 10px var(--flag); }

/* ── dark or light screenshots — the page-wide switch ──
   Every capture exists in both of the app's appearances. Dark is the default
   (Ajay, 2026-09-27); the switch sets data-screens on .thq, and the hidden
   twin is display:none and lazy, so it is never fetched until it is shown. */
.thq:not([data-screens="light"]) .is-light, .thq[data-screens="light"] .is-dark { display: none !important; }
.thq:not(.thq-js) .screens-toggle { display: none; }
.thq .screens-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px 18px; margin-top: 64px; }
.thq .screens-bar .real-note { margin: 0; }
.thq .screens-toggle { display: inline-flex; padding: 3px; border-radius: 11px; border: 1px solid var(--line-2); background: var(--surface); }
.thq .screens-toggle button { min-height: 44px; padding: 0 14px; border-radius: 9px; border: 0; background: transparent; color: var(--ink-soft); font: 600 13.5px/1 var(--sans); cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
.thq .screens-toggle button .i { width: 16px; height: 16px; }
.thq .screens-toggle button[aria-pressed="true"] { background: var(--surface-3); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-2); }

/* ── stats strip ── */
.thq .strip { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--bg-2); position: relative; z-index: 1; margin-top: 64px; }
.thq .strip .wrap { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.thq .strip .s { padding: 34px 24px; border-left: 1px solid var(--line); display: grid; gap: 8px; }
.thq .strip .s:first-child { border-left: 0; padding-left: 0; }
.thq .strip b { font: 600 clamp(32px, 3.4vw, 44px)/1 var(--sans); letter-spacing: -.04em; }
.thq .strip span { font-size: 14px; color: var(--ink-soft); line-height: 1.45; }
@media (max-width: 860px) { .thq .strip .wrap { grid-template-columns: 1fr 1fr; } .thq .strip .s:nth-child(3) { border-left: 0; padding-left: 0; } .thq .strip .s:nth-child(-n+2) { border-bottom: 1px solid var(--line); } }
@media (max-width: 600px) { .thq .strip .s { padding: 26px 16px; } .thq .strip .s:nth-child(odd) { padding-left: 0; } }
@media (max-width: 360px) { .thq .strip .wrap { grid-template-columns: minmax(0, 1fr); } .thq .strip .s { border-left: 0 !important; padding-left: 0 !important; border-bottom: 1px solid var(--line); } .thq .strip .s:last-child { border-bottom: 0; } }

/* ── the scorecard motif ──
   Ajay, 2026-09-28: "make it unique". The signature is golf's own paper: the
   stats strip reads as a row of a scorecard — a hole number over each cell,
   each figure boxed in the app's scoreboard face (Oswald, the same tiles the
   player's Today screen uses), and the one that matters circled, the way a
   birdie is marked on a card. Colours come from the palette tokens only. */
.thq { --card-font: var(--font-board), "Arial Narrow", system-ui, sans-serif; }
.thq .strip.card-row .wrap { counter-reset: hole; }
.thq .strip.card-row .s { counter-increment: hole; gap: 12px; align-content: start; }
.thq .strip.card-row .s::before { content: "Hole " counter(hole); font: 600 11px/1 var(--card-font); letter-spacing: .16em; text-transform: uppercase; color: var(--ink-soft); padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.thq .strip.card-row b { justify-self: start; font: 600 clamp(30px, 3.2vw, 40px)/1 var(--card-font); letter-spacing: 0; padding: .14em .34em .16em; border: 1.5px solid var(--line-3); border-radius: 4px; min-width: 1.6em; text-align: center; font-variant-numeric: tabular-nums; }
.thq .strip.card-row b.accent { border-color: currentColor; border-radius: 999px; padding-inline: .42em; box-shadow: 0 0 0 3px var(--bg-2), 0 0 0 4.5px var(--accent-a45); }

/* ── formats gallery: four real boards, each titled like a scorecard header ── */
.thq .fmt-rack { display: grid; grid-template-columns: repeat(4, minmax(0, 220px)); justify-content: center; gap: 28px; margin-top: 8px; }
.thq .fmt { margin: 0; display: grid; gap: 16px; align-content: start; }
.thq .fmt figcaption { display: grid; gap: 6px; text-align: center; }
.thq .fmt figcaption b { font: 600 13px/1.2 var(--card-font); letter-spacing: .12em; text-transform: uppercase; color: var(--ink); }
.thq .fmt figcaption span { font-size: 13.5px; line-height: 1.45; color: var(--ink-soft); }
.thq .formats .real-note { text-align: center; margin-top: 28px; }
@media (max-width: 960px) { .thq .fmt-rack { grid-template-columns: repeat(2, minmax(0, 220px)); row-gap: 40px; } }
@media (max-width: 440px) { .thq .fmt-rack { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; row-gap: 32px; } .thq .fmt figcaption span { font-size: 12.5px; } }

/* ── formats ticker ── */
.thq .ticker { overflow: hidden; position: relative; padding: 8px 0; }
.thq .ticker::before, .thq .ticker::after { content: ""; position: absolute; top: 0; bottom: 0; width: 160px; z-index: 1; pointer-events: none; }
.thq .ticker::before { left: 0; background: linear-gradient(to right, var(--bg), transparent); }
.thq .ticker::after { right: 0; background: linear-gradient(to left, var(--bg), transparent); }
.thq .tick-label { text-align: center; font: 500 13px/1 var(--sans); color: var(--ink-faint); margin-bottom: 22px; }
.thq .tick-track { display: flex; gap: 10px; width: max-content; animation: thq-tick 60s linear infinite; }
.thq .tick-track span { font: 500 14px/1 var(--sans); color: var(--ink-soft); padding: 12px 16px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); white-space: nowrap; }
@keyframes thq-tick { to { transform: translateX(-50%); } }

/* ── feature bento ── */
.thq .bento { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 16px; }
.thq .cell { position: relative; background: linear-gradient(180deg, var(--surface) 0%, var(--bg-2) 100%); border: 1px solid var(--line); border-radius: var(--r-lg); padding: 28px; display: grid; align-content: start; gap: 12px; overflow: hidden; transition: border-color .25s; }
.thq .cell:hover { border-color: var(--line-2); }
.thq .cell::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: radial-gradient(400px 200px at 0% 0%, var(--wash), transparent 60%); pointer-events: none; }
.thq .ic { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-a08); border: 1px solid var(--accent-a22); color: var(--brass); }
.thq .cell .ic { margin-bottom: 4px; }
.thq .cell p { color: var(--ink-soft); font-size: 15px; line-height: 1.55; max-width: 520px; }
.thq .c4 { grid-column: span 4; } .thq .c3 { grid-column: span 3; } .thq .c2 { grid-column: span 2; }
@media (max-width: 1000px) { .thq .bento { grid-template-columns: repeat(2, minmax(0, 1fr)); } .thq .c4, .thq .c3 { grid-column: span 2; } .thq .c2 { grid-column: span 1; } }
@media (max-width: 640px) { .thq .bento { grid-template-columns: minmax(0, 1fr); } .thq .c4, .thq .c3, .thq .c2 { grid-column: span 1; } }
@media (max-width: 360px) { .thq .cell, .thq .idx-col { padding: 20px; } }
.thq .shot-fig { margin: 10px 0 0; display: grid; gap: 10px; align-content: start; }
.thq .shot { display: block; width: 100%; height: auto; border-radius: 12px; border: 1px solid var(--line-2); background: var(--bg); box-shadow: 0 1px 0 var(--wash), 0 22px 44px -22px rgba(0,0,0,.8); }
.thq .cell .shot-fig .shot { max-height: 300px; object-fit: cover; object-position: top; }
/* Every crop taken from a PHONE capture is shown at one width, so the app's
   type reads at the same size in every card — a wide card must not blow a
   phone crop up to twice the size of its neighbour's (Ajay, 2026-09-28: "this
   section doesn't match with other sections"). They are whole crops, framed
   to what the card says, so they are never cut short either. */
.thq .cell .shot-fig .shot.from-phone { width: min(100%, 360px); max-height: none; }
.thq .narrow-only { display: none; }
@media (max-width: 700px) {
  .thq .wide-only { display: none !important; }
  .thq .narrow-only { display: block; }
  /* The screens are the point of each card: on a phone they take the card's
     full width, not the width left inside its padding, and show whole. */
  .thq .bento .cell { padding: 22px 18px; }
  .thq .cell .shot-fig { margin-inline: -8px; }
  .thq .cell .shot-fig .shot, .thq .cell .shot-fig .shot.from-phone { width: 100%; max-height: none; }
}
.thq .shot-fig figcaption { display: flex; align-items: center; gap: 7px; font: 500 12.5px/1.3 var(--mono); color: var(--ink-faint); }
.thq .shot-fig figcaption i { flex: none; width: 5px; height: 5px; border-radius: 50%; background: var(--flag); }
.thq .shot-fig.panel { margin: 0; }
.thq .shot-fig.panel .shot { border-radius: 16px; box-shadow: var(--shadow); }
.thq .shot-fig.panel figcaption { justify-content: center; }
.thq .shot-fig.panel.narrow { max-width: 340px; justify-self: center; width: 100%; }

/* ── how it works ── */
.thq .steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; position: relative; }
.thq .steps::before { content: ""; position: absolute; top: 21px; left: 22px; right: 22px; height: 1px; background: linear-gradient(90deg, var(--brass-ui), var(--line-2) 60%, var(--line)); }
.thq .step { position: relative; display: grid; gap: 14px; align-content: start; padding-right: 12px; }
.thq .step .n { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: var(--surface); border: 1px solid var(--line-2); font: 600 14px/1 var(--mono); color: var(--brass); position: relative; z-index: 1; }
.thq .step h3 { font: 600 26px/1.1 var(--display); letter-spacing: -.02em; }
.thq .step p { color: var(--ink-soft); font-size: 15px; }
.thq .step ul { list-style: none; display: grid; gap: 9px; margin-top: 4px; }
.thq .step li { display: grid; grid-template-columns: 16px 1fr; gap: 10px; font-size: 14px; line-height: 1.45; }
.thq .step li .i { width: 16px; height: 16px; color: var(--flag); margin-top: 2px; }
@media (max-width: 1000px) { .thq .steps { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 44px; } .thq .steps::before { display: none; } }
@media (max-width: 600px) { .thq .steps { grid-template-columns: minmax(0, 1fr); } }

/* ── who it's for ── */
.thq .aud .seg { margin-bottom: 40px; }
.thq .aud-panel { display: none; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 56px; align-items: center; }
.thq .aud:has(input[value="club"]:checked) .aud-panel[data-p="club"],
.thq .aud:has(input[value="league"]:checked) .aud-panel[data-p="league"],
.thq .aud:has(input[value="day"]:checked) .aud-panel[data-p="day"],
.thq .aud:has(input[value="casual"]:checked) .aud-panel[data-p="casual"] { display: grid; animation: thq-fade .4s var(--ease); }
@keyframes thq-fade { from { opacity: 0; transform: translateY(8px); } }
@media (max-width: 900px) { .thq .aud-panel { grid-template-columns: minmax(0, 1fr); gap: 32px; } }
@media (max-width: 600px) { .thq .aud .seg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; } .thq .aud .tab { padding: 6px 10px; font-size: 13.5px; text-align: center; } }
.thq .aud-copy { display: grid; gap: 18px; }
.thq .aud-copy h3 { font: 600 clamp(26px, 2.8vw, 34px)/1.12 var(--sans); letter-spacing: -.03em; }
.thq .aud-copy p { color: var(--ink-soft); font-size: 16.5px; }
.thq .checks { list-style: none; display: grid; gap: 13px; margin-top: 6px; }
.thq .checks li { display: grid; grid-template-columns: 22px 1fr; gap: 12px; font-size: 15px; line-height: 1.5; }
.thq .checks .ck { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--flag-a); color: var(--flag); margin-top: 1px; }
.thq .checks .ck .i { width: 13px; height: 13px; stroke-width: 2.5; }

/* ── for the player ── */
.thq .feats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; margin-top: 36px; }
@media (max-width: 700px) { .thq .feats { grid-template-columns: minmax(0, 1fr); } }
.thq .feat { display: grid; grid-template-columns: 40px 1fr; gap: 16px; padding: 14px; border-radius: 14px; transition: background .2s; }
.thq .feat:hover { background: var(--surface); }
.thq .feat .ic { width: 40px; height: 40px; border-radius: 11px; }
.thq .feat h4 { font: 600 15.5px/1.3 var(--sans); margin-bottom: 3px; }
.thq .feat p { font-size: 14.5px; color: var(--ink-soft); }
.thq .feats.yours { grid-template-columns: minmax(0, 1fr); margin-top: 0; }

.thq .player-phones { display: grid; grid-template-columns: repeat(3, minmax(0, 230px)); justify-content: center; align-items: end; gap: 28px; margin-top: 56px; }
.thq .player-phones .phone:nth-child(2) { transform: translateY(-28px); }
@media (max-width: 700px) {
  .thq .player-phones { grid-template-columns: repeat(2, minmax(0, 170px)); gap: 16px; }
  .thq .player-phones .phone:nth-child(2) { transform: none; }
  .thq .player-phones .phone:nth-child(3) { display: none; }
}

/* ── desktop and phone ── */
.thq .dp { display: grid; justify-items: center; gap: 22px; }
.thq .dp-set { display: none; width: 100%; justify-items: center; gap: 22px; }
.thq .dp:has(input[value="live"]:checked) .dp-set[data-dp="live"],
.thq .dp:has(input[value="console"]:checked) .dp-set[data-dp="console"],
.thq .dp:has(input[value="player"]:checked) .dp-set[data-dp="player"] { display: grid; }
.thq .dp-stage { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) 250px; gap: 32px; align-items: end; }
.thq .dp-window { border-radius: 14px; border-bottom: 1px solid var(--line-2); }
.thq .dp-window img { display: block; width: 100%; height: auto; }
.thq .dp-phone { width: 250px; }
.thq .dp .real-note { margin-top: 0; }
@media (max-width: 860px) { .thq .dp-stage { grid-template-columns: minmax(0, 1fr); justify-items: center; gap: 28px; } .thq .dp-phone { width: min(240px, 70vw); } }

/* ── the money ── */
.thq .money { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 72px; align-items: center; }
@media (max-width: 1000px) { .thq .money { grid-template-columns: minmax(0, 1fr); } }
.thq .games { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 28px; }
.thq .games span { font: 500 13.5px/1 var(--sans); padding: 10px 14px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-soft); }
.thq .money-note { margin-top: 24px; font-size: 14.5px; color: var(--ink-soft); max-width: 560px; }
.thq .money-shot { display: grid; justify-items: center; }
.thq .money-shot .phone { width: min(300px, 78vw); }
.thq .money-shot .real-note { margin-top: 18px; }

/* ── make it yours: the comparison viewer ── */
.thq .yours-head { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 56px; align-items: end; }
@media (max-width: 900px) { .thq .yours-head { grid-template-columns: minmax(0, 1fr); gap: 28px; } }
.thq .compare { display: grid; justify-items: center; gap: 18px; margin-top: 44px; }
.thq .compare .seg.mode { background: var(--bg-2); border-color: var(--line-2); }
.thq .cmp-tabs { display: none; }
.thq .compare:has(input[name="cmp-mode"][value="ap"]:checked) .cmp-tabs[data-set="ap"],
.thq .compare:has(input[name="cmp-mode"][value="col"]:checked) .cmp-tabs[data-set="col"] { display: inline-flex; }
.thq .cmp-f { display: none; justify-items: center; gap: 18px; width: 100%; }
__CMP_FRAMES__
.thq .cmp-frame.phone { width: min(300px, 78vw); }
.thq .cmp-frame.phone .cmp-view { border-radius: 27px; }
.thq .cmp-frame.window { width: min(960px, 100%); border-radius: 14px; border: 1px solid var(--line-2); box-shadow: var(--shadow-xl); overflow: hidden; }
.thq .cmp-view { position: relative; overflow: hidden; --pos: 50%; touch-action: pan-y; }
.thq .cmp-view img { display: block; width: 100%; height: auto; user-select: none; -webkit-user-drag: none; }
.thq .cmp-view .cmp-b { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; clip-path: inset(0 0 0 var(--pos)); }
.thq .cmp-line { position: absolute; top: 0; bottom: 0; left: var(--pos); width: 2px; margin-left: -1px; background: var(--brass-ui); box-shadow: 0 0 0 1px rgba(0,0,0,.35); pointer-events: none; }
.thq .cmp-line i { position: absolute; top: 50%; left: 50%; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%; background: var(--brass-ui); box-shadow: 0 4px 14px rgba(0,0,0,.5); }
.thq .cmp-line i::before, .thq .cmp-line i::after { content: ""; position: absolute; top: 50%; width: 0; height: 0; border: 5px solid transparent; margin-top: -5px; }
.thq .cmp-line i::before { left: 6px; border-right-color: var(--on-accent); }
.thq .cmp-line i::after { right: 6px; border-left-color: var(--on-accent); }
.thq .cmp-range { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; touch-action: pan-y; }
.thq .cmp-view:focus-within .cmp-line i { outline: 2px solid var(--ink); outline-offset: 2px; }
.thq .cmp-legend { display: flex; align-items: center; gap: 14px; font: 600 13px/1.3 var(--sans); color: var(--ink-soft); }
.thq .cmp-legend span { display: inline-flex; align-items: center; gap: 6px; max-width: 42vw; text-align: center; }
.thq .cmp-legend .i { width: 15px; height: 15px; }
.thq .cmp-hint { font: 500 12px/1 var(--mono); color: var(--ink-faint); }
.thq .cmp-f .real-note { margin-top: 0; max-width: 520px; }

/* ── the whole list ── */
.thq .idx { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 1000px) { .thq .idx { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .thq .idx { grid-template-columns: minmax(0, 1fr); } }
.thq .idx-col { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); padding: 24px; }
.thq .idx-col h3 { display: flex; align-items: center; gap: 10px; font: 600 15px/1.2 var(--sans); margin-bottom: 16px; }
.thq .idx-col h3 .ic { width: 32px; height: 32px; border-radius: 9px; border: 0; }
.thq .idx-col h3 .ic .i { width: 17px; height: 17px; }
.thq .idx-col h3 em { font: 500 12px/1 var(--mono); color: var(--ink-faint); font-style: normal; margin-left: auto; }
.thq .idx-col ul { list-style: none; display: grid; }
.thq .idx-col li { display: grid; grid-template-columns: 16px 1fr; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); font-size: 14px; line-height: 1.45; }
.thq .idx-col li:first-child { border-top: 0; }
.thq .idx-col li .i { width: 15px; height: 15px; color: var(--flag); margin-top: 3px; stroke-width: 2.2; }
.thq .idx-col li small { display: block; color: var(--ink-faint); font-size: 12.5px; margin-top: 1px; }
.thq .idx-all:not(:has(.idx-more input:checked)) .idx-col li:nth-child(n+7) { display: none; }
.thq .idx-more { display: flex; justify-content: center; margin-top: 24px; }
.thq .idx-more label { position: relative; display: inline-flex; align-items: center; min-height: 44px; padding: 0 20px; border-radius: 10px; border: 1px solid var(--line-2); background: var(--wash); color: var(--ink); font: 600 14px/1 var(--sans); cursor: pointer; }
.thq .idx-more label:hover { border-color: var(--brass-ui); color: var(--brass); }
.thq .idx-more label:has(input:focus-visible) { outline: 2px solid var(--brass-ui); outline-offset: 2px; }
.thq .idx-more label:has(input:checked) .when-closed, .thq .idx-more label:not(:has(input:checked)) .when-open { display: none; }

/* ── how it compares ── */
.thq .vs { display: grid; justify-items: center; }
.thq .vs > * { width: 100%; }
.thq .vs .vs-tabs { width: auto; margin-bottom: 18px; }
.thq .vs-set { display: none; }
.thq .vs:has(input[name="vs-set"][value="club"]:checked) .vs-set[data-set="club"],
.thq .vs:has(input[name="vs-set"][value="apps"]:checked) .vs-set[data-set="apps"] { display: block; animation: thq-fade .35s var(--ease); }
.thq .vs-intro { text-align: center; color: var(--ink-soft); font-size: 15px; margin: 0 auto 18px; max-width: 620px; }
.thq .vs-table[data-cols="4"] { min-width: 900px; }
.thq .glance { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 28px; }
@media (max-width: 800px) { .thq .glance { grid-template-columns: minmax(0, 1fr); } }
.thq .glance-col { border: 1px solid var(--line-2); border-radius: var(--r-lg); padding: 24px; background: var(--surface); }
.thq .glance-col.further { background: var(--bg-2); }
.thq .glance-col h3 { margin-bottom: 14px; }
.thq .glance-col ul { list-style: none; display: grid; gap: 11px; }
.thq .glance-col li { display: grid; grid-template-columns: 18px 1fr; gap: 10px; font-size: 14.5px; line-height: 1.5; color: var(--ink-soft); }
.thq .glance-col li .i { width: 17px; height: 17px; color: var(--flag); margin-top: 2px; stroke-width: 2.2; }
.thq .glance-col li .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-faint); margin: 8px 0 0 5px; }
.thq .vs-scroll { overflow-x: auto; border: 1px solid var(--line-2); border-radius: 18px; background: var(--surface); -webkit-overflow-scrolling: touch; }
.thq .vs-table { width: 100%; min-width: 720px; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
.thq .vs-table th, .thq .vs-table td { vertical-align: top; }
.thq .vs-table thead th { font: 650 16px/1.2 var(--sans); letter-spacing: -.01em; color: var(--ink); text-align: left; padding: 22px 18px 16px; border-bottom: 1px solid var(--line-2); }
.thq .vs-table thead th:first-child { width: 190px; }
.thq .vs-table tbody th { font: 600 11.5px/1.4 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-faint); text-align: left; padding: 18px; }
.thq .vs-table td { font-size: 14px; line-height: 1.45; color: var(--ink-soft); padding: 18px; }
.thq .vs-table tbody tr + tr > * { border-top: 1px solid var(--line); }
.thq .vs-table .hot { background: var(--accent-a08); color: var(--ink); }
.thq .vs-table thead th.hot { color: var(--brass); box-shadow: inset 0 3px 0 var(--brass-ui); }
.thq .vs-table td b { font-weight: 600; color: var(--ink); }
.thq .vs-table tbody th, .thq .vs-table thead th:first-child { position: sticky; left: 0; z-index: 1; background: var(--surface); }
.thq .vs-mk { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; margin: 0 8px 0 0; font: 700 11px/1 var(--sans); vertical-align: -3px; }
.thq .vs-mk.yes { background: var(--flag-a); color: var(--flag); }
.thq .vs-mk.no { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger); }
.thq .vs-mk.part { background: color-mix(in srgb, var(--warn) 14%, transparent); color: var(--warn); }
.thq .vs-mk.na { background: var(--wash-2); color: var(--ink-faint); }
.thq .vs-srcrow td { font: 500 11.5px/1.3 var(--mono); color: var(--ink-faint); overflow-wrap: anywhere; }
.thq .vs-srcrow a:hover { color: var(--brass); }
.thq .vs-hint { display: none; margin: 10px 0 0; text-align: right; font: 500 12px/1 var(--mono); color: var(--ink-faint); }
.thq .vs-legal { max-width: 760px; margin: 24px auto 0; text-align: center; font-size: 12.5px; line-height: 1.55; color: var(--ink-faint); }
@media (max-width: 980px) { .thq .vs-hint { display: block; } .thq .vs-table thead th:first-child { width: 118px; } }
/* On a phone (Ajay, 2026-09-28: "comparisons should show side by side"):
   TourneyHQ and ONE competitor, two columns that fit and read, with the chips
   above choosing which competitor. Each row is its question across the top,
   then the two answers side by side. The product names stay pinned under the
   nav while the rows scroll past. */
.thq .vs-pick { display: none; }
@media (max-width: 700px) {
  .thq .vs-pick { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; margin: 0 0 14px; }
  .thq .vs-pick-lead { font: 600 12px/1 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-faint); margin-right: 2px; }
  .thq .vs-pick .chip { min-height: 44px; padding: 0 14px; border-radius: 999px; display: inline-flex; align-items: center; border: 1px solid var(--line-2); background: var(--surface); font: 600 13.5px/1 var(--sans); color: var(--ink-soft); cursor: pointer; }
  .thq .vs-pick .chip:has(input:checked) { background: var(--ink); color: var(--ground); border-color: var(--ink); }
  .thq .vs-pick .chip:has(input:focus-visible) { outline: 2px solid var(--brass-ui); outline-offset: 2px; }
  .thq .vs-set:has(.vs-pick input[value="0"]:checked) .vs-table tr > :nth-child(n+4),
  .thq .vs-set:has(.vs-pick input[value="1"]:checked) .vs-table tr > :is(:nth-child(3), :nth-child(n+5)),
  .thq .vs-set:has(.vs-pick input[value="2"]:checked) .vs-table tr > :is(:nth-child(3), :nth-child(4)) { display: none; }
  .thq .vs-scroll { overflow: visible; border-radius: 16px; }
  .thq .vs-table, .thq .vs-table[data-cols="4"] { min-width: 0; table-layout: auto; display: block; }
  .thq .vs-table thead, .thq .vs-table tbody { display: block; }
  .thq .vs-table tr { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  /* Under the nav: its 68px row, the design-system .nav padding above and below it, and its 1px rule. */
  .thq .vs-table thead { position: sticky; top: calc(69px + 2 * var(--space-3, 12px)); z-index: 3; }
  .thq .vs-table thead th { font-size: 14.5px; padding: 14px 12px 12px; background: var(--surface); position: static; }
  .thq .vs-table thead th:first-child { display: none; }
  .thq .vs-table thead th:nth-child(2) { border-top-left-radius: 16px; }
  .thq .vs-table thead th:last-child { border-top-right-radius: 16px; }
  .thq .vs-table thead th.hot { background: color-mix(in srgb, var(--brass-ui) 8%, var(--surface)); }
  .thq .vs-table tbody th { grid-column: 1 / -1; position: static; padding: 14px 12px 4px; background: none; font-size: 11px; color: var(--ink-faint); }
  .thq .vs-table td { font-size: 13px; line-height: 1.42; padding: 6px 12px 14px; }
  .thq .vs-table .vs-mk { width: 16px; height: 16px; margin-right: 6px; font-size: 10px; }
  .thq .vs-table tbody tr + tr > * { border-top: 0; }
  .thq .vs-table tbody tr + tr { border-top: 1px solid var(--line); }
  .thq .vs-hint { display: none; }
}

/* ── pricing ── */
.thq .per-y { display: none; }
.thq #pricing:has(input[name="bill"][value="y"]:checked) .per-y { display: inline; }
.thq #pricing:has(input[name="bill"][value="y"]:checked) .per-m { display: none; }
.thq .bill { margin-top: 10px; }
.thq .bill em { font-style: normal; font: 600 11px/1 var(--mono); color: var(--flag); background: var(--flag-a); padding: 4px 7px; border-radius: 6px; }
.thq .ed-note { font-size: 13.5px; color: var(--ink-faint); margin-top: 14px; display: flex; flex-wrap: wrap; gap: 6px 10px; justify-content: center; align-items: center; }
.thq .ed-note button { min-height: 44px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--line-2); background: var(--wash); color: var(--ink); font: 600 13.5px/1 var(--sans); cursor: pointer; }
.thq .ed-note button:hover { border-color: var(--brass-ui); color: var(--brass); }
.thq .tiers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: stretch; }
@media (max-width: 1000px) { .thq .tiers { gap: 12px; } .thq .tier { padding: 24px 18px; } .thq .tier .price b { font-size: 38px; } }
.thq .tier { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-xl); padding: 30px 28px; display: grid; grid-template-rows: auto auto auto auto 1fr auto; gap: 18px; position: relative; }
.thq .tier.hot { background: linear-gradient(180deg, color-mix(in srgb, var(--brass-ui) 10%, transparent), var(--surface) 45%); border-color: var(--accent-a45); box-shadow: 0 0 0 1px var(--accent-a22), 0 30px 70px -30px var(--accent-a45); }
.thq .tier .badge { position: absolute; top: 18px; right: 18px; font: 600 11px/1 var(--mono); letter-spacing: .06em; text-transform: uppercase; background: var(--brass-ui); color: var(--on-accent); padding: 6px 9px; border-radius: 7px; }
.thq .tier h3 { font: 600 18px/1 var(--sans); letter-spacing: -.01em; }
.thq .tier .for { font-size: 14px; color: var(--ink-soft); min-height: 44px; margin-top: -6px; }
.thq .price { display: flex; align-items: baseline; gap: 6px; }
.thq .price b { font: 600 50px/1 var(--sans); letter-spacing: -.045em; }
.thq .price > span { color: var(--ink-faint); font-size: 15px; }
.thq .price-sub { font-size: 13px; color: var(--ink-faint); margin-top: -10px; min-height: 18px; }
.thq .tier ul { list-style: none; display: grid; gap: 11px; align-content: start; padding-top: 18px; border-top: 1px solid var(--line); }
.thq .tier li { display: grid; grid-template-columns: 18px 1fr; gap: 10px; font-size: 14.5px; line-height: 1.45; }
.thq .tier li .i { width: 17px; height: 17px; color: var(--flag); margin-top: 2px; stroke-width: 2.2; }
.thq .tier .note { font-size: 12.5px; color: var(--ink-faint); line-height: 1.5; }
.thq .tier .btn { width: 100%; }
@media (max-width: 420px) { .thq .price b { font-size: 42px; } .thq .tier { padding: 26px 20px; } }
/* On a phone the plans stay side by side (Ajay, 2026-09-28): each card is its
   plan's head — name, price, button — and the table under them says what
   each includes, in the same three columns. After the tier rules, so it wins. */
.thq .plan-grid { display: none; }
@media (max-width: 700px) {
  .thq .tiers { gap: 8px; }
  .thq .tier { padding: 16px 10px 14px; gap: 10px; grid-template-rows: none; align-content: start; justify-items: center; text-align: center; border-radius: 16px; }
  .thq .tier .for, .thq .tier ul, .thq .tier .note, .thq .tier .price-sub { display: none; }
  .thq .tier .badge { position: static; order: -1; font-size: 9.5px; padding: 4px 6px; }
  .thq .tier:not(.hot)::before { content: ""; order: -1; height: 17.5px; }
  .thq .tier h3 { font-size: 15px; }
  .thq .tier .price { flex-direction: column; align-items: center; gap: 2px; }
  .thq .tier .price b { font-size: clamp(22px, 7vw, 30px); }
  .thq .tier .price > span { font-size: 12px; }
  .thq .tier .btn { min-height: 44px; padding: 0 6px; font-size: 13px; }
  .thq .plan-grid { display: block; margin-top: 10px; border: 1px solid var(--line-2); border-radius: 16px; background: var(--surface); overflow: hidden; }
  .thq .plan-grid tbody { display: block; }
  .thq .plan-grid tr { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 8px; padding: 0 0 12px; }
  .thq .plan-grid tr + tr { border-top: 1px solid var(--line); }
  .thq .plan-grid th { grid-column: 1 / -1; text-align: center; padding: 12px 12px 8px; font: 600 11px/1.35 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); }
  .thq .plan-grid td { display: grid; place-items: center; text-align: center; font: 600 13.5px/1.3 var(--sans); color: var(--ink); min-height: 24px; }
  .thq .plan-grid td.hot { color: var(--brass); }
  .thq .plan-grid .pg-yes .i { width: 18px; height: 18px; color: var(--flag); stroke-width: 2.4; }
  .thq .plan-grid .pg-no { color: var(--ink-faint); }
}
@media (max-width: 360px) { .thq .tier { padding: 14px 6px 12px; } .thq .tier .btn { font-size: 12px; } }
.thq .ultimate { margin-top: 16px; display: grid; grid-template-columns: auto 1fr auto; gap: 22px; align-items: center; padding: 24px 28px; border-radius: var(--r-xl); border: 1px solid var(--line); background: var(--bg-2); }
.thq .ultimate .ic { width: 44px; height: 44px; border-radius: 12px; background: var(--surface-2); color: var(--ink-soft); border-color: var(--line); }
.thq .ultimate h3 { font: 600 17px/1.25 var(--sans); margin-bottom: 3px; }
.thq .ultimate p { color: var(--ink-soft); font-size: 14.5px; }
@media (max-width: 700px) { .thq .ultimate { grid-template-columns: minmax(0, 1fr); } }
.thq .metered { margin: 24px auto 0; text-align: center; font-size: 13.5px; color: var(--ink-faint); max-width: 720px; }

/* ── questions (the landing's eight, and /faq) ── */
.thq .faq { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 72px; }
@media (max-width: 900px) { .thq .faq { grid-template-columns: minmax(0, 1fr); gap: 32px; } }
.thq .faq details.q { border: 1px solid var(--line); border-radius: 14px; background: var(--surface); margin-bottom: 10px; transition: border-color .2s, background .2s; }
.thq .faq details.q[open] { border-color: var(--line-2); background: var(--surface-2); }
.thq .faq details.q > summary { list-style: none; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 20px; min-height: 44px; padding: 18px 20px; font: 600 16px/1.4 var(--sans); letter-spacing: -.01em; color: var(--ink); }
.thq .faq summary::-webkit-details-marker { display: none; }
.thq .faq .pm { flex: none; width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--line-2); display: grid; place-items: center; color: var(--ink-soft); font-weight: 500; transition: transform .25s var(--ease), background .2s, color .2s; }
.thq .faq details.q[open] .pm { transform: rotate(45deg); background: var(--brass-ui); border-color: var(--brass-ui); color: var(--on-accent); }
.thq .faq .ans { padding: 0 64px 20px 20px; color: var(--ink-soft); font-size: 15.5px; display: grid; gap: 14px; }
@media (max-width: 600px) { .thq .faq .ans { padding-right: 20px; } }
@media (max-width: 360px) { .thq .faq details.q > summary { padding: 16px; } .thq .faq .ans { padding: 0 16px 18px; } }
.thq .ans ul { list-style: none; display: grid; gap: 8px; }
.thq .ans li { display: grid; grid-template-columns: 14px 1fr; gap: 10px; }
.thq .ans li::before { content: ""; width: 6px; height: 6px; border-radius: 2px; background: var(--brass-ui); margin-top: 9px; }
.thq .ans strong { color: var(--ink); }
.thq .ans a, .thq .faq-more a:not(.btn) { color: var(--brass); text-decoration: underline; text-underline-offset: 3px; }
.thq .hc { display: grid; grid-template-columns: 1fr auto; border: 1px solid var(--line-2); border-radius: 12px; overflow: hidden; font-size: 14px; max-width: 420px; background: var(--bg); }
.thq .hc span { padding: 10px 14px; border-bottom: 1px solid var(--line); }
.thq .hc span:nth-child(even) { text-align: right; font-family: var(--mono); color: var(--ink); }
.thq .hc span.t { font-weight: 600; color: var(--ink); border-bottom: 0; background: var(--accent-a08); }
.thq .hc span.t:nth-child(even) { color: var(--brass); }
.thq .fmts { display: flex; flex-wrap: wrap; gap: 6px; }
.thq .fmts span { font: 500 13px/1 var(--sans); padding: 8px 11px; border-radius: 999px; border: 1px solid var(--line-2); color: var(--ink); background: var(--bg); }
.thq .tierlist { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 560px) { .thq .tierlist { grid-template-columns: minmax(0, 1fr); } }
.thq .tierlist div { border: 1px solid var(--line-2); border-radius: 12px; padding: 12px 14px; background: var(--bg); display: grid; gap: 4px; }
.thq .tierlist b { font: 600 14px/1.2 var(--sans); color: var(--ink-soft); }
.thq .tierlist span { font: 600 22px/1 var(--sans); letter-spacing: -.03em; color: var(--ink); }
.thq .tierlist small { font-size: 13px; color: var(--ink-faint); }
.thq .faq-more { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: center; margin-top: 24px; }
.thq .faq-more small { font-size: 14px; color: var(--ink-soft); }

/* ── /faq ── */
.thq .fq-hero { padding: 96px 0 56px; position: relative; overflow: hidden; isolation: isolate; }
.thq .fq-hero::before { content: ""; position: absolute; inset: 0; z-index: -1; background: radial-gradient(60% 70% at 50% 0%, var(--accent-a16), transparent 70%); }
.thq .fq-hero .wrap { display: grid; gap: 22px; justify-items: center; text-align: center; max-width: 860px; }
.thq .fq-hero .lead { text-align: center; }
.thq .search { position: relative; width: 100%; max-width: 580px; margin-top: 6px; }
.thq .search input { width: 100%; min-height: 56px; padding: 0 18px 0 50px; border-radius: 14px; border: 1px solid var(--line-2); background: var(--surface); color: var(--ink); font: 500 16px/1 var(--sans); outline: none; transition: border-color .15s, box-shadow .15s; box-shadow: var(--shadow-sm); }
.thq .search input::placeholder { color: var(--ink-faint); }
.thq .search input:focus { border-color: var(--brass-ui); box-shadow: 0 0 0 4px var(--accent-a16); }
.thq .search svg { position: absolute; left: 18px; top: 50%; transform: translateY(-50%); color: var(--ink-faint); }
.thq .fq-count { font: 500 12.5px/1 var(--mono); color: var(--ink-faint); }
.thq .topics { position: sticky; top: 68px; z-index: 20; background: color-mix(in srgb, var(--bg-2) 86%, transparent); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-bottom: 1px solid var(--line); }
@media (vertical-viewport-segments: 2) { .thq .topics { position: static; } }
.thq .topics .wrap { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; padding-top: 10px; padding-bottom: 10px; }
.thq .topics .wrap::-webkit-scrollbar { display: none; }
.thq .topics a { flex: none; display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px; border-radius: 10px; font: 600 13.5px/1 var(--sans); color: var(--ink-soft); white-space: nowrap; transition: background .15s, color .15s; }
.thq .topics a:hover { color: var(--ink); background: var(--wash-2); }
.thq .topics a b { font: 500 11px/1 var(--mono); color: var(--ink-faint); margin-left: 8px; }
.thq .fq-body { padding: 40px 0 96px; }
.thq .fq-body .faq { display: block; }
.thq details.fq-group { border-top: 1px solid var(--line); scroll-margin-top: 140px; }
.thq details.fq-group:first-child { border-top: 0; }
.thq .fq-head { list-style: none; display: flex; align-items: center; gap: 16px; min-height: 72px; padding: 18px 4px; cursor: pointer; }
.thq .fq-head::-webkit-details-marker { display: none; }
.thq .fq-head:hover .fq-h2 { color: var(--brass); }
.thq .fq-title { flex: 1; display: grid; gap: 4px; }
.thq .fq-h2 { font: 600 22px/1.2 var(--sans); letter-spacing: -.02em; transition: color .15s; }
.thq .fq-desc { font-size: 14.5px; color: var(--ink-faint); }
.thq .fq-n { font: 500 12.5px/1 var(--mono); color: var(--ink-faint); white-space: nowrap; }
.thq .fq-chev { flex: none; width: 32px; height: 32px; border-radius: 9px; border: 1px solid var(--line-2); position: relative; transition: transform .25s var(--ease), background .2s; }
.thq .fq-chev::before { content: ""; position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; border-right: 2px solid var(--ink-soft); border-bottom: 2px solid var(--ink-soft); transform: translate(-50%, -70%) rotate(45deg); }
.thq details.fq-group[open] .fq-chev { transform: rotate(180deg); background: var(--surface-2); }
.thq details.fq-group[open] > .faq { padding: 0 0 24px; }
@media (max-width: 600px) { .thq .fq-h2 { font-size: 19px; } .thq .fq-n { display: none; } }
.thq .fq-empty { padding: 48px 0; text-align: center; color: var(--ink-soft); font-size: 17px; }
.thq .fq-cta { margin-top: 56px; padding: 36px; border-radius: var(--r-xl); background: linear-gradient(135deg, var(--accent-a16), var(--surface) 60%); border: 1px solid var(--accent-a45); display: flex; flex-wrap: wrap; gap: 20px; justify-content: space-between; align-items: center; }
.thq .fq-cta h2 { font: 600 24px/1.2 var(--sans); letter-spacing: -.03em; }
.thq .fq-cta p { color: var(--ink-soft); font-size: 15px; margin-top: 4px; }

/* ── closing card, sign-in and the app stores ── */
.thq .close { padding: 40px 0 120px; }
.thq .cta-card { position: relative; overflow: hidden; isolation: isolate; border-radius: 28px; border: 1px solid var(--accent-a45); background: linear-gradient(160deg, color-mix(in srgb, var(--brass-ui) 12%, var(--ground)) 0%, var(--surface) 55%, var(--bg-2) 100%); padding: 88px 32px; text-align: center; display: grid; gap: 24px; justify-items: center; }
.thq .cta-card::before { content: ""; position: absolute; inset: 0; z-index: -1; background: radial-gradient(60% 80% at 50% 0%, var(--accent-a22), transparent 70%); }
.thq .cta-card .lead { text-align: center; }
.thq .cta-card .h1 { font-size: clamp(34px, 5.6vw, 72px); }
@media (max-width: 420px) { .thq .cta-card { padding: 64px 20px; } }
.thq .anchor { display: block; position: relative; top: -84px; visibility: hidden; }
.thq .authpanel {
  /* The sign-in form is the app's own component (LoginPanel), drawn with the
     app's --color-* tokens and carrying its own card. On the front door its
     controls wear the page's teal like every other control here, so those
     tokens are re-pointed for this panel only — never in globals.css. */
  --color-accent: var(--brass-ui); --color-accent-300: var(--brass-hi); --color-accent-400: var(--brass-hi); --color-accent-600: var(--brass);
  --color-accent-2: var(--brass); --color-accent-2-300: var(--brass-hi); --color-on-accent: var(--on-accent);
  --color-text: var(--ink); --color-surface: var(--ground-2);
}
.thq .store-block { display: grid; gap: 12px; margin-top: 8px; }
.thq .stores { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.thq .store { display: inline-flex; align-items: center; gap: 11px; min-height: 52px; padding: 0 18px 0 14px; border-radius: 12px; background: black; border: 1px solid var(--line-3); color: white; text-align: left; transition: border-color .15s; }
.thq .store .i { width: 24px; height: 24px; stroke-width: 1.6; }
.thq .store > span { display: grid; gap: 3px; }
.thq .store small { font: 500 11px/1 var(--sans); color: color-mix(in srgb, white 72%, transparent); letter-spacing: .01em; }
.thq .store b { font: 600 17px/1 var(--sans); letter-spacing: -.02em; }
.thq .store[aria-disabled="true"] { cursor: default; opacity: .78; }
.thq a.store:hover { border-color: var(--ink); }
.thq .stores-note { font-size: 13.5px; color: var(--ink-faint); text-align: center; max-width: 460px; margin: 0 auto; }

/* ── footer ── */
.thq footer { border-top: 1px solid var(--line); padding: 56px 0 calc(40px + env(safe-area-inset-bottom)); font-size: 14px; color: var(--ink-faint); }
.thq .foot-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) repeat(3, minmax(0, 1fr)); gap: 32px; }
@media (max-width: 800px) { .thq .foot-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .thq .foot-grid > div:first-child { grid-column: span 2; } }
@media (max-width: 360px) { .thq .foot-grid { grid-template-columns: minmax(0, 1fr); } .thq .foot-grid > div:first-child { grid-column: auto; } }
.thq .foot-grid h4 { font: 600 13px/1 var(--sans); color: var(--ink); margin-bottom: 10px; }
.thq .foot-grid ul { list-style: none; display: grid; }
.thq .foot-grid ul a { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; color: var(--ink-faint); transition: color .15s; }
.thq .foot-grid ul a:hover { color: var(--ink); }
.thq .foot-grid p { margin-top: 12px; max-width: 300px; line-height: 1.55; }
.thq .foot-base { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-top: 44px; padding-top: 24px; border-top: 1px solid var(--line); font-size: 13px; }
.thq .foot-base .ed-note { margin-top: 0; justify-content: flex-start; }
.thq .cred { white-space: nowrap; }

/* ── reveal on scroll: only once JavaScript is there to reveal it ── */
.thq-js .reveal { opacity: 0; transform: translateY(16px); transition: opacity .8s var(--ease), transform .8s var(--ease); }
.thq-js .reveal.seen { opacity: 1; transform: none; }

@media (prefers-reduced-motion: reduce) {
  .thq-js .reveal { opacity: 1; transform: none; transition: none; }
  .thq .tick-track { animation: none; flex-wrap: wrap; width: auto; justify-content: center; }
  .thq .aud-panel { animation: none !important; }
}

/* ── big monitors, and dual-screen foldables spanning a hinge ── */
@media (min-width: 1600px) { .thq { --wrap: 1320px; } }
@media (min-width: 2200px) { .thq { --wrap: 1440px; font-size: 17px; } }
@media (horizontal-viewport-segments: 2) {
  .thq .wrap { max-width: none; }
  .thq .money, .thq .yours-head, .thq .aud-panel, .thq .faq {
    grid-template-columns: calc(env(viewport-segment-width 0 0) - 48px) calc(env(viewport-segment-width 1 0) - 48px);
    column-gap: calc(env(viewport-segment-left 1 0) - env(viewport-segment-right 0 0) + 48px);
  }
  .thq .hero-copy { max-width: calc(env(viewport-segment-width 0 0) - 48px); margin: 0; }
}
`.replace(
  "__CMP_FRAMES__",
  // One rule per frame of the comparison viewer: shown when its mode AND its
  // tab are the checked ones. Generated so the frame list lives in one place.
  [
    ...["today", "board", "card", "money", "console"].map((k) => ["ap", k] as const),
    ...["championship", "coastal", "azalea"].map((k) => ["col", k] as const),
  ]
    .map(
      ([mode, k]) =>
        `.thq .compare:has(input[name="cmp-mode"][value="${mode}"]:checked):has(input[name="cmp-${mode}"][value="${k}"]:checked) .cmp-f[data-f="${mode}-${k}"] { display: grid; }`,
    )
    .join("\n"),
);

/** The comparison viewer's frames, in the order its tabs show them. Read by the page. */
export const COMPARE_APPEARANCE = ["today", "board", "card", "money", "console"] as const;
export const COMPARE_COLOURS = ["championship", "coastal", "azalea"] as const;
