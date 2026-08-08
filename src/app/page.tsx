import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginPanel } from "@/components/LoginPanel";
import { Logo } from "@/components/Logo";
import { BrandMark } from "@/components/BrandMark";
import { GOLF_FORMATS, PLAYABLE_FORMAT_NAMES, TEAM_FORMAT_NAMES } from "@/lib/formats";
import { THEME_PRESETS } from "@/lib/themes";
import { courseHandicap, playingHandicapFrom } from "@/lib/domain/handicap";

/**
 * The front door.
 *
 * Everything countable here is read from the code that implements it — the
 * format list, the counts, the worked handicap. A landing page is the easiest
 * place in a product to make a promise nobody notices has gone stale, and
 * deriving the claims means the page cannot drift past what actually ships.
 *
 * The centrepiece is the format catalogue. That is the actual selling point:
 * a club adopts tournament software because the format its members voted for
 * is on the list and comes out scored correctly. Brackets, seasons and chained
 * rounds are all downstream of that, and each is a feature rather than the
 * pitch.
 */

const FORMAT_COUNT = PLAYABLE_FORMAT_NAMES.length;
const TEAM_COUNT = TEAM_FORMAT_NAMES.length;

/* The worked example, computed rather than written: a 12.4 index on a card
   rated 71.5 off 140 slope, playing four-ball at its 90% allowance. */
const EXAMPLE = (() => {
  const index = 12.4;
  const tee = { courseRating: 71.5, slopeRating: 140, par: 72 };
  const course = courseHandicap(index, tee);
  return { index, tee, course, playing: playingHandicapFrom(course, 90) };
})();

const HAIRLINE = "1px solid color-mix(in srgb, var(--color-text) 9%, transparent)";
const FAINT = "color-mix(in srgb, var(--color-text) 9%, transparent)";

const PROOF: Array<{ figure: string; label: string }> = [
  { figure: `${FORMAT_COUNT}`, label: "formats, each scored by its own rules" },
  { figure: "WHS", label: "course handicaps from slope and rating" },
  { figure: "0", label: "spreadsheets to reconcile afterwards" },
];

const CAPABILITIES: Array<{ icon: string; title: string; text: string }> = [
  {
    icon: "ph ph-list-checks",
    title: "Every format, one set of standings",
    text: `Singles and ${TEAM_COUNT} side formats, each with its own engine — a scramble is not stroke play with fewer cards, and skins is not a total. All of them resolve to one leaderboard.`,
  },
  {
    icon: "ph ph-target",
    title: "Handicaps done to the book",
    text: "Course handicap from the tee's slope and rating, then the format's published allowance. Unrated tees say so rather than quietly using the raw index.",
  },
  {
    icon: "ph ph-flag-checkered",
    title: "Rounds that follow on",
    text: "Cuts and carry-forward apply as each round closes. When two rounds don't measure the same thing — match points into a stroke round — it says so before the standings do.",
  },
  {
    icon: "ph ph-tree-structure",
    title: "Brackets, drawn your way",
    text: "One bracket, two flights, or a main draw with a plate for first-round losers. Seeded from live standings by reflection, byes handled, any field size.",
  },
  {
    icon: "ph ph-trophy",
    title: "Seasons and orders of merit",
    text: "Points across a season, best-of counting, a minimum-rounds threshold, and countback that settles ties on finishing positions rather than on who entered first.",
  },
  {
    icon: "ph ph-device-mobile",
    title: "Players score from the tee",
    text: "A round code puts a player on their card — no account, no app store, no install. Or keep the cards with your staff. Both are one setting.",
  },
  {
    icon: "ph ph-users-three",
    title: "A roster that outlives the event",
    text: "Members carry from one tournament to the next with their handicaps, so next year's entry list is a few taps rather than a re-import.",
  },
  {
    icon: "ph ph-broadcast",
    title: "A link for everyone else",
    text: "A public live leaderboard for the clubhouse screen and the players' families, without giving anyone a login.",
  },
];

