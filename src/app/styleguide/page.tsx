import { notFound } from "next/navigation";
import { themeCss, DEFAULT_CLUB_THEME, THEME_PRESETS, type Appearance, type ClubTheme } from "@/lib/themes";
import { NAV } from "@/lib/nav";
import { ScoreImport } from "@/components/ScoreImport";
import FieldInfo from "@/components/FieldInfo";
import { NOINDEX } from "@/lib/site";

// 404s in production already, so this is belt to that brace — and it keeps the
// rule "every route that is not marketing says noindex" true without an
// exemption, which is one fewer thing for the guard to have to know about.
export const metadata = { title: "Style guide", robots: NOINDEX };

/**
 * Every component class, on both grounds, side by side.
 *
 * Development only — see the guard below.
 *
 * This exists because the console is behind a login and the design system
 * underneath it is not. Without it, the only way to look at a button, a table
 * row or a light-mode surface is to sign in as a real organizer, which makes
 * "did that change look right?" an expensive question and so an unasked one.
 *
 * It is not decoration. On its first run it caught three regressions that the
 * whole test suite had missed: the fairway green had drifted from forest to
 * mint, the primary button's label measured 3.87:1 in light mode, and steps
 * 400 and 500 had collapsed onto the same colour so hover states were
 * invisible. All three were mine, and all three were obvious the moment
 * anything rendered.
 *
 * It renders the real classes from design-system.css and globals.css, themed with
 * the real `themeCss()` output, so it cannot quietly become a picture of
 * something the app doesn't look like.
 */

export const dynamic = "force-static";

/** Nine holes of a real-shaped card, with a spread of scores so every mark
 *  (eagle, birdie, par, bogey, double) is visible at once. */
const CARD = [
  { n: 1, par: 4, yards: 412, si: 7, score: 4, won: "A" },
  { n: 2, par: 5, yards: 528, si: 3, score: 3, won: "H" },
  { n: 3, par: 3, yards: 168, si: 11, score: 2, won: "B" },
  { n: 4, par: 4, yards: 445, si: 1, score: 5, won: "A" },
  { n: 5, par: 4, yards: 389, si: 15, score: 6, won: "H" },
  { n: 6, par: 4, yards: 401, si: 5, score: 4, won: "B" },
  { n: 7, par: 3, yards: 205, si: 17, score: 3, won: "A" },
  { n: 8, par: 4, yards: 378, si: 9, score: 5, won: "H" },
  { n: 9, par: 5, yards: 511, si: 13, score: 5, won: "A" },
] as const;

/** Same rule the entry screens use: under par ringed, over par boxed. */
function markFor(score: number, par: number): string {
  const d = score - par;
  return d <= -2 ? " is-eagle" : d === -1 ? " is-under" : d === 1 ? " is-over" : d >= 2 ? " is-double" : "";
}

const MATCHES = [
  { a: "Aj Moore", b: "Rob Ferris", flight: "Flight 1", on: true, tag: "2 up", tagClass: "tag-accent" },
  { a: "M. Ndlovu", b: "S. Kaur", flight: "Flight 1", on: false, tag: "AS", tagClass: "tag-neutral" },
  { a: "T. Alvarez", b: "J. Whitfield", flight: "Flight 2", on: false, tag: "Final", tagClass: "tag-neutral" },
];

const SAMPLE = [
  { pos: 1, name: "A. Moore", hcp: 8, thru: "F", gross: 74, net: 66, tag: "Advancing" },
  { pos: 2, name: "Rob Ferris", hcp: 14, thru: "F", gross: 81, net: 67, tag: "Advancing" },
  { pos: 3, name: "M. Ndlovu", hcp: 3, thru: "17", gross: 71, net: 68, tag: "" },
  { pos: 4, name: "S. Kaur", hcp: 19, thru: "16", gross: 88, net: 69, tag: "" },
];

