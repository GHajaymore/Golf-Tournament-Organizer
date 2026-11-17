import type { PrismaClient } from "@prisma/client";
import { endOfClubDay } from "@/lib/domain/club-clock";
import type { LockScope } from "@/lib/domain/tournament-status";

/**
 * A COMMITTEE CORRECTION, OPENED BY A FIXTURE (state machine PR 9b, test plan F5).
 *
 * Until 9b a test that needed to press a locked control on a live tournament wrote the blanket
 * flag (`configUnlocked`), which opened every part at once and said nothing about which part
 * the test needed. That flag is no longer read. A test now opens ONE part, the way
 * `openCorrection` stores it — the scope, the reason, who, and the end of the club's day — so
 * the test says which part it needed, and a press on any other part is still refused.
 *
 * It writes only to a fixture: a tournament whose name carries the `zz` mark (Hard rule 1).
 * `the-blanket-unlock-is-not-read.audit.test.ts` holds it to the row the real action writes.
 */
export const FIXTURE_CORRECTION_REASON = "zz fixture: a part opened for this test";
export const FIXTURE_CORRECTION_BY = "Zz Organizer";

/** Null for a fixture's tournament (its name starts with the `zz` mark); the refusal otherwise. */
export function fixtureMarkRefusal(name: string): string | null {
  return /^zz/i.test(name.trim()) ? null : `“${name}” carries no zz mark: a fixture opens a correction only on its own tournament (Hard rule 1).`;
}

/**
 * The correction's four columns, for a fixture that CREATES its tournament with one part already
 * open (`prisma.event.create({ data: { name, …, ...correctionColumns(name, "sides") } })`). The
 * name is asked for so the mark is checked here too. Until the end of the club's day: `zone` is
 * the club's (`""` keeps the server's day, as the club clock does).
 */
export function correctionColumns(name: string, scope: LockScope, opts: { reason?: string; by?: string; zone?: string } = {}) {
  const refused = fixtureMarkRefusal(name);
  if (refused) throw new Error(refused);
  return {
    correctionScope: scope,
    correctionReason: opts.reason ?? FIXTURE_CORRECTION_REASON,
    correctionBy: opts.by ?? FIXTURE_CORRECTION_BY,
    correctionUntil: endOfClubDay(opts.zone ?? ""),
  };
}

export async function openCorrectionOn(
  prisma: PrismaClient,
  eventId: string,
  scope: LockScope,
  opts: { reason?: string; by?: string } = {},
): Promise<void> {
  const row = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true, organization: { select: { timeZone: true } } } });
  await prisma.event.update({
    where: { id: eventId },
    data: correctionColumns(row.name, scope, { ...opts, zone: row.organization?.timeZone ?? "" }),
  });
}

/** Done, as a fixture presses it: nothing open afterwards. */
export async function endCorrectionOn(prisma: PrismaClient, eventId: string): Promise<void> {
  await prisma.event.update({ where: { id: eventId }, data: { correctionScope: null, correctionReason: null, correctionBy: null, correctionUntil: null } });
}