const BUILT_FOR = [
  "Club championships",
  "Member-guest",
  "Member-member",
  "Society away days",
  "Corporate days",
  "Winter leagues",
  "Charity scrambles",
];

const STEPS: Array<{ n: string; title: string; text: string }> = [
  {
    n: "01",
    title: "Set up",
    text: "Field, flights, rounds and format. If this is last year's tournament again, copy it — configuration only, never the old results.",
  },
  {
    n: "02",
    title: "Play",
    text: "Scores from any phone at the tee, or entered by your staff. Standings update on every connected device as cards come in.",
  },
  {
    n: "03",
    title: "Results",
    text: "Brackets seeded, ties broken, payouts calculated. Export the lot, or publish a link.",
  },
];

export default async function LoginPage() {
  const session = await getSession();
  // Straight after sign-up there is no tournament yet, and the dashboard has
  // nothing to render without one — it would only bounce to /choose anyway.
  // Sending them there directly saves a redirect through a dead screen.
  if (session) redirect(session.eventId ? "/dashboard" : "/choose");

  return (
    <div
      className="login-grid"
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "1.3fr minmax(390px, 0.75fr)",
        background: "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      <div
        className="login-pitch"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 38,
          padding: "44px 56px 40px",
          position: "relative",
          isolation: "isolate",
        }}
      >
        <Backdrop />
        {/* Hidden on a phone, where the panel above already carries the mark
            and a second one just pushes the headline further down. */}
        <div className="pitch-brand">
          <Brand />
        </div>
        <Hero />

        <div style={{ maxWidth: 700 }}>
          <Section title="Where the numbers come from">
            <WorkedExample />
          </Section>

          <Section title="What it does">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: "22px 32px",
              }}
            >
              {CAPABILITIES.map((c) => (
                <div key={c.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  {/* The icon carries the accent; the box around it is gone.
                      Eight bordered cards made a grid of eight competing
                      objects where the text is the thing worth reading. */}
                  <i
                    className={c.icon}
                    style={{ fontSize: 16, color: "var(--color-accent-400)", marginTop: 2, flex: "none" }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.005em" }}>{c.title}</div>
                    <div className="text-muted" style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>
                      {c.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="How a tournament runs">
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
              {STEPS.map((s) => (
                <div key={s.n} style={{ flex: "1 1 175px", minWidth: 175 }}>
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: "var(--font-heading)",
                      color: "var(--color-accent-300)",
                      background: "color-mix(in srgb, var(--color-accent) 13%, transparent)",
                      boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 26%, transparent)",
                    }}
                  >
                    {s.n}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 9 }}>{s.title}</div>
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
                    {s.text}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Built for">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {BUILT_FOR.map((b) => (
                <span key={b} className="tag tag-neutral" style={{ fontSize: 11.5 }}>
                  {b}
                </span>
              ))}
            </div>
          </Section>
        </div>

        <Footer />
      </div>

      {/* The cell stretches the full height of the page; only the panel inside
          it sticks. Making the cell itself sticky left its background 100vh
          tall against a much taller page, so everything below the fold had a
          dead rectangle down one side. */}
      <div
        className="login-side"
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "40px",
          borderLeft: HAIRLINE,
          background: "color-mix(in srgb, var(--color-text) 2.5%, transparent)",
        }}
      >
        <div
          className="login-sticky"
          style={{
            // Sticky so signing in stays reachable however far down the pitch
            // someone reads. A page this long with its only action pinned to
            // the top is a page that asks people to scroll back.
            position: "sticky",
            top: 40,
            alignSelf: "flex-start",
            width: "100%",
            maxWidth: 380,
            display: "flex",
            flexDirection: "column",
            gap: 22,
          }}
        >
          {/* The pitch column moves below this on a phone, so the mark has to
              appear here too — otherwise a mobile visitor lands on a bare
              password box with nothing telling them whose it is. */}
          <div className="login-side-brand" style={{ display: "none" }}>
            <Brand compact />
          </div>
          <LoginPanel />
        </div>
      </div>
    </div>
  );
}

