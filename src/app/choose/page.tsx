import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-helpers";
import { enterTournament, signOutAction } from "@/app/actions/auth";
import { prisma } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/roles";
import { Logo } from "@/components/Logo";
import { BrandMark } from "@/components/BrandMark";
import { CreateFirstTournament } from "@/components/CreateFirstTournament";

export default async function ChooseTournamentPage({
  searchParams,
}: {
  searchParams: Promise<{ stay?: string }>;
}) {
  const session = await requireSession();
  const { stay } = await searchParams;
  const accounts = await prisma.account.findMany({
    where: { email: session.email },
    include: { event: { include: { _count: { select: { players: true } } } } },
    orderBy: { event: { createdAt: "desc" } },
  });

  // With exactly one tournament there's nothing to choose between, so don't
  // make people click through a list of one — the common case for players.
  // `?stay=1` keeps the picker visible for anyone who wants to create another.
  //
  // No active-event cookie is set here: cookies can only be written from a
  // Server Action or Route Handler, not during a render. It isn't needed
  // either — with a single account, getSession's "most recent tournament"
  // fallback already resolves to this one.
  if (accounts.length === 1 && !stay) {
    redirect("/dashboard");
  }

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
        <h1 style={{ fontSize: 32, margin: "8px 0 4px" }}>
          {accounts.length === 0 ? "Welcome to TourneyHQ" : "Which tournament?"}
        </h1>
        <p className="text-muted" style={{ fontSize: 14, margin: "0 0 28px" }}>
          {accounts.length === 0
            ? "Your account is ready. If an organizer has invited you to a tournament, it appears here as soon as they add your email — otherwise create your own below."
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

        {/* Keyed on the count so the form remounts (and collapses) once the
            first tournament exists, instead of staying open from its initial
            "no tournaments yet" state. */}
        <CreateFirstTournament key={accounts.length} first={accounts.length === 0} />
      </div>
    </div>
  );
}
