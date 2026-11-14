import { NextResponse } from "next/server";
import { bearerMatches, backupMayRunHere } from "@/lib/backup/bearer";
import { runBackup, reportBackup } from "@/lib/backup/run";

/**
 * THE NIGHTLY BACKUP OF PRODUCTION (B21; docs/operations/backups.md).
 *
 * Called by Vercel Cron at 02:00 UTC (`vercel.json`), an hour before
 * `expire-rounds` deletes anything, so the night's deletes always have a copy
 * from just before them. It READS every table in one snapshot, seals the copy
 * to the owner's public key and files it in private Vercel Blob.
 *
 * AUTHORIZATION IS A HARD REFUSAL, as on every cron route: `Authorization:
 * Bearer $CRON_SECRET`, compared in constant time, and 401 when it does not
 * match — including when the secret is MISSING. Reading the whole database on
 * demand is not a door to leave open because a variable was forgotten. And it
 * runs only on PRODUCTION's deployment (`backupMayRunHere`): a preview holds
 * production's database string too.
 *
 * The answer, which reaches Vercel's logs, is counts. A failure is reported to
 * Sentry tagged `backup` and answers 500 with nothing else.
 */

export const dynamic = "force-dynamic";
// Vercel Hobby's ceiling. The export stops itself at 240 s (run.ts) to leave time to file it.
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  if (!backupMayRunHere()) return NextResponse.json({ ok: false }, { status: 403, headers: NO_STORE });
  try {
    const outcome = await runBackup("daily", new Date());
    return NextResponse.json({ ok: true, ...outcome }, { headers: NO_STORE });
  } catch (error) {
    await reportBackup("error", error, "daily");
    return NextResponse.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