export default function StyleguidePage() {
  // Never reachable in production. A styleguide is an internal tool; shipping
  // it would put an unauthenticated page on the public site whose whole job is
  // to enumerate the interface.
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: [
            themeCss({ ...DEFAULT_CLUB_THEME, appearance: "dark" }, "#ground-dark"),
            themeCss({ ...DEFAULT_CLUB_THEME, appearance: "light" }, "#ground-light"),
            "body{margin:0}",
          ].join("\n"),
        }}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: "100vh" }}>
        <Ground id="ground-dark" appearance="dark" />
        <Ground id="ground-light" appearance="light" />
      </div>
      <SwatchWall />
    </>
  );
}

function Ground({ id, appearance }: { id: string; appearance: Appearance }) {
  return (
    <div
      id={id}
      data-appearance={appearance}
      style={{
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        minWidth: 0,
      }}
    >
      <div>
        <div className="page-kicker">{appearance} ground</div>
        <h1 className="page-title" style={{ margin: "2px 0 0" }}>Spring Medal</h1>
        <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
          Real classes from design-system.css and globals.css, themed by the same themeCss() the app
          renders with.
        </p>
      </div>

      <Section title="Type scale">
        <h1 style={{ margin: 0 }}>Heading 1 &mdash; 28px</h1>
        <h2 style={{ margin: 0 }}>Heading 2 &mdash; 22px</h2>
        <h3 style={{ margin: 0 }}>Heading 3 &mdash; 18px</h3>
        <h4 style={{ margin: 0 }}>Heading 4 &mdash; 16px</h4>
        <p style={{ margin: 0, fontSize: 14 }}>
          Body copy at 14px. The quick brown fox jumped over the lazy dog, then three-putted from
          eight feet.
        </p>
        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
          Muted secondary copy, mixed from the text colour so it inverts with the ground.
        </p>
      </Section>

      <Section title="Buttons">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn btn-primary">Enter scores</button>
          <button type="button" className="btn btn-secondary">Publish</button>
          <button type="button" className="btn btn-ghost">Cancel</button>
          <button type="button" className="btn btn-icon"><i className="ph ph-trash" /></button>
          <button type="button" className="btn btn-primary" disabled>Disabled</button>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="field">
          <label>Tournament name</label>
          <input className="input" defaultValue="Spring Medal" />
        </div>
        <div className="field">
          <label>Format</label>
          <select className="input" defaultValue="Four-Ball">
            <option>Match Play</option>
            <option>Four-Ball</option>
            <option>Scramble</option>
          </select>
        </div>
        <div className="field">
          <label>Notes</label>
          <input className="input" placeholder="Placeholder text" />
        </div>
        <div className="seg">
          <label className="seg-opt"><input type="radio" name={`h-${id}`} defaultChecked />18 holes</label>
          <label className="seg-opt"><input type="radio" name={`h-${id}`} />9 holes</label>
        </div>
        <label className="radio">
          <input type="radio" name={`r-${id}`} defaultChecked />
          <span className="dot" />
          Net scoring
        </label>
      </Section>

      <Section title="Field info">
        {/* The explanation control, on both grounds. It lives here as well as
            on the setup screens because the screens that use it sit behind a
            login and inside a collapsed panel, which made "does the popover
            actually open?" a question nobody could answer without seeding a
            tournament first. Here it is one click. */}
        <div className="field">
          <label>
            Handicap allowance
            <FieldInfo label="the handicap allowance">
              <p>
                The share of a player&rsquo;s course handicap that counts in this format.
                Four-ball is 90%, foursomes 50% of the combined.
              </p>
              <p>A committee may set its own; these are recommendations, not rules.</p>
            </FieldInfo>
          </label>
          <input className="input" defaultValue="90" style={{ maxWidth: 120 }} />
        </div>
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          Opens on tap, not hover — the app is used one-handed on a phone. Escape or a
          tap outside closes it.
        </p>
      </Section>

      <Section title="Tags">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="tag tag-accent">Live</span>
          <span className="tag tag-accent-2">Advancing</span>
          <span className="tag tag-neutral">Upcoming</span>
          <span className="tag tag-outline">Managing</span>
        </div>
      </Section>

      <Section title="Leaderboard table">
        <table className="table">
          <thead>
            <tr>
              <th>Pos</th><th>Player</th><th style={{ textAlign: "right" }}>Hcp</th>
              <th style={{ textAlign: "right" }}>Thru</th><th style={{ textAlign: "right" }}>Gross</th>
              <th style={{ textAlign: "right" }}>Net</th><th />
            </tr>
          </thead>
          <tbody>
            {SAMPLE.map((r) => (
              <tr key={r.pos}>
                <td style={{ color: "var(--color-accent-300)", fontWeight: 600 }}>{r.pos}</td>
                <td>{r.name}</td>
                <td style={{ textAlign: "right" }}>{r.hcp}</td>
                <td style={{ textAlign: "right" }}>{r.thru}</td>
                <td style={{ textAlign: "right" }}>{r.gross}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{r.net}</td>
                <td>{r.tag && <span className="tag tag-accent-2">{r.tag}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Cards and elevation">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="card elev-sm">
            <span className="card-kicker">Round 2</span>
            <span className="card-title">Four-Ball</span>
            <p className="card-body">Sides of two, 90% allowance.</p>
            <div className="card-meta"><i className="ph ph-users-three" /> 16 sides</div>
          </div>
          <div className="card elev-md">
            <span className="card-kicker">Elevated</span>
            <span className="card-title">elev-md</span>
            <p className="card-body">Hairline plus ambient shadow.</p>
          </div>
        </div>
      </Section>

      <Section title="Sidebar links">
        <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 8 }}>
          {NAV[0].items.map((item, i) => (
            <a key={item.key} className="side-link" href="#" aria-current={i === 0 ? "page" : undefined}>
              <i className={item.icon} />
              {item.label}
            </a>
          ))}
        </div>
      </Section>

      <Section title="Error state">
        <p
          style={{
            fontSize: 12.5, margin: 0, padding: "9px 11px", borderRadius: 9,
            color: "var(--color-danger)", background: "var(--color-danger-bg)",
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-danger) 32%, transparent)",
          }}
        >
          <i className="ph ph-warning-circle" /> That reset link has expired — request a new one.
        </p>
      </Section>

      {/* Score entry is the screen this styleguide exists for. It sits behind
          a login *and* behind a course card, so "does that look right?" was
          effectively unanswerable — which is exactly how a restyle shipped
          that missed three of its four surfaces. */}
      <Section title="Scorecard — the shared table">
        <div className="sc-wrap">
          <table className="sc" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>Hole</th>
                {CARD.map((h) => (<th key={h.n}>{h.n}</th>))}
                <th className="sc-tot">Out</th>
              </tr>
            </thead>
            <tbody>
              <tr className="sc-ref">
                <td>Yards</td>
                {CARD.map((h) => (<td key={h.n}>{h.yards}</td>))}
                <td className="sc-tot">3437</td>
              </tr>
              <tr className="sc-ref sc-par">
                <td>Par</td>
                {CARD.map((h) => (<td key={h.n}>{h.par}</td>))}
                <td className="sc-tot">36</td>
              </tr>
              <tr className="sc-ref">
                <td>S.I.</td>
                {CARD.map((h) => (<td key={h.n}>{h.si}</td>))}
                <td className="sc-tot" />
              </tr>
              <tr>
                <td>Score</td>
                {CARD.map((h) => (
                  <td key={h.n} style={{ padding: 2 }}>
                    <input className={`input sc-score${markFor(h.score, h.par)}`} defaultValue={h.score} readOnly />
                  </td>
                ))}
                <td className="sc-tot">37</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-muted" style={{ fontSize: 11.5, margin: 0 }}>
          Under par ringed, over par boxed — eagle and double get a second ring. Row labels stay pinned when
          the back nine scrolls in.
        </p>
      </Section>

      <Section title="Scorecard — match hole picker">
        <div className="sc-wrap">
          <table className="sc" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>Hole</th>
                {CARD.map((h) => (<th key={h.n}>{h.n}</th>))}
                <th className="sc-tot">Out</th>
              </tr>
            </thead>
            <tbody>
              <tr className="sc-ref sc-par">
                <td>Par</td>
                {CARD.map((h) => (<td key={h.n}>{h.par}</td>))}
                <td className="sc-tot">36</td>
              </tr>
              <tr>
                <td>Result</td>
                {CARD.map((h) => (
                  <td key={h.n} style={{ padding: 2 }}>
                    <div className="sc-pick">
                      <button type="button" className="is-a" aria-pressed={h.won === "A"}>A</button>
                      <button type="button" className="is-h" aria-pressed={h.won === "H"}>½</button>
                      <button type="button" className="is-b" aria-pressed={h.won === "B"}>B</button>
                    </div>
                  </td>
                ))}
                <td className="sc-tot" />
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Entry modes">
        <div className="mode-pick">
          <button type="button" className="mode-opt" aria-pressed>
            <span className="mode-opt-head"><i className="ph ph-flag" /> Hole-by-hole result</span>
            <span className="mode-opt-blurb">Who won each hole. What a player actually tracks while playing match play.</span>
          </button>
          <button type="button" className="mode-opt">
            <span className="mode-opt-head"><i className="ph ph-cards" /> Full scorecard</span>
            <span className="mode-opt-blurb">Both players&rsquo; strokes on every hole. The only one that survives a change from gross to net.</span>
          </button>
          <button type="button" className="mode-opt" disabled>
            <span className="mode-opt-head"><i className="ph ph-check-circle" /> Final result only</span>
            <span className="mode-opt-blurb">Just the margin — &ldquo;3&amp;2&rdquo;.</span>
            <span className="mode-opt-why">Set the course for this match first — strokes need its par and stroke index.</span>
          </button>
        </div>
      </Section>

      {/* The importer, with its column spec. Lives inside /entry behind the
          login, so this is the only place it can be looked at without a
          tournament, a course card and a signed-in organizer. */}
      <Section title="Bulk import — file spec">
        <ScoreImport
          stageId="styleguide"
          format="Match Play"
          holes={18}
          field={[
            { id: "p1", name: "Aj Moore" },
            { id: "p2", name: "Rob Ferris" },
          ]}
        />
      </Section>

      <Section title="Match list">
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 320 }}>
          {MATCHES.map((m) => (
            <button key={m.a} type="button" className="match-row" aria-current={m.on}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="match-row-name">{m.a} v {m.b}</span>
                <span className="match-row-meta">{m.flight} · Round 2</span>
              </span>
              <span className={`tag ${m.tagClass}`}>{m.tag}</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

/**
 * Every preset's full ramp on both grounds.
 *
 * The place a collapsed step or a doubled-back ramp is visible at a glance —
 * which is exactly the failure that shipped, twice, past a green test suite.
 */
function SwatchWall() {
  const steps = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  return (
    <div style={{ padding: 24, background: "#0d0e10", color: "#e9e9ed", fontFamily: "system-ui" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.55, marginBottom: 14 }}>
        Every preset, both grounds — each row must run light to dark without repeating a shade
      </div>
      {THEME_PRESETS.map((p) => (
        <div key={p.key} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, marginBottom: 5, opacity: 0.8 }}>{p.name}</div>
          {(["dark", "light"] as const).map((appearance) => {
            const theme: ClubTheme = { ...DEFAULT_CLUB_THEME, accentKey: p.key, appearance };
            const id = `sw-${p.key}-${appearance}`;
            return (
              <div key={appearance} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <style dangerouslySetInnerHTML={{ __html: themeCss(theme, `#${id}`) }} />
                <span style={{ fontSize: 10, width: 40, opacity: 0.5 }}>{appearance}</span>
                <div id={id} style={{ display: "flex", flex: 1 }}>
                  {steps.map((s) => (
                    <div
                      key={s}
                      title={`${p.key} ${appearance} ${s}`}
                      style={{
                        flex: 1, height: 26, background: `var(--color-accent-${s})`,
                        display: "grid", placeItems: "center", fontSize: 9,
                        color: s >= 600 ? "#fff" : "#000",
                      }}
                    >
                      {s}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="card elev-sm"
      style={{ gap: 10, background: "color-mix(in srgb, var(--color-text) 3%, transparent)" }}
    >
      <span className="card-kicker">{title}</span>
      {children}
    </div>
  );
}
