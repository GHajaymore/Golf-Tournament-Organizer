import { relocate, type ScreenKey } from "./console-merges";
import { drawSections } from "./draw-sections";
import type { Family } from "./tournament-status";
import type { Role } from "../roles";

/**
 * WHERE ROUND n's DRAW IS MADE ON THE REDESIGNED ROUNDS & FORMATS (R4d): "/stages" (here, `DrawRound`) or the room it
 * moved to.
 *
 * `relocate` alone said Tee times & draw whenever that room was shown, but the room draws only the rounds
 * `drawSections` says it BUILDS (a stroke or Stableford round, so far): for a match or a knockout it still shows today's
 * tee sheet, which has no draw. A link there led nowhere and the press had left Rounds, so the draw was in neither room.
 * `drawSections(...).built` is the one decider, so when R9b or R9c builds a family the link moves with no edit here.
 * `hasSavedSheet` only adds the paper section, so it is not asked.
 */
export function roundDrawHref(
  round: { id: string; type: string; format: string },
  family: Family,
  role: Role,
  shown: ReadonlySet<ScreenKey>,
): string {
  if (!drawSections({ type: round.type, format: round.format, hasSavedSheet: false }, family).built) return "/stages";
  return relocate({ href: "/stages", job: "draw", roundId: round.id, role }, shown);
}
