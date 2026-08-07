"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { refusalFor } from "@/lib/services/limits";
import { isThemeKey, hexToHsl } from "@/lib/themes";
import { checkLogoUrl } from "@/lib/services/logo-check";

export interface OrgResult {
  ok: boolean;
  error?: string;
  /** Saved, but something about it is worth telling the organizer — currently
   *  only used when a logo URL couldn't be reached from our server. */
  warning?: string;
}

/**
 * The organization that owns the tournament currently being managed, plus
 * whether this person may change its settings.
 *
 * Organization settings sit above a single tournament, so editing them
 * requires being an owner/admin of the organization — not merely an organizer
 * of one of its events.
 */
async function currentOrganization() {
  const session = await getSession();
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

  return {
    organizationId: event.organizationId,
    canEdit:
      membership?.role === "owner" ||
      membership?.role === "admin" ||
      // An organizer of the event who predates organization membership (or
      // whose personal org was created by the backfill) can still administer
      // their own tenant — otherwise they'd be locked out of their own club.
      (session.role === "admin" && !membership),
  };
}

const ORG_ROLES = ["owner", "admin", "member"] as const;
const cleanOrgRole = (r: string) => (ORG_ROLES.includes(r as (typeof ORG_ROLES)[number]) ? r : "member");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True once the organization has an owner other than this member — the same
 *  guard the per-event access screen uses, applied one level up. Losing the
 *  last owner would strand the tenant and its billing. */
async function hasOtherOwner(organizationId: string, memberId: string): Promise<boolean> {
  return (
    (await prisma.organizationMember.count({
      where: { organizationId, role: "owner", id: { not: memberId } },
    })) > 0
  );
}

/**
 * Add someone to the organization's staff.
 *
 * Staff only — players are never organization members, so a club's seat count
 * can't grow with the size of its fields. A User row is created if this email
 * has never signed in; they claim it with a password on first login.
 */
export async function addOrganizationMember(email: string, name: string, role: string): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can manage staff." };

  const refusal = await refusalFor(org.organizationId, "staffSeats");
  if (refusal) return { ok: false, error: refusal };

  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) return { ok: false, error: "Enter a valid email address." };

  const user = await prisma.user.upsert({
    where: { email: cleanEmail },
    update: name.trim() ? { name: name.trim() } : {},
    create: { email: cleanEmail, name: name.trim() },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.organizationId, userId: user.id } },
    update: { role: cleanOrgRole(role) },
    create: { organizationId: org.organizationId, userId: user.id, role: cleanOrgRole(role) },
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setOrganizationMemberRole(memberId: string, role: string): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can manage staff." };

  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: org.organizationId },
  });
  if (!member) return { ok: false, error: "Staff member not found." };

  const next = cleanOrgRole(role);
  if (member.role === "owner" && next !== "owner" && !(await hasOtherOwner(org.organizationId, memberId))) {
    return { ok: false, error: "This is the only owner — make someone else an owner first." };
  }

  await prisma.organizationMember.update({ where: { id: memberId }, data: { role: next } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeOrganizationMember(memberId: string): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can manage staff." };

  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: org.organizationId },
  });
  if (!member) return { ok: false, error: "Staff member not found." };

  if (member.role === "owner" && !(await hasOtherOwner(org.organizationId, memberId))) {
    return { ok: false, error: "This is the only owner — make someone else an owner before removing them." };
  }

  await prisma.organizationMember.delete({ where: { id: memberId } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveOrganizationBranding(
  name: string,
  shortName: string,
  logoUrl: string,
): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can change these settings." };

  const cleanName = name.trim();
  if (!cleanName) return { ok: false, error: "Enter an organization name." };

  const cleanLogo = logoUrl.trim();

  // Only hit the network when the URL actually changed — renaming the club
  // shouldn't cost an outbound request.
  let warning: string | undefined;
  const current = await prisma.organization.findUnique({
    where: { id: org.organizationId },
    select: { logoUrl: true },
  });
  if (cleanLogo !== current?.logoUrl) {
    const check = await checkLogoUrl(cleanLogo);
    if (!check.ok) return { ok: false, error: check.error };
    warning = check.warning;
  }

  await prisma.organization.update({
    where: { id: org.organizationId },
    data: { name: cleanName, shortName: shortName.trim(), logoUrl: cleanLogo },
  });

  revalidatePath("/", "layout");
  return { ok: true, warning };
}

/**
 * Set the club's accent colour.
 *
 * Takes a preset key, never a colour. A raw hex would let a club pick
 * something the app cannot stay readable against; the presets are
 * contrast-checked, so whichever is chosen the text survives.
 */
export async function saveOrganizationTheme(themeKey: string, themeHex = ""): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can change branding." };

  // "custom" is a legitimate key that isn't in the preset list, so it is
  // checked separately rather than widening isThemeKey and letting an unknown
  // preset name through.
  if (themeKey === "custom") {
    if (!hexToHsl(themeHex)) {
      return { ok: false, error: "Enter a colour like #1B4D3E, or pick one of the presets." };
    }
  } else if (!isThemeKey(themeKey)) {
    return { ok: false, error: "Unknown theme." };
  }

  await prisma.organization.update({
    where: { id: org.organizationId },
    data: { themeKey, themeHex: themeKey === "custom" ? themeHex.trim() : "" },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
