import { keepsDataForever, PLANS } from "../plans";

/**
 * DOES COMPLETING THIS TOURNAMENT DELETE IT?
 *
 * Ajay, 2026-09-29: on the Free plan a tournament's data is wiped the moment
 * it is closed, and the terms apply to NEW clubs only. Kept pure and apart from
 * anything that deletes, for the reason `retention.ts` gives: this decides what
 * gets destroyed, so it must be provable on its own.
 *
 * Every condition must hold, and each one fails SAFE (towards keeping):
 *   - the club is held to the published terms (`planTermsApply`). An existing
 *     club is grandfathered, and a club with no subscription row is treated
 *     as grandfathered too, never as new;
 *   - its plan does not keep data (`keepsDataForever` false, so Free only);
 *   - it is a tournament, not a casual round. A quick round has its own 24-hour
 *     expiry (`round-expiry.ts`) and is not what this rule is about;
 *   - nobody has put an explicit hold on it (`retainUntil` in the future). A
 *     hold only ever extends, the same rule `retentionDecision` keeps.
 */
export interface CloseTermsInput {
  planTermsApply: boolean | null | undefined;
  plan: string | null | undefined;
  shape: string;
  retainUntil?: Date | null;
}

export function wipesOnClose(input: CloseTermsInput, now: Date = new Date()): boolean {
  if (input.planTermsApply !== true) return false;
  if (keepsDataForever(input.plan ?? "free")) return false;
  if (input.shape === "match") return false;
  if (input.retainUntil && now.getTime() < new Date(input.retainUntil).getTime()) return false;
  return true;
}

/** What the organizer is told before they complete a tournament that this deletes. */
export const WIPE_ON_CLOSE =
  `On the free ${PLANS.free.name} plan, completing a tournament deletes it for good — entries, cards, results, prizes and money. ` +
  "Nobody can open it afterwards, not you and not the players. Download anything you want to keep from Reports first.";
