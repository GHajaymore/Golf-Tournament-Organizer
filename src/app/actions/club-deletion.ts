"use server";
import { redirect } from "next/navigation";
import { createSession, getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { primaryOrganizationFor } from "@/lib/services/organization";
import { clubDeletionRefusal } from "@/lib/domain/club-deletion";
import { orgProfile } from "@/lib/domain/org-profile";
import { deleteClubAndEverything } from "@/lib/services/club-deletion";

/**
 * The owner deletes their club (2026-10-03). The rule and its reasons are in
 * `domain/club-deletion.ts`.
 *
 * WHICH club comes from the server — `primaryOrganizationFor`, the very
 * resolver the settings page shows its club through — never from the caller:
 * a "use server" export is a public endpoint, and an id in its arguments is an
 * id anybody can change. Were the two ever to disagree, the typed name would
 * not match and nothing would be deleted.
 *
 * The ROLE is read from this person's own membership of that club, not from
 * `canEdit`, which an admin also has.
 *
 * Afterwards the session is re-issued so no cookie still points at a
 * tournament that has gone, and they land where somebody with no club starts.
 */
export async function deleteClub(typedNameInput: unknown): Promise<{ ok: false; error: string }> {
  const typedName = typeof typedNameInput === "string" ? typedNameInput : "";
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const organizationId = await primaryOrganizationFor(session);
  if (!organizationId) return { ok: false, error: "There's no club here to delete." };

  const club = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      name: true,
      kind: true,
      country: true,
      communityNoun: true,
      members: { where: { userId: session.userId }, select: { role: true } },
      subscription: { select: { plan: true, status: true, provider: true, providerSubscriptionId: true } },
    },
  });
  if (!club) return { ok: false, error: "There's no club here to delete." };

  const refusal = clubDeletionRefusal({
    role: club.members[0]?.role ?? null,
    clubName: club.name,
    typedName,
    subscription: club.subscription,
    noun: orgProfile(club.kind, club.country, club.communityNoun).noun,
  });
  if (refusal) return { ok: false, error: refusal };

  await deleteClubAndEverything(organizationId);
  await createSession(session.userId);
  redirect("/choose");
}
