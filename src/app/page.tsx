import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { courseHandicap, playingHandicapFrom } from "@/lib/domain/handicap";
import { LandingAuth } from "@/components/LandingAuth";
import { LandingEffects } from "@/components/LandingEffects";

/**
 * The front door.
 *
 * A faithful port of the approved "championship programme on fairway green"
 * landing design. Everything visual is scoped under the `.thq` wrapper and its
 * own `--flag/--ground/--paper` palette, defined in the page-local stylesheet
 * below — deliberately NOT the app's `--color-*` tokens, so this identity never
 * leaks into the authenticated console chrome and the console theme never
 * bleeds in here.
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

/* The design's stylesheet, scoped under `.thq`. Animation baselines live behind
   `.thq-js` (added by LandingEffects on mount) so content is fully visible with
   JavaScript disabled rather than stuck at opacity 0. */
const LANDING_CSS = `
.thq, .thq * { box-sizing: border-box; }
.thq {
  --ground:#0E231A; --ground-2:#123026; --panel:#14342785;
  --paper:#F1EDE1; --paper-2:#E9E4D4; --paper-ink:#1B2A22; --paper-soft:#5A6B5E;
  --ink:#EFEEE4; --ink-soft:#A6B8AC; --ink-faint:#6E8378;
  --line:rgba(239,238,228,0.12); --line-2:rgba(239,238,228,0.22);
  --flag:#F2862E; --flag-soft:#F6A468; --under:#E36B5C; --brass:#C7A45E;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
  --sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
  --mono:"SFMono-Regular","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;
  font-family:var(--sans); background:var(--ground); color:var(--ink);
  line-height:1.6; -webkit-font-smoothing:antialiased;
}
@media (prefers-color-scheme: light) {
  .thq {
    --ground:#F1EDE1; --ground-2:#E9E4D4; --panel:#FBF9F1;
    --ink:#182A20; --ink-soft:#4E5E52; --ink-faint:#86928A;
    --line:rgba(20,35,25,0.12); --line-2:rgba(20,35,25,0.22);
    --flag:#C56A10; --flag-soft:#B85F0C; --under:#C0453B; --brass:#997633;
    --paper:#10251B; --paper-2:#0C1F16; --paper-ink:#EDEBE0; --paper-soft:#9FB1A5;
  }
}
.thq :focus-visible { outline:2px solid var(--flag); outline-offset:3px; border-radius:4px; }
.thq .wrap { width:min(1140px,92vw); margin:0 auto; }
.thq a { color:inherit; }

.thq .nav { position:sticky; top:0; z-index:20; background:color-mix(in srgb, var(--ground) 84%, transparent); backdrop-filter:blur(14px); border-bottom:1px solid var(--line); transition:box-shadow .25s ease, background .25s ease; }
.thq .nav.scrolled { background:color-mix(in srgb, var(--ground) 94%, transparent); box-shadow:0 10px 34px -24px rgba(0,0,0,0.6); }
.thq .nav-in { display:flex; align-items:center; justify-content:space-between; height:64px; }
.thq .brand { display:flex; align-items:center; gap:11px; font-family:var(--serif); font-size:20px; font-weight:600; letter-spacing:-0.01em; }
.thq .brand .hq { color:var(--flag); font-style:italic; }
.thq .nav-actions { display:flex; align-items:center; gap:10px; }
.thq .btn { font-family:var(--sans); font-size:13.5px; font-weight:560; cursor:pointer; border-radius:8px; padding:9px 16px; border:1px solid transparent; text-decoration:none; display:inline-flex; align-items:center; gap:8px; transition:transform .16s ease, background .16s ease, border-color .16s ease, color .16s ease; letter-spacing:-0.005em; }
.thq .btn-ghost { color:var(--ink-soft); border-color:var(--line-2); }
.thq .btn-ghost:hover { color:var(--ink); border-color:var(--ink-faint); }
.thq .btn-solid { background:var(--flag); color:#17130C; font-weight:640; }
@media (prefers-color-scheme: light) { .thq .btn-solid { color:#FFF7EE; } }
.thq .btn-solid:hover { transform:translateY(-1px); background:var(--flag-soft); }
.thq .btn-lg { padding:13px 22px; font-size:15px; }
.thq .btn-solid.btn-lg::after { content:"\\2192"; font-size:14px; transition:transform .2s cubic-bezier(.2,.7,.2,1); }
.thq .btn-solid.btn-lg:hover::after { transform:translateX(3px); }

.thq .hero { position:relative; overflow:hidden; border-bottom:1px solid var(--line); }
.thq .hero::before { content:""; position:absolute; inset:-40% -20% auto 40%; height:720px; z-index:0; background:radial-gradient(50% 60% at 70% 10%, color-mix(in srgb, var(--flag) 14%, transparent), transparent 70%); pointer-events:none; }
.thq .hero::after { content:""; position:absolute; inset:0; z-index:0; pointer-events:none; background:repeating-linear-gradient(90deg, transparent 0 72px, color-mix(in srgb, var(--ink) 3%, transparent) 72px 144px); -webkit-mask-image:linear-gradient(180deg, #000, transparent 78%); mask-image:linear-gradient(180deg, #000, transparent 78%); }
.thq .hero-in { position:relative; z-index:1; display:grid; grid-template-columns:1.02fr 0.98fr; gap:56px; align-items:center; padding:96px 0 88px; }
.thq .eyebrow { display:inline-flex; align-items:center; gap:10px; font-size:11.5px; text-transform:uppercase; letter-spacing:0.18em; font-weight:650; color:var(--brass); }
.thq .eyebrow::before { content:""; width:22px; height:1px; background:var(--brass); }
.thq h1 { font-family:var(--serif); font-weight:600; font-size:clamp(2.6rem, 5.4vw, 4.3rem); line-height:1.03; letter-spacing:-0.02em; margin:22px 0 0; text-wrap:balance; }
.thq h1 em { font-style:italic; color:var(--flag); }
.thq .lede { font-size:clamp(1.02rem, 1.4vw, 1.16rem); color:var(--ink-soft); margin:24px 0 0; max-width:40ch; line-height:1.6; }
.thq .cta-row { display:flex; gap:12px; margin-top:32px; flex-wrap:wrap; }
.thq .proof { display:flex; gap:8px 22px; margin-top:34px; flex-wrap:wrap; font-size:12.5px; color:var(--ink-soft); }
.thq .proof span { display:inline-flex; align-items:center; gap:8px; }
.thq .proof i { width:5px; height:5px; border-radius:50%; background:var(--brass); }

.thq .board { background:var(--panel); border:1px solid var(--line-2); border-radius:16px; overflow:hidden; box-shadow:0 30px 70px -34px rgba(0,0,0,0.6); }
.thq .board-top { display:flex; align-items:center; justify-content:space-between; padding:15px 18px; border-bottom:1px solid var(--line); }
.thq .board-top .t { font-family:var(--serif); font-size:15px; font-weight:600; }
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
.thq .band .sec-kick { color:var(--brass); }
.thq .band .sec-h { color:var(--paper-ink); }
.thq .band .sec-sub { color:var(--paper-soft); }
.thq .cardgrid { display:grid; grid-template-columns:1.05fr 0.95fr; gap:40px; align-items:center; margin-top:44px; }
.thq .scard { background:var(--paper-2); border:1px solid color-mix(in srgb, var(--paper-ink) 12%, transparent); border-radius:14px; padding:6px; }
.thq .scard-in { border:1px dashed color-mix(in srgb, var(--paper-ink) 22%, transparent); border-radius:10px; padding:18px 20px; }
.thq .band h3.big { font-family:var(--serif); font-size:clamp(1.5rem, 2.6vw, 2rem); font-weight:600; letter-spacing:-0.02em; margin:0; color:var(--paper-ink); text-wrap:balance; }
.thq .band .body { color:var(--paper-soft); margin:16px 0 0; font-size:14.5px; line-height:1.6; }
.thq .band .body b { color:var(--paper-ink); font-weight:600; }

.thq section { padding:100px 0; }
.thq .sec-kick { font-size:11.5px; text-transform:uppercase; letter-spacing:0.16em; font-weight:650; color:var(--brass); }
.thq .sec-h { font-family:var(--serif); font-size:clamp(1.7rem, 3vw, 2.4rem); font-weight:600; letter-spacing:-0.02em; margin:12px 0 0; text-wrap:balance; }
.thq .sec-sub { color:var(--ink-soft); margin:14px 0 0; max-width:54ch; line-height:1.6; }

.thq .features { display:grid; grid-template-columns:repeat(3, 1fr); gap:1px; margin-top:50px; background:var(--line); border:1px solid var(--line); border-radius:16px; overflow:hidden; }
.thq .feat { background:var(--ground); padding:30px 28px; display:flex; flex-direction:column; gap:13px; min-height:190px; transition:background .18s ease; }
.thq .feat:hover { background:var(--ground-2); }
.thq .feat .ic { width:28px; height:28px; color:var(--brass); }
.thq .feat h4 { font-family:var(--serif); font-size:17px; font-weight:600; letter-spacing:-0.01em; margin:0; }
.thq .feat p { font-size:13.5px; color:var(--ink-soft); margin:0; line-height:1.56; }

.thq .steps { display:grid; grid-template-columns:repeat(3,1fr); gap:40px; margin-top:50px; }
.thq .step { padding-top:22px; border-top:1px solid var(--line-2); }
.thq .step .n { font-family:var(--mono); font-size:11.5px; color:var(--flag); letter-spacing:0.08em; }
.thq .step h4 { font-family:var(--serif); font-size:19px; font-weight:600; margin:12px 0 8px; letter-spacing:-0.01em; }
.thq .step p { font-size:13.5px; color:var(--ink-soft); margin:0; line-height:1.56; }

.thq .chips { display:flex; flex-wrap:wrap; gap:10px; margin-top:36px; }
.thq .chip { font-size:13px; color:var(--ink-soft); border:1px solid var(--line-2); border-radius:999px; padding:8px 16px; transition:border-color .16s ease, color .16s ease; }
.thq .chip:hover { border-color:var(--brass); color:var(--ink); }
.thq .chip b { color:var(--ink); font-weight:580; }

.thq .faq { margin-top:44px; border-top:1px solid var(--line); }
.thq .faq details { border-bottom:1px solid var(--line); }
.thq .faq summary { list-style:none; cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:24px; padding:24px 4px; font-family:var(--serif); font-size:clamp(1rem, 1.6vw, 1.18rem); font-weight:600; letter-spacing:-0.012em; color:var(--ink); transition:color .16s ease; }
.thq .faq summary:hover { color:var(--flag-soft); }
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
.thq .close h2 { font-family:var(--serif); position:relative; font-size:clamp(2rem, 4vw, 3rem); font-weight:600; letter-spacing:-0.025em; margin:0; text-wrap:balance; }
.thq .close p { position:relative; color:var(--ink-soft); margin:18px auto 32px; max-width:46ch; }

.thq footer { border-top:1px solid var(--line); padding:34px 0 44px; }
.thq .foot-in { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; }
.thq .foot-brand { font-family:var(--serif); font-size:17px; font-weight:600; display:flex; align-items:center; gap:10px; }
.thq .foot-brand .hq { color:var(--flag); font-style:italic; }
.thq .foot-meta { font-size:12.5px; color:var(--ink-faint); display:flex; gap:18px; flex-wrap:wrap; }
.thq .foot-meta .cred { color:var(--ink-soft); }

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
  .thq section { padding:72px 0; }
}
`;

