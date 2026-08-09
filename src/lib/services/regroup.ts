import "server-only";
import { prisma } from "../db";
import { formGroups, roundRobinSchedule } from "../domain";
import type { FormationRule, FlightConfig, Player as DomainPlayer } from "../domain";
import { needsTeams } from "../formats";
import { generatesPairings, isPlayingRound } from "../stage-types";
import { courseHandicapMap } from "../domain";

/**
 * Re-form flights for an event from its confirmed players using the stored rule
 * and flight configuration, then regenerate the round-robin schedule (empty
 * matches) for every Round Robin stage that doesn't have a cut line — a
 * tournament can sequence more than one round, and each gets its own full
 * round-robin among the same flights. Stages with a cut line are left empty
 * here; they're built by generateNextRound once the previous round's results
 * decide who advances.
 *
 * This is the intended-destructive "Generate flights" action: it discards any
 * existing round-robin matches (and their scores), since roster/rule changes
 * invalidate the schedule. In production this would be guarded once live scores
 * exist (see handoff README); the UI previews the result before committing.
 */
/**
 * How many Round Robin matches already have a hole result recorded.
 *
 * Regenerating flights deletes and rebuilds every Round Robin match, so this
 * is the number that says whether doing so destroys real results. It counts
 * scored matches rather than reading `Event.status`, because status is a label
 * an organizer sets by hand — a tournament can be 83% played and still say
 * "draft" if nobody pressed Launch. Actual scores can't be forgotten about.
 */
export async function scoredMatchCount(eventId: string): Promise<number> {
  const rrStages = await prisma.stage.findMany({
    where: { eventId, type: "Round Robin" },
    select: { id: true },
  });
  if (!rrStages.length) return 0;

  const matches = await prisma.match.findMany({
    where: { eventId, stageId: { in: rrStages.map((s) => s.id) } },
    select: { holes: true },
  });

  return matches.filter((m) => {
    try {
      const holes = JSON.parse(m.holes) as unknown[];
      return Array.isArray(holes) && holes.some((h) => h !== null);
    } catch {
      return false;
    }
  }).length;
}

/**
 * Repair one player's pairings after they have been moved between flights.
 *
 * Moving a player used to change nothing but a foreign key. The round-robin
 * matches drawn for the old flight stayed exactly where they were, so the
 * player still had a full card of matches against a flight they were no longer
 * in — and none at all against the flight they had joined. The flight standings
 * then showed them in one flight with results earned in another, and the
 * players who *were* in their new flight were a match short each, for good.
 * Nothing warned about any of it; the counts still added up.
 *
 * Surgical on purpose. Only matches involving this player are touched, so
 * every other pairing in both flights keeps its result. The moved player's own
 * results are discarded, because they were played against opponents this
 * player is no longer scheduled to meet — that is the one thing a move cannot
 * preserve, and the caller confirms it first.
 *
 * Round numbers are chosen per stage as the first round in which neither side
 * is already playing, so nobody ends up in two matches at once.
 */
export async function repairPlayerPairings(eventId: string, playerId: string): Promise<void> {
  const player = await prisma.player.findFirst({
    where: { id: playerId, eventId },
    select: { id: true, groupId: true, status: true },
  });
  if (!player) return;

  const stages = await prisma.stage.findMany({
    where: { eventId, type: "Round Robin" },
    orderBy: { position: "asc" },
  });
  // The same three exclusions regenerateGroupsAndSchedule applies: a cut-gated
  // round is drawn from results it doesn't have yet, a team round is played
  // side against side, and a medal round has no opponents at all.
  const drawable = stages.filter(
    (s) => !s.cutEnabled && !needsTeams(s.format) && generatesPairings(s.type),
  );
  if (drawable.length === 0) return;

  const flightMates =
    player.groupId && player.status === "confirmed"
      ? await prisma.player.findMany({
          where: { eventId, groupId: player.groupId, status: "confirmed", id: { not: playerId } },
          orderBy: { seed: "asc" },
          select: { id: true },
        })
      : [];

  await prisma.$transaction(async (tx) => {
    for (const stage of drawable) {
      await tx.match.deleteMany({
        where: {
          eventId,
          stageId: stage.id,
          OR: [{ playerAId: playerId }, { playerBId: playerId }],
        },
      });

      if (!player.groupId || flightMates.length === 0) continue;

      // Rounds already spoken for, per opponent, so a repaired match never
      // double-books either side.
      const rest = await tx.match.findMany({
        where: { eventId, stageId: stage.id },
        select: { round: true, playerAId: true, playerBId: true },
      });
      const busy = new Map<string, Set<number>>();
      const mark = (id: string, r: number) => {
        const set = busy.get(id) ?? new Set<number>();
        set.add(r);
        busy.set(id, set);
      };
      for (const m of rest) {
        mark(m.playerAId, m.round);
        mark(m.playerBId, m.round);
      }

      const emptyHoles = JSON.stringify(new Array(stage.holes === 9 ? 9 : 18).fill(null));
      for (const mate of flightMates) {
        let round = 1;
        while (busy.get(playerId)?.has(round) || busy.get(mate.id)?.has(round)) round += 1;
        mark(playerId, round);
        mark(mate.id, round);
        await tx.match.create({
          data: {
            eventId,
            stageId: stage.id,
            groupId: player.groupId,
            round,
            playerAId: playerId,
            playerBId: mate.id,
            holes: emptyHoles,
          },
        });
      }
    }
  });
}

