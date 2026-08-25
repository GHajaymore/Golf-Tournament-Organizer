import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { landingScreenFor } from "@/lib/roles";
import { courseHandicap, playingHandicapFrom } from "@/lib/domain/handicap";
import { shareOf } from "@/lib/domain/expenses";
import { money } from "@/lib/domain/money-format";
import { PLANS } from "@/lib/plans";
import { LandingAuth } from "@/components/LandingAuth";
import { LandingEffects } from "@/components/LandingEffects";
import { Logo, LOGO_SIZE } from "@/components/Logo";
import { BrandMark } from "@/components/BrandMark";

/**
 * The app's wordmark tokens, mapped to the BRAND's own colours.
 *
 * BrandMark reads --color-accent* and --color-bg, which the landing page does
 * not define — it has its own ground. Mapping them here is what lets one
 * component serve both, exactly as --logo-flag does for the mark itself, and
 * is why there is no second copy of the lockup to drift.
 *
 * These map to --brand-*, NOT to the page accent. They were pointed at
 * --brass, which meant retuning the page's palette silently recoloured the
 * logo — a brand changing because a background did. The mark is fixed; the
 * page around it is the variable.
 */
const BRAND_TOKENS = {
  "--color-accent": "var(--brand-amber)",
  "--color-accent-200": "var(--brand-amber)",
  "--color-accent-300": "var(--brand-amber)",
  "--color-accent-600": "var(--brand-green-soft)",
  "--color-bg": "var(--ground)",
} as React.CSSProperties;

/**
 * The front door.
 *
 * Direction 02, "The Board" — standing in front of the leaderboard in the
 * clubhouse. The board is the hero and type does the work: a grotesque set very
 * large and tracked tight, night ground, fairway green for anything live or
 * under par, and exactly one amber, spent on the last word of the headline.
 *
 * It replaced a serif "championship programme" treatment. The problem with that
 * one was not that it was ugly — it read editorial, and this app's claim is that
 * it is LIVE.
 *
 * Everything visual is scoped under the `.thq` wrapper and its own
 * `--flag/--ground/--paper` palette, defined in the page-local stylesheet below
 * — deliberately NOT the app's `--color-*` tokens, so this identity never leaks
 * into the authenticated console chrome and the console theme never bleeds in
 * here.
 *
 * The one thing not hard-coded is the worked handicap example: it is computed
 * from the same engine the app scores with, so the number a visitor is shown on
 * the way in cannot drift from the number they get once inside.
 */

/* A 12.4 index on a card rated 71.5 off 140 slope, playing four-ball at its
   90% allowance — the single calculation most golf software gets wrong. Derived
   so the FAQ can never quote a course/playing handicap the engine disagrees
   with. */
const EXAMPLE = (() => {
  const index = 12.4;
  const tee = { courseRating: 71.5, slopeRating: 140, par: 72 };
  const course = courseHandicap(index, tee);
  return { index, tee, course, playing: playingHandicapFrom(course, 90) };
})();

/**
 * The worked trip, run through the SAME splitter the app settles with.
 *
 * It used to be five hand-typed figures under the heading "four players,
 * shared evenly", and evenly is the one thing a golf trip never is. Somebody
 * drives up for the second night only, two of them go to the bar, one is
 * driving and skips the wine. A page that shows four equal quarters is
 * describing a dinner, not a weekend, and it undersells the thing the app
 * actually does: every line carries its OWN set of people and its own weights.
 *
 * So each line below names who is on it, and the numbers come from `shareOf`
 * rather than from arithmetic done in a comment. The lodging is the case that
 * proves the point — three players for two nights and one for a single night
 * is a 2:2:2:1 split of $640, which is $91.43 and $182.86-ish and does not
 * divide into anything a person would type by hand. The remainder lands by
 * the largest-remainder rule, so the five parts still sum to the cent.
 *
 * A worked example that does not add up is worse than none, because the reader
 * checking it is exactly the reader who would have bought.
 */
const TRIP = (() => {
  const you = "you";
  const field = [you, "b", "c", "d"];
  const all = field.map((playerId) => ({ playerId, weight: 1 }));

  const lines = [
    { description: "Travel and fuel", who: "all four", amountCents: 18_000, shares: all },
    {
      description: "Lodging",
      // The whole argument in one line: two nights each for three of them,
      // one for the fourth.
      who: "three for two nights, one for one",
      amountCents: 64_000,
      shares: field.map((playerId) => ({ playerId, weight: playerId === you ? 1 : 2 })),
    },
    { description: "Cart fees", who: "all four", amountCents: 12_000, shares: all },
    { description: "Dinner", who: "all four", amountCents: 16_460, shares: all },
    {
      description: "The bar",
      // Not everyone drinks, and one of them is driving home.
      who: "two of them",
      amountCents: 5_000,
      shares: field.map((playerId) => ({ playerId, weight: playerId === you || playerId === "b" ? 1 : 0 })),
    },
  ];

  const rows = lines.map((line) => ({
    description: line.description,
    who: line.who,
    total: line.amountCents,
    yours: shareOf({ id: line.description, paidBy: "b", ...line }).get(you) ?? 0,
  }));

  const yourShare = rows.reduce((sum, r) => sum + r.yours, 0);
  // What the golf came to, from the section beside this one.
  const golfNet = 7_750;
  return { rows, yourShare, golfNet, handover: yourShare - golfNet };
})();

/* The design's stylesheet, scoped under `.thq`. Animation baselines live behind
   `.thq-js` (added by LandingEffects on mount) so content is fully visible with
   JavaScript disabled rather than stuck at opacity 0. */