/**
 * Depth without decoration: one accent wash off the top-left and a dot grid
 * that fades out before it reaches the text.
 *
 * The previous version lit both diagonals with competing radial glows, which
 * left the middle of the page — where the words are — the dimmest part of it.
 * A single light source is what makes a surface read as a surface.
 */
function Backdrop() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: -1,
        pointerEvents: "none",
        backgroundImage: [
          "radial-gradient(880px 480px at 8% -8%, color-mix(in srgb, var(--color-accent) 13%, transparent), transparent 68%)",
          "radial-gradient(600px 400px at 96% 22%, color-mix(in srgb, var(--color-accent-2) 8%, transparent), transparent 70%)",
          `radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--color-text) 7%, transparent) 1px, transparent 0)`,
        ].join(", "),
        backgroundSize: "auto, auto, 22px 22px",
        maskImage: "radial-gradient(1000px 700px at 20% 0%, black, transparent 80%)",
        WebkitMaskImage: "radial-gradient(1000px 700px at 20% 0%, black, transparent 80%)",
      }}
    />
  );
}

function Hero() {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.11em",
          textTransform: "uppercase",
          fontWeight: 600,
          color: "var(--color-accent-400)",
        }}
      >
        For clubs, societies and member-guest organizers
      </div>

      <h1
        style={{
          fontSize: 46,
          lineHeight: 1.03,
          letterSpacing: "-0.034em",
          margin: "16px 0 0",
          maxWidth: "15ch",
        }}
      >
        {/* The reader is not a tournament director. They are a member who
            volunteered, and who is going to spend their own club championship
            in the pro shop typing cards in while everyone else plays. A
            feature-list headline ignores that; this one names the grievance
            and then the sub-line lists exactly what stops being their problem.
            Both halves are true: round codes let players enter their own
            scores, and standings, cuts, seeding and payouts all compute
            themselves. */}
        The hard part should be{" "}
        <span style={{ color: "var(--color-accent-300)" }}>the golf</span>.
      </h1>

      <p className="text-muted" style={{ fontSize: 16.5, maxWidth: "52ch", margin: "20px 0 0", lineHeight: 1.6 }}>
        Not the entry list, the handicap maths, the cut, the seeding or the payout. Those run
        themselves — correctly — while you play.
      </p>

      <div style={{ display: "flex", gap: 34, margin: "30px 0 0", flexWrap: "wrap" }}>
        {PROOF.map((p) => (
          <div key={p.label} style={{ minWidth: 130 }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: "-0.03em",
                color: "var(--color-accent-300)",
                lineHeight: 1,
              }}
            >
              {p.figure}
            </div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 6, maxWidth: "20ch", lineHeight: 1.4 }}>
              {p.label}
            </div>
          </div>
        ))}
      </div>

      <FormatMatrix />
    </div>
  );
}

/**
 * The catalogue itself, as the hero visual.
 *
 * This is the selling point. A club does not adopt tournament software because
 * it draws a nice bracket; it adopts it because the format the members voted
 * for last winter is on the list and comes out scored correctly. Every other
 * feature is downstream of that.
 *
 * Rendered from GOLF_FORMATS rather than a copy of it, so the page shows
 * exactly what the app can play — including each format's published handicap
 * allowance, which is the detail that separates "we support four-ball" from
 * "we support four-ball properly".
 */
