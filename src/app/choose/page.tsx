import { requireSession } from "@/lib/page-helpers";
import { enterTournament, signOutAction } from "@/app/actions/auth";
import { prisma } from "@/lib/db";
import { Logo } from "@/components/Logo";
import { BrandMark } from "@/components/BrandMark";

const ROLE_LABEL: Record<string, string> = { admin: "Organizer", assistant: "Assistant", player: "Player" };

export default async function ChooseTournamentPage() {
  const session = await requireSession();
  const accounts = await prisma.account.findMany({
    where: { email: session.email },
    include: { event: { include: { _count: { select: { players: true } } } } },
    orderBy: { event: { createdAt: "desc" } },
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "64px 24px",
        background:
          "radial-gradient(1100px 650px at 85% -140px, var(--color-accent-900), transparent 62%), " +
          "radial-gradient(900px 500px at -10% 110%, var(--color-accent-2-900), transparent 55%), " +
          "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      <div style={{ width: "min(640px, 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                display: "grid",
                placeItems: "center",
                borderRadius: 11,
                background: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
              }}
            >
              <Logo size={22} style={{ color: "var(--color-accent)" }} />
            </div>
            <BrandMark style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 22, letterSpacing: "-0.01em" }} />
          </div>
          <form action={signOutAction}>
            <button type="submit" className="btn btn-secondary" style={{ fontSize: 12 }}>
              <i className="ph ph-sign-out" /> Sign out
            </button>
          </form>
        </div>

        <div className="page-kicker">Signed in as {session.name}</div>
        <h1 style={{ fontSize: 32, margin: "8px 0 4px" }}>Which tournament?</h1>
        <p className="text-muted" style={{ fontSize: 14, margin: "0 0 28px" }}>
          {accounts.length === 0
            ? "You don't have access to any tournament yet."
            : `You have access to ${accounts.length} tournament${accounts.length === 1 ? "" : "s"}.`}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {accounts.map((a) => (
            <form key={a.id} action={enterTournament.bind(null, a.eventId)}>
              <button
                type="submit"
                className="card elev-sm"
                style={{
                  width: "100%",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  cursor: "pointer",
                  border: "1px solid var(--color-divider)",
                }}
              >
                <div>
                  <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 17 }}>
                    {a.event.name || "Untitled tournament"}
                  </div>
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 3 }}>
                    {a.event.dates || "No dates set"}
                    {a.event.course ? ` · ${a.event.course}` : ""} · {a.event._count.players} players
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
                  <span className={`tag ${a.role === "admin" ? "tag-accent" : "tag-neutral"}`}>{ROLE_LABEL[a.role] ?? a.role}</span>
                  <i className="ph ph-arrow-right" style={{ color: "var(--color-accent-300)" }} />
                </div>
              </button>
            </form>
          ))}
        </div>
      </div>
    </div>
  );
}
