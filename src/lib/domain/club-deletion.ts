/**
 * MAY THIS PERSON DELETE THIS CLUB? (2026-10-03)
 *
 * The terms said a club could ask us to delete its data by writing in, and
 * there was no way to do it yourself. Deleting a club takes every tournament,
 * every card, every member on the roster and every money record with it, at
 * once and for good — so the rule is narrow on purpose, and each refusal says
 * what would make it possible:
 *
 *   - THE OWNER ONLY. Not an admin: an admin can run everything, but handing
 *     the off-switch for the whole club to everyone with settings access is
 *     how a falling-out becomes a deleted season. Not the "ownerless" escape
 *     hatch in `org-access.ts` either — that exists so nobody is locked OUT,
 *     and must never be how somebody gets in to destroy.
 *   - NOT WHILE A PAID PLAN IS RUNNING. Stripe would keep billing a club that
 *     no longer exists, with nobody left to cancel it. Cancel in Manage
 *     billing; once the plan has ended, the club can be deleted.
 *   - TYPED NAME. The club's own name, exactly, so the button cannot be
 *     pressed by accident or from muscle memory on the wrong club.
 *
 * Pure, so every refusal is provable on its own; the action and the delete
 * live in `actions/club-deletion.ts` and `services/club-deletion.ts`.
 */

/** Stripe states in which the club is still being billed (see `clubStatusFor`). */
const STILL_BILLING = new Set(["active", "trialing", "past_due"]);

export interface ClubDeletionInput {
  /** The caller's OrganizationMember role in THIS club, or null. */
  role: string | null;
  clubName: string;
  typedName: string;
  subscription: { plan: string; status: string; provider: string; providerSubscriptionId: string | null } | null;
  /** The organization's own word — club, society, outing. Defaults to "club". */
  noun?: string;
}

/** Whether a paid plan is still running through Stripe for this club. */
export function paidPlanRunning(sub: ClubDeletionInput["subscription"]): boolean {
  if (!sub) return false;
  return sub.provider === "stripe" && Boolean(sub.providerSubscriptionId) && sub.plan !== "free" && STILL_BILLING.has(sub.status);
}

/** Why this deletion cannot happen, or null when it may. */
export function clubDeletionRefusal(input: ClubDeletionInput): string | null {
  const noun = input.noun || "club";
  if (input.role !== "owner") return `Only the ${noun}'s owner can delete it.`;
  if (paidPlanRunning(input.subscription)) {
    return `This ${noun} has a paid plan running. Cancel it in Manage billing first; once the plan has ended, the ${noun} can be deleted.`;
  }
  if (input.typedName.trim() !== input.clubName.trim() || !input.clubName.trim()) {
    return `Type the ${noun}'s name exactly as it appears to confirm.`;
  }
  return null;
}
