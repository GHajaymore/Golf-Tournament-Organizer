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
  /* The navy is a COLOUR under the gradients, not only a gradient: with none,
     anything that reads the ground from colours (the legibility sweep, a print
     engine with backgrounds off) found the light page behind it (2026-10-20). */
  background:
    radial-gradient(circle at 1px 1px, rgba(255,255,255,.07) 1px, transparent 1.6px) 0 0 / 11px 11px,
    radial-gradient(120% 90% at 50% -10%, var(--fr-navy2) 0%, var(--fr-navy) 62%) var(--fr-navy); }
.fr-mast::after { content: ""; position: absolute; inset: auto 0 0 0; height: 4px;
  background: linear-gradient(90deg, var(--fr-a) 0 var(--fr-split), var(--fr-gold) var(--fr-split) calc(var(--fr-split) + 1.2%), var(--fr-b) calc(var(--fr-split) + 1.2%) 100%); }
.fr-mast.fr-plain::after { background: var(--fr-gold); }
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

/* A tournament that is not a cup: the champion where the cup has its score. */
.fr-champ { margin-top: 18px; text-align: center; }
.fr-champ-name { font: 600 clamp(2rem, 8vw, 3.2rem)/1.08 var(--font-heading); color: var(--fr-on-navy); text-wrap: balance; overflow-wrap: anywhere; }
.fr-champ-fig { margin-top: 6px; font: 600 18px var(--font-scoreboard), "Arial Narrow", sans-serif; letter-spacing: .06em; color: var(--fr-on-navy-muted); }
.fr-board-wrap { overflow-x: auto; margin-top: 12px; }
.fr-board { width: 100%; border-collapse: collapse; font-size: 16px; font-variant-numeric: tabular-nums; }
.fr-board th { font: 600 13px var(--font-body), sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--fr-muted); text-align: right; padding: 0 0 6px 10px; white-space: nowrap; }
.fr-board th:nth-child(1), .fr-board th:nth-child(2) { text-align: left; }
.fr-board td { border-top: 1px solid var(--fr-rule); padding: 9px 0 9px 10px; text-align: right; white-space: nowrap; }
.fr-board td:nth-child(1) { width: 3.2em; padding-left: 0; text-align: left; color: var(--fr-muted); font-family: var(--font-scoreboard), sans-serif; }
.fr-board td:nth-child(2) { text-align: left; white-space: normal; overflow-wrap: anywhere; min-width: 9em; }
.fr-board td.fr-note { color: var(--fr-muted); font-size: 14px; }
.fr-board tr.fr-top td { font-weight: 700; color: var(--fr-ink); }
.fr-board tr.fr-top td:nth-child(1) { color: var(--fr-ink); }
.fr-board td.fr-figs { font-family: var(--font-scoreboard), sans-serif; }

/* The conclusion's sections (2026-10-21): a figure and a sentence, never a
   chart. One row per thing at every width, and nothing under 13px. */
