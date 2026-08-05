import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadEventState, standingRows, settingsOf } from "@/lib/services/tournament";
import { isLeaderboardPublic } from "@/lib/tournament-settings";
import { brandForEvent } from "@/lib/services/organization";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { OrgBrand } from "@/components/OrgBrand";

/**
 * The public read-only leaderboard.
 *
 * Deliberately outside the (app) group: no session, no sidebar, no role. The
 * share token is the only credential, and it grants exactly one thing —
 * looking at the standings of one tournament.
 *
 * Nothing here may render contact details or anything a spectator shouldn't
 * see. The page shows names, positions and scores; that is the whole contract.
 */

// Standings move as scores come in, so this must never be served stale from
// the full route cache.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const event = await prisma.event.findUnique({
    where: { shareToken: token },
    select: { name: true, leaderboardVisibility: true },
  });
  // Don't leak a tournament's name through the tab title when it isn't public.
  if (!event || event.leaderboardVisibility !== "public") return { title: "Leaderboard" };
  return { title: `${event.name} — Live leaderboard` };
}

export default async function PublicLeaderboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const event = await prisma.event.findUnique({ where: { shareToken: token } });
  // Same response whether the token is wrong or the organizer has unpublished:
  // a 404 either way, so the link can be switched off without confirming that
  // the tournament exists.
  if (!event || !isLeaderboardPublic(settingsOf(event))) notFound();

  const state = await loadEventState(event.id);
  if (!state) notFound();

  const rows = standingRows(state);
  const brand = await brandForEvent(event.id);
  const venue = [event.course, event.city].filter(Boolean).join(", ");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        padding: "22px 18px 40px",
      }}
    >
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <OrgBrand brand={brand} />
        </div>

        <div style={{ marginBottom: 18 }}>
          <div className="page-kicker">Live leaderboard</div>
          <h1 style={{ fontSize: 26, margin: "5px 0 0", fontFamily: "var(--font-heading)" }}>{event.name}</h1>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {[event.dates, venue].filter(Boolean).join(" · ")}
          </p>
        </div>

        <div className="card elev-sm">
          {rows.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              No scores yet. This page updates as cards come in.
            </p>
          ) : (
            <LeaderboardTable
              isStroke={state.isStroke}
              isStableford={state.activeStage?.scoringBasis === "stableford"}
              rows={rows}
            />
          )}
        </div>

        <p className="text-muted" style={{ fontSize: 11, marginTop: 16, textAlign: "center" }}>
          Read-only · refresh for the latest scores
        </p>
      </div>
    </div>
  );
}