const LANDING_CSS = `
.thq, .thq * { box-sizing: border-box; }
.thq {
  /* "Patina": verdigris on lacquer — the two things a clubhouse is made of.
     Aged wood for the ground, and for the accent the green that copper turns
     when nobody polishes it.

     It is deliberately the one combination that is vintage AND electric at
     once: the GROUND is aged, the ACCENT is not. That split is the whole
     design. A warm near-black with a single hot accent is the shape every dark
     product page has, and the previous try at fixing that went the other way —
     gold leaf, which is handsome and entirely period, but leaves the page with
     nothing sharp in it at all.

     Cool accent on a warm ground is also the strongest pairing available here,
     which is not a stylistic point: this page gets opened on a phone at a golf
     course, and hue contrast survives sunlight in a way lightness alone does
     not.

     One rule holds it together. TEAL is identity — the marks, the headline's
     last word, the rules, the buttons. GREEN is meaning — live, under par,
     money coming your way. Never the reverse: the moment teal says "winning",
     the page has two words for one idea and neither is legible. The two are
     174 degrees apart precisely so nobody can confuse them.

     Verdigris is also a preset a club can pick in settings, so a club that
     wants the site's own look can have it. */
  --ground:#171210; --ground-2:#221A16; --panel:#221A1685;
  --paper:#EDE4CE; --paper-2:#E4DABF; --paper-ink:#1C1712; --paper-soft:#5C5343;
  --paper-accent:#0E6E72;
  --ink:#EDE6DC; --ink-soft:#ABA091; --ink-faint:#837868;
  --line:rgba(237,230,220,0.12); --line-2:rgba(237,230,220,0.24);
  --flag:#6FB894; --flag-soft:#8ACCAB; --under:#6FB894;
  /* Accent text and accent FILL are different steps, the way the app's own
     ramp separates 400 from 500. Held to one value the button and the body
     text end up the same colour and the button stops reading as a control. */
  --brass:#76E1E5; --brass-ui:#45D6DC; --brass-hi:#A6EEF1; --on-accent:#08201F;
  /* THE MARK DOES NOT MOVE WITH THE PAGE.
     These are the wordmark's own orange and green, and they are the values the
     logo has always been drawn in. They are separate tokens precisely because
     the accent is now a variable: when the page palette was retuned, the mark
     read --brass and quietly recoloured with it, which is a brand changing
     because a background did. A logo is a constant. Retune the page all you
     like; these two lines stay put. */
  --brand-amber:#E8A33D; --brand-green:#4FA97C; --brand-green-soft:#63BE90;
  /* The dim edge where the patina has gone dark. DECORATION ONLY — around
     3:1 on the lacquer, so it may rule a line or edge a frame and must never
     carry a word. Text uses --brass, which clears 9:1. */
  --incised:#2F6F72;
  --sans:var(--font-geist-sans),-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
  --mono:var(--font-geist-mono),ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
  /* Display only. Golf sets its own type in engraved and printed serifs —
     honours boards, card stock, the crest over the door — and a page selling
     that in the same grotesque as every other SaaS reads as software about
     golf rather than something belonging to it. Headlines only: a serif in a
     score column, read on a phone in sun, is a worse leaderboard. */
  --display:var(--font-display),"Hoefler Text","Iowan Old Style",Georgia,"Times New Roman",serif;
  font-family:var(--sans); background:var(--ground); color:var(--ink);
  line-height:1.6; -webkit-font-smoothing:antialiased;
}
@media (prefers-color-scheme: light) {
  .thq {
    /* The same page in daylight rather than a different design: card stock
       instead of lacquer. The patina cannot survive the swap unchanged —
       #76E1E5 is a highlight on a dark ground and pale nothing on a light one
       — so it deepens to the teal of oxidised copper in shadow, dark enough
       to carry a word. Green darkens with it, because a board is only readable
       if under-par reads instantly and #6FB894 on cream does not.

       Fill and text collapse to ONE value here. On the dark ground they are
       two steps apart because both must clear the ground; on cream the darker
       of the pair is already doing the work, and a second, deeper teal for the
       button just read as a different colour. */
    --ground:#F4EFE2; --ground-2:#EAE3D2; --panel:#FFFDF7;
    --ink:#1E1710; --ink-soft:#5C5342; --ink-faint:#7E7460;
    --line:rgba(30,23,16,0.12); --line-2:rgba(30,23,16,0.22);
    --flag:#1F7A50; --flag-soft:#186541; --under:#1F7A50;
    --brass:#0E6E72; --brass-ui:#0E6E72; --brass-hi:#0A5457;
    --on-accent:#F2FEFF; --incised:#7FC5C8;
    /* The mark's own daylight pair — the exact values it used on the light
       ground before any of this, so the logo is unchanged on both grounds. */
    --brand-amber:#A8701A; --brand-green:#1F7A50; --brand-green-soft:#186541;
    --paper:#241A16; --paper-2:#1A120F; --paper-ink:#EFE7D8; --paper-soft:#B3A791;
    /* Light ground flips the band to lacquer, so the band's accent flips back
       to bright patina — the mirror of the dark-ground rule above. */
    --paper-accent:#76E1E5;
  }
}
.thq :focus-visible { outline:2px solid var(--flag); outline-offset:3px; border-radius:4px; }
.thq .wrap { width:min(1140px,92vw); margin:0 auto; }
.thq a { color:inherit; }

.thq .nav { position:sticky; top:0; z-index:20; background:color-mix(in srgb, var(--ground) 84%, transparent); backdrop-filter:blur(14px); border-bottom:1px solid var(--line); transition:box-shadow .25s ease, background .25s ease; }
.thq .nav.scrolled { background:color-mix(in srgb, var(--ground) 94%, transparent); box-shadow:0 10px 34px -24px rgba(0,0,0,0.6); }
.thq .nav-in { display:flex; align-items:center; justify-content:space-between; height:64px; }
.thq .brand { display:flex; align-items:center; gap:11px; font-family:var(--sans); font-size:22px; font-weight:700; letter-spacing:-0.025em; }
.thq .nav-actions { display:flex; align-items:center; gap:10px; }
/* The two nav buttons are a PAIR, so they are one size.
   Sized by their labels alone they came out 77px and 97px — a 20px step that
   reads as a mistake rather than as hierarchy, because the difference is the
   length of the words and not the importance of the actions. The weight and
   the fill already say which one is primary. */
.thq .nav-actions .btn { min-width:98px; justify-content:center; }
/* On a phone the nav is a utility bar, not the hero placement, and at the
   hero size the lockup finished 4px from the buttons — fine until a longer
   word or a wider button. Back to LOGO_SIZE.md (22), which the scale
   documents as the page-header size. */
@media (max-width: 560px) {
  .thq .brand { font-size:19px; gap:9px; }
  .thq .brand > svg:first-of-type { width:22px; height:22px; }
  /* Equal, but narrower. At 375px the lockup finished 12.6px from the buttons
     — the same crowding the note above records at 4px, just less of it. The
     pair stays matched and gives the width back to the gap; the 44px touch
     height is set by padding and is untouched. */
  .thq .nav-actions { gap:8px; }
  /* 13px and 10px of padding is what lets the LONGER label fit inside the
     shared width. Set any wider and "Start free" sets its own size, the pair
     stops matching, and the extra width comes straight out of the gap to the
     lockup — which is the crowding this block exists to prevent. */
  .thq .nav-actions .btn { min-width:86px; font-size:13px; padding-left:10px; padding-right:10px; }
}
.thq .btn { font-family:var(--sans); font-size:13.5px; font-weight:560; cursor:pointer; border-radius:8px; padding:9px 16px; border:1px solid transparent; text-decoration:none; display:inline-flex; align-items:center; gap:8px; transition:transform .16s ease, background .16s ease, border-color .16s ease, color .16s ease; letter-spacing:-0.005em; }
.thq .btn-ghost { color:var(--ink-soft); border-color:var(--line-2); }
.thq .btn-ghost:hover { color:var(--ink); border-color:var(--ink-faint); }
/* The FILL step, not the text step — and the label colour comes from the
   palette rather than being written here twice. The light-mode override this
   replaces was hard-coding a label colour against an accent that has since
   changed hue entirely; --on-accent is defined next to each ground's accent,
   so the pair can never drift apart again. */
.thq .btn-solid { background:var(--brass-ui); color:var(--on-accent); font-weight:640; }
/* Brighter leaf, not green. Green is reserved for meaning on this page — live,
   under par, money coming your way — and a primary button that turns green on
   hover spends that word on "you moused over something". */
.thq .btn-solid:hover { transform:translateY(-1px); background:var(--brass-hi); }
.thq .btn-lg { padding:13px 22px; font-size:15px; }
.thq .btn-solid.btn-lg::after { content:"\\2192"; font-size:14px; transition:transform .2s cubic-bezier(.2,.7,.2,1); }
.thq .btn-solid.btn-lg:hover::after { transform:translateX(3px); }

.thq .hero { position:relative; overflow:hidden; border-bottom:1px solid var(--line); }
.thq .hero::before { content:""; position:absolute; inset:-40% -20% auto 40%; height:720px; z-index:0; background:radial-gradient(50% 60% at 70% 10%, color-mix(in srgb, var(--flag) 14%, transparent), transparent 70%); pointer-events:none; }
.thq .hero::after { content:""; position:absolute; inset:0; z-index:0; pointer-events:none; background:repeating-linear-gradient(90deg, transparent 0 72px, color-mix(in srgb, var(--ink) 3%, transparent) 72px 144px); -webkit-mask-image:linear-gradient(180deg, #000, transparent 78%); mask-image:linear-gradient(180deg, #000, transparent 78%); }
.thq .hero-in { position:relative; z-index:1; display:grid; grid-template-columns:1.02fr 0.98fr; gap:56px; align-items:center; padding:76px 0 68px; }
/* balance, and align-items:flex-start rather than center, because this line
   now wraps in the hero's narrow column and on every phone. Centred, the rule
   floated to the middle of a two-line block; unbalanced, it broke to a single
   orphaned word. */
.thq .eyebrow { display:inline-flex; align-items:flex-start; gap:10px; font-size:11.5px; text-transform:uppercase; letter-spacing:0.18em; font-weight:650; color:var(--brass); text-wrap:balance; line-height:1.5; }
.thq .eyebrow::before { content:""; width:22px; height:1px; background:var(--brass); flex:none; margin-top:0.55em; }
/* Type IS the hero in this direction: a grotesque set very large and tracked
   tight, the way a board reads across a room. Not the serif — that belonged to
   the programme direction, and a serif at this size reads editorial rather
   than live. */
.thq h1 { font-family:var(--display); font-weight:700; font-size:clamp(2.8rem, 6.4vw, 5.2rem); line-height:0.98; letter-spacing:-0.022em; margin:20px 0 0; text-wrap:balance; }
/* The one italic on the page, on the one word the whole line turns on. */
.thq h1 em { font-style:italic; font-weight:600; }
.thq h1 em { font-style:normal; color:var(--brass); }
/* The four verbs. Spaced and uppercase so they read as a sequence — which is
   what they are: the organizer's actual path through the app. */
.thq .verbs { display:flex; flex-wrap:wrap; gap:8px 18px; margin:22px 0 0; font-size:12px; font-weight:650; letter-spacing:0.16em; text-transform:uppercase; color:var(--ink-soft); }
.thq .verbs span { display:inline-flex; align-items:center; gap:9px; }
.thq .verbs span::before { content:""; width:5px; height:5px; border-radius:50%; background:var(--brass); flex:none; }
.thq .lede { font-size:clamp(1.02rem, 1.4vw, 1.16rem); color:var(--ink-soft); margin:24px 0 0; max-width:40ch; line-height:1.6; }
.thq .cta-row { display:flex; gap:12px; margin-top:32px; flex-wrap:wrap; }
.thq .proof { display:flex; gap:8px 22px; margin-top:34px; flex-wrap:wrap; font-size:12.5px; color:var(--ink-soft); }
.thq .proof span { display:inline-flex; align-items:center; gap:8px; }
.thq .proof i { width:5px; height:5px; border-radius:50%; background:var(--brass); }

.thq .board { background:var(--panel); border:1px solid var(--line-2); border-radius:16px; overflow:hidden; box-shadow:0 30px 70px -34px rgba(0,0,0,0.6); }
.thq .board-top { display:flex; align-items:center; justify-content:space-between; padding:15px 18px; border-bottom:1px solid var(--line); }
.thq .board-top .t { font-family:var(--sans); font-size:15px; font-weight:600; }
.thq .board-top .t small { display:block; font-family:var(--sans); font-size:10.5px; letter-spacing:0.14em; text-transform:uppercase; color:var(--ink-faint); font-weight:600; margin-top:2px; }
.thq .live { display:inline-flex; align-items:center; gap:7px; font-size:10.5px; font-weight:650; letter-spacing:0.12em; text-transform:uppercase; color:var(--under); }
.thq .live b { width:7px; height:7px; border-radius:50%; background:var(--under); animation:thqpulse 2s infinite; }
@keyframes thqpulse { 0%,100%{opacity:1} 50%{opacity:.35} }
.thq table.lb { width:100%; border-collapse:collapse; font-size:13.5px; }
.thq .lb thead th { font-family:var(--sans); font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:var(--ink-faint); font-weight:650; text-align:right; padding:11px 18px 9px; }
.thq .lb thead th.l { text-align:left; }
.thq .lb tbody tr { transition:background .15s ease; }
.thq .lb tbody tr:hover td { background:color-mix(in srgb, var(--ink) 4%, transparent); }
.thq .lb tbody tr.lead:hover td { background:color-mix(in srgb, var(--flag) 13%, transparent); }
.thq .lb tbody td { padding:11px 18px; border-top:1px solid var(--line); text-align:right; font-variant-numeric:tabular-nums; }
.thq .lb td.pos { text-align:left; color:var(--ink-faint); font-family:var(--mono); font-size:12px; width:44px; }
.thq .lb td.name { text-align:left; font-weight:520; letter-spacing:-0.005em; }
.thq .lb td.num { font-family:var(--mono); color:var(--ink-soft); }
.thq .lb td.par { font-family:var(--mono); font-weight:640; }
.thq .lb .under { color:var(--under); }
.thq .lb .even { color:var(--ink-faint); }
.thq .lb tr.lead td { background:color-mix(in srgb, var(--flag) 9%, transparent); }
.thq .lb tr.lead td.name { color:var(--ink); font-weight:600; }
.thq .lb tr.lead td.pos { color:var(--flag); }

.thq .band { background:var(--paper); color:var(--paper-ink); }
/* The band inverts the ground, so it must invert the gold too. Leaf is a
   HIGHLIGHT — it reads at 11:1 on lacquer and all but vanishes on card stock.
   On paper the same accent has to be struck bronze instead. */
.thq .band .sec-kick { color:var(--paper-accent); }
.thq .band .sec-h { color:var(--paper-ink); }
.thq .band .sec-sub { color:var(--paper-soft); }
.thq .cardgrid { display:grid; grid-template-columns:1.05fr 0.95fr; gap:40px; align-items:center; margin-top:32px; }
.thq .scard { background:var(--paper-2); border:1px solid color-mix(in srgb, var(--paper-ink) 12%, transparent); border-radius:14px; padding:6px; }
.thq .scard-in { border:1px dashed color-mix(in srgb, var(--paper-ink) 22%, transparent); border-radius:10px; padding:18px 20px; }
.thq .band h3.big { font-family:var(--sans); font-size:clamp(1.5rem, 2.6vw, 2rem); font-weight:700; letter-spacing:-0.02em; margin:0; color:var(--paper-ink); text-wrap:balance; }
.thq .band .body { color:var(--paper-soft); margin:16px 0 0; font-size:14.5px; line-height:1.6; }
.thq .band .body b { color:var(--paper-ink); font-weight:600; }

.thq section { padding:72px 0; }
.thq .sec-kick { font-size:11.5px; text-transform:uppercase; letter-spacing:0.16em; font-weight:650; color:var(--brass); }
.thq .sec-h { font-family:var(--display); font-size:clamp(1.8rem, 3.1vw, 2.6rem); font-weight:700; letter-spacing:-0.012em; line-height:1.12; margin:12px 0 0; text-wrap:balance; }
/* 62ch rather than 54: at this size the shorter measure was breaking two-line
   sentences into three. */
.thq .sec-sub { color:var(--ink-soft); margin:15px 0 0; max-width:62ch; line-height:1.62; font-size:16.5px; }

.thq .features { display:grid; grid-template-columns:repeat(3, 1fr); gap:1px; margin-top:36px; background:var(--line); border:1px solid var(--line); border-radius:16px; overflow:hidden; }
.thq .feat { background:var(--ground); padding:30px 28px; display:flex; flex-direction:column; gap:13px; min-height:190px; transition:background .18s ease; }
.thq .feat:hover { background:var(--ground-2); }
.thq .feat .ic { width:28px; height:28px; color:var(--brass); }
.thq .feat h4 { font-family:var(--sans); font-size:17px; font-weight:600; letter-spacing:-0.01em; margin:0; }
.thq .feat p { font-size:13.5px; color:var(--ink-soft); margin:0; line-height:1.56; }

.thq .steps { display:grid; grid-template-columns:repeat(3,1fr); gap:40px; margin-top:36px; }
.thq .step { padding-top:22px; border-top:1px solid var(--line-2); }
.thq .step .n { font-family:var(--mono); font-size:11.5px; color:var(--flag); letter-spacing:0.08em; }
.thq .step h4 { font-family:var(--sans); font-size:19px; font-weight:600; margin:12px 0 8px; letter-spacing:-0.01em; }
.thq .step p { font-size:13.5px; color:var(--ink-soft); margin:0; line-height:1.56; }

.thq .chips { display:flex; flex-wrap:wrap; gap:10px; margin-top:36px; }
.thq .chip { font-size:13px; color:var(--ink-soft); border:1px solid var(--line-2); border-radius:999px; padding:8px 16px; transition:border-color .16s ease, color .16s ease; }
.thq .chip:hover { border-color:var(--brass); color:var(--ink); }
.thq .chip b { color:var(--ink); font-weight:580; }

.thq .faq { margin-top:44px; border-top:1px solid var(--line); }
.thq .faq details { border-bottom:1px solid var(--line); }
.thq .faq summary { list-style:none; cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:24px; padding:24px 4px; font-family:var(--sans); font-size:clamp(1rem, 1.6vw, 1.18rem); font-weight:600; letter-spacing:-0.012em; color:var(--ink); transition:color .16s ease; }
.thq .faq summary:hover { color:var(--brass); }
.thq .faq summary::-webkit-details-marker { display:none; }
.thq .faq .chev { flex:none; width:19px; height:19px; color:var(--brass); transition:transform .22s cubic-bezier(.2,.7,.2,1); }
.thq .faq details[open] summary .chev { transform:rotate(180deg); }
.thq .faq .ans { padding:0 4px 26px; max-width:64ch; color:var(--ink-soft); font-size:14.5px; line-height:1.64; }
.thq .faq .ans p { margin:0; }
.thq .faq .ans p + p { margin-top:12px; }
.thq .faq .ans b { color:var(--ink); font-weight:600; }
.thq .calc { margin-top:16px; border:1px solid var(--line-2); border-radius:11px; overflow:hidden; max-width:400px; }
.thq .calc .cr { display:flex; align-items:center; justify-content:space-between; padding:10px 15px; border-top:1px solid var(--line); font-size:13px; }
.thq .calc .cr:first-child { border-top:0; }
.thq .calc .cr .k { color:var(--ink-soft); }
.thq .calc .cr .v { font-family:var(--mono); font-variant-numeric:tabular-nums; color:var(--ink); }
.thq .calc .cr.win { background:color-mix(in srgb, var(--flag) 10%, transparent); }
.thq .calc .cr.win .k { color:var(--ink); font-weight:560; }
.thq .calc .cr.win .v { color:var(--flag); font-weight:660; font-size:14px; }

.thq .authsec { position:relative; }
.thq .anchor { display:block; position:relative; top:-84px; height:0; visibility:hidden; }
.thq .authwrap { display:grid; grid-template-columns:1fr minmax(360px, 400px); gap:56px; align-items:center; }
.thq .authcopy .proof { margin-top:26px; }
.thq .authpanel { display:flex; justify-content:center; }

.thq .close { text-align:center; padding:108px 0; border-top:1px solid var(--line); position:relative; overflow:hidden; }
.thq .close::before { content:""; position:absolute; inset:auto 0 -50% 0; height:460px; background:radial-gradient(50% 100% at 50% 100%, color-mix(in srgb, var(--flag) 12%, transparent), transparent 72%); pointer-events:none; }
.thq .close h2 { font-family:var(--display); position:relative; font-size:clamp(2rem, 4vw, 3rem); font-weight:700; letter-spacing:-0.025em; margin:0; text-wrap:balance; }
.thq .close p { position:relative; color:var(--ink-soft); margin:18px auto 32px; max-width:46ch; }

.thq footer { border-top:1px solid var(--line); padding:34px 0 44px; }
.thq .foot-in { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; }
.thq .foot-brand { font-family:var(--sans); font-size:17px; font-weight:600; display:flex; align-items:center; gap:10px; }
.thq .foot-meta { font-size:12.5px; color:var(--ink-faint); display:flex; gap:18px; flex-wrap:wrap; }
.thq .foot-meta .cred { color:var(--ink-soft); }

/* The AjAi mark: orange capitals, green stems, orange tittles.
   A tittle — the dot over an i or a j — is part of the glyph, so CSS cannot
   colour it apart from the stem it sits on. The only honest way to get an
   orange dot over a green stem is to use the DOTLESS letters (ı U+0131,
   ȷ U+0237) and draw the dots as pseudo-elements.
   That swap is invisible to the eye and very visible to a screen reader, which
   would read "AȷAı" — so the decorative version is aria-hidden and the real
   word is supplied beside it for assistive tech only. */
/* The rule: ORANGE for the capitals and the tittles, GREEN for the lowercase
   stems and the "Labs" that follows. Two brand colours, one statable rule.

   Every number below is MEASURED off Geist's own i and j — rasterized and
   pixel-scanned — rather than eyeballed, so a replacement tittle is
   indistinguishable from the real one except in colour:

     tittle box      0.1575 x 0.1225em   (wider than tall — it is a rounded
                                          RECTANGLE, not a dot; a circle here
                                          reads as a different typeface)
     corner radius   ~0.028em            (measured 96.4% box fill)
     tittle top      0.725em above the baseline
     ink left edge   0.06em (i) / 0.11em (j) from the glyph origin — the j's
                     stem sits right of its advance centre because the
                     descender hooks left, so left:50% would misplace it
     font ascent     1.005em  -> top = 1.005 - 0.725 = 0.28em from the inline
                     content box, which is what an absolutely positioned child
                     of an inline element is measured against.

   These are Geist's metrics. If the display face ever changes, re-measure. */
.thq .ajai { font-weight:700; }
.thq .ajai-cap { color:var(--brand-amber); }
.thq .ajai-stem { position:relative; color:var(--brand-green); }
.thq .ajai-stem::after {
  content:""; position:absolute; top:0.28em;
  width:0.1575em; height:0.1225em; border-radius:0.028em;
  background:var(--brand-amber);
}
.thq .ajai-stem.is-i::after { left:0.06em; }
.thq .ajai-stem.is-j::after { left:0.11em; }
/* The qualifier, tied to the stems and one weight quieter so it reads as the
   suffix to the mark rather than a fifth letter competing with it. */
.thq .ajai-labs { color:var(--brand-green); font-weight:600; }
.thq .sr-only {
  position:absolute; width:1px; height:1px; padding:0; margin:-1px;
  overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0;
}

.thq-js .rise { opacity:0; transform:translateY(15px); }
.thq-js .in .rise { opacity:1; transform:none; transition:opacity .75s ease, transform .75s cubic-bezier(.2,.7,.2,1); }
.thq-js .in .rise:nth-child(2){transition-delay:.07s} .thq-js .in .rise:nth-child(3){transition-delay:.14s} .thq-js .in .rise:nth-child(4){transition-delay:.2s}
.thq-js .reveal { opacity:0; transform:translateY(22px); transition:opacity .75s ease, transform .75s cubic-bezier(.2,.7,.2,1); }
.thq-js .reveal.seen { opacity:1; transform:none; }
@media (prefers-reduced-motion: reduce){ .thq .rise, .thq .reveal, .thq .live b { opacity:1 !important; transform:none !important; transition:none !important; animation:none !important } }

@media (max-width: 880px) {
  .thq .hero-in { grid-template-columns:1fr; gap:46px; padding:62px 0 58px; }
  .thq .cardgrid { grid-template-columns:1fr; gap:30px; }
  .thq .features { grid-template-columns:1fr; }
  .thq .steps { grid-template-columns:1fr; gap:30px; }
  .thq .authwrap { grid-template-columns:1fr; gap:34px; }
  .thq .lede { max-width:none; }
  .thq section { padding:54px 0; }
}

/* ── The night ────────────────────────────────────────────────────────────
   The signature. A golf club's Thursday is not a feature list, it is a card
   and a settle-up — so the page shows one rather than describing it.

   Tabular numerals throughout: a column of scores that does not line up is
   the one thing a golfer notices before they read a word. */
.thq .night { margin-top: 26px; }
.thq .holes {
  display: grid;
  grid-template-columns: repeat(9, minmax(0, 1fr));
  gap: 2px;
  font-variant-numeric: tabular-nums;
}
.thq .hole {
  padding: 9px 2px 8px;
  text-align: center;
  border-radius: 3px;
  background: color-mix(in srgb, var(--color-text) 5%, transparent);
  min-width: 0;
}
/* A hole somebody won outright. The carry stops here and the money moves. */
.thq .hole.won {
  background: color-mix(in srgb, var(--color-accent) 20%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 42%, transparent);
}
/* Tied: nobody takes it and the value rolls into the next one. This is the
   whole character of skins, so it is drawn rather than captioned. */
.thq .hole.carry { background: color-mix(in srgb, var(--color-text) 9%, transparent); }
.thq .hole .h { display: block; font-size: 9.5px; letter-spacing: .08em; opacity: .55; }
.thq .hole .v { display: block; font-size: 14px; font-weight: 600; margin-top: 2px; }
.thq .hole .who { display: block; font-size: 9px; opacity: .7; margin-top: 1px; }
.thq .settle {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  align-items: baseline;
  margin-top: 12px;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
.thq .settle b { font-size: 15px; }
.thq .settle .sep { opacity: .35; }

/* ── Price ────────────────────────────────────────────────────────────────
   The page has never priced anything. Two columns, the free one first,
   because most readers are on it and the thing they most need to know is
   what it does not keep. */
.thq .plans {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 14px;
  margin-top: 22px;
}
.thq .plan {
  padding: 20px 20px 22px;
  border-radius: var(--radius-lg, 14px);
  background: color-mix(in srgb, var(--color-text) 4%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text) 11%, transparent);
  min-width: 0;
}
.thq .plan.paid {
  background: color-mix(in srgb, var(--color-accent) 9%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 34%, transparent);
}
.thq .plan .amt {
  font-family: var(--font-display, var(--font-heading));
  font-size: 34px;
  line-height: 1.05;
  letter-spacing: -.02em;
  font-variant-numeric: tabular-nums;
}
.thq .plan .per { font-size: 13px; opacity: .6; }
.thq .plan ul { margin: 14px 0 0; padding-left: 17px; font-size: 13.5px; line-height: 1.75; }
.thq .plan li::marker { color: color-mix(in srgb, var(--color-accent) 70%, transparent); }
/* The retention line is the one fact a club must have before it plays, not
   after. It is styled to be read first and it is not softened. */
.thq .keepwarn {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 1.55;
  background: color-mix(in srgb, var(--color-danger) 13%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-danger) 34%, transparent);
}

/* ── The weekend, settled ───────────────────────────────────
   Two columns that add to one number. Tabular numerals and a right-aligned
   value column, because a ledger nobody can scan down is not a ledger. */
.thq .ledger { display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:14px; margin-top:22px; }
.thq .led { padding:16px 18px; border-radius:var(--radius-lg,14px); background:color-mix(in srgb, var(--paper-ink) 5%, transparent); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--paper-ink) 13%, transparent); min-width:0; }
.thq .led-h { font-size:12px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; margin-bottom:9px; }
.thq .led-h span { font-weight:500; letter-spacing:0; text-transform:none; }
.thq .led dl { margin:0; font-variant-numeric:tabular-nums; }
.thq .led dl > div { display:flex; justify-content:space-between; gap:14px; padding:5px 0; font-size:13.5px; }
.thq .led dt { margin:0; min-width:0; }
/* Who is actually on this line. It sits under the description rather than
   beside it because it is the part that differs per line, and a reader
   scanning for "wait, am I paying for the bar?" is scanning this column. */
.thq .led-who { display:block; font-size:11.5px; line-height:1.45; margin-top:1px; }
.thq .led dd { margin:0; text-align:right; white-space:nowrap; }
.thq .led dd.won { color:var(--flag); font-weight:640; }
.thq .led .led-sum { margin-top:5px; padding-top:9px; border-top:1px solid color-mix(in srgb, var(--paper-ink) 20%, transparent); font-weight:680; }
.thq .led-out { margin-top:16px; display:flex; flex-direction:column; gap:3px; }
.thq .led-out-k { font-size:11.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
.thq .led-out-v { font-family:var(--display); font-size:27px; line-height:1.15; letter-spacing:-.01em; font-variant-numeric:tabular-nums; }
.thq .led-out-n { font-size:12.5px; line-height:1.6; max-width:62ch; }
@media (max-width: 560px) {
  /* Nine across is unreadable on a phone; two rows of nine is how a card is
     printed anyway — an Out nine and an In nine. */
  .thq .holes { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .thq .plan .amt { font-size: 30px; }
}

`;

