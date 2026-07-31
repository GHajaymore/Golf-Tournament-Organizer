import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { LoginPanel } from "@/components/LoginPanel";
import { Logo } from "@/components/Logo";

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
        gridTemplateColumns: "1fr 1fr",
        background:
          "radial-gradient(1000px 600px at 80% -120px, var(--color-accent-900), transparent 60%), var(--color-bg)",
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
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "var(--font-heading)",
            fontWeight: 500,
            fontSize: 19,
          }}
        >
          <Logo size={24} /> Flights
        </div>
        <div>
          <div className="page-kicker">Tournament Operations</div>
          <h1 style={{ fontSize: 44, lineHeight: 1.08, margin: "14px 0 0", maxWidth: "12ch" }}>
            Run the whole event from one console.
          </h1>
          <p className="text-muted" style={{ fontSize: 15, maxWidth: "44ch", marginTop: 16 }}>
            Round-robin groups, qualification, brackets, match-play scorecards and live
            standings — automated, with manual override wherever you need it.
          </p>
        </div>
        <div className="text-muted" style={{ fontSize: 12 }}>
          Pilot build · v1.0 · Ridgeline National
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 40,
          borderLeft: "1px solid var(--color-divider)",
        }}
      >
        <LoginPanel events={eventCards} />
      </div>
    </div>
  );
}
