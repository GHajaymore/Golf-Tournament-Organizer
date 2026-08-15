"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { refusalFor } from "@/lib/services/limits";
import {
  isThemeKey, hexToHsl, isAppearance, FAIRWAY, SECONDARY_PRESETS, DEFAULT_APPEARANCE, pairVerdict, type Appearance,
} from "@/lib/themes";
import { checkLogoUrl } from "@/lib/services/logo-check";
import { organizationAccess } from "@/lib/services/org-access";
import { isBrandDisplay } from "@/lib/brand";

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
 * requires being an owner/admin of the ORGANIZATION — not merely an organizer
 * of one of its events. The rule itself lives in services/org-access.ts, which
 * explains at length why "not a member" was the wrong reading; this file and
 * settings.ts held identical copies of it and one of them was a club takeover.
 */
async function currentOrganization() {
  return organizationAccess(await getSession());
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
  /** Where the club is — prefills new courses and scopes a course search. */
  location: { city?: string; region?: string; country?: string } = {},
  /** How the name renders beside the logo. Checked against a closed list. */
  brandDisplay = "short",
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
    data: {
      name: cleanName,
      shortName: shortName.trim(),
      logoUrl: cleanLogo,
      city: (location.city ?? "").trim().slice(0, 80),
      region: (location.region ?? "").trim().slice(0, 80),
      country: (location.country ?? "").trim().slice(0, 80),
      brandDisplay: isBrandDisplay(brandDisplay) ? brandDisplay : "short",
    },
  });

  revalidatePath("/", "layout");
  return { ok: true, warning };
}

/**
 * Set the club's whole theme: both colours and light/dark appearance.
 *
 * Every field is checked separately and against a closed list. This is a
 * "use server" export, so the picker's own constraints mean nothing here —
 * whatever arrives is arbitrary caller input, and one of these values ends up
 * in a stylesheet.
 *
 * A club's own colour is allowed, but only its hue and saturation survive: the
 * ramp built from it fixes lightness, which is what keeps an open colour field
 * readable. The hex is stored, never emitted.
 */
export async function saveOrganizationTheme(
  themeKey: string,
  themeHex = "",
  secondaryKey = FAIRWAY.key,
  secondaryHex = "",
  appearance = DEFAULT_APPEARANCE as string,
): Promise<OrgResult> {
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

  if (secondaryKey === "custom") {
    if (!hexToHsl(secondaryHex)) {
      return { ok: false, error: "Enter a second colour like #1B4D3E, or pick one of the presets." };
    }
  } else if (!SECONDARY_PRESETS.some((p) => p.key === secondaryKey)) {
    return { ok: false, error: "Unknown second colour." };
  }

  if (!isAppearance(appearance)) return { ok: false, error: "Unknown appearance." };

  // The same rule the picker enforces, because the picker's gate means nothing
  // here: a second colour indistinguishable from the accent erases the
  // information it carries on every leaderboard.
  const pair = pairVerdict({
    accentKey: themeKey,
    accentHex: themeHex,
    secondaryKey,
    secondaryHex,
    appearance: appearance as Appearance,
  });
  if (pair.kind === "indistinct") return { ok: false, error: pair.message };

  await prisma.organization.update({
    where: { id: org.organizationId },
    data: {
      themeKey,
      themeHex: themeKey === "custom" ? themeHex.trim() : "",
      themeSecondaryKey: secondaryKey,
      themeSecondaryHex: secondaryKey === "custom" ? secondaryHex.trim() : "",
      themeAppearance: appearance,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
