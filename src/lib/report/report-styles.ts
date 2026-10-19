/**
 * THE FINAL REPORT'S STYLESHEET (2026-10-19) — a cup programme: a navy
 * masthead with the score, a points track, the story, then the sessions as
 * panels and the players.
 *
 * Its own palette, like the front door's, because it is a document a club
 * sends round and prints, not a screen of the console: it reads the same at
 * every club. Every class is prefixed `fr-` and scoped to `.fr`, so nothing
 * here can reach another page.
 *
 * Three rulings shape it, all Ajay's, 2026-10-19:
 *
 *   COLOUR ONLY WHERE IT CARRIES A RESULT ("isn't it too colorful?"). Team A is
 *   blue and Team B red, as a cup is drawn, and the colours appear in four
 *   places only: the masthead score, the points track, each session's tally
 *   and the dot beside a match's winner. Rows, chips, cards and bars are ink.
 *   EVERY WORD READS AT 7:1 on whatever is behind it, as the app's text does,
 *   so the team colours have a darker TEXT form (`--fr-a-ink`) beside the
 *   brighter one the track is painted in.
 *   THE TYPE IS LARGE ("the fonts in the final report is very small"): body
 *   18px on a phone, rows 16px, no label under 13px.
 */
export const REPORT_CSS = `
.fr {
  --fr-bg: #eef0f4; --fr-paper: #ffffff; --fr-ink: #121c2b; --fr-muted: #444e5e; --fr-rule: #dfe3ea;
  --fr-navy: #0f2140; --fr-navy2: #1b3561; --fr-gold: #d6a84a;
  --fr-a: #2e6db4; --fr-b: #b23a2c; --fr-a-ink: #1d4c86; --fr-b-ink: #8c2a1e;
  --fr-a-on-navy: #9cc4f2; --fr-b-on-navy: #f5ab9f;
  --fr-on-navy: #f4f1e8; --fr-on-navy-muted: #c3ccdc;
  background: var(--fr-bg); color: var(--fr-ink);
  font: 18px/1.6 var(--font-body), "Segoe UI", system-ui, sans-serif;
  min-height: 100vh;
}
@media (prefers-color-scheme: dark) {
  .fr {
    --fr-bg: #0b111b; --fr-paper: #121a26; --fr-ink: #e9edf3; --fr-muted: #b0bac8; --fr-rule: #263142;
    --fr-a: #5f97dc; --fr-b: #d86c5c; --fr-a-ink: #8dbcf2; --fr-b-ink: #f19a8b;
    color-scheme: dark;
  }
}
.fr-embedded { min-height: 0; }
.fr-page { max-width: 880px; margin: 0 auto; padding: 20px 16px 56px; display: grid; gap: 18px; }

.fr-mast { position: relative; overflow: hidden; border-radius: 14px; color: var(--fr-on-navy); padding: 26px clamp(16px, 4vw, 40px) 24px;
  background:
    radial-gradient(circle at 1px 1px, rgba(255,255,255,.07) 1px, transparent 1.6px) 0 0 / 11px 11px,
    radial-gradient(120% 90% at 50% -10%, var(--fr-navy2) 0%, var(--fr-navy) 62%); }
.fr-mast::after { content: ""; position: absolute; inset: auto 0 0 0; height: 4px;
  background: linear-gradient(90deg, var(--fr-a) 0 var(--fr-split), var(--fr-gold) var(--fr-split) calc(var(--fr-split) + 1.2%), var(--fr-b) calc(var(--fr-split) + 1.2%) 100%); }
.fr-crest { display: flex; align-items: center; justify-content: center; gap: 10px; color: var(--fr-gold); font: 600 13px/1 var(--font-body), sans-serif; letter-spacing: .22em; text-transform: uppercase; }
.fr-crest svg { width: 30px; height: 30px; flex: none; }
.fr-mast h1 { font: 600 clamp(1.75rem, 5.4vw, 2.6rem)/1.12 var(--font-heading); text-align: center; margin: 12px 0 4px; text-wrap: balance; }
.fr-where { text-align: center; color: var(--fr-on-navy-muted); font-size: 16px; }
.fr-score { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); align-items: end; gap: 10px; margin-top: 18px; text-align: center; }
.fr-team { min-width: 0; }
.fr-n { font: 600 clamp(3.4rem, 14vw, 5.6rem)/0.9 var(--font-scoreboard), "Arial Narrow", sans-serif; letter-spacing: -.01em; }
.fr-team-a .fr-n { color: var(--fr-a-on-navy); } .fr-team-b .fr-n { color: var(--fr-b-on-navy); }
.fr-nm { margin-top: 8px; font: 600 16px var(--font-body), sans-serif; letter-spacing: .14em; overflow-wrap: anywhere; }
.fr-win .fr-nm::after { content: " \\2605"; color: var(--fr-gold); }
.fr-v { font: italic 400 22px var(--font-heading); color: var(--fr-on-navy-muted); padding-bottom: 18px; }
.fr-ribbon { display: block; width: fit-content; max-width: 100%; margin: 18px auto 0; background: var(--fr-gold); color: var(--fr-navy); font: 700 14px/1.2 var(--font-body), sans-serif; letter-spacing: .12em; text-transform: uppercase; padding: 9px 18px; border-radius: 999px; text-align: center; }

.fr-card { background: var(--fr-paper); border: 1px solid var(--fr-rule); border-radius: 12px; padding: 20px clamp(16px, 3vw, 28px); min-width: 0; }
.fr-eyebrow { font: 600 13px/1.25 var(--font-body), sans-serif; letter-spacing: .12em; text-transform: uppercase; color: var(--fr-muted); margin: 0 0 8px; }
.fr h2 { font: 600 1.45rem/1.25 var(--font-heading); margin: 0; text-wrap: balance; }

.fr-track-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.fr-track-head span { font-size: 15px; color: var(--fr-muted); }
.fr-track { position: relative; margin-top: 14px; display: grid; gap: 2px; }
.fr-track i { height: 24px; border-radius: 2px; background: var(--fr-rule); }
.fr-track i.fr-ca { background: var(--fr-a); } .fr-track i.fr-cb { background: var(--fr-b); } .fr-track i.fr-cx { background: var(--fr-gold); }
.fr-mark { position: absolute; top: -6px; bottom: -6px; width: 2px; margin-left: -1px; background: var(--fr-ink); }
.fr-mark span { position: absolute; top: calc(100% + 4px); left: 50%; transform: translateX(-50%); white-space: nowrap; font: 600 13px var(--font-body), sans-serif; color: var(--fr-ink); }
.fr-legend { display: flex; gap: 8px 18px; flex-wrap: wrap; margin-top: 30px; font-size: 15px; color: var(--fr-muted); }
.fr-legend b { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 7px; }
.fr-legend .fr-ka { background: var(--fr-a); } .fr-legend .fr-kb { background: var(--fr-b); } .fr-legend .fr-kx { background: var(--fr-gold); }

.fr-story p { margin: 0 0 12px; font-size: 18px; line-height: 1.7; }
.fr-story p:last-child { margin-bottom: 0; }
.fr-story p.fr-eyebrow { font-size: 13px; line-height: 1.25; margin-bottom: 8px; }
.fr-story p.fr-eyebrow + p::first-letter { float: left; font: 600 3.4em/0.85 var(--font-heading); color: var(--fr-ink); padding: 6px 8px 0 0; }

.fr-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 14px 22px; margin-top: 14px; font-size: 17px; }
.fr-facts div { min-width: 0; border-left: 2px solid var(--fr-rule); padding-left: 11px; overflow-wrap: anywhere; }
.fr-facts b { display: block; font-size: 13px; color: var(--fr-muted); text-transform: uppercase; letter-spacing: .07em; font-weight: 600; }

.fr-session-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.fr-tally { display: inline-flex; gap: 14px; font: 600 17px var(--font-scoreboard), sans-serif; letter-spacing: .04em; }
.fr-ta { color: var(--fr-a-ink); } .fr-tb { color: var(--fr-b-ink); }
.fr-cols, .fr-matches li { display: grid; grid-template-columns: minmax(0,1fr) 88px minmax(0,1fr); gap: 8px; }
.fr-cols { font: 600 13px var(--font-body), sans-serif; letter-spacing: .1em; text-transform: uppercase; padding: 0 0 6px; color: var(--fr-muted); }
.fr-cols span:last-child { text-align: right; }
.fr-matches { list-style: none; margin: 0; padding: 0; }
.fr-matches li { align-items: center; padding: 10px 0; border-top: 1px solid var(--fr-rule); font-size: 16px; color: var(--fr-muted); }
.fr-matches li > span:first-child, .fr-matches li > span:last-child { min-width: 0; overflow-wrap: anywhere; }
.fr-matches li > span:last-child { text-align: right; }
.fr-matches li.fr-wa > span:first-child, .fr-matches li.fr-wb > span:last-child { font-weight: 600; color: var(--fr-ink); }
.fr-matches li.fr-wa > span:first-child::before, .fr-matches li.fr-wb > span:last-child::after { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; vertical-align: 2px; }
.fr-matches li.fr-wa > span:first-child::before { background: var(--fr-a); margin-right: 8px; }
.fr-matches li.fr-wb > span:last-child::after { background: var(--fr-b); margin-left: 8px; }
.fr-matches li.fr-hv { color: var(--fr-ink); }
.fr-chip { justify-self: center; font: 500 14px var(--font-scoreboard), sans-serif; letter-spacing: .03em; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--fr-rule); color: var(--fr-ink); white-space: nowrap; }
.fr-hv .fr-chip { color: var(--fr-muted); }

.fr-other { display: grid; gap: 0; margin-top: 10px; }
.fr-other div { display: flex; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid var(--fr-rule); font-size: 16px; }

.fr-stars { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr)); gap: 10px; margin-top: 14px; }
.fr-star { border-radius: 10px; padding: 13px; background: var(--fr-bg); min-width: 0; }
.fr-who { font: 600 17px/1.25 var(--font-heading); overflow-wrap: anywhere; }
.fr-rec { font: 600 14px var(--font-scoreboard), sans-serif; letter-spacing: .05em; margin-top: 4px; color: var(--fr-muted); }
.fr-how { font-size: 14px; color: var(--fr-muted); margin-top: 2px; }

.fr-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr)); gap: 24px; margin-top: 14px; }
.fr-grid2 > div { min-width: 0; }
.fr-rec-h { font: 600 14px var(--font-body), sans-serif; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 6px; color: var(--fr-muted); }
.fr-row { display: grid; grid-template-columns: minmax(0,1fr) 92px 34px; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--fr-rule); font-size: 16px; }
.fr-row span:first-child { min-width: 0; overflow-wrap: anywhere; }
.fr-bar { height: 8px; border-radius: 99px; background: var(--fr-rule); overflow: hidden; }
.fr-bar i { display: block; height: 100%; border-radius: 99px; background: var(--fr-muted); }
.fr-pts { text-align: right; font: 600 16px var(--font-scoreboard), sans-serif; font-variant-numeric: tabular-nums; }

.fr-foot { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 14px; color: var(--fr-muted); padding: 2px 4px 0; }
.fr-foot b { color: var(--fr-ink); font-weight: 600; letter-spacing: .08em; }
.fr-foot a { color: inherit; }
@media (prefers-reduced-motion: no-preference) {
  .fr-track i { animation: fr-grow .5s ease-out both; }
  @keyframes fr-grow { from { transform: scaleY(.2); opacity: .3; } to { transform: none; opacity: 1; } }
}
@media print {
  .fr { background: #fff; font-size: 12pt; }
  .fr-page { padding: 0; gap: 10pt; }
  .fr-card, .fr-mast { break-inside: avoid; }
  .fr-noprint { display: none !important; }
}
`;
