import "server-only";
import { prisma } from "../db";
import { wipesOnClose } from "../domain/close-terms";

/**
 * Whether completing this tournament deletes it: the club's terms, plan and
 * any hold, read in one place for both the button that warns and the action
 * that deletes. See `wipesOnClose` for the rule.
 */
export async function wipesOnCloseFor(eventId: string): Promise<boolean> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      shape: true,
      retainUntil: true,
      organization: { select: { subscription: { select: { plan: true, planTermsApply: true } } } },
    },
  });
  if (!event) return false;
  const sub = event.organization.subscription;
  return wipesOnClose({
    planTermsApply: sub?.planTermsApply,
    plan: sub?.plan,
    shape: event.shape,
    retainUntil: event.retainUntil,
  });
}
