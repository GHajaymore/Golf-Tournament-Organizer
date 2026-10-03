import "server-only";
import { prisma } from "@/lib/db";

/**
 * The clubs this person is the ONLY owner of — the ones their leaving would
 * strand. Named, so the refusal can say which.
 */
export async function soleOwnedClubs(userId: string): Promise<string[]> {
  const owned = await prisma.organizationMember.findMany({
    where: { userId, role: "owner" },
    select: { organizationId: true, organization: { select: { name: true } } },
  });
  const names: string[] = [];
  for (const o of owned) {
    const others = await prisma.organizationMember.count({
      where: { organizationId: o.organizationId, role: "owner", userId: { not: userId } },
    });
    if (others === 0) names.push(o.organization.name || "your club");
  }
  return names;
}

/**
 * Delete a person's login and access, in one transaction (2026-10-03). What
 * goes and what stays, and why, is in `domain/account-deletion.ts`.
 *
 * The User row cascades to its staff memberships, join requests and reset
 * tokens. Four things are keyed by EMAIL, not by the user, so they do not
 * cascade and are deleted by address here — and per-tournament access is the
 * one that matters most: left behind, anybody who later registered the same
 * address would inherit it.
 */
export async function deleteAccountAndAccess(userId: string, email: string): Promise<void> {
  const byEmail = { email: { equals: email, mode: "insensitive" as const } };
  await prisma.$transaction([
    prisma.account.deleteMany({ where: byEmail }),
    prisma.pushSubscription.deleteMany({ where: byEmail }),
    prisma.threadRead.deleteMany({ where: byEmail }),
    prisma.threadParticipant.deleteMany({ where: byEmail }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
}
