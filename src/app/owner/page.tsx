import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { prisma } from "@/lib/db";
import { ownerMetrics } from "@/lib/domain/owner-metrics";
import { PLANS, effectivePrice } from "@/lib/plans";
import { storedPricingOverrides } from "@/lib/services/platform-pricing";
import { OwnerPricing } from "@/components/OwnerPricing";
import { DEFAULT_LOCALE } from "@/lib/domain/locale";
import { NOINDEX } from "@/lib/site";

/**
 * THE OWNER CONSOLE — the whole business on one screen, for the people who run
 * TourneyHQ.
 *
 * Every other screen answers about one tournament; this reads ACROSS all of
 * them. It is gated on `isOwner` against `OWNER_EMAILS`, and a stranger gets a
 * 404, not a "forbidden" — a console that shows every club's numbers must not
 * even admit to existing. It is noindex for the same reason, belt to the robots
 * braces.
 *
 * IT COUNTS AND NEVER NAMES A PERSON. Every figure is an aggregate; the only
 * names on it are customer ORGANIZATIONS, which are the owner's own accounts to
 * see, never a member or a player. Revenue is projected from the SAME
 * `effectivePrice` a customer is quoted (see `owner-metrics.ts`), so the number
 * here and the number on the pricing page move together.
 *
 * Read-only. Nothing on it writes.
 */

export const metadata: Metadata = { title: "Owner console", robots: NOINDEX };

// Live business data behind a per-request owner check — never statically cached.
export const dynamic = "force-dynamic";

