import "server-only";
import { prisma } from "../db";
import { formGroups, roundRobinSchedule } from "../domain";
import type { FormationRule, FlightConfig, Player as DomainPlayer } from "../domain";

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

  const domainPlayers: DomainPlayer[] = confirmed.map((p) => ({
    id: p.id,
    name: p.name,
    handicap: p.handicap,
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
