import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { LoginPanel } from "@/components/LoginPanel";
import { Logo } from "@/components/Logo";

const FEATURES: Array<{ icon: string; title: string; text: string }> = [
  {
    icon: "ph ph-arrows-clockwise",
    title: "Match play & stroke play",
    text: "Round-robin flights, gross/net/both scoring, and a real Stableford option — all in one console.",
  },
  {
    icon: "ph ph-flag-checkered",
    title: "Multi-round cuts",
    text: "Sequence any number of rounds, cut the field by a real count or percent, and carry points forward.",
  },
  {
    icon: "ph ph-tree-structure",
    title: "Automatic brackets",
    text: "Qualifiers seed straight into winners & consolation brackets — no re-entry, no spreadsheets.",
  },
  {
    icon: "ph ph-ranking",
    title: "Live leaderboards",
    text: "Standings, tiebreakers down to the toughest holes, and highlights update the moment a score lands.",
  },
];

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const events = await prisma.event.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      accounts: { orderBy: { name: "asc" } },
      _count: { select: { players: true } },
    },
  });

  const eventCards = events.map((e) => ({
    id: e.id,
    name: e.name,
    meta: `${e.dates} · ${e.course}, ${e.city} · ${e._count.players} players`,
    status: e._count.players >= e.capacity ? "Full" : "Open",
    tagClass: e._count.players >= e.capacity ? "tag-neutral" : "tag-accent",
    accounts: e.accounts.map((a) => ({ id: a.id, name: a.name, role: a.role })),
  }));

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
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              display: "grid",
              placeItems: "center",
              borderRadius: 12,
              background: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
              boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 45%, transparent)",
            }}
          >
            <Logo size={26} style={{ color: "var(--color-accent)" }} />
          </div>
          <span
            className="brand-mark"
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 700,
              fontSize: 28,
              letterSpacing: "-0.01em",
            }}
          >
            Flights
          </span>
        </div>

        <div>
          <div className="page-kicker">Tournament Operations</div>
          <h1 style={{ fontSize: 50, lineHeight: 1.04, margin: "16px 0 0", maxWidth: "13ch" }}>
            Run the whole event from one console.
          </h1>
          <p className="text-muted" style={{ fontSize: 16, maxWidth: "46ch", marginTop: 18 }}>
            Round-robin flights, qualification cuts, brackets, match-play scorecards and live
            standings — automated end to end, with a manual override wherever you need one.
          </p>

          <div className="flight-rule" style={{ maxWidth: 420 }} />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 16,
              maxWidth: 520,
            }}
          >
            {FEATURES.map((f) => (
              <div key={f.title} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    flex: "none",
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 9,
                    background: "var(--color-accent-900)",
                    color: "var(--color-accent-300)",
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
        </div>

        <div className="text-muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span className="tag tag-outline" style={{ fontSize: 10 }}>Flights</span>
          Tournament operations console
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
        <LoginPanel events={eventCards} />
      </div>
    </div>
  );
}
