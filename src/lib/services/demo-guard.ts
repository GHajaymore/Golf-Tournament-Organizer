import "server-only";
import { prisma } from "@/lib/db";
import { isDemoAddress } from "@/lib/domain/demo-club";

/**
 * IS THIS THE DEMO CLUB? (2026-10-24; docs/claude/demo-club.md) — the questions
 * the places that leave the demo out ask. Kept apart from `demo-club.ts`, which
 * writes, so a sender can ask without importing a writer of scorecards.
 */

/** Whether a club is the demo. A database fault answers "no": the caller then treats it as a real club. */
export async function isDemoOrganization(organizationId: string | null | undefined): Promise<boolean> {
  if (!organizationId) return false;
  try {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { isDemo: true } });
    return org?.isDemo === true;
  } catch {
    return false;
  }
}

/** Whether a tournament is the demo club's. A fault answers "no", as above. */
export async function isDemoEvent(eventId: string | null | undefined): Promise<boolean> {
  if (!eventId) return false;
  try {
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { organization: { select: { isDemo: true } } } });
    return event?.organization.isDemo === true;
  } catch {
    return false;
  }
}

/**
 * WHETHER A MESSAGE MUST NOT GO — the one question every sender asks before it
 * sends (email, text, push). Yes for any address on the demo's domain, and yes
 * for anything sent on the demo club's behalf: "the demo must never message
 * anyone" is kept where the message leaves, not by remembering it upstream.
 */
export async function demoRefusesMessage(input: {
  to?: readonly (string | null | undefined)[];
  organizationId?: string | null;
  eventId?: string | null;
}): Promise<boolean> {
  if ((input.to ?? []).some((a) => isDemoAddress(a))) return true;
  if (await isDemoOrganization(input.organizationId)) return true;
  return isDemoEvent(input.eventId);
}
