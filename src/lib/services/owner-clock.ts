import "server-only";
import { prisma } from "../db";
import { clubClockInWords } from "../domain/club-clock";
import { DEFAULT_LOCALE } from "../domain/locale";

/**
 * A moment on the owner console, on the OWNER's clock: the first club they belong to that has said
 * where it is — or UTC, said so, when none has. The console is the platform's own view and has no
 * club of its own, so this is the nearest thing to "the club's clock" it can ask (2026-10-23).
 */
export async function ownerClockInWords(userId: string, at: Date): Promise<string> {
  const own = await prisma.organizationMember.findFirst({
    where: { userId, organization: { timeZone: { not: "" } } },
    orderBy: { createdAt: "asc" },
    select: { organization: { select: { timeZone: true } } },
  });
  const zone = own?.organization.timeZone ?? "";
  return `${clubClockInWords(zone || "UTC", DEFAULT_LOCALE, at)}${zone ? "" : " UTC"}`;
}
