import { prisma } from "@/lib/db";

/**
 * A PERSON ADDED AS STAFF HAS NOW BEEN BACK (2026-10-11).
 *
 * `OrganizationMember.invitedUnseenAt` is set when somebody else adds a person
 * to a club's staff, and while it is set the staff list shows the address that
 * was typed and "Invited — not opened yet" — not the account's name, and not
 * whether the account has ever signed in (`organizationAccessReport`). This is
 * what clears it.
 *
 * Called from the two ACTIONS in which a person demonstrably arrives: signing
 * in (every club they were added to while away), and opening a tournament
 * (that tournament's club — the case of somebody already signed in when they
 * were added, who will not sign in again for days). Never during a render: a
 * screen that writes when it is merely looked at is a screen a crawler changes.
 *
 * It only ever clears, so calling it twice, or for somebody who is not staff
 * anywhere, does nothing — and it never throws into the sign-in it rides on.
 */
export async function markStaffSeen(userId: string, organizationId?: string | null): Promise<void> {
  if (!userId) return;
  try {
    await prisma.organizationMember.updateMany({
      where: { userId, invitedUnseenAt: { not: null }, ...(organizationId ? { organizationId } : {}) },
      data: { invitedUnseenAt: null },
    });
  } catch (err) {
    // The person is signing in or opening their tournament; a list that goes on
    // saying "invited" for a while is a far smaller fault than refusing them.
    console.error("[staff-seen] could not clear the invited mark", err);
  }
}

/** The clubs this person is staff at, for the "leave" control on their account page. */
export async function staffClubsOf(userId: string): Promise<Array<{ organizationId: string; name: string; role: string; onlyOwner: boolean }>> {
  const rows = await prisma.organizationMember.findMany({
    where: { userId },
    select: { organizationId: true, role: true, organization: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const out = [];
  for (const r of rows) {
    const otherOwners =
      r.role === "owner"
        ? await prisma.organizationMember.count({ where: { organizationId: r.organizationId, role: "owner", userId: { not: userId } } })
        : 1;
    out.push({ organizationId: r.organizationId, name: r.organization.name || "your club", role: r.role, onlyOwner: otherOwners === 0 });
  }
  return out;
}
