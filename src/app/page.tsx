import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginPanel } from "@/components/LoginPanel";
import { Logo } from "@/components/Logo";
import { BrandMark } from "@/components/BrandMark";

const FEATURES: Array<{ icon: string; title: string; text: string; accent: "accent" | "accent-2" }> = [
  {
    icon: "ph ph-arrows-clockwise",
    title: "Every format, one leaderboard",
    text: "Match play, stroke play, Stableford, skins, Nassau, four-ball, foursomes and scrambles — each scored properly, all resolving to one set of standings.",
    accent: "accent",
  },
  {
    icon: "ph ph-flag-checkered",
    title: "Rounds that carry forward",
    text: "Cut lines and carry-forward points are applied automatically as each round closes, so the next round begins from the correct field and score.",
    accent: "accent-2",
  },
  {
    icon: "ph ph-tree-structure",
    title: "Automatic bracket seeding",
    text: "Qualifiers advance from live standings into winners and consolation brackets, seeded and updated without manual entry.",
    accent: "accent-2",
  },
  {
    icon: "ph ph-ranking",
    title: "Rules-based tiebreakers",
    text: "Ties are settled against the course's own stroke-index data using the tiebreaker sequence you configure.",
    accent: "accent",
  },
];

const STEPS: Array<{ n: string; title: string; text: string }> = [
  { n: "01", title: "Set up", text: "Define the field, flights, format and rounds. Everything stays editable until you lock the event." },
  { n: "02", title: "Play", text: "Enter scores from any phone at the tee. Updates appear immediately on every connected device." },
  { n: "03", title: "Results", text: "Standings, brackets and payouts are calculated as scores arrive — no manual reconciliation." },
];

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div
      className="login-grid"
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "1.15fr 1fr",
        background:
          "radial-gradient(1100px 650px at 85% -140px, var(--color-accent-900), transparent 62%), " +
          "radial-gradient(900px 500px at -10% 110%, var(--color-accent-2-900), transparent 55%), " +
          "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      <div
        className="login-pitch"
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "48px 56px",
          gap: 28,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              display: "grid",
              placeItems: "center",
              borderRadius: 13,
              background: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
              boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 45%, transparent)",
            }}
          >
            <Logo size={28} style={{ color: "var(--color-accent)" }} />
          </div>
          <div>
            <BrandMark
              style={{
                fontFamily: "var(--font-heading)",
                fontWeight: 700,
                fontSize: 30,
                letterSpacing: "-0.01em",
                lineHeight: 1,
                display: "block",
              }}
            />
            <span
              className="text-muted"
              style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 500 }}
            >
              From tee to trophy
            </span>
          </div>
        </div>

        <div>
          <span
            className="tag tag-outline"
            style={{ fontSize: 11, color: "var(--color-accent-200)", borderColor: "color-mix(in srgb, var(--color-accent) 40%, transparent)" }}
          >
            For club, member-guest &amp; member-member organizers
          </span>
          <h1 style={{ fontSize: 50, lineHeight: 1.04, margin: "18px 0 0", maxWidth: "14ch" }}>
            Tournament operations, start to finish.
          </h1>
          <p className="text-muted" style={{ fontSize: 16, maxWidth: "46ch", marginTop: 18 }}>
            Registration, flights, qualification, brackets, scoring and live standings — managed
            from one console, with full manual control at every stage.
          </p>

          <div className="flight-rule" style={{ maxWidth: 420 }} />

          <div
            className="text-muted"
            style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500, marginBottom: 10 }}
          >
            Capabilities
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 12,
              maxWidth: 540,
            }}
          >
            {FEATURES.map((f) => (
              <div
                key={f.title}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  padding: 12,
                  borderRadius: 12,
                  border: `1px solid color-mix(in srgb, var(--color-${f.accent}) 22%, var(--color-divider))`,
                  background: "color-mix(in srgb, var(--color-surface) 40%, transparent)",
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    flex: "none",
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 9,
                    background: `var(--color-${f.accent}-900)`,
                    color: `var(--color-${f.accent}-300)`,
                  }}
                >
                  <i className={f.icon} style={{ fontSize: 16 }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.title}</div>
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.45 }}>
                    {f.text}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 22, marginTop: 26, maxWidth: 540, flexWrap: "wrap" }}>
            {STEPS.map((s) => (
              <div key={s.n} style={{ flex: "1 1 140px", minWidth: 140 }}>
                <span
                  className="brand-mark"
                  style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 20, letterSpacing: "-0.02em" }}
                >
                  {s.n}
                </span>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{s.title}</div>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{s.text}</div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 18,
            borderTop: "1px solid var(--color-divider)",
          }}
        >
          <div className="text-muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <Logo size={13} style={{ color: "var(--color-accent)" }} />
            &copy; {new Date().getFullYear()} TourneyHQ
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            Built for the modern clubhouse
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 40,
          borderLeft: "1px solid var(--color-divider)",
          background: "color-mix(in srgb, var(--color-surface) 55%, transparent)",
        }}
      >
        <LoginPanel />
      </div>
    </div>
  );
}
