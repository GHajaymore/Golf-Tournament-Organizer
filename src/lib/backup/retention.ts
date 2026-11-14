/**
 * WHERE A BACKUP IS FILED, AND HOW LONG IT IS KEPT (B21).
 *
 * Names are instants in UTC — a storage key, not a club's day, so no club's
 * clock is asked: `backups/2026-11-14/020004-daily.thqbak`, beside its
 * `…-daily.manifest.json`. `backups/latest.json` is the newest manifest again,
 * overwritten each time; the status check reads only its upload time.
 *
 * KEPT, at most 35 days:
 *   - every copy from the last 48 hours (an event day's hourly copies);
 *   - the newest copy of each of the last 14 days;
 *   - the newest copy of each Sunday in the last 35 days;
 *   - and always the newest copy of all, whatever the clock says.
 * Everything else under `backups/` that is named like a backup is deleted.
 * Anything not named like one — `latest.json`, a file somebody put there by
 * hand — is never touched.
 *
 * AND THE STORE'S SIZE. Vercel Blob on Hobby holds 1 GB and BLOCKS the store
 * for 30 days when it goes over. So when what would be kept is over the budget,
 * the oldest kept copies go too — never the newest two — and the run says so
 * (`shortened`), which reaches Sentry: the moment one copy is past ~25 MB, the
 * 35 days cannot all fit, and somebody must choose (a paid plan, or a weekly
 * catalogue copy; docs/operations/backups.md).
 */

export const BACKUP_PREFIX = "backups/";
export const LATEST = "backups/latest.json";
export type BackupKind = "daily" | "event-day";

const DAY_MS = 24 * 60 * 60 * 1000;
export const KEEP_ALL_MS = 2 * DAY_MS;
export const KEEP_DAILY_DAYS = 14;
export const KEEP_SUNDAYS_DAYS = 35;
/** Of Blob's 1 GB on Hobby, what the backups may take; the rest is headroom for one more copy. */
export const STORE_BUDGET_BYTES = 850 * 1024 * 1024;

export function backupPaths(at: Date, kind: BackupKind): { data: string; manifest: string } {
  const iso = at.toISOString(); // 2026-11-14T02:00:04.123Z — an instant, read in UTC
  const stem = `${BACKUP_PREFIX}${iso.slice(0, 10)}/${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}-${kind}`;
  return { data: `${stem}.thqbak`, manifest: `${stem}.manifest.json` };
}

const NAMED = /^backups\/(\d{4}-\d{2}-\d{2})\/(\d{2})(\d{2})(\d{2})-(daily|event-day)\.(thqbak|manifest\.json)$/;

export function parseBackupPath(pathname: string): { stem: string; at: Date; day: string } | null {
  const m = NAMED.exec(pathname);
  if (!m) return null;
  const at = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  if (Number.isNaN(at.getTime())) return null;
  return { stem: `${BACKUP_PREFIX}${m[1]}/${m[2]}${m[3]}${m[4]}-${m[5]}`, at, day: m[1] };
}

export interface StoredFile {
  pathname: string;
  url: string;
  size: number;
}

export interface Pruning {
  /** URLs to delete. */
  remove: string[];
  /** Copies kept. */
  kept: number;
  /** True when the size budget, not the calendar, decided something went. */
  shortened: boolean;
}

export function choosePruning(files: StoredFile[], now: Date, budgetBytes = STORE_BUDGET_BYTES): Pruning {
  const stems = new Map<string, { at: Date; day: string; files: StoredFile[]; size: number }>();
  for (const f of files) {
    const p = parseBackupPath(f.pathname);
    if (!p) continue;
    const s = stems.get(p.stem) ?? { at: p.at, day: p.day, files: [], size: 0 };
    s.files.push(f);
    s.size += f.size;
    stems.set(p.stem, s);
  }
  const newestFirst = [...stems.values()].sort((a, b) => b.at.getTime() - a.at.getTime());
  const newestOfDay = new Set<string>();
  const seenDays = new Set<string>();
  for (const s of newestFirst) {
    if (!seenDays.has(s.day)) {
      seenDays.add(s.day);
      newestOfDay.add(`${s.day}|${s.at.getTime()}`);
    }
  }

  const keep = newestFirst.filter((s, i) => {
    if (i === 0) return true;
    const age = now.getTime() - s.at.getTime();
    if (age > KEEP_SUNDAYS_DAYS * DAY_MS) return false;
    if (age <= KEEP_ALL_MS) return true;
    const dayNewest = newestOfDay.has(`${s.day}|${s.at.getTime()}`);
    if (!dayNewest) return false;
    if (age <= KEEP_DAILY_DAYS * DAY_MS) return true;
    return new Date(`${s.day}T00:00:00Z`).getUTCDay() === 0;
  });

  let shortened = false;
  let total = keep.reduce((sum, s) => sum + s.size, 0);
  while (total > budgetBytes && keep.length > 2) {
    const oldest = keep.pop()!;
    total -= oldest.size;
    shortened = true;
  }

  const kept = new Set(keep);
  const remove = newestFirst.filter((s) => !kept.has(s)).flatMap((s) => s.files.map((f) => f.url));
  return { remove, kept: keep.length, shortened };
}