.fr-part { font: 600 13px/1 var(--font-body), sans-serif; letter-spacing: .16em; text-transform: uppercase; color: var(--fr-muted); margin: 8px 4px -6px; }
.fr-line { margin: 10px 0 0; font-size: 16px; color: var(--fr-muted); }
.fr-line b { color: var(--fr-ink); }
.fr-lines { display: grid; margin-top: 10px; }
.fr-lines > div { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; align-items: baseline; padding: 9px 0; border-top: 1px solid var(--fr-rule); font-size: 16px; }
.fr-lines > div > span:first-child { min-width: 0; overflow-wrap: anywhere; }
.fr-lines > .fr-sub-eyebrow { margin: 8px 0 4px; }
.fr-amt { font: 600 16px var(--font-scoreboard), sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fr-res { overflow-wrap: anywhere; min-width: 0; }
/* A round and its result: one under the other on a phone, side by side when there is room. */
.fr-lines.fr-stack > div { grid-template-columns: minmax(0,1fr); gap: 0; }
@media (min-width: 620px) { .fr-lines.fr-stack > div { grid-template-columns: minmax(0, 15em) minmax(0,1fr); gap: 12px; } }
.fr-total { border-top: 2px solid var(--fr-ink) !important; }
.fr-game + .fr-game { margin-top: 14px; }
.fr-moves { display: grid; gap: 10px; margin-top: 12px; }
.fr-moves > div { display: grid; grid-template-columns: 5.4em minmax(0,1fr); gap: 10px; }
.fr-moves p { margin: 0; font-size: 16px; }
.fr-r { font: 600 15px/1.6 var(--font-scoreboard), sans-serif; color: var(--fr-muted); overflow-wrap: anywhere; }
.fr-mini { width: 100%; border-collapse: collapse; font-size: 16px; font-variant-numeric: tabular-nums; }
.fr-mini th { font: 600 13px var(--font-body), sans-serif; letter-spacing: .06em; text-transform: uppercase; color: var(--fr-muted); text-align: center; padding: 0 0 6px 8px; white-space: nowrap; }
.fr-mini th:first-child { text-align: left; padding-left: 0; white-space: normal; }
.fr-mini td { border-top: 1px solid var(--fr-rule); padding: 8px 0 8px 8px; text-align: center; font-family: var(--font-scoreboard), sans-serif; }
.fr-mini td:first-child { text-align: left; padding-left: 0; font-family: inherit; overflow-wrap: anywhere; }
.fr-mini td.fr-up { font-weight: 700; }
.fr-mini td.fr-up::after { content: " \\2191"; }
.fr-feats { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); column-gap: 24px; margin-top: 8px; }
.fr-feat { border-top: 1px solid var(--fr-rule); padding: 8px 0; display: grid; gap: 1px; min-width: 0; overflow-wrap: anywhere; }
.fr-feat .fr-who { font-size: 16px; }
.fr-k { font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: var(--fr-muted); }
.fr-nums { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px 16px; margin-top: 12px; }
@media (min-width: 620px) { .fr-nums { grid-template-columns: repeat(3, minmax(0,1fr)); } }
.fr-nums > div { display: grid; min-width: 0; }
.fr-nums b { font: 600 1.6rem/1.15 var(--font-scoreboard), sans-serif; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.fr-nums span { font-size: 14px; color: var(--fr-muted); }
.fr-yours { margin: 0; background: var(--fr-paper); border: 2px solid var(--fr-gold); border-radius: 12px; padding: 12px 16px; font-weight: 600; font-size: 17px; }
.fr-next { display: grid; gap: 8px; margin-top: 12px; }
.fr-next > div { display: grid; grid-template-columns: 6.4em minmax(0,1fr); gap: 10px; }
.fr-next p { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
.fr-d { font: 600 15px/1.6 var(--font-scoreboard), sans-serif; }
.fr-small { margin: -6px 4px 0; font-size: 14px; color: var(--fr-muted); }

/* THE RICH REPORT (2026-10-23): the club first, the prize list, one picture
   per format. No axes, no gridlines, never hue alone — under par is solid, par
   blank, over par outlined and hatched, a week played a filled dot — so it
   reads on a black-and-white printer. Figures 16px or more. */
.fr-club { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 0 0 12px; color: var(--fr-on-navy); font: 600 15px/1.25 var(--font-body), sans-serif; letter-spacing: .14em; text-transform: uppercase; text-align: center; overflow-wrap: anywhere; }
.fr-club img { height: 44px; width: auto; max-width: 120px; object-fit: contain; border-radius: 6px; background: #fff; padding: 3px; }
.fr-lead-group + .fr-lead-group { margin-top: 16px; }
.fr-lead-group > .fr-eyebrow { margin: 0 0 2px; }
/* The figure column is fit-content, never auto: a figure can be a sentence ("beat Bram Kettle in the
   final at the 19th", a knockout's), and an auto column sized to it one line long pushed the page 80px
   sideways and squeezed the champion's name to a letter a line. A short figure keeps its width; a
   long one wraps inside 45% of the line. */
.fr-lead-line { display: grid; grid-template-columns: 8.5em minmax(0,1fr) fit-content(45%); gap: 2px 14px; align-items: baseline; padding: 11px 0; border-top: 1px solid var(--fr-rule); }
.fr-lp { font: 600 13px/1.3 var(--font-body), sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--fr-muted); }
.fr-ln { font: 600 18px/1.3 var(--font-heading); min-width: 0; overflow-wrap: anywhere; }
.fr-lf { font: 600 17px var(--font-scoreboard), "Arial Narrow", sans-serif; letter-spacing: .03em; font-variant-numeric: tabular-nums; text-align: right; min-width: 0; overflow-wrap: break-word; }
.fr-lh { grid-column: 2 / -1; font-size: 15px; color: var(--fr-muted); }
.fr-lead-line.fr-first .fr-ln { font-size: 22px; }
@media (max-width: 560px) {
  .fr-lead-line { grid-template-columns: minmax(0,1fr) fit-content(45%); }
  .fr-lp { grid-column: 1 / -1; }
  .fr-lh { grid-column: 1 / -1; }
}
.fr-fig { margin: 0; }
.fr-caption { margin: 6px 0 12px; font-size: 17px; line-height: 1.5; color: var(--fr-ink); }
.fr-sr { position: absolute !important; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
/* A table grows to its content whatever its width says; as a block it keeps the 1px. */
table.fr-sr { display: block; }
.fr-gtable { margin-top: 12px; }
.fr-ladder { width: 100%; max-width: 480px; height: auto; display: block; margin: 4px auto 0; overflow: visible; }
.fr-svg-col { font: 600 17px var(--font-body), sans-serif; fill: var(--fr-muted); letter-spacing: .04em; }
.fr-svg-name { font: 600 19px var(--font-body), sans-serif; fill: var(--fr-ink); }
.fr-svg-place { font: 700 19px var(--font-scoreboard), "Arial Narrow", sans-serif; fill: var(--fr-ink); }
.fr-svg-dot { fill: var(--fr-paper); stroke: var(--fr-muted); stroke-width: 1.5; }
.fr-svg-line { fill: none; stroke: var(--fr-muted); stroke-width: 2; stroke-opacity: .6; }
.fr-svg-lead .fr-svg-line { stroke: var(--fr-ink); stroke-width: 4.5; stroke-opacity: 1; }
.fr-svg-lead .fr-svg-dot { fill: var(--fr-gold); stroke: var(--fr-ink); stroke-width: 3; }
.fr-svg-lead .fr-svg-place { fill: #0f2140; }
.fr-svg-lead .fr-svg-name { font-weight: 800; }
.fr-svg-cut line { stroke: var(--fr-ink); stroke-width: 1.5; stroke-dasharray: 5 5; }
.fr-svg-cut text { font: 600 16px var(--font-body), sans-serif; fill: var(--fr-muted); }
/* Nine to a row where there is room (the front nine over the back); six to a row on a phone,
   where nine cells would be 34px and a figure would not fit in one. */
.fr-holes { display: grid; grid-template-columns: repeat(9, minmax(0,1fr)); gap: 5px; margin-top: 6px; }
@media (max-width: 560px) { .fr-holes { grid-template-columns: repeat(6, minmax(0,1fr)); } }
.fr-hole { display: grid; justify-items: center; align-content: start; gap: 2px; padding: 6px 0 5px; border-radius: 6px; border: 1px solid var(--fr-rule); min-width: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.fr-hole b { font: 700 16px/1.3 var(--font-scoreboard), "Arial Narrow", sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fr-hole-n, .fr-hole-p { font: 600 13px/1.2 var(--font-body), sans-serif; color: var(--fr-muted); white-space: nowrap; }
.fr-t-under { background: var(--fr-ink); border-color: var(--fr-ink); }
.fr-t-under b, .fr-t-under span { color: var(--fr-paper); }
.fr-t-over { border: 2px solid var(--fr-ink); background: repeating-linear-gradient(135deg, transparent 0 5px, var(--fr-rule) 5px 8px); }
.fr-t-none b { color: var(--fr-muted); }
.fr-key { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin: 10px 0 0; font-size: 14px; color: var(--fr-muted); }
.fr-key-i { display: inline-block; width: 18px; height: 18px; padding: 0; vertical-align: -4px; margin-right: 2px; }
.fr-key-w { display: inline-flex; align-items: center; gap: 6px; }
.fr-key-w b { color: var(--fr-ink); }
.fr-s { display: inline-grid; place-items: center; min-width: 26px; height: 26px; padding: 0 2px; }
.fr-s-birdie { border: 2px solid var(--fr-ink); border-radius: 50%; }
.fr-s-eagle { border: 2px solid var(--fr-ink); border-radius: 50%; outline: 2px solid var(--fr-ink); outline-offset: 2px; }
.fr-s-bogey { border: 2px solid var(--fr-ink); border-radius: 3px; }
.fr-s-double { border: 2px solid var(--fr-ink); border-radius: 3px; outline: 2px solid var(--fr-ink); outline-offset: 2px; }
.fr-bars { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 8px; }
.fr-bars li { display: grid; grid-template-columns: 2.6em minmax(0, 10em) minmax(0,1fr) 2.8em; gap: 4px 10px; align-items: center; font-size: 16px; }
.fr-bar-pl { font: 600 16px var(--font-scoreboard), sans-serif; color: var(--fr-muted); }
.fr-bar-nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-bar-track { height: 16px; }
.fr-bar-track i { display: block; height: 100%; border-radius: 3px; background: var(--fr-muted); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.fr-bar-lead .fr-bar-track i { background: var(--fr-ink); }
.fr-bar-lead .fr-bar-nm { font-weight: 700; }
.fr-bar-fig { font: 700 18px var(--font-scoreboard), sans-serif; text-align: right; font-variant-numeric: tabular-nums; }
@media (max-width: 560px) {
  .fr-bars li { grid-template-columns: 2.2em minmax(0,1fr) 2.8em; }
  .fr-bar-track { grid-column: 2 / 3; grid-row: 2; }
}
.fr-path { list-style: none; margin: 12px 0 0 8px; padding: 0 0 0 20px; border-left: 3px solid var(--fr-rule); display: grid; gap: 14px; }
.fr-path li { position: relative; display: grid; gap: 2px; min-width: 0; }
.fr-path li::before { content: ""; position: absolute; left: -30px; top: 4px; width: 15px; height: 15px; border-radius: 50%; background: var(--fr-paper); border: 3px solid var(--fr-ink); }
.fr-path li.fr-path-end::before { background: var(--fr-gold); }
.fr-path-r { font: 600 13px/1.3 var(--font-body), sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--fr-muted); }
.fr-path-w { font-size: 17px; display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; overflow-wrap: anywhere; }
.fr-path-w .fr-chip { justify-self: auto; }
.fr-upset { font-size: 14px; font-weight: 600; border: 1px dashed var(--fr-ink); border-radius: 999px; padding: 1px 9px; }
.fr-dots { white-space: nowrap; text-align: left !important; }
/* The league table fits a phone: the name may wrap, and nothing scrolls sideways. */
.fr-weeks th, .fr-weeks td { padding-left: 8px; }
.fr-weeks th { white-space: normal; }
.fr-weeks td:nth-child(2) { min-width: 5.5em; }
.fr-move { font-size: 16px; color: var(--fr-muted); white-space: nowrap; }
@media (max-width: 560px) { .fr-weeks th:nth-child(1), .fr-weeks td:nth-child(1) { width: 2.4em; } }
.fr-dot-on, .fr-dot-off { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 3px; vertical-align: -1px; border: 2px solid var(--fr-ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.fr-dot-on { background: var(--fr-ink); }
.fr-course .fr-lines > div > span:last-child { color: var(--fr-muted); }
.fr-net-pos { font-weight: 700; }
.fr-tug { display: grid; gap: 10px; margin-top: 12px; }
.fr-tug-row { display: grid; grid-template-columns: minmax(0, 9em) minmax(0,1fr); gap: 6px 12px; align-items: center; font-size: 16px; }
.fr-tug-bar { position: relative; display: flex; height: 26px; border-radius: 4px; overflow: hidden; border: 1px solid var(--fr-rule); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.fr-tug-bar i { display: flex; align-items: center; height: 100%; font: 700 16px var(--font-scoreboard), sans-serif; color: #fff; padding: 0 6px; }
.fr-tug-bar i.fr-tug-a { background: var(--fr-a-ink); justify-content: flex-start; }
.fr-tug-bar i.fr-tug-b { background: var(--fr-b-ink); justify-content: flex-end; margin-left: auto; background-image: repeating-linear-gradient(135deg, transparent 0 6px, rgba(255,255,255,.18) 6px 9px); }
.fr-tug-mark { position: absolute; top: -3px; bottom: -3px; width: 3px; margin-left: -1.5px; background: var(--fr-gold); }
@media (max-width: 560px) { .fr-tug-row { grid-template-columns: minmax(0,1fr); } }
.fr-clinch { margin: 12px 0 0; font-size: 17px; }
@media print {
  .fr-sr { position: static !important; width: auto; height: auto; overflow: visible; clip: auto; clip-path: none; white-space: normal; }
  table.fr-sr { display: table; width: 100%; }
}

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
