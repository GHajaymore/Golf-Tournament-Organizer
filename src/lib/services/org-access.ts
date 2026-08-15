import "server-only";
import { prisma } from "@/lib/db";
import type { Session } from "@/lib/auth";

/**
 * Who may administer a CLUB, as opposed to one of its tournaments.
 *
 * S1 of the 2026-08-12 audit, and the most dangerous thing it found. Both
 * callers carried their own copy of this:
 *
 *   canEdit: membership?.role === "owner" || membership?.role === "admin" ||
 *            (session.role === "admin" && !membership)
 *
 * The last clause exists so a legitimate owner whose membership row predates
 * organization membership isn't locked out of their own tenant. But
 * `addAccount` creates an `Account` row and never an `OrganizationMember`, so
 * a guest organizer granted admin on ONE event had `session.role === "admin"`
 * with no membership — and therefore rights over the entire organization.
 * `addOrganizationMember(self, "owner")` followed by
 * `removeOrganizationMember(realOwner)` takes the club: every event, the
 * roster, the branding.
 *
 * `roles.audit.test.ts` asserts one club's rights don't leak SIDEWAYS into
 * another, and the structural IDOR sweep finds no unscoped id here because
 * there isn't one — the id is right and the role is wrong. Nothing asserted
 * that a per-event admin's rights don't leak UPWARD.
 *
 * The rule now: an explicit membership, or an organization with no members at
 * all. The escape hatch keeps a genuinely ownerless tenant administrable —
 * nobody can be locked out of a club nobody owns — while closing the attack,
 * which needs a club that HAS an owner to take it from. `scripts/backfill-org-
 * owners.ts` converts those ownerless organizations into owned ones; the hatch
 * is what makes deploying this safe before that has been run everywhere.
 *
 * One function, one place, because the two copies were identical and would not
 * have stayed that way.
 */

export interface OrganizationAccess {
  organizationId: string;
  canEdit: boolean;
  /** Why, for the message and for the tests. */
  reason: "member" | "ownerless" | "denied";
}

/** The pure half: given the membership and whether anyone owns the club. */
export function canAdministerOrganization(input: {
  /** The caller's OrganizationMember role in this club, or null. */
  membershipRole: string | null;
  /** The caller's role in the tournament they are currently managing. */
  sessionRole: string;
  /** Whether this organization has ANY members. */
  hasMembers: boolean;
}): OrganizationAccess["reason"] {
  if (input.membershipRole === "owner" || input.membershipRole === "admin") return "member";
  // Deliberately not `!membership`: that reads "I am not a member of this
  // club", which is true of an attacker. This reads "this club has nobody",
  // which cannot be true of a club being taken from someone.
  if (!input.hasMembers && input.sessionRole === "admin") return "ownerless";
  return "denied";
}

/**
 * The organization that owns the tournament being managed, and whether this
 * person may change it.
 */
export async function organizationAccess(session: Session | null): Promise<OrganizationAccess | null> {
  if (!session?.eventId) return null;

  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
    select: { organizationId: true },
  });
  if (!event) return null;

  const user = await prisma.user.findUnique({ where: { email: session.email } });
  const membership = user
    ? await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: event.organizationId, userId: user.id } },
      })
    : null;

  // Counted rather than fetched: the question is whether anybody at all holds
  // this club, not who.
  const memberCount = await prisma.organizationMember.count({
    where: { organizationId: event.organizationId },
  });

  const reason = canAdministerOrganization({
    membershipRole: membership?.role ?? null,
    sessionRole: session.role,
    hasMembers: memberCount > 0,
  });

  return { organizationId: event.organizationId, canEdit: reason !== "denied", reason };
}
