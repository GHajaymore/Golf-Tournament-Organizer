import { describe, it, expect } from "vitest";
import { backupPaths, choosePruning, parseBackupPath, LATEST, type StoredFile } from "../backup/retention";

/**
 * HOW LONG A BACKUP IS KEPT (B21): 48 hours of everything, 14 days of dailies,
 * Sundays to 35 days, never the newest, never past the store's budget, and
 * never a file that is not named like a backup. Worked from the rule by
 * listing what a calendar keeps, not by calling the function's own pieces.
 */

const NOW = new Date("2026-12-20T02:30:00Z"); // a Sunday
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function copy(at: Date, kind: "daily" | "event-day" = "daily", size = 1000): StoredFile[] {
  const p = backupPaths(at, kind);
  return [
    { pathname: p.data, url: `https://store.private.blob.vercel-storage.com/${p.data}`, size },
    { pathname: p.manifest, url: `https://store.private.blob.vercel-storage.com/${p.manifest}`, size: 10 },
  ];
}

const daysAgo = (n: number, hour = 2) => new Date(Date.UTC(2026, 11, 20 - n, hour, 0, 4));
const keptDays = (files: StoredFile[], removed: string[]) =>
  [...new Set(files.filter((f) => !removed.includes(f.url)).map((f) => f.pathname.slice(8, 18)))].sort();

describe("backup names", () => {
  it("are an instant in UTC, and read back", () => {
    const at = new Date("2026-11-14T02:00:04.900Z");
    expect(backupPaths(at, "daily")).toEqual({
      data: "backups/2026-11-14/020004-daily.thqbak",
      manifest: "backups/2026-11-14/020004-daily.manifest.json",
    });
    const event = backupPaths(at, "event-day");
    expect(parseBackupPath(event.data)).toEqual({ stem: "backups/2026-11-14/020004-event-day", at: new Date("2026-11-14T02:00:04Z"), day: "2026-11-14" });
    expect(parseBackupPath(event.manifest)?.stem).toBe("backups/2026-11-14/020004-event-day");
    expect(parseBackupPath(LATEST)).toBeNull();
    expect(parseBackupPath("backups/2026-11-14/notes.txt")).toBeNull();
  });
});

describe("what is kept", () => {
  it("40 nightly copies: the last 14 days, and the Sundays before them inside 35 days", () => {
    const files = Array.from({ length: 40 }, (_, n) => copy(daysAgo(n))).flat();
    const { remove, kept, shortened } = choosePruning(files, NOW);
    // Dailies: 7–20 Dec (the copy of 6 Dec at 02:00 is 14 days and 30 minutes old). Sundays: 6 Dec,
    // 29 and 22 Nov; 15 Nov's is 35 days and 30 minutes old, so it goes.
    expect(keptDays(files, remove)).toEqual([
      "2026-11-22", "2026-11-29",
      "2026-12-06", "2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12",
      "2026-12-13", "2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18", "2026-12-19", "2026-12-20",
    ]);
    expect(kept).toBe(17);
    expect(shortened).toBe(false);
    // Both halves of a copy go together.
    expect(remove.length % 2).toBe(0);
  });

  it("an event day's hourly copies stay 48 hours, then only that day's newest", () => {
    const yesterday = Array.from({ length: 10 }, (_, h) => copy(new Date(Date.UTC(2026, 11, 19, 8 + h, 7)), "event-day")).flat();
    const lastWeek = Array.from({ length: 10 }, (_, h) => copy(new Date(Date.UTC(2026, 11, 12, 8 + h, 7)), "event-day")).flat();
    const { remove } = choosePruning([...yesterday, ...lastWeek], NOW);
    expect(yesterday.filter((f) => remove.includes(f.url))).toEqual([]);
    const lastWeekKept = lastWeek.filter((f) => !remove.includes(f.url)).map((f) => f.pathname);
    expect(lastWeekKept).toEqual(["backups/2026-12-12/170700-event-day.thqbak", "backups/2026-12-12/170700-event-day.manifest.json"]);
  });

  it("never the newest copy, however old (a stopped cron must not empty the store)", () => {
    const files = copy(daysAgo(90));
    expect(choosePruning(files, NOW)).toEqual({ remove: [], kept: 1, shortened: false });
  });

  it("never a file not named like a backup", () => {
    const stray: StoredFile[] = [
      { pathname: LATEST, url: "u/latest", size: 10 },
      { pathname: "backups/readme.txt", url: "u/readme", size: 10 },
    ];
    const { remove } = choosePruning([...stray, ...copy(daysAgo(60)), ...copy(daysAgo(0))], NOW);
    expect(remove).not.toContain("u/latest");
    expect(remove).not.toContain("u/readme");
    expect(remove).toHaveLength(2);
  });

  it("past the store's budget, the oldest go first, never the newest two, and it says so", () => {
    const files = Array.from({ length: 10 }, (_, n) => copy(daysAgo(n), "daily", 100)).flat();
    const fits = choosePruning(files, NOW, 10_000);
    expect(fits.shortened).toBe(false);
    const tight = choosePruning(files, NOW, 4 * 110);
    expect(tight.shortened).toBe(true);
    expect(keptDays(files, tight.remove)).toEqual(["2026-12-17", "2026-12-18", "2026-12-19", "2026-12-20"]);
    const tiny = choosePruning(files, NOW, 1);
    expect(keptDays(files, tiny.remove)).toEqual(["2026-12-19", "2026-12-20"]);
  });
});
