import "server-only";
import { prisma } from "@/lib/db";
import { resolveThirdPlace } from "@/lib/domain/third-place";
import type { ThirdPlaceView } from "@/components/StagesClient";
import type { EventState } from "./tournament";

/**
 * THE PLAY-OFF FOR THIRD, AS ITS CONTROL IS HANDED IT (R9c): ONE reader for Rounds & formats and for Tee times & draw, so the
 * two cannot name different players or give a different reason.
 *
 * Resolved from the winners bracket as it stands, so a corrected semi-final changes who would play it. In flights there is no
 * play-off for third at all (see `setThirdPlace`), and the reason is said where the control is rather than discovered by
 * pressing it. `made` is whether the match (round 0 of the knockout's own round) already exists.
 */
export async function thirdPlaceViewFor(
  eventId: string,
  stage: { id: string; thirdPlace: boolean },
  brackets: EventState["brackets"],
): Promise<ThirdPlaceView> {
  const r = brackets.draws
    ? { problem: "A knockout in several flights has no play-off for third: each flight's beaten semi-finalists share third.", pairing: null }
    : resolveThirdPlace(brackets.winners);
  const made = await prisma.match.count({ where: { eventId, stageId: stage.id, round: 0 } });
  return {
    on: stage.thirdPlace,
    problem: r.problem,
    aName: r.pairing?.a.name ?? "",
    bName: r.pairing?.b.name ?? "",
    made: made > 0,
  };
}
