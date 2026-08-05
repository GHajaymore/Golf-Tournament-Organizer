"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export interface OrgResult {
  ok: boolean;
  error?: string;
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

/** Only allow logos over https from a real host — a data: or javascript: URL
 *  here would be rendered into every page header. */
function logoUrlProblem(url: string): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Enter a full image URL, starting with https://";
  }
  if (parsed.protocol !== "https:") return "Logo URL must start with https://";
  return null;
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
  const logoProblem = logoUrlProblem(cleanLogo);
  if (logoProblem) return { ok: false, error: logoProblem };

  await prisma.organization.update({
    where: { id: org.organizationId },
    data: { name: cleanName, shortName: shortName.trim(), logoUrl: cleanLogo },
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