export async function regenerateGroupsAndSchedule(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return;

  const formationRule = event.formationRule as FormationRule;
  const config: FlightConfig = {
    mode: (["auto", "count", "perFlight"].includes(event.flightMode)
      ? event.flightMode
      : "auto") as FlightConfig["mode"],
    value: event.flightValue > 0 ? event.flightValue : undefined,
  };

  const confirmed = await prisma.player.findMany({
    where: { eventId, status: "confirmed" },
    orderBy: { seed: "asc" },
  });

  // Flights must be balanced on the same number the round is scored on.
  // This built its players from the raw stored handicap while scoring used a
  // Course Handicap — so a handicap-balanced draw was balanced on indexes,
  // and over nine holes it was balanced on doubled ones. Both are the same
  // mistake as using an index where a Course Handicap belongs, and neither
  // shows a symptom: the flights just come out subtly uneven.
  const [allStages, tees] = await Promise.all([
    prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
    prisma.tee.findMany({
      where: { course: { events: { some: { eventId } } } },
      orderBy: [{ position: "asc" }],
    }),
  ]);
  const activeHoles = allStages.filter((s) => isPlayingRound(s.type))[0]?.holes === 9 ? 9 : 18;
  const teeRatings = new Map(
    tees.map((t) => [t.id, { courseRating: t.courseRating, slopeRating: t.slopeRating, par: t.par }]),
  );
  const courseHcp = courseHandicapMap(confirmed, teeRatings, tees[0]?.id ?? null, activeHoles);

  const domainPlayers: DomainPlayer[] = confirmed.map((p) => ({
    id: p.id,
    name: p.name,
    handicap: courseHcp.get(p.id) ?? p.handicap,
    seed: p.seed,
  }));
  const groups = formGroups(domainPlayers, formationRule, config);

  const rrStages = await prisma.stage.findMany({
    where: { eventId, type: "Round Robin" },
    orderBy: { position: "asc" },
  });

  await prisma.$transaction(async (tx) => {
    if (rrStages.length) {
      await tx.match.deleteMany({ where: { eventId, stageId: { in: rrStages.map((s) => s.id) } } });
    }
    await tx.player.updateMany({ where: { eventId }, data: { groupId: null } });
    await tx.group.deleteMany({ where: { eventId } });

    const groupIdByEngineId = new Map<string, string>();
    for (let i = 0; i < groups.length; i += 1) {
      const g = groups[i];
      const created = await tx.group.create({
        data: { eventId, name: g.name, position: i },
      });
      groupIdByEngineId.set(g.id, created.id);
      if (g.playerIds.length) {
        await tx.player.updateMany({
          where: { id: { in: g.playerIds } },
          data: { groupId: created.id },
        });
      }
    }

    for (const rrStage of rrStages) {
      // Cut-gated stages are built separately (generateNextRound), once the
      // preceding round's real results decide who's still in the field.
      if (rrStage.cutEnabled) continue;
      // A team round is played side against side, so pairing its players
      // individually would fill it with matches nobody plays — and they would
      // count toward the standings. Its matches come from generateTeamMatches
      // on the Teams screen, once the sides are drawn.
      if (needsTeams(rrStage.format)) continue;
      // A medal round has no opponents. Drawing pairings for it produced
      // matches nobody played, which could still be scored and would then
      // count toward the standings — the same failure the team skip above
      // exists to prevent.
      if (!generatesPairings(rrStage.type)) continue;
      const emptyHoles = JSON.stringify(new Array(rrStage.holes === 9 ? 9 : 18).fill(null));
      for (const g of groups) {
        const dbGroupId = groupIdByEngineId.get(g.id)!;
        const schedule = roundRobinSchedule(g.playerIds);
        for (const pairing of schedule) {
          await tx.match.create({
            data: {
              eventId,
              stageId: rrStage.id,
              groupId: dbGroupId,
              round: pairing.round,
              playerAId: pairing.aId,
              playerBId: pairing.bId,
              holes: emptyHoles,
            },
          });
        }
      }
    }
  });
}
