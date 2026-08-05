import "server-only";
import { prisma } from "../db";
import { DEFAULT_PLAN } from "../plans";

/**
 * Resolve the organization a new tournament should belong to for this person,
 * creating their personal one on first use.
 *
 * Everyone gets an organization — an individual organizer's is `personal` —
 * so there is never an event without a billing tenant, and no code path needs
 * to handle that case.
 *
 * Preference order:
 *   1. an organization they already own or administer (their club, if any)
 *   2. their personal organization
 *   3. a newly created personal organization
 */
export async function organizationForNewEvent(email: string, displayName: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: user.id, role: { in: ["owner", "admin"] } },
      include: { organization: true },
      // Prefer a real club over the personal fallback, then oldest first so
      // the choice is stable rather than shifting as rows are added.
      orderBy: [{ organization: { kind: "asc" } }, { createdAt: "asc" }],
    });
    if (membership) return membership.organizationId;
  }

  const org = await prisma.organization.create({
    data: {
      name: displayName.trim() || email,
      kind: "personal",
      subscription: { create: { plan: DEFAULT_PLAN, status: "active" } },
      ...(user ? { members: { create: { userId: user.id, role: "owner" } } } : {}),
    },
  });
  return org.id;
}

export interface EventBrand {
  name: string;
  logoUrl: string;
}

/**
 * Branding for whichever organization owns this event, for the console header
 * and anything printed or sent to players.
 *
 * Returns null when the club hasn't set a name/logo, so callers fall back to
 * TourneyHQ's own mark rather than rendering an empty header.
 */
export async function brandForEvent(eventId: string): Promise<EventBrand | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organization: { select: { name: true, shortName: true, logoUrl: true } } },
  });
  const org = event?.organization;
  if (!org) return null;
  const name = org.shortName || org.name;
  if (!name && !org.logoUrl) return null;
  return { name, logoUrl: org.logoUrl };
}

/** The organizations a person owns, administers, or is staff in. */
export async function organizationsFor(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return [];
  return prisma.organizationMember.findMany({
    where: { userId: user.id },
    include: { organization: { include: { subscription: true, _count: { select: { events: true } } } } },
    orderBy: { createdAt: "asc" },
  });
}
