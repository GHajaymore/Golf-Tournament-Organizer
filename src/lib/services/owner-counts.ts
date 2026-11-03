import "server-only";
import { prisma } from "@/lib/db";
import { DEMO_EMAIL_DOMAIN } from "@/lib/domain/demo-club";

/**
 * THE OWNER CONSOLE'S FIGURES, ABOUT REAL CLUBS ONLY (2026-10-24).
 *
 * Every count and listing on /owner, read here so that one rule covers all of
 * them: the demo club (`Organization.isDemo`) is not a customer, so it is in no
 * total, no tier mix, no "newest organizations" and no "live right now" — a
 * club that is "live" every day of the year would otherwise be the first line
 * of that list for ever. Read-only.
 */

/** A real club, as every query below asks for it. */
const REAL_CLUB = { isDemo: false } as const;

export async function ownerCounts() {
  const [totalOrgs, orgsByPlan, orgsByKind, eventsByStatus, totalPlayers, orgsWithNoEvents, recentOrgs, liveEvents] = await Promise.all([
    prisma.organization.count({ where: REAL_CLUB }),
    prisma.subscription.groupBy({ by: ["plan"], where: { organization: REAL_CLUB }, _count: { _all: true } }),
    prisma.organization.groupBy({ by: ["kind"], where: REAL_CLUB, _count: { _all: true } }),
    prisma.event.groupBy({ by: ["status"], where: { organization: REAL_CLUB }, _count: { _all: true } }),
    prisma.player.count({ where: { event: { organization: REAL_CLUB } } }),
    prisma.organization.count({ where: { ...REAL_CLUB, events: { none: {} } } }),
    prisma.organization.findMany({
      where: REAL_CLUB,
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        name: true,
        kind: true,
        createdAt: true,
        subscription: { select: { plan: true } },
        _count: { select: { events: true } },
      },
    }),
    prisma.event.findMany({
      where: { status: "live", organization: REAL_CLUB },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, name: true, organization: { select: { name: true } } },
    }),
  ]);
  return { totalOrgs, orgsByPlan, orgsByKind, eventsByStatus, totalPlayers, orgsWithNoEvents, recentOrgs, liveEvents };
}

/**
 * The people who registered interest, newest first — never a row the demo
 * made. The demo writes none (`services/demo-club.ts`), and an address on its
 * domain is left out besides, so a demo row could not be counted as somebody
 * waiting for a launch email.
 */
export async function interestShown(limit: number) {
  return prisma.interestRequest.findMany({
    where: { NOT: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}`, mode: "insensitive" } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
