import "server-only";
import { prisma } from "@/lib/db";
import { mayChangeMembership } from "@/lib/domain/membership-rule";

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
export async function deleteAccountAndAccess(userId: string, email: string): Promise<string[]> {
  const byEmail = { email: { equals: email, mode: "insensitive" as const } };
  try {
    return await prisma.$transaction(
      async (tx) => {
        // The membership rule, asked INSIDE this transaction: a club must keep a Commissioner.
        const blocked: string[] = [];
        const owned = await tx.organizationMember.findMany({
          where: { userId, role: "owner" },
          select: { organizationId: true, organization: { select: { name: true } } },
        });
        for (const o of owned) {
          const commissionerCount = await tx.organizationMember.count({ where: { organizationId: o.organizationId, role: "owner" } });
          const v = mayChangeMembership({ actorRole: "owner", targetCurrentRole: "owner", targetNewRole: null, commissionerCount });
          if (!v.ok) blocked.push(o.organization.name || "your club");
        }
        if (blocked.length) return blocked;
        await tx.account.deleteMany({ where: byEmail });
        await tx.pushSubscription.deleteMany({ where: byEmail });
        await tx.threadRead.deleteMany({ where: byEmail });
        await tx.threadParticipant.deleteMany({ where: byEmail });
        await tx.user.delete({ where: { id: userId } });
        return [];
      },
      { isolationLevel: "Serializable" },
    );
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "P2034") return ["a club whose people were changing at that moment — try again"];
    throw e;
  }
}