/** Reused wordmark; `aria-hidden` because the "TourneyHQ" text sits beside it. */
function FlagMark({ size = 23 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M20 4 V18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M20 4.5 L27.5 7.5 L20 10.5 Z" fill="var(--flag)" />
      <ellipse cx="16" cy="22.5" rx="8" ry="3.2" fill="none" stroke="var(--line-2)" strokeWidth="1.1" />
      <circle cx="12" cy="20" r="3.1" fill="currentColor" />
    </svg>
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
  if (session) redirect(session.eventId ? "/dashboard" : "/choose");

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
            <FlagMark size={23} />
            Tourney<span className="hq">HQ</span>
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
            <div className="eyebrow rise">For clubs, societies, corporate &amp; charity events</div>
            <h1 className="rise">Signed. Attested.<br /><em>Settled.</em></h1>
            <p className="lede rise">From the first tee to the trophy, TourneyHQ scores every format to the book, carries the cut round to round, and puts a live leaderboard on every phone at the tee.</p>
            <div className="cta-row rise">
              <a className="btn btn-solid btn-lg" href="#signup" role="button">Set up your first event</a>
              <a className="btn btn-ghost btn-lg" href="#board" role="button">See a live leaderboard</a>
            </div>
            <div className="proof rise">
              <span><i></i>Every recognised format</span>
              <span><i></i>WHS course handicaps</span>
              <span><i></i>No spreadsheets</span>
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
                <tr className="lead"><td className="pos">1</td><td className="name">J. Carter</td><td className="num">F</td><td className="par under">&minus;6</td><td className="num">138</td></tr>
                <tr><td className="pos">2</td><td className="name">M. Ellis</td><td className="num">F</td><td className="par under">&minus;4</td><td className="num">140</td></tr>
                <tr><td className="pos">T3</td><td className="name">T. Brooks</td><td className="num">F</td><td className="par under">&minus;2</td><td className="num">142</td></tr>
                <tr><td className="pos">T3</td><td className="name">D. Warren</td><td className="num">F</td><td className="par under">&minus;2</td><td className="num">142</td></tr>
                <tr><td className="pos">5</td><td className="name">A. Reid</td><td className="num">F</td><td className="par even">E</td><td className="num">144</td></tr>
                <tr><td className="pos">6</td><td className="name">S. Hayes</td><td className="num">F</td><td className="par even">+2</td><td className="num">146</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </header>

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
            <FlagMark size={19} />
            Tourney<span className="hq">HQ</span>
          </div>
          <div className="foot-meta">
            <a href="/privacy">Privacy</a>
            <span className="cred">An AJAI Labs creation</span>
            <span>© {new Date().getFullYear()} TourneyHQ</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
