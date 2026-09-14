import "server-only";
import { prisma } from "@/lib/db";
import { generateAccessCode } from "@/lib/codes";
import { cleanSettings, usesAccessCodes } from "@/lib/tournament-settings";

/**
 * EVERY ROUND OF A CODE-USING TOURNAMENT HAS A CODE.
 *
 * A Round Code is how a player without an account reaches their card. A round
 * with a blank one is a round nobody can enter — and it does not announce
 * itself: the organizer's Round Codes list simply has a gap where that round's
 * code would be, which reads as "not generated yet" rather than as a door that
 * does not open.
 *
 * THIS USED TO BE A TRANSITION, AND THAT IS THE BUG. `saveTournamentSettings`
 * issued codes when the access dropdown changed FROM something else TO codes:
 *
 *     if (nowUsingCodes && !wasUsingCodes) await issueRoundCodes(eventId);
 *
 * Which is correct about the moment it fires and wrong about every other
 * moment. Two ways a round ends up with no code, both ordinary:
 *
 *   - A ROUND ADDED AFTERWARDS. Codes are on, the organizer adds round four,
 *     and nothing issues one — the setting has not changed, so the guard does
 *     not fire. Stage creation happens in four places and none of them knew
 *     this rule existed.
 *   - A TOURNAMENT CREATED WITH CODES ALREADY ON. There is no transition to
 *     catch at all, so not one round is ever issued a code.
 *
 * Measured against the development database on 2026-09-14, all three
 * code-using tournaments in it were affected: Demo Cup had one of four rounds
 * coded, and the other two had ZERO of theirs — the second case above, where
 * the feature is switched on and has simply never worked.
 *
 * So it is a STATE now, asked at every point that could make it false, and
 * this function is the one place that answers it. Idempotent by construction:
 * it fills blanks and touches nothing else, so calling it on a tournament that
 * is already correct costs one indexed query and writes nothing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO is issue codes for a tournament that is not
 * using them. "Off" has to mean off — `revokeRoundCodes` blanks them for
 * exactly that reason — so this reads the setting rather than trusting the
 * caller to have checked.
 */
export async function ensureRoundCodes(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return;
  if (!usesAccessCodes(cleanSettings(event))) return;

  const stages = await prisma.stage.findMany({
    where: { eventId, accessCode: "" },
    select: { id: true },
  });

  for (const stage of stages) {
    /**
     * Codes are unique across all tournaments because redemption looks them up
     * on their own, so a collision is retried rather than thrown — with 27^8
     * codes this effectively never fires, but "effectively never" is not
     * "never" and a unique-constraint crash mid-round would be a miserable way
     * to find out.
     */
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateAccessCode();
      const taken = await prisma.stage.count({ where: { accessCode: code } });
      if (taken > 0) continue;
      try {
        await prisma.stage.update({ where: { id: stage.id }, data: { accessCode: code } });
        break;
      } catch {
        // Lost a race against a concurrent issue for the same code — try again.
      }
    }
  }
}

/**
 * Withdraw every Round Code for a tournament.
 *
 * Turning code access off has to actually revoke the codes, or "off" would
 * mean nothing. Here rather than in `settings.ts` so that the two halves of
 * one rule — issue while on, revoke when off — sit next to each other and
 * cannot drift apart.
 */
export async function revokeRoundCodes(eventId: string): Promise<void> {
  await prisma.stage.updateMany({ where: { eventId }, data: { accessCode: "" } });
}
