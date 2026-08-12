import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadEventState, standingRows, settingsOf } from "@/lib/services/tournament";
import { needsTeams } from "@/lib/formats";
import { teamStandings } from "@/lib/services/teams";
import { resolveCourse } from "@/lib/courses";
import { TeamLeaderboard } from "@/components/TeamLeaderboard";
import { isLeaderboardPublic } from "@/lib/tournament-settings";
import { brandForEvent, themeForEvent } from "@/lib/services/organization";
import { PlayerLeaderboard } from "@/components/PlayerLeaderboard";
import { OrgBrand } from "@/components/OrgBrand";
import { themeCss, playerColorScheme } from "@/lib/themes";

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

  // A team round keeps its scores on TeamScorecard, so standingRows — which
  // only knows about players — would render an empty table on a page the club
  // has deliberately made public.
  const activeStage = state.activeStage ?? state.stages[0] ?? null;
  const teamRound = !!activeStage && needsTeams(activeStage.format);
  const holeCount = activeStage?.holes === 9 ? 9 : 18;
  const liveCourse = resolveCourse(event);
  const teamRows = teamRound
    ? await teamStandings(
        event.id,
        activeStage!.id,
        activeStage!.format,
        liveCourse.pars.slice(0, holeCount),
        liveCourse.strokeIndex.slice(0, holeCount),
        activeStage!.scoringBasis,
        activeStage!.handicapAllowance,
        activeStage!.allowanceWeights,
        activeStage!.countBest,
      )
    : [];

  const rows = standingRows(state);
  const brand = await brandForEvent(event.id);
  const venue = [event.course, event.city].filter(Boolean).join(", ");

  // The club's own theme, the same one the console renders. This page applied
  // no theme at all until recently — it read `var(--color-bg)` off the
  // stylesheet default, so a club that had chosen light still got a dark board
  // on the one screen in the product that is looked at in direct sun.
  //
  // `auto` resolves dark unless the device asks for light, which is the same
  // rule everywhere: one club, one ground, whichever screen you are on.
  const theme = await themeForEvent(event.id);
  const themeStyleSheet = themeCss(theme, "#player-theme");

  // How far the field has actually got, which is the first thing anyone asks.
  const started = rows.filter((r) => r.thru > 0);
  const allIn = started.length > 0 && started.every((r) => r.thru >= holeCount);
  const roundLabel = activeStage?.description?.trim() || activeStage?.type || "";

  return (
    <div
      id="player-theme"
      style={{
        colorScheme: playerColorScheme(theme),
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        padding: "20px 16px 48px",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: themeStyleSheet }} />
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <OrgBrand brand={brand} />
        </div>

        <header style={{ marginBottom: 22 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "var(--color-accent-400)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: allIn ? "var(--color-neutral-400)" : "var(--color-accent)",
              }}
            />
            {allIn ? "Final" : "Live"}
          </div>
          <h1
            style={{
              fontSize: 30,
              lineHeight: 1.12,
              margin: "8px 0 0",
              fontFamily: "var(--font-heading)",
              fontWeight: "var(--font-heading-weight)" as unknown as number,
              textWrap: "balance",
            }}
          >
            {event.name}
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5, color: "var(--color-neutral-400)" }}>
            {[roundLabel, event.dates, venue].filter(Boolean).join(" · ")}
          </p>
        </header>

        {teamRound ? (
          <TeamLeaderboard
            format={activeStage!.format}
            stableford={activeStage!.scoringBasis === "stableford"}
            rows={teamRows}
          />
        ) : (
          <PlayerLeaderboard
            isStroke={state.isStroke}
            isStableford={state.activeStage?.scoringBasis === "stableford"}
            rows={rows}
            holes={holeCount}
          />
        )}

        <p style={{ fontSize: 12, marginTop: 24, textAlign: "center", color: "var(--color-neutral-400)" }}>
          Read-only · pull down to refresh
        </p>
      </div>
    </div>
  );
}
