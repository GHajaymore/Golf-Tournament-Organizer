import "server-only";
import { prisma } from "../db";
import { changeKind, FIELD_ACTIONS, type ChangeKind } from "../domain/change-kind";

/**
 * THE AUDIT LOG, READ BACK (Ajay, 2026-09-27).
 *
 * Every money change, every result confirmed, every round closed and cut made,
 * every member who withdraws themselves writes an `AuditLog` line — and until
 * this nothing in the app showed one. So the record existed and nobody could
 * see it: a member withdrawing took the field from 19 to 18 with nothing saying
 * who or when.
 *
 * PLAYER IDS ARE TURNED BACK INTO NAMES. Some writers put a player's id in the
 * sentence ("paid by cmsm…", "settlement (cm… → cm…)") because that is what
 * they had in hand. Printed as stored, the screen would show gibberish; so any
 * id belonging to a player in THIS tournament — withdrawn ones too, since a
 * withdrawal is exactly what gets read back — is replaced by their name, and
 * one whose row has gone reads "someone no longer in the field".
 */

export interface RecentChange {
  id: string;
  /** ISO timestamp, formatted where it is shown — see `ChangeTime`. */
  at: string;
  actor: string;
  kind: ChangeKind;
  what: string;
}

export async function recentChanges(
  eventId: string,
  opts: { only?: "field"; take?: number } = {},
): Promise<RecentChange[]> {
  const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
  const [rows, players] = await Promise.all([
    prisma.auditLog.findMany({
      where: { eventId, ...(opts.only === "field" ? { action: { in: [...FIELD_ACTIONS] } } : {}) },
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, createdAt: true, actor: true, action: true, detail: true },
    }),
    prisma.player.findMany({ where: { eventId }, select: { id: true, name: true } }),
  ]);
  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    actor: r.actor,
    kind: changeKind(r.action),
    what: namesForIds(r.detail, nameOf),
  }));
}

/**
 * Replace every player id in a sentence with that player's name. Ids are cuids —
 * a lower-case letter followed by alphanumerics, 20+ characters — so the scan
 * looks for that shape.
 *
 * AN ID THAT NAMES NOBODY ANY MORE is somebody who has left the field: a player
 * with no history is DELETED when they withdraw, so the expense line that named
 * them outlives their row. Printed raw it is gibberish; it reads "someone no
 * longer in the field", the words the settle-up already uses for the same
 * person (`MoneyClient`). The ids these lines carry are players' — who paid,
 * who settled — which is why that is the honest reading.
 */
export function namesForIds(detail: string, nameOf: ReadonlyMap<string, string>): string {
  return detail.replace(/\bc[a-z0-9]{20,}\b/g, (id) => nameOf.get(id) ?? "someone no longer in the field");
}
