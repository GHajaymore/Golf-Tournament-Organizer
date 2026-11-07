import "server-only";
import { prisma } from "../db";
import { clubDayInWords } from "../domain/club-clock";
import { namesakeNoticeWords } from "../domain/org-name-match";
import { orgProfile } from "../domain/org-profile";

/**
 * THE CLUB THAT WAS HERE FIRST IS TOLD (Ajay, 7 Nov 2026).
 *
 * Club names are not unique by design. The second club's founder is asked ("is it yours?") and may
 * carry on; until now the FIRST club never heard. `noteNamesake` (in `organization.ts`, beside the match it uses) is called at the moment a club
 * actually TAKES a name (naming a club at its first tournament, a new club made with a name, a rename
 * in club settings) and keeps one notice for the existing club, shown to its Commissioner on Staff &
 * access. No email and no push: in the app only.
 *
 * THE MATCH IS NOT RE-WRITTEN HERE. It is `otherOrganizationNamed` (same normaliser, same area rule,
 * never a `personal` tenant, never the demo club), asked with the new club's own town. `noteNamesake` writes the row; this file reads it back for the screen.
 */

export interface OpenNamesakeNotice {
  id: string;
  /** The sentence, already worded for this club. */
  words: string;
}

/** The notices waiting on this club, oldest first. */
export async function openNamesakeNotices(organizationId: string): Promise<OpenNamesakeNotice[]> {
  const reader = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timeZone: true, locale: true } });
  const rows = await prisma.namesakeNotice.findMany({
    where: { organizationId, status: "open" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, town: true, byName: true, createdAt: true,
      newOrganization: { select: { kind: true, country: true, communityNoun: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    words: namesakeNoticeWords({
      name: r.name,
      label: orgProfile(r.newOrganization.kind, r.newOrganization.country, r.newOrganization.communityNoun).label,
      where: r.town,
      byName: r.byName,
      day: clubDayInWords(reader?.timeZone, reader?.locale, r.createdAt),
    }),
  }));
}
