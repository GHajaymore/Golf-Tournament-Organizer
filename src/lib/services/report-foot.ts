import "server-only";
import { signInsHeld } from "./signins-switch";
import { HELD_FRONT_DOOR } from "../sign-in-gate";

/**
 * THE REPORT'S ONE LINE ABOUT TOURNEYHQ (2026-10-23): "Results by TourneyHQ",
 * small, at the foot — the club's document, the club's name first.
 *
 * Where it points follows THE launch switch (`signInsHeld`: the deploy's hold,
 * unless the owner has opened accounts on /owner). While sign-ins are held it
 * goes to the early list, in the front door's own words for it; once the
 * owner presses go-live it goes to the front door, by itself. Nothing here is
 * written for one state or the other: the words come from the gate's file.
 */
export interface ReportFoot {
  text: string;
  href: string;
  /** "Join the early list" while held; "" once open. */
  cta: string;
}

export function reportFootFor(held: boolean): ReportFoot {
  return held
    ? { text: "Results by TourneyHQ", href: "/interest", cta: HELD_FRONT_DOOR.cta }
    : { text: "Results by TourneyHQ", href: "/", cta: "" };
}

export async function reportFoot(): Promise<ReportFoot> {
  return reportFootFor(await signInsHeld());
}
