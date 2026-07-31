import "server-only";
import { prisma } from "../db";
import { formGroups, roundRobinSchedule } from "../domain";
import type { FormationRule, Player as DomainPlayer } from "../domain";

/**
 * Re-form groups for an event from its confirmed players using the given rule,
 * then regenerate the round-robin schedule (empty matches) for stage 0.
 *
 * This is the intended-destructive "Generate groups" action: it discards any
 * existing round-robin matches (and their scores), since roster/rule changes
 * invalidate the schedule. In production this would be guarded once live scores
 * exist (see handoff README); the UI surfaces that clearly.
 */
export async function regenerateGroupsAndSchedule(
  eventId: string,
  rule?: FormationRule,
): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return;
  const formationRule = (rule ?? (event.formationRule as FormationRule)) as FormationRule;

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
  const groups = formGroups(domainPlayers, formationRule);

  const rrStage = await prisma.stage.findFirst({
    where: { eventId, type: "Round Robin" },
    orderBy: { position: "asc" },
  });

  await prisma.$transaction(async (tx) => {
    if (rule) await tx.event.update({ where: { id: eventId }, data: { formationRule } });
    // Clear old round-robin matches and groups.
    if (rrStage) await tx.match.deleteMany({ where: { eventId, stageId: rrStage.id } });
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

    // Fresh round-robin schedule with empty holes.
    if (rrStage) {
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
              holes: JSON.stringify(new Array(18).fill(null)),
            },
          });
        }
      }
    }
  });
}