// The owner console is the PLATFORM's own view, not a club's, so it formats in
// DEFAULT_LOCALE rather than resolving a club locale it does not have — the one
// place `no-hardcoded-locale` allows a caller to reach for the default.
function usd(n: number): string {
  return `$${Math.round(n).toLocaleString(DEFAULT_LOCALE)}`;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(DEFAULT_LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

export default async function OwnerConsolePage() {
  const session = await getSession();
  // Fail closed: no session, or a signed-in person who is not on the owner
  // allow-list, gets exactly what a non-existent page gives.
  if (!session || !isOwner(session.email)) notFound();

  const [
    totalOrgs,
    orgsByPlan,
    orgsByKind,
    eventsByStatus,
    totalPlayers,
    orgsWithNoEvents,
    recentOrgs,
    liveEvents,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.subscription.groupBy({ by: ["plan"], _count: { _all: true } }),
    prisma.organization.groupBy({ by: ["kind"], _count: { _all: true } }),
    prisma.event.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.player.count(),
    prisma.organization.count({ where: { events: { none: {} } } }),
    prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        name: true,
        kind: true,
        createdAt: true,
        subscription: { select: { plan: true } },
        _count: { select: { events: true } },
      },
    }),
    prisma.event.findMany({
      where: { status: "live" },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, name: true, organization: { select: { name: true } } },
    }),
  ]);

  // The owner's own price overrides, so the projected MRR here and the price
  // the editor below shows both reflect what customers are actually quoted.
  const overrides = await storedPricingOverrides();

  const m = ownerMetrics(
    {
      totalOrgs,
      orgsByPlan: orgsByPlan.map((r) => ({ plan: r.plan, count: r._count._all })),
      orgsByKind: orgsByKind.map((r) => ({ kind: r.kind, count: r._count._all })),
      eventsByStatus: eventsByStatus.map((r) => ({ status: r.status, count: r._count._all })),
      totalPlayers,
      orgsWithNoEvents,
    },
    overrides,
  );

  const tiers = Object.values(PLANS).map((p) => ({
    key: p.key,
    name: p.name,
    monthly: effectivePrice(p, overrides),
    free: p.key === "free",
  }));

  const stat = (label: string, value: string, sub?: string) => (
    <div className="card elev-sm" style={{ flex: 1, minWidth: 150, gap: 2 }}>
      <span className="card-kicker">{label}</span>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 26 }}>{value}</div>
      {sub && <span className="text-muted" style={{ fontSize: 12 }}>{sub}</span>}
    </div>
  );

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 64px" }}>
      <div style={{ marginBottom: 8 }}>
        <span className="card-kicker">TourneyHQ</span>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 28, margin: "2px 0 0" }}>
          Owner console
        </h1>
        <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
          The whole business, read-only. Signed in as {session.email}.
        </p>
      </div>

      {/* Headline numbers */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "16px 0" }}>
        {stat("Organizations", m.totalOrgs.toLocaleString(DEFAULT_LOCALE), `${m.paidOrgs} paid · ${m.freeOrgs} free`)}
        {stat("Est. MRR", usd(m.estMrrMonthly), `${usd(m.estArr)} ARR at today's prices`)}
        {stat("Tournaments", m.totalEvents.toLocaleString(DEFAULT_LOCALE), `${m.liveEvents} live now`)}
        {stat("Players", m.totalPlayers.toLocaleString(DEFAULT_LOCALE), "across every event")}
      </div>

      {/* The one control that writes: set the price every screen quotes. */}
      <OwnerPricing tiers={tiers} />

      {/* Tier mix */}
      <div className="card elev-sm" style={{ marginBottom: 16 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Tier mix</span>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Plan</th>
                <th style={{ textAlign: "right" }}>Clubs</th>
                <th style={{ textAlign: "right" }}>Price / mo</th>
                <th style={{ textAlign: "right" }}>MRR</th>
              </tr>
            </thead>
            <tbody>
              {m.tierMix.map((t) => (
                <tr key={t.plan}>
                  <td style={{ fontWeight: 500 }}>{t.name}</td>
                  <td style={{ textAlign: "right" }}>{t.count.toLocaleString(DEFAULT_LOCALE)}</td>
                  <td style={{ textAlign: "right" }}>{t.monthly === 0 ? "—" : usd(t.monthly)}</td>
                  <td style={{ textAlign: "right" }}>{t.mrr === 0 ? "—" : usd(t.mrr)}</td>
                </tr>
              ))}
              {m.tierMix.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-muted" style={{ fontSize: 13, padding: 16 }}>
                    No subscriptions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Two side-by-side breakdowns */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div className="card elev-sm" style={{ flex: 1, minWidth: 240 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Organizations by kind</span>
          <div style={{ marginTop: 8 }}>
            {m.kinds.map((k) => (
              <div key={k.kind} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                <span style={{ textTransform: "capitalize" }}>{k.kind}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{k.count.toLocaleString(DEFAULT_LOCALE)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card elev-sm" style={{ flex: 1, minWidth: 240 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Tournaments by stage</span>
          <div style={{ marginTop: 8 }}>
            {m.statuses.map((s) => (
              <div key={s.status} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                <span style={{ textTransform: "capitalize" }}>{s.status}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{s.count.toLocaleString(DEFAULT_LOCALE)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Worth attention */}
      <div className="card elev-sm" style={{ marginBottom: 16 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Worth a look</span>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
          <li>
            <strong>{m.orgsWithNoEvents.toLocaleString(DEFAULT_LOCALE)}</strong> organization
            {m.orgsWithNoEvents === 1 ? " has" : "s have"} signed up but never run a tournament — onboarding drop-off.
          </li>
          <li>
            <strong>{m.freeOrgs.toLocaleString(DEFAULT_LOCALE)}</strong> on the free tier
            {m.paidOrgs > 0 ? `, against ${m.paidOrgs} paying` : ""} — the conversion pool.
          </li>
          <li>
            <strong>{m.liveEvents.toLocaleString(DEFAULT_LOCALE)}</strong> tournament{m.liveEvents === 1 ? " is" : "s are"} live right now.
          </li>
        </ul>
      </div>

      {/* Recent signups */}
      <div className="card elev-sm" style={{ marginBottom: 16 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Newest organizations</span>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Kind</th>
                <th>Plan</th>
                <th style={{ textAlign: "right" }}>Events</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {recentOrgs.map((o) => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 500 }}>{o.name}</td>
                  <td className="text-muted" style={{ textTransform: "capitalize" }}>{o.kind}</td>
                  <td className="text-muted" style={{ textTransform: "capitalize" }}>{o.subscription?.plan ?? "free"}</td>
                  <td style={{ textAlign: "right" }}>{o._count.events}</td>
                  <td className="text-muted">{shortDate(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live now */}
      {liveEvents.length > 0 && (
        <div className="card elev-sm">
          <span className="card-title" style={{ fontSize: 15 }}>Live right now</span>
          <div style={{ marginTop: 8 }}>
            {liveEvents.map((e) => (
              <div key={e.id} style={{ fontSize: 13, padding: "3px 0" }}>
                <span style={{ fontWeight: 500 }}>{e.name}</span>
                <span className="text-muted"> · {e.organization.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
