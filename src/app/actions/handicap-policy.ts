"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { organizationAccess } from "@/lib/services/org-access";
import { isHandicapPolicy } from "@/lib/domain/handicap-policy";
import { handicapAuthority, scoreReporter } from "@/lib/integrations/registry";
import { clubHandicapBody } from "@/lib/domain/handicap-body";

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
    return { ok: false, error: "Only a Commissioner or Admin can change this." };
  }
  return { ok: true, organizationId: access.organizationId };
}

/** Switch the club between its own record and an association's figures. */
export async function saveHandicapPolicy(policy: string): Promise<PolicyResult> {
  const club = await requireClub();
  if (!club.ok) return { ok: false, error: club.error };

  if (!isHandicapPolicy(policy)) {
    return { ok: false, error: "Choose either the club's own record or an association." };
  }

  /**
   * THE BODY IS THE CLUB'S COUNTRY'S, worked out here — never taken from the
   * caller (Ajay, 2026-10-17: "make it geographical vs US enforced"). A public
   * endpoint handed "ghin" by a club in England would otherwise put it on the
   * USGA's books. `clubHandicapBody` is the one answer; every screen reads it.
   *
   * Stored with "where a member has one" as surely as with "only" — until
   * 2026-10-17 only the latter stored a body at all.
   */
  const usesBody = policy !== "club";
  const org = await prisma.organization.findUnique({ where: { id: club.organizationId }, select: { country: true } });
  const body = clubHandicapBody(org ?? {});
  if (usesBody && !handicapAuthority(body.id)) {
    return { ok: false, error: "That handicapping association isn't available." };
  }

  await prisma.organization.update({
    where: { id: club.organizationId },
    data: {
      handicapPolicy: policy,
      ...(usesBody ? { handicapAuthorityId: body.id } : {}),
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
