import "server-only";
import { prisma } from "@/lib/db";

/**
 * Delete a club and everything it holds, in one transaction (2026-10-03).
 *
 * Almost everything goes by cascade from the Organization row: its members,
 * roster, subscription, invitations and every tournament — and from each
 * tournament, its entries, cards, rounds and money (the Par clean-up deletes
 * tournaments the same way, so that chain is exercised every day).
 *
 * TWO TABLES DO NOT CASCADE, because they record the club's id as a plain
 * column rather than a relation: `SmsDelivery` (the texts sent, with phone
 * numbers, names and message bodies) and `EmailFailure` (sends that failed,
 * with addresses). Left behind, "everything is deleted" would be false about
 * exactly the rows holding people's contact details — so they are deleted
 * first, explicitly, inside the same transaction. If the club itself cannot be
 * deleted, nothing is.
 *
 * Who may call this is decided by `clubDeletionRefusal`; this only deletes.
 */
export async function deleteClubAndEverything(organizationId: string): Promise<void> {
  await prisma.$transaction([
    prisma.smsDelivery.deleteMany({ where: { organizationId } }),
    prisma.emailFailure.deleteMany({ where: { organizationId } }),
    prisma.organization.delete({ where: { id: organizationId } }),
  ]);
}
