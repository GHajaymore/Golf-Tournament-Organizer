import { prisma } from "../db";
import { defaultFormationRule, type FormationRule } from "../domain";
import { lookupFormat } from "../formats";
import { isHeadToHead, isPlayingRound } from "../stage-types";

/**
 * THE FLIGHT RULE A TOURNAMENT'S OWN ROUNDS CALL FOR — `defaultFormationRule`
 * over its playing rounds as they stand now.
 */
export async function flightDefaultFor(eventId: string): Promise<FormationRule> {
  const stages = await prisma.stage.findMany({ where: { eventId }, select: { type: true, format: true } });
  return defaultFormationRule(
    stages
      .filter((s) => isPlayingRound(s.type))
      .map((s) => ({ headToHead: isHeadToHead(s.type), engine: lookupFormat(s.format.trim())?.engine })),
  );
}

/**
 * KEEP A TOURNAMENT'S FLIGHT RULE ON ITS DEFAULT WHILE NOBODY HAS CHOSEN ONE.
 *
 * Called after a round is added or its format changed, with the default as it
 * stood BEFORE the change. The rule moves only when both hold:
 *
 *   - no flights have been drawn yet — a drawn flight is somebody's division
 *     or opponents, and changing the rule under it would redraw people;
 *   - the stored rule is still the one the app would have picked before the
 *     change — anything else is an organizer's choice, and a choice is kept.
 *
 * So a new medal's field divides by handicap without anybody asking, a match
 * play event keeps its balanced flights, and an organizer who picked a rule
 * never has it changed for them.
 */
export async function followFlightDefault(eventId: string, before: FormationRule): Promise<void> {
  const [event, drawn] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { formationRule: true } }),
    prisma.group.count({ where: { eventId, isCarrier: false } }),
  ]);
  if (!event || drawn > 0 || event.formationRule !== before) return;
  const next = await flightDefaultFor(eventId);
  if (next !== event.formationRule) {
    await prisma.event.update({ where: { id: eventId }, data: { formationRule: next } });
  }
}
