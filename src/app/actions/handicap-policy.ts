"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { organizationAccess } from "@/lib/services/org-access";
import { isHandicapPolicy } from "@/lib/domain/handicap-policy";
import { handicapAuthority, scoreReporter } from "@/lib/integrations/registry";

/**
 * A club deciding where its handicaps come from, and whether rounds go back.
 *
 * Two settings and two permissions, kept apart on purpose. Reading indexes and
 * writing scores to a golfer's official record are different entitlements, and
 * a club routinely has the first without the second.
 *
 * Owner-or-admin only, the same rule as every other house default: this
 * changes how every competition at the club is handicapped, which is not a
 * decision for a guest organizer running one society day.
 */

export interface PolicyResult {
  ok: boolean;
  error?: string;
}

async function requireClub(): Promise<
  { ok: true; organizationId: string } | { ok: false; error: string }
> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };
  const access = await organizationAccess(session);
  if (!access) return { ok: false, error: "No organization found." };
  if (!access.canEdit) {
    return { ok: false, error: "Only an organization owner or admin can change this." };
  }
  return { ok: true, organizationId: access.organizationId };
}

/** Switch the club between its own record and an association's figures. */
export async function saveHandicapPolicy(
  policy: string,
  authorityId: string,
): Promise<PolicyResult> {
  const club = await requireClub();
  if (!club.ok) return { ok: false, error: club.error };

  if (!isHandicapPolicy(policy)) {
    return { ok: false, error: "Choose either the club's own record or an association." };
  }

  /**
   * The authority has to be one this app actually has.
   *
   * Storing an unknown id would leave the club on a policy with no provider —
   * `integrationSetup` reports that as unconfigured rather than falling back
   * to another association, which is right, but it is a state better refused
   * here than explained later.
   */
  if (policy === "ghin" && !handicapAuthority(authorityId)) {
    return { ok: false, error: "That handicapping association isn't available." };
  }

  await prisma.organization.update({
    where: { id: club.organizationId },
    data: {
      handicapPolicy: policy,
      ...(policy === "ghin" ? { handicapAuthorityId: authorityId.trim().toLowerCase() } : {}),
    },
  });

  /**
   * Not written to AuditLog, and that is a gap rather than a decision.
   *
   * `AuditLog.eventId` is required and cascades from an Event, so a
   * club-wide change has no honest event to attach to — pinning it to
   * whichever tournament happened to be open would attribute a policy change
   * to one competition and delete the record with it. Turning score posting on
   * is a permission with real-world effects and deserves a trail, so this
   * wants an organization-scoped audit table. Recorded here rather than
   * quietly skipped.
   */

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Turn posting rounds back to the association on or off.
 *
 * Off is the default and turning it on is a deliberate act, because a posted
 * score changes a real person's handicap index at every club they play and
 * there is no undo this app controls. Nothing is posted merely because
 * credentials exist — see domain/score-posting.ts.
 */
export async function saveScoreReporting(
  enabled: boolean,
  reporterId: string,
): Promise<PolicyResult> {
  const club = await requireClub();
  if (!club.ok) return { ok: false, error: club.error };

  if (enabled && !scoreReporter(reporterId)) {
    return { ok: false, error: "That association isn't available for score posting." };
  }

  await prisma.organization.update({
    where: { id: club.organizationId },
    data: {
      scoreReportingEnabled: enabled,
      ...(enabled ? { scoreReporterId: reporterId.trim().toLowerCase() } : {}),
    },
  });

  /**
   * Not written to AuditLog, and that is a gap rather than a decision.
   *
   * `AuditLog.eventId` is required and cascades from an Event, so a
   * club-wide change has no honest event to attach to — pinning it to
   * whichever tournament happened to be open would attribute a policy change
   * to one competition and delete the record with it. Turning score posting on
   * is a permission with real-world effects and deserves a trail, so this
   * wants an organization-scoped audit table. Recorded here rather than
   * quietly skipped.
   */

  revalidatePath("/", "layout");
  return { ok: true };
}