function FormatMatrix() {
  const tiles = GOLF_FORMATS.filter((f) => f.playable).map((f) => ({
    name: f.name,
    side:
      f.sideSize === 1
        ? "Singles"
        : f.maxSideSize && f.maxSideSize !== f.sideSize
          ? `${f.sideSize}–${f.maxSideSize} a side`
          : `${f.sideSize} a side`,
    team: f.sideSize > 1,
    allowance: f.allowance,
    convention: f.allowanceIsConvention === true,
  }));

  return (
    <div
      style={{
        marginTop: 34,
        maxWidth: 640,
        borderRadius: 14,
        overflow: "hidden",
        background: "var(--color-surface)",
        boxShadow: [
          "0 0 0 1px color-mix(in srgb, var(--color-text) 11%, transparent)",
          "0 2px 6px -1px rgba(0,0,0,0.18)",
          "0 24px 60px -18px rgba(0,0,0,0.45)",
          // A hairline of accent along the top edge, as if lit from above.
          "inset 0 1px 0 0 color-mix(in srgb, var(--color-accent) 22%, transparent)",
        ].join(", "),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "11px 14px",
          borderBottom: `1px solid ${FAINT}`,
          background: "color-mix(in srgb, var(--color-text) 3%, transparent)",
        }}
      >
        <i className="ph ph-golf" style={{ fontSize: 15, color: "var(--color-accent-400)" }} />
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.005em" }}>
          Formats, with the allowance each one is played off
        </span>
        <span
          className="tag"
          style={{
            marginLeft: "auto",
            fontSize: 10,
            fontWeight: 700,
            background: "color-mix(in srgb, var(--color-accent) 15%, transparent)",
            color: "var(--color-accent-300)",
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 30%, transparent)",
          }}
        >
          {tiles.length} live
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
          // Hairlines drawn by each tile rather than by a 1px gap over a
          // coloured parent: the gap trick leaves the unfilled cells of the
          // last row showing the parent's colour, which reads as a grey block
          // hanging off the end of the grid. Overlapping outlines merge into
          // single lines and stop where the tiles do.
          gap: 0,
          background: "var(--color-surface)",
        }}
      >
        {tiles.map((t) => (
          <div
            key={t.name}
            style={{
              padding: "11px 13px",
              background: "var(--color-surface)",
              boxShadow: `inset -1px -1px 0 0 ${FAINT}`,
              display: "flex",
              flexDirection: "column",
              gap: 5,
              minHeight: 66,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.012em", lineHeight: 1.25 }}>
                {t.name}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "auto" }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                  padding: "1px 6px",
                  borderRadius: 999,
                  whiteSpace: "nowrap",
                  color: t.team ? "var(--color-accent-2-300)" : "color-mix(in srgb, var(--color-text) 60%, transparent)",
                  background: t.team
                    ? "color-mix(in srgb, var(--color-accent-2) 13%, transparent)"
                    : "color-mix(in srgb, var(--color-text) 7%, transparent)",
                }}
              >
                {t.side}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 600,
                  color: "var(--color-accent-300)",
                  marginLeft: "auto",
                }}
                // Marked where the percentage is club convention rather than a
                // published standard, because an organizer defending a result
                // needs to know which of the two they are quoting.
                title={t.convention ? "Common practice — not a published standard" : "Published allowance"}
              >
                {t.allowance}%{t.convention ? "*" : ""}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderTop: `1px solid ${FAINT}`,
          background: "color-mix(in srgb, var(--color-text) 3%, transparent)",
          fontSize: 11.5,
          color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
        }}
      >
        <i className="ph ph-seal-check" style={{ fontSize: 14, color: "var(--color-accent-2-400)" }} />
        Each has its own scoring engine, not one engine with a different label. * marks a club
        convention rather than a published allowance.
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 30, paddingTop: 26, borderTop: HAIRLINE, position: "relative" }}>
      {/* A short accent tick on the rule — a section marker rather than a
          full-width coloured line, which would cut the page into slabs. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: -1,
          left: 0,
          width: 26,
          height: 2,
          borderRadius: 2,
          background: "var(--color-accent)",
        }}
      />
      <div
        style={{
          fontSize: 10.5,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          fontWeight: 600,
          color: "color-mix(in srgb, var(--color-text) 46%, transparent)",
          marginBottom: 14,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * The handicap calculation, shown rather than claimed.
 *
 * This is the single most common thing to get wrong in golf software — using
 * the handicap index directly instead of converting it for the course — and
 * the difference is invisible until someone loses a match by a stroke. Showing
 * the working is the only way to make the claim checkable.
 */
function WorkedExample() {
  const { index, tee, course, playing } = EXAMPLE;
  const steps = [
    { label: "Handicap index", value: index.toFixed(1) },
    { label: "Slope · rating", value: `${tee.slopeRating} · ${tee.courseRating}` },
    { label: "Course handicap", value: `${course}`, strong: true },
    { label: "Four-ball allowance", value: "90%" },
    { label: "Strokes received", value: `${playing}`, strong: true },
  ];

  return (
    <div
      style={{
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: `inset 0 0 0 1px ${FAINT}`,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 1, background: FAINT }}>
        {steps.map((s, i) => (
          <div
            key={s.label}
            style={{
              flex: "1 1 118px",
              minWidth: 118,
              padding: "12px 14px",
              background: "var(--color-bg)",
              position: "relative",
            }}
          >
            <div
              className="text-muted"
              style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}
            >
              {s.label}
            </div>
            <div
              style={{
                fontSize: s.strong ? 21 : 15,
                fontWeight: s.strong ? 600 : 500,
                marginTop: 5,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.015em",
                fontFamily: s.strong ? "var(--font-heading)" : undefined,
                color: s.strong ? "var(--color-accent-300)" : "var(--color-text)",
              }}
            >
              {s.value}
            </div>
            {i < steps.length - 1 && (
              <i
                className="ph ph-caret-right"
                aria-hidden
                style={{
                  position: "absolute",
                  right: -6,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 11,
                  zIndex: 1,
                  color: "color-mix(in srgb, var(--color-text) 32%, transparent)",
                }}
              />
            )}
          </div>
        ))}
      </div>
      <div style={{ padding: "11px 14px", background: "var(--color-bg)", borderTop: `1px solid ${FAINT}` }}>
        <span className="text-muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
          Off that card a {index.toFixed(1)} index plays to {course}, not {Math.round(index)} — and{" "}
          {playing} in a four-ball. Most software stops at the index, and the difference only shows up
          when a match is decided by a stroke.
        </span>
      </div>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  const size = compact ? 40 : 46;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
      <div
        style={{
          width: size,
          height: size,
          display: "grid",
          placeItems: "center",
          borderRadius: 12,
          flex: "none",
          background: "color-mix(in srgb, var(--color-accent) 14%, transparent)",
          boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 38%, transparent)",
        }}
      >
        <Logo size={compact ? 23 : 27} style={{ color: "var(--color-accent)" }} />
      </div>
      <div>
        <BrandMark
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 700,
            fontSize: compact ? 24 : 27,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            display: "block",
          }}
        />
        <span
          className="text-muted"
          style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600 }}
        >
          From tee to trophy
        </span>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 20,
        paddingTop: 20,
        borderTop: HAIRLINE,
        flexWrap: "wrap",
      }}
    >
      <div className="text-muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <Logo size={13} style={{ color: "var(--color-accent)" }} />
        &copy; {new Date().getFullYear()} TourneyHQ
      </div>
      {/* Stated on the way in rather than discovered on the way out. A club
          that loses its member-guest results the morning after was not
          warned; this is where the warning belongs. */}
      <div className="text-muted" style={{ fontSize: 11.5, maxWidth: "52ch", textAlign: "right", lineHeight: 1.5 }}>
        Free tournaments are deleted 48 hours after you mark them complete — export first, or move to a
        paid plan to keep them. Your club&apos;s colours throughout, light or dark:{" "}
        {THEME_PRESETS.length} presets or your own.
      </div>
    </div>
  );
}
