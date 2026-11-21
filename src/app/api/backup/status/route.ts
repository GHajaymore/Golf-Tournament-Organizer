import { NextResponse } from "next/server";
import { bearerMatches, backupMayRunHere, TRIGGER_SECRET_MIN_LENGTH } from "@/lib/backup/bearer";
import { backupStore, lastBackupAt, FRESH_FOR_MS } from "@/lib/backup/run";

/**
 * IS THERE A RECENT BACKUP? Asked every hour by the production canary
 * (`canary.yml`), because a cron that is never invoked raises nothing: the
 * failure Sentry cannot see is the backup that did not run at all.
 *
 * It answers `{ fresh: true | false }` and nothing else — no age, no size, no
 * name. Fresh means the newest copy was filed in the last 30 hours (a daily
 * copy, plus the cron's hour of slack, plus some). Not fresh, or a store that
 * cannot be asked, is `false`; the canary fails on it and the failure email is
 * the alert. One Blob "head" per call, a simple operation (10,000 a month free).
 *
 * Bearer `BACKUP_TRIGGER_SECRET`, constant-time, 401 otherwise; production's
 * deployment only.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.BACKUP_TRIGGER_SECRET, TRIGGER_SECRET_MIN_LENGTH)) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  if (!backupMayRunHere()) return NextResponse.json({ ok: false }, { status: 403, headers: NO_STORE });
  let fresh = false;
  try {
    const last = await lastBackupAt(backupStore());
    fresh = !!last && Date.now() - last.getTime() < FRESH_FOR_MS;
  } catch {
    fresh = false;
  }
  return NextResponse.json({ fresh }, { headers: NO_STORE });
}
