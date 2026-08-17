import "server-only";
import { prisma } from "@/lib/db";
import {
  summariseEmailTrouble,
  TROUBLE_WINDOW_MS,
  type EmailTrouble,
  type EmailFailureRow,
  type EmailKind,
  type EmailFailureReason,
} from "@/lib/domain/email-trouble";

/**
 * Recent email failures for one club, as one line for the Access screen.
 *
 * Scoped to the organization, like everything else that reads rows: a club can
 * only ever be told about its own undelivered mail.
 */
export async function emailTroubleFor(organizationId: string): Promise<EmailTrouble | null> {
  const since = new Date(Date.now() - TROUBLE_WINDOW_MS);
  let rows: { kind: string; reason: string; createdAt: Date }[] = [];
  try {
    rows = await prisma.emailFailure.findMany({
      where: { organizationId, createdAt: { gte: since } },
      select: { kind: true, reason: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      // A registration day that overruns the allowance produces one row per
      // player. The banner only reports a count and a reason, so reading the
      // whole pile to say "137" rather than "100+" is not worth the query.
      take: 200,
    });
  } catch (e) {
    // Never let a bookkeeping table take down the Access screen — an organizer
    // locked out of staff management because a banner could not load is a far
    // worse outcome than a missing banner.
    console.error(`[email] Could not read send failures: ${e instanceof Error ? e.message : "unknown"}`);
    return null;
  }

  const parsed: EmailFailureRow[] = rows.map((r) => ({
    kind: r.kind as EmailKind,
    reason: r.reason as EmailFailureReason,
    createdAt: r.createdAt.getTime(),
  }));
  return summariseEmailTrouble(parsed, Date.now());
}
