import { requireScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { TeamsClient } from "@/components/TeamsClient";
import { teamsForStage, unassignedPlayers, teamProblems } from "@/lib/services/teams";
import { TEAM_FORMAT_NAMES, findFormat, sideSizeRange } from "@/lib/formats";

/**
 * Drawing sides for the team formats.
 *
 * Scoped to a round rather than the tournament, because a round is what has a
 * format — a multi-day member-guest can play four-ball on Saturday and
 * foursomes on Sunday off the same pairings, and a society can redraw weekly.
 */
export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ round?: string }>;
}) {
  const session = await requireScreen("teams");
  const params = await searchParams;

  const stages = await prisma.stage.findMany({
    where: { eventId: session.eventId },
    orderBy: { position: "asc" },
    select: { id: true, position: true, type: true, format: true, description: true },
  });

  const teamStages = stages.filter((s) => TEAM_FORMAT_NAMES.includes(s.format));
  const active = teamStages.find((s) => s.id === params.round) ?? teamStages[0] ?? null;

  if (!active) {
    return (
      <>
        <p className="kicker">Set up</p>
        <h1 className="page-title">Teams</h1>
        <div className="card elev-sm" style={{ marginTop: 16 }}>
          <span className="card-title" style={{ fontSize: 15 }}>No team rounds yet</span>
          <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
            Sides are drawn per round, so this fills in once a round is set to a team format —
            four-ball, best ball, foursomes, a scramble or a shamble. Set one on{" "}
            <a href="/stages">Rounds &amp; format</a>.
          </p>
        </div>
      </>
    );
  }

  const teams = await teamsForStage(session.eventId, active.id, active.format);
  const matchCount = await prisma.match.count({ where: { eventId: session.eventId, stageId: active.id } });
  const unassigned = await unassignedPlayers(session.eventId, teams);
  const format = findFormat(active.format);
  const range = sideSizeRange(active.format);

  return (
    <>
      <p className="kicker">Set up</p>
      <h1 className="page-title">Teams</h1>
      <TeamsClient
        rounds={teamStages.map((s) => ({
          id: s.id,
          label: `Round ${s.position + 1} — ${s.format}`,
          format: s.format,
        }))}
        activeRoundId={active.id}
        format={{
          name: format.name,
          desc: format.desc,
          min: range.min,
          max: range.max,
          sharesOneCard: format.ball === "single",
          allowance: format.allowance,
          allowanceIsConvention: !!format.allowanceIsConvention,
        }}
        teams={teams}
        problems={teamProblems(teams, active.format)}
        unassigned={unassigned}
        matchCount={matchCount}
      />
    </>
  );
}
