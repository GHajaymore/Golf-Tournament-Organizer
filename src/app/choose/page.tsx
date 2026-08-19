import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-helpers";
import { enterTournament, signOutAction } from "@/app/actions/auth";
import { homeFor } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { accessibleEvents } from "@/lib/services/access";
import { ROLE_LABEL } from "@/lib/roles";
import { Logo, LOGO_SIZE } from "@/components/Logo";
import { BrandMark } from "@/components/BrandMark";
import { CreateFirstTournament } from "@/components/CreateFirstTournament";
import { orgProfile } from "@/lib/domain/org-profile";

export default async function ChooseTournamentPage({
  searchParams,
}: {
  searchParams: Promise<{ stay?: string }>;
}) {
  const session = await requireSession();
  const { stay } = await searchParams;

  // Includes tournaments reached through organization membership, not just
  // those with an explicit per-event account — otherwise a club admin can't
  // see events their colleagues created.
  const access = await accessibleEvents(session.email);
  const events = await prisma.event.findMany({
    where: { id: { in: access.map((a) => a.eventId) } },
    include: { _count: { select: { players: true } }, organization: { select: { name: true, kind: true } } },
    orderBy: { createdAt: "desc" },
  });
  const roleByEvent = new Map(access.map((a) => [a.eventId, a]));
  const accounts = events.map((event) => ({
    id: event.id,
    eventId: event.id,
    role: roleByEvent.get(event.id)?.role ?? "player",
    source: roleByEvent.get(event.id)?.source ?? "event",
    event,
  }));

  // With exactly one tournament there's nothing to choose between, so don't
  // make people click through a list of one — the common case for players.
  // `?stay=1` keeps the picker visible for anyone who wants to create another.
  //
  // No active-event cookie is set here: cookies can only be written from a
  // Server Action or Route Handler, not during a render. It isn't needed
  // either — with a single account, getSession's "most recent tournament"
  // fallback already resolves to this one.
  if (accounts.length === 1 && !stay) {
    // By role, not to the console. A player with one tournament was being sent
    // to /dashboard — the organizer's screen, emptied by the role guards —
    // while the player app sat one hand-typed URL away.
    redirect(homeFor(accounts[0].role));
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
              <Logo size={LOGO_SIZE.md} style={{ color: "var(--color-accent)" }} />
            </div>
            <BrandMark />
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
                    {/* Whose name is worth showing: a tenant shared with other
                        people, so the row says which one. A personal organizer's
                        org name is their own and adds nothing. Asked via the
                        profile rather than compared, so a society gets it too. */}
                    {a.event.organization && orgProfile(a.event.organization.kind).sharedRoster
                      ? ` · ${a.event.organization.name}`
                      : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
                  {/* Makes inherited access legible: "why can I see this?" */}
                  {a.source === "organization" && (
                    <span className="tag tag-neutral" title="Access inherited from your organization role">
                      <i className="ph ph-buildings" /> via club
                    </span>
                  )}
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

        {/* A player given a round code but never added by email lands here with
            nothing to enter — accessibleEvents only knows people an organizer
            put on the roster. This is their way in: the existing /play code
            entry, not a new sign-up path. Shown only in the empty state, where
            "I was sent a code" is the likeliest reason someone sees no events. */}
        {accounts.length === 0 && (
          <div
            style={{
              marginTop: 18,
              paddingTop: 18,
              borderTop: "1px solid var(--color-divider)",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Given a round code?</div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                Playing today but not on the list yet — enter the code from your organizer.
              </div>
            </div>
            <Link href="/play" className="btn btn-secondary" style={{ flex: "none" }}>
              <i className="ph ph-flag" /> Join with a round code
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
