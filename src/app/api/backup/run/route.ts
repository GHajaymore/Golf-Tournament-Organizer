import { NextResponse } from "next/server";
import { bearerMatches, backupMayRunHere, TRIGGER_SECRET_MIN_LENGTH } from "@/lib/backup/bearer";
import { runBackup, reportBackup, backupStore, lastBackupAt, TRIGGER_MIN_GAP_MS } from "@/lib/backup/run";
import { aTournamentIsOnToday } from "@/lib/services/deploy-window";

/**
 * AN EXTRA BACKUP ON AN EVENT DAY (B21; docs/operations/backups.md).
 *
 * Vercel Hobby runs a cron once a day. On a day a real club is playing, a
 * GitHub workflow (`backup-event-day.yml`) presses this every hour, so a lost
 * database costs at most an hour of a field's cards rather than a day.
 *
 * The caller holds `BACKUP_TRIGGER_SECRET` — a trigger, NOT a database
 * credential. The GitHub runner never holds production's database string; the
 * read happens here, inside Vercel. Bearer, constant-time, 401 when it does
 * not match or the secret is missing or short; production's deployment only.
 *
 * It takes a copy only when:
 *   - a real club has a tournament on today by its own clock (the deploy
 *     window's `onToday`), else `{ ran: false }` and nothing else is asked;
 *   - and the newest copy is at least 30 minutes old, else 429: a leaked
 *     trigger cannot run the database's operations or the store's up.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.BACKUP_TRIGGER_SECRET, TRIGGER_SECRET_MIN_LENGTH)) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  if (!backupMayRunHere()) return NextResponse.json({ ok: false }, { status: 403, headers: NO_STORE });
  const now = new Date();
  try {
    if (!(await aTournamentIsOnToday(now))) {
      return NextResponse.json({ ok: true, ran: false, why: "no tournament on today" }, { headers: NO_STORE });
    }
    const last = await lastBackupAt(backupStore());
    if (last && now.getTime() - last.getTime() < TRIGGER_MIN_GAP_MS) {
      return NextResponse.json({ ok: true, ran: false, why: "a copy was taken under 30 minutes ago" }, { status: 429, headers: NO_STORE });
    }
    const outcome = await runBackup("event-day", now);
    return NextResponse.json({ ok: true, ran: true, ...outcome }, { headers: NO_STORE });
  } catch (error) {
    await reportBackup("error", error, "event-day");
    return NextResponse.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
