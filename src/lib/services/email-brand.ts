import "server-only";
import { prisma } from "@/lib/db";
import { brandLines, isBrandDisplay } from "@/lib/brand";
import { logoSrc } from "@/lib/domain/logo-upload";
import { planFor } from "@/lib/plans";
import type { EmailBrand } from "@/lib/domain/email-layout";

/**
 * A club's brand, for the head of an email it causes to be sent (2026-10-03).
 *
 * The same three facts the console header reads through `brandForEvent` — the
 * name the club chose to be shown by, its logo, and whether its plan is
 * white-label — with one difference that matters only here: the logo address
 * is made ABSOLUTE. A screen can say `/api/logo/<id>`; an inbox has no idea
 * which site that path belongs to.
 *
 * Never throws: an email that cannot find its club's brand is still worth
 * sending with TourneyHQ's alone.
 */
export async function emailBrandFor(organizationId: string | null | undefined, base: string): Promise<EmailBrand | undefined> {
  if (!organizationId) return undefined;
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, shortName: true, brandDisplay: true, logoUrl: true, subscription: { select: { plan: true } } },
    });
    if (!org) return undefined;
    const lines = brandLines(org.name, org.shortName, isBrandDisplay(org.brandDisplay) ? org.brandDisplay : "short");
    const src = logoSrc(org.id, org.logoUrl);
    const absolute = !src ? "" : /^https?:\/\//i.test(src) ? src : src.startsWith("/") ? `${base}${src}` : "";
    return {
      clubName: lines.primary || org.name,
      clubLogoUrl: absolute,
      whiteLabel: planFor(org.subscription?.plan).features.whiteLabel,
    };
  } catch (err) {
    console.error("[email] could not read the club's brand:", err instanceof Error ? err.message : err);
    return undefined;
  }
}