/**
 * The app's mark, wearing the programme palette.
 *
 * This used to be a second hand-drawn copy of the logo — same idea, a slightly
 * bigger cup and a thinner flagstick — so the mark above the sign-in button
 * was not quite the mark inside the app. It now maps the page's own colours
 * onto the real component, which is the point of the --logo-* variables: one
 * drawing, two palettes.
 *
 * The cup is left unfilled here because it sits on the fairway-green ground
 * rather than on a flat surface.
 */
function FlagMark({ size = LOGO_SIZE.md }: { size?: number }) {
  return (
    <Logo
      size={size}
      style={
        {
          // Pennant orange, ball green, stick in ink — the programme's
          // two-tone. The app draws stick and pennant in one colour; this is
          // the difference the variables exist to carry.
          //
          // The comment above said "pennant orange" while the line below
          // mapped it to --flag, which is this page's GREEN. The mark rendered
          // green-on-green and the ball took the ink colour, because it was
          // not a variable at all.
          "--logo-flag": "var(--brand-amber)",
          "--logo-ball": "var(--brand-green)",
          "--logo-stick": "currentColor",
          "--logo-rim": "var(--line-2)",
          "--logo-cup": "transparent",
        } as React.CSSProperties
      }
    />
  );
}

function Chevron() {
  return (
    <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export default async function LoginPage() {
  const session = await getSession();
  // Straight after sign-up there is no tournament yet, and the dashboard has
  // nothing to render without one — it would only bounce to /choose anyway.
  // Via landingScreenFor, not a hard-coded /dashboard. This is where signing
  // in actually lands, and it was sending players into the organizer's console
  // no matter what that function said — the function was only ever consulted
  // by requireScreen as somewhere to BOUNCE to, so changing it had no effect
  // on the one journey it is named after.
  if (session) redirect(session.eventId ? landingScreenFor(session.viewRole) : "/choose");

  /**
   * Whole dollars where the price is whole, so "$29" never reads "$29.00".
   *
   * Named `planPrice`, not `money`, and the rename is the point: it takes
   * WHOLE DOLLARS while the shared `money()` next to it takes CENTS. As
   * `money` it shadowed the import inside this component, and the trip ledger
   * — which is in cents — rendered $45.00 as "$4500". Two formatters with one
   * name and different units is a bug waiting on whoever writes the next line.
   */
  const planPrice = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

  const paperInk = { color: "var(--paper-ink)" } as const;
  const paperSoft = { color: "var(--paper-soft)" } as const;
  const stepBorder = { borderTopColor: "color-mix(in srgb, var(--paper-ink) 22%, transparent)" } as const;

  return (
    <div className="thq">
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <LandingEffects />

      <nav className="nav">
        <div className="wrap nav-in">
          <div className="brand">
            {/* `lg`, which the scale documents as the hero size — and this
                nav IS the hero placement. At `md` the mark stood 22px in an
                89px bar beside a 51px headline: a quarter of the bar, reading
                as subordinate to the sentence on the one page whose job is to
                say who we are. Still a value from LOGO_SIZE, so the one-size
                rule brand-consistency.test.ts enforces still holds. */}
            <FlagMark size={LOGO_SIZE.lg} />
            {/* The same lockup the app uses, re-skinned by variables — the
                pattern FlagMark above already follows. It used to be written
                out here by hand in the sans face with an italic "HQ", so the
                wordmark above the sign-in button was not the wordmark inside
                the product. */}
            <BrandMark size={22} style={BRAND_TOKENS} />
          </div>
          <div className="nav-actions">
            <a className="btn btn-ghost" href="#signin" role="button">Sign in</a>
            <a className="btn btn-solid" href="#signup" role="button">Start free</a>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="wrap hero-in" id="thq-hero">
          <div>
            {/* Says what this IS, not who it is for. The audience already has
                a section of its own further down — club championships, league
                play, member-guest, corporate and charity — so an eyebrow
                listing them again buried the one word a stranger needs, and
                buried it at the end of the line.

                "Management" rather than "software": the category word moved on,
                and "software" now reads like a 2005 licence rather than
                something you sign into. "All-in-one" is doing real work too —
                the objection this product answers is a club running four
                different tools and a spreadsheet. */}
            <div className="eyebrow rise">All-in-one golf tournament &amp; league management</div>
            <h1 className="rise">From Registration<br />to <em>Recognition.</em></h1>
            {/* The four verbs are the organizer's real path through the app —
                registration, flights and pairings, rounds and scoring, prizes
                and the champion — which is why they earn the sequence
                treatment rather than being decoration. */}
            <div className="verbs rise">
              <span>Plan it</span><span>Pair it</span><span>Play it</span><span>Crown it</span>
            </div>
            <p className="lede rise">Every format scored to the book, the cut carried round to round, the skins settled to the penny — and a live leaderboard on every phone at the tee.</p>
            <div className="cta-row rise">
              <a className="btn btn-solid btn-lg" href="#signup" role="button">Set up your first event</a>
              <a className="btn btn-ghost btn-lg" href="#board" role="button">See a live leaderboard</a>
            </div>
            <div className="proof rise">
              <span><i></i>Every recognised format</span>
              <span><i></i>WHS course handicaps</span>
              {/* The money promise belongs in the hero, not four screens down.
                  It is half of what this product is, and "No spreadsheets"
                  said what a visitor avoids rather than what they get. */}
              <span><i></i>The money settles itself</span>
            </div>
          </div>

          <div className="board rise" id="board" role="figure" aria-label="Live tournament leaderboard">
            <div className="board-top">
              <div className="t">Club Championship<small>Round 2 · Final round</small></div>
              <span className="live"><b></b>Live</span>
            </div>
            <table className="lb">
              <thead>
                <tr><th className="l">Pos</th><th className="l">Player</th><th>Thru</th><th>To par</th><th>Total</th></tr>
              </thead>
              <tbody>
                {/* Half the field still out. The badge says LIVE, so the board
                    has to look live: every row reading F described a finished
                    round, which quietly contradicted the one claim this page
                    is making. Totals are blank for anyone mid-round, because a
                    total before the 18th is not a thing. */}
                <tr className="lead"><td className="pos">1</td><td className="name">A. Moore</td><td className="num">14</td><td className="par under">&minus;6</td><td className="num">&mdash;</td></tr>
                <tr><td className="pos">2</td><td className="name">M. Ellis</td><td className="num">F</td><td className="par under">&minus;4</td><td className="num">140</td></tr>
                <tr><td className="pos">T3</td><td className="name">T. Brooks</td><td className="num">16</td><td className="par under">&minus;2</td><td className="num">&mdash;</td></tr>
                <tr><td className="pos">T3</td><td className="name">D. Warren</td><td className="num">F</td><td className="par under">&minus;2</td><td className="num">142</td></tr>
                <tr><td className="pos">5</td><td className="name">A. Reid</td><td className="num">11</td><td className="par even">E</td><td className="num">&mdash;</td></tr>
                <tr><td className="pos">6</td><td className="name">S. Hayes</td><td className="num">F</td><td className="par even">+2</td><td className="num">146</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </header>

      {/* ── A league night ────────────────────────────────────────────────
          The page used to open its argument with a grid of twelve features.
          A grid is what every product does; a league night is what this one
          is actually for, and it is what the last month of work serves.

          The strip is a real skins game: ties carry, and the carry is why
          the last hole is worth something. Drawn rather than described,
          because the drama IS the arithmetic.

          No names at all: a skins game is holes and money, and this
          repository is public. */}
      <section>
        <div className="wrap">
          <div className="reveal">
            <div className="sec-kick">A weekly league</div>
            <h2 className="sec-h">Nine holes, four games, everyone paid before the bar closes.</h2>
            <p className="sec-sub">
              A league night is not one competition. It is the match, the front nine, the back nine,
              gross and net — and a season table underneath all of it. TourneyHQ scores every one of
              them off the same cards.
            </p>
          </div>

          <div className="night reveal">
            <div className="holes" aria-hidden="true">
              {[
                { h: 1, v: "1", note: "won", won: true },
                { h: 2, v: "1", note: "won", won: true },
                { h: 3, v: "—", note: "tied", carry: true },
                { h: 4, v: "—", note: "tied", carry: true },
                { h: 5, v: "—", note: "tied", carry: true },
                { h: 6, v: "4", note: "won, 3 carried", won: true },
                { h: 7, v: "—", note: "tied", carry: true },
                { h: 8, v: "—", note: "tied", carry: true },
                { h: 9, v: "3", note: "won, 2 carried", won: true },
              ].map((s) => (
                <div key={s.h} className={`hole${s.won ? " won" : ""}${s.carry ? " carry" : ""}`}>
                  <span className="h">{s.h}</span>
                  <span className="v">{s.v}</span>
                  <span className="who">{s.note}</span>
                </div>
              ))}
            </div>
            <div className="settle">
              <span>Front nine skins, net</span>
              <span className="sep">·</span>
              <span>18 in at $5</span>
              <span className="sep">·</span>
              <span>4 skins won</span>
              <span className="sep">·</span>
              <span>
                <b>$22.50</b> a skin
              </span>
            </div>
            <p className="sec-sub" style={{ marginTop: 10 }}>
              A tied hole pays nobody and rolls into the next — which is why the 9th was worth three.
              The pot divides in whole cents, so it cannot pay out a penny more than went in, and
              nothing is settled on a hole nobody has finished.
            </p>
            {/* The group-level games. Said here rather than in its own section
                because it is the same fact one scope down: a night is several
                games, and not all of them are the club's. */}
            <p className="sec-sub" style={{ marginTop: 10 }}>
              And not every game is the club&rsquo;s. <b>Any fourball can run its own</b> — their
              stake, their players, their pot — alongside the field&rsquo;s, without the organizer
              setting it up and without the two ever touching. Whatever a player is in, it lands in
              the same one number at the end.
            </p>
          </div>
        </div>
      </section>

      {/* ── The championship shape ────────────────────────────────────────
          Divisions off different tees is the case that breaks most software,
          and the reason is always the same: it is expressed per player, so
          nobody does it. */}
      <section className="band">
        <div className="wrap">
          <div className="reveal">
            <div className="sec-kick">Club championship</div>
            <h2 className="sec-h" style={paperInk}>Three divisions, three sets of tees, one leaderboard.</h2>
            <p className="sec-sub" style={paperSoft}>
              The championship off the blues, the seniors off the whites, the ladies off the reds.
              Set it once per division — not once per player — and the course handicap does the rest:
              the rating difference between two sets is exactly what makes them comparable.
            </p>
          </div>
          <div className="cardgrid reveal">
            <div className="scard" style={stepBorder}>
              <div className="scard-in">
                <h4 style={paperInk}>Or one set for everyone</h4>
                <p style={paperSoft}>
                  A medal off the whites is a condition of competition, not a preference. Choose it
                  and a player&rsquo;s own stored tee cannot quietly override the committee.
                </p>
              </div>
            </div>
            <div className="scard" style={stepBorder}>
              <div className="scard-in">
                <h4 style={paperInk}>Or let them choose</h4>
                <p style={paperSoft}>
                  A society that already knows what it plays off can pick for itself, and change it
                  until a card is returned. Same scoring either way.
                </p>
              </div>
            </div>
            <div className="scard" style={stepBorder}>
              <div className="scard-in">
                <h4 style={paperInk}>Printed on the card</h4>
                <p style={paperSoft}>
                  Each player&rsquo;s tees are named beside them on the scorecard the group carries
                  out — the set the round was actually scored from, not a second guess at it.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── The season ───────────────────────────────────────────────────
          The table a league exists for, and the one thing that makes several
          weeks a season rather than several evenings. */}
      <section>
        <div className="wrap">
          <div className="reveal">
            <div className="sec-kick">Across the weeks</div>
            <h2 className="sec-h">Where the teams stand after six weeks.</h2>
            <p className="sec-sub">
              Not just after last night. Sides that missed a week are shown as having played fewer,
              never as having scored nothing — and two teams level share a place rather than being
              separated by the order they happen to sit in.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="reveal">
            <div className="sec-kick">What it does</div>
            <h2 className="sec-h">Built for how golf is actually run.</h2>
            <p className="sec-sub">A scramble is not stroke play with fewer cards, and skins is not a total. Every format keeps its own engine — and all of them settle onto one leaderboard.</p>
          </div>
          <div className="features reveal">
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 21V4" /><path d="M6 4l11 3-11 3" /></svg>
              <h4>Every format, one table</h4>
              <p>Singles and side formats, each scored by its own rules, then reconciled to a single set of standings.</p>
            </div>
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.3" /></svg>
              <h4>Handicaps to the book</h4>
              <p>Course handicap from the tee&rsquo;s slope and rating, then the format&rsquo;s allowance. Unrated tees say so.</p>
            </div>
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v6a3 3 0 003 3h6" /><rect x="3" y="1.5" width="3" height="3" rx=".6" /><rect x="18" y="10.5" width="3" height="3" rx=".6" /><rect x="18" y="4.5" width="3" height="3" rx=".6" /></svg>
              <h4>Brackets, drawn your way</h4>
              <p>One bracket, two flights, or a main draw with a plate. Seeded from live standings, byes handled.</p>
            </div>
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 21V4h13l-2.5 3.5L19 11H6" /></svg>
              <h4>Rounds that follow on</h4>
              <p>Cuts and carry-forward apply as each round closes. When two rounds don&rsquo;t measure the same thing, it says so first.</p>
            </div>
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.4" /><path d="M11 18.5h2" /></svg>
              <h4>Players score from the tee</h4>
              <p>A round code puts a player on their card — no account, no install. Or keep the cards with your staff.</p>
            </div>
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2.2" /><path d="M7.5 7.5a6.4 6.4 0 000 9M16.5 7.5a6.4 6.4 0 010 9M4.5 4.5a10.6 10.6 0 000 15M19.5 4.5a10.6 10.6 0 010 15" /></svg>
              <h4>A link for everyone else</h4>
              <p>A public live leaderboard for the clubhouse screen and the players&rsquo; families — without a login.</p>
            </div>
            {/* Three the page never claimed, and all three are what an
                organizer is otherwise doing in a group chat and a spreadsheet
                beside the app — which is the actual competitor. Nine cards
                also keeps the three-column grid square. */}
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20.5 12a8.5 8.5 0 01-12.3 7.6L3.5 20.5l.9-4.7A8.5 8.5 0 1120.5 12z" /></svg>
              <h4>Messages, at the right level</h4>
              <p>The whole club, one tournament, a flight, a round, a side, your fourball, your match — or one player. Everyone sees only the conversations they&rsquo;re actually in.</p>
            </div>
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /><path d="M9 14.5l2 2 4-4" /></svg>
              <h4>Who&rsquo;s in, week by week</h4>
              <p>Players opt in or out on their own phone and the tee sheet fills from the answers — instead of a reply-all thread you have to count.</p>
            </div>
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8.5" r="3.4" /><path d="M2.8 20a6.4 6.4 0 0112.4 0" /><path d="M16.5 6.2a3.4 3.4 0 010 6.6M18.4 20a6.4 6.4 0 00-2.2-4.8" /></svg>
              <h4>One roster, every event</h4>
              <p>Entering somebody in a tournament adds them to the club list. Handicaps, tees and contact details carry to the next one — and a blank box never overwrites what you already had.</p>
            </div>
            {/* Three more the page did not claim, and each is a thing the app
                now does that nothing on this list implied. Twelve keeps the
                three-column grid square. */}
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-6.1 7-11a7 7 0 10-14 0c0 4.9 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></svg>
              <h4>Your course, not a guess</h4>
              <p>Look it up and its card and rated tee sets arrive with it. Where the public data can&rsquo;t be trusted we say so and leave the card blank, rather than handing you a par nobody has played.</p>
            </div>
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 9.5h19M7 9.5V19M12 9.5V19M17 9.5V19" /></svg>
              <h4>The card, as it is on paper</h4>
              <p>Your club&rsquo;s mark at the head of it, the course leading, par and stroke index where you expect them — and the round&rsquo;s format decides what it asks for: every hole, who won each one, or just the margin.</p>
            </div>
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.8l2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 16.6 6.7 19.5l1.1-6.1L3.4 9.2l6-.8z" /></svg>
              <h4>However you&rsquo;re organised</h4>
              <p>A club with a members&rsquo; roster, a society playing a different course each month, or four of you on a Saturday. Each gets the parts that apply and is never asked about the rest.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="reveal">
            <div className="sec-kick">How a tournament runs</div>
            <h2 className="sec-h" style={paperInk}>First tee to honours board.</h2>
          </div>
          <div className="steps reveal">
            <div className="step" style={stepBorder}>
              <span className="n" style={{ color: "var(--brass)" }}>STEP 01</span>
              <h4 style={paperInk}>Set up</h4>
              <p style={paperSoft}>Field, flights, rounds and format. Running last year&rsquo;s again? Copy it — configuration only, never the old results.</p>
            </div>
            <div className="step" style={stepBorder}>
              <span className="n" style={{ color: "var(--brass)" }}>STEP 02</span>
              <h4 style={paperInk}>Play</h4>
              <p style={paperSoft}>Scores from any phone at the tee, or entered by your staff. Standings update on every device as cards come in.</p>
            </div>
            <div className="step" style={stepBorder}>
              <span className="n" style={{ color: "var(--brass)" }}>STEP 03</span>
              <h4 style={paperInk}>Results</h4>
              <p style={paperSoft}>Brackets seeded, ties broken, payouts calculated. Export the lot, or publish a link for the clubhouse.</p>
            </div>
          </div>
        </div>
      </section>

      {/* The player's half of the product. The page spoke only to organizers,
          which undersold the thing a member actually holds on the course —
          and it is the half every competitor leads with. */}
      <section>
        <div className="wrap">
          <div className="reveal">
            <div className="sec-kick">For the player</div>
            <h2 className="sec-h">Four tabs, and nothing to learn.</h2>
            <p className="sec-sub">
              A member opens their phone on the first tee, not a manual. Their card, the board, what
              they owe, and whether they&rsquo;re playing next week — and a round code gets them in
              with no account at all.
            </p>
          </div>
          <div className="features reveal">
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /></svg>
              <h4>A card that saves itself</h4>
              <p>
                Hole by hole between shots, or the whole card to check against the paper one. No Save
                button — a Save button on a golf course is a round lost to a pocket.
              </p>
            </div>
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
              <h4>Where you stand, first</h4>
              <p>
                Your own line sits above the board, so &ldquo;where am I&rdquo; is answered before a
                finger touches the screen — and the column says whether it is strokes, points or
                match play.
              </p>
            </div>
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 11h18" /></svg>
              <h4>Am I in next week?</h4>
              <p>
                A league season on a calendar, not twelve identical rows. In, out, and — honestly —
                &ldquo;in because nobody said otherwise&rdquo;, which is a different promise.
              </p>
            </div>
            <div className="feat">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18" /><path d="M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.6 5 3 5 1.3 5 3-2.2 3-5 3-5-1.1-5-3" /></svg>
              <h4>What you owe, in one number</h4>
              <p>
                Dinner, the carts, the skins and the closest-to-the-pin — added up into a single
                figure, with the parts shown so nobody has to take it on trust.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* The differentiator, and the one thing no general expense app can do:
          it does not know the golf. */}
      <section className="band">
        <div className="wrap">
          <div className="reveal">
            <div className="sec-kick" style={paperInk}>The money</div>
            <h2 className="sec-h" style={paperInk}>One settle-up, golf included.</h2>
            {/* No named products here, and none anywhere on this page.
                It also does not pretend splitting is hard. It is not, and
                the apps that do it do it well — the claim is about where the
                NUMBERS come from, which is the half they cannot help with. */}
            <p className="sec-sub" style={paperInk}>
              Splitting a bill is the easy half, and this does that too — but properly. Every line
              carries its own people and its own weights: the two who went to the bar, the one who
              came up for the second night only, the guest somebody signed in. Nothing is forced
              into equal quarters. The half that costs an evening is knowing the amounts —
              somebody has to work out that a player won three skins at $22.50, lost the front
              nine, and owes for a guest, then type it in. Here nobody types it. The golf money IS
              the card, and the trip and the competition net off into one balance and one handover.
            </p>
          </div>

          {/* The weekend, settled.
              The claim above is that the trip and the competition net into one
              number. That is only believable if the number is shown, so it is.
              Every figure in the left-hand column now comes from `shareOf` —
              the splitter the app settles with — so the example cannot drift
              from the product, and the awkward lodging split is the engine's
              answer rather than mine. See TRIP at the top of this file. */}
          <div className="ledger reveal">
            <div className="led">
              <div className="led-h" style={paperInk}>The trip <span style={paperSoft}>· four players, no two shares alike</span></div>
              <dl>
                {TRIP.rows.map((r) => (
                  <div key={r.description}>
                    <dt style={paperInk}>
                      {r.description}
                      <span className="led-who" style={paperSoft}>{r.who}</span>
                    </dt>
                    <dd style={paperInk}>{money(r.yours)}</dd>
                  </div>
                ))}
                <div className="led-sum"><dt style={paperInk}>Your share</dt><dd style={paperInk}>{money(TRIP.yourShare)}</dd></div>
              </dl>
            </div>

            <div className="led">
              <div className="led-h" style={paperInk}>The golf <span style={paperSoft}>· worked out from the cards</span></div>
              <dl>
                <div><dt style={paperInk}>Skins, front nine net</dt><dd className="won" >+$67.50</dd></div>
                <div><dt style={paperInk}>Closest to the pin</dt><dd className="won">+$25.00</dd></div>
                <div><dt style={paperInk}>Long drive, into the pot</dt><dd style={paperInk}>−$15.00</dd></div>
                <div className="led-sum"><dt style={paperInk}>Golf nets</dt><dd className="won">+$77.50</dd></div>
              </dl>
            </div>
          </div>

          <div className="led-out reveal" style={paperInk}>
            <span className="led-out-k" style={paperSoft}>Settles to</span>
            <span className="led-out-v">one handover of {money(TRIP.handover)}</span>
            <span className="led-out-n" style={paperSoft}>
              Not four transfers between four people, and not a quarter of everything. Nobody typed
              a golf number, and nothing here moves a penny — it is the figure everybody agrees on
              before they get to the bar.
            </span>
          </div>

          <div className="calc reveal" style={{ maxWidth: 440 }}>
            <div className="cr"><span className="k">Dinner, split four ways</span><span className="v">−65.00</span></div>
            <div className="cr"><span className="k">Carts, your fourball</span><span className="v">−45.00</span></div>
            <div className="cr"><span className="k">Skins, worked out from the cards</span><span className="v">+80.00</span></div>
            <div className="cr"><span className="k">Closest to the pin, 7th</span><span className="v">+15.00</span></div>
            <div className="cr win"><span className="k">You&rsquo;re owed</span><span className="v">15.00</span></div>
          </div>
          <p className="sec-sub reveal" style={{ ...paperInk, marginTop: 18, maxWidth: "52ch" }}>
            Skins and the low-gross pot settle from the scorecards themselves. Closest to the pin and
            the long drive are typed in, because no card has ever recorded who was nearest the flag.
            Everything balances to the cent, and a pot nobody has won yet costs nobody anything.
          </p>
        </div>
      </section>

      {/* ── Nothing else open ────────────────────────────────────────────
          The real competitor was never another golf product. It is the
          spreadsheet, the group chat and the money app an organizer already
          runs beside whatever they use — so the claim worth making is that
          none of them is still open.

          No product is named here or anywhere on this page. Naming one dates
          the copy, and picks a fight the reader did not come for. */}
      <section>
        <div className="wrap">
          <div className="reveal">
            <div className="sec-kick">All of it, in one place</div>
            {/* The claim stated plainly, because it is the one this product
                is actually built on: the golf AND the books, from the same
                cards. Everything under this heading is evidence for it. */}
            <h2 className="sec-h">Play the golf. The accounting takes care of itself.</h2>
            <p className="sec-sub">
              Nobody turns up for the arithmetic. You should not be totting up skins in the car park
              or working out who owes whom before the bar closes — so here you don&rsquo;t. Every
              stake, every pot, every shared cost and every payout is worked out from the cards as
              you play, and lands as <b>one number per person</b>. Nothing to reconcile afterwards,
              and no spreadsheet, chat thread or side app to keep in step.
            </p>
            <p className="sec-sub" style={{ marginTop: 12 }}>
              Running a competition usually means a workbook for the field, a chat thread for who is
              in, a notes app for the skins and something else again to work out who owes whom. Every
              one of them is a place the numbers can disagree. Here they cannot, because there is
              only one set of them — and it is the set the round produced.
            </p>
          </div>

          <div className="features reveal">
            <div className="feat">
              <h3>The field and the draw</h3>
              <p>
                Entries, the roster, flights and the tee sheet — drawn from who actually said they
                were playing, not from a column somebody kept up to date by hand.
              </p>
            </div>
            <div className="feat">
              <h3>The scoring</h3>
              <p>
                Every format on its own engine, handicaps to the book, and one leaderboard they all
                settle onto. No formula to copy down a column and no column to get wrong.
              </p>
            </div>
            <div className="feat">
              <h3>The talking</h3>
              <p>
                Frost delays, tee changes and the week&rsquo;s question, sent to the club, a flight,
                a match or one player — so the thread nobody can search is not where the fixture
                lives.
              </p>
            </div>
            <div className="feat">
              <h3>The money</h3>
              <p>
                Entry fees, skins, the pot and the side games added up together, settled to the
                penny, and reduced to the fewest handovers that square everybody.
              </p>
            </div>
          </div>

          {/* Said plainly and immediately after the money claim, because a
              club will ask it and would rather read it here than find out. */}
          <p className="sec-sub reveal" style={{ marginTop: 18 }}>
            TourneyHQ works out the money and keeps the record. It never holds it, moves it or takes
            a cut — what changes hands happens between the people it always did, and the app is the
            thing everybody agrees with rather than another account to reconcile.
          </p>
        </div>
      </section>


      <section>
        <div className="wrap reveal">
          <div className="sec-kick">Built for</div>
          <h2 className="sec-h">The events your members actually play.</h2>
          <div className="chips">
            <span className="chip"><b>Club</b> championships</span>
            <span className="chip"><b>League</b> play</span>
            <span className="chip"><b>Member</b>-guest</span>
            <span className="chip"><b>Member</b>-member</span>
            <span className="chip"><b>Corporate</b> &amp; society days</span>
            <span className="chip"><b>Charity</b> scrambles</span>
          </div>
        </div>
      </section>


      {/* ── Price ─────────────────────────────────────────────────────────
          The page said "Start free" twice and priced nothing, which left the
          most important fact about the free tier — that it keeps results for
          two days — to be discovered after the results were gone.

          Read from PLANS rather than typed here, so the page cannot promise
          a limit the code does not enforce. */}
      <section>
        <div className="wrap">
          <div className="reveal">
            <div className="sec-kick">What it costs</div>
            <h2 className="sec-h">Free for one event. {planPrice(PLANS.club.priceMonthly)} a month for a season.</h2>
            <p className="sec-sub">
              No card to start, and nothing is charged through the app — TourneyHQ works out the
              money and keeps the record; what changes hands is arranged between you and us, and
              between your players and each other.
            </p>
          </div>

          <div className="plans reveal">
            <div className="plan">
              <div className="amt">Free</div>
              <div className="per">{PLANS.free.blurb}</div>
              <ul>
                <li>One tournament at a time</li>
                <li>One organizer</li>
                <li>As many players as turn up</li>
                <li>Every format, every scoring engine</li>
              </ul>
              <div className="keepwarn">
                <b>Results are kept {PLANS.free.retentionHours} hours.</b> After that the scores,
                the players and the standings are deleted for good. Export what you want to keep —
                or run it on the paid plan and keep it.
              </div>
            </div>

            <div className="plan paid">
              <div className="amt">
                {planPrice(PLANS.club.priceMonthly)}
                <span className="per"> / month</span>
              </div>
              <div className="per">{PLANS.club.blurb}</div>
              <ul>
                <li>As many tournaments as your season runs</li>
                <li>Up to {PLANS.club.limits.staffSeats} organizers and assistants</li>
                <li>Results kept for good</li>
                <li>The season table across the weeks</li>
                <li>Your club&rsquo;s branding, ours removed</li>
              </ul>
              <p className="sec-sub" style={{ margin: "14px 0 0", fontSize: 12.5 }}>
                Text alerts, reading a photographed card, and drafted commentary are built and not
                switched on for anybody yet — they cost per message and per call, and we will not
                bill for them until they are worth it.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="reveal">
            <div className="sec-kick">Common questions</div>
            <h2 className="sec-h" style={paperInk}>What organisers ask first.</h2>
          </div>
          <div className="faq reveal" style={{ borderTopColor: "color-mix(in srgb, var(--paper-ink) 12%, transparent)" }}>
            <details open>
              <summary style={paperInk}>How are course handicaps calculated?<Chevron /></summary>
              <div className="ans" style={paperSoft}>
                <p>To the World Handicap System, from the <b style={paperInk}>tee&rsquo;s own rating and slope</b> and then the format&rsquo;s published allowance — never the raw index. A {EXAMPLE.index.toFixed(1)} index off blue tees rated {EXAMPLE.tee.courseRating}&nbsp;/&nbsp;{EXAMPLE.tee.slopeRating}, playing four-ball at its 90% allowance, works out like this:</p>
                <div className="calc" style={{ borderColor: "color-mix(in srgb, var(--paper-ink) 20%, transparent)" }}>
                  <div className="cr" style={{ borderColor: "color-mix(in srgb, var(--paper-ink) 12%, transparent)" }}><span className="k" style={paperSoft}>Handicap index</span><span className="v" style={paperInk}>{EXAMPLE.index.toFixed(1)}</span></div>
                  <div className="cr" style={{ borderColor: "color-mix(in srgb, var(--paper-ink) 12%, transparent)" }}><span className="k" style={paperSoft}>Course rating / slope</span><span className="v" style={paperInk}>{EXAMPLE.tee.courseRating} / {EXAMPLE.tee.slopeRating}</span></div>
                  <div className="cr" style={{ borderColor: "color-mix(in srgb, var(--paper-ink) 12%, transparent)" }}><span className="k" style={paperSoft}>Course handicap</span><span className="v" style={paperInk}>{EXAMPLE.course}</span></div>
                  <div className="cr" style={{ borderColor: "color-mix(in srgb, var(--paper-ink) 12%, transparent)" }}><span className="k" style={paperSoft}>Four-ball allowance</span><span className="v" style={paperInk}>90%</span></div>
                  <div className="cr win" style={{ borderColor: "color-mix(in srgb, var(--paper-ink) 12%, transparent)", background: "color-mix(in srgb, var(--brass) 22%, transparent)" }}><span className="k" style={paperInk}>Playing handicap</span><span className="v" style={paperInk}>{EXAMPLE.playing}</span></div>
                </div>
                <p style={paperSoft}>Done for every player, every round, the moment a card comes in. An unrated tee says so, in plain words, rather than quietly scoring off the raw index.</p>
              </div>
            </details>
            <details>
              <summary style={paperInk}>Can I reuse last year&rsquo;s tournament?<Chevron /></summary>
              <div className="ans" style={paperSoft}><p>Copy it in a click. Every setting — <b style={paperInk}>flights, rounds, format, prizes</b> — carries over to a fresh event; last year&rsquo;s scores never do. Next season&rsquo;s setup is a name and a date.</p></div>
            </details>
            <details>
              <summary style={paperInk}>Can more than one of us run it?<Chevron /></summary>
              <div className="ans" style={paperSoft}><p>Invite assistants to score and manage alongside you — everyone works from the <b style={paperInk}>same live event</b>, so the scoring desk and the first tee are never out of step.</p></div>
            </details>
            <details>
              <summary style={paperInk}>Is our members&rsquo; information kept private?<Chevron /></summary>
              <div className="ans" style={paperSoft}><p>Contact details never appear on the public leaderboard — it carries names and scores only, and nothing is visible at all until <b style={paperInk}>you choose to publish</b>. Your roster stays yours.</p></div>
            </details>
            <details>
              <summary style={paperInk}>How much do I have to set up to get going?<Chevron /></summary>
              <div className="ans" style={paperSoft}><p>A name is enough to start. Dates, course, the field and the format come after — and <b style={paperInk}>every one of them stays editable</b>, right through the event.</p></div>
            </details>
          </div>
        </div>
      </section>

      <section className="authsec">
        <span className="anchor" id="signin" aria-hidden="true" />
        <span className="anchor" id="signup" aria-hidden="true" />
        <div className="wrap authwrap">
          <div className="authcopy reveal">
            <div className="sec-kick">Get started</div>
            <h2 className="sec-h">Set up your first event, or sign back in.</h2>
            <p className="sec-sub">Organizers create an event here; players invited to one sign in with the same box. A name is all it takes to start.</p>
            <div className="proof">
              <span><i></i>No card to start</span>
              <span><i></i>Editable to the last minute</span>
              <span><i></i>Players need no account</span>
            </div>
          </div>
          <div className="authpanel reveal">
            <LandingAuth />
          </div>
        </div>
      </section>

      <section className="close">
        <div className="wrap reveal">
          <h2>Set up your first event in minutes.</h2>
          <p>Just the draw, the scores, and a leaderboard that was right all along.</p>
          <div className="cta-row" style={{ justifyContent: "center" }}>
            <a className="btn btn-solid btn-lg" href="#signup" role="button">Start free</a>
            <a className="btn btn-ghost btn-lg" href="#signin" role="button">Sign in</a>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap foot-in">
          <div className="foot-brand">
            <FlagMark size={LOGO_SIZE.sm} />
            <BrandMark size={16} style={BRAND_TOKENS} />
          </div>
          <div className="foot-meta">
            <a href="/privacy">Privacy</a>
            <span className="cred">
              {/* Lowercase deliberately. Sentence case would be the safe call
                  and it is what convention asks for — but the line opens on
                  "an A", and two capital As back to back stutter. Setting the
                  article quiet lets the mark start the line. */}
              an{" "}
              {/* aria-hidden because the dotless letters below are a drawing,
                  not spelling. The real word follows for screen readers. */}
              <span className="ajai" aria-hidden="true">
                <span className="ajai-cap">A</span>
                <span className="ajai-stem is-j">{"ȷ"}</span>
                <span className="ajai-cap">A</span>
                <span className="ajai-stem is-i">{"ı"}</span>
              </span>
              <span className="sr-only">AjAi</span> <span className="ajai-labs">Labs</span> creation
            </span>
            <span>© {new Date().getFullYear()} TourneyHQ</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
