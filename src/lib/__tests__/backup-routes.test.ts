import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bearerMatches, backupMayRunHere, TRIGGER_SECRET_MIN_LENGTH } from "../backup/bearer";

/**
 * THE THREE BACKUP DOORS, AND WHO GETS THROUGH (B21).
 *
 *   GET  /api/cron/backup     Vercel Cron, bearer CRON_SECRET
 *   POST /api/backup/run      the event-day trigger, bearer BACKUP_TRIGGER_SECRET
 *   GET  /api/backup/status   the canary, bearer BACKUP_TRIGGER_SECRET
 *
 * Each refuses a missing secret, a wrong one, a short one, and a preview
 * deployment; each answers in counts. The backup itself is a stand-in here
 * (the restore drill runs the real one against a throwaway database), so this
 * file proves the doors, not the copy.
 */

const { runBackup, reportBackup, lastBackupAt, aTournamentIsOnToday } = vi.hoisted(() => ({
  runBackup: vi.fn(),
  reportBackup: vi.fn(),
  lastBackupAt: vi.fn(),
  aTournamentIsOnToday: vi.fn(),
}));

vi.mock("@/lib/backup/run", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/backup/run")>();
  return { ...real, runBackup, reportBackup, lastBackupAt, backupStore: () => ({}) };
});
vi.mock("@/lib/services/deploy-window", () => ({ aTournamentIsOnToday }));

const CRON = "zz-cron-secret-for-the-backup-door";
const TRIGGER = "zz".repeat(TRIGGER_SECRET_MIN_LENGTH / 2);
const OUTCOME = { tables: 61, rows: 1234, bytes: 5678, seconds: 3.2, kept: 4, deleted: 1, shortened: false };

const saved = { ...process.env };
beforeEach(() => {
  process.env.CRON_SECRET = CRON;
  process.env.BACKUP_TRIGGER_SECRET = TRIGGER;
  delete process.env.VERCEL_ENV;
  runBackup.mockReset().mockResolvedValue(OUTCOME);
  reportBackup.mockReset().mockResolvedValue(undefined);
  lastBackupAt.mockReset().mockResolvedValue(null);
  aTournamentIsOnToday.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  process.env = { ...saved };
});

const cron = async (auth?: string) => {
  const { GET } = await import("@/app/api/cron/backup/route");
  return GET(new Request("https://example.invalid/api/cron/backup", { headers: auth ? { authorization: auth } : {} }));
};
const trigger = async (auth?: string) => {
  const { POST } = await import("@/app/api/backup/run/route");
  return POST(new Request("https://example.invalid/api/backup/run", { method: "POST", headers: auth ? { authorization: auth } : {} }));
};
const status = async (auth?: string) => {
  const { GET } = await import("@/app/api/backup/status/route");
  return GET(new Request("https://example.invalid/api/backup/status", { headers: auth ? { authorization: auth } : {} }));
};

describe("bearerMatches", () => {
  it("is true only for exactly `Bearer <secret>`", () => {
    expect(bearerMatches("Bearer abc", "abc")).toBe(true);
    for (const h of ["Bearer abd", "bearer abc", "Bearer abc ", "abc", "", null]) expect(bearerMatches(h, "abc")).toBe(false);
  });
  it("is false when the secret is missing, empty or shorter than asked — whatever is offered", () => {
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer undefined", undefined)).toBe(false);
    expect(bearerMatches("Bearer short", "short", 32)).toBe(false);
  });
  it("runs a backup only on production's deployment, or off Vercel", () => {
    expect(backupMayRunHere({})).toBe(true);
    expect(backupMayRunHere({ VERCEL_ENV: "production" })).toBe(true);
    expect(backupMayRunHere({ VERCEL_ENV: "preview" })).toBe(false);
    expect(backupMayRunHere({ VERCEL_ENV: "development" })).toBe(false);
  });
});

describe("the nightly cron door", () => {
  it("refuses no header, a wrong secret, the trigger's secret, and a missing CRON_SECRET", async () => {
    expect((await cron()).status).toBe(401);
    expect((await cron("Bearer wrong")).status).toBe(401);
    expect((await cron(`Bearer ${TRIGGER}`)).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await cron("Bearer ")).status).toBe(401);
    expect((await cron("Bearer undefined")).status).toBe(401);
    expect(runBackup).not.toHaveBeenCalled();
  });

  it("refuses on a preview deployment even with the right secret", async () => {
    process.env.VERCEL_ENV = "preview";
    expect((await cron(`Bearer ${CRON}`)).status).toBe(403);
    expect(runBackup).not.toHaveBeenCalled();
  });

  it("runs a daily backup and answers counts", async () => {
    const res = await cron(`Bearer ${CRON}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...OUTCOME });
    expect(runBackup).toHaveBeenCalledWith("daily", expect.any(Date));
  });

  it("a failure answers 500 with nothing in it, and is reported tagged backup", async () => {
    runBackup.mockRejectedValue(new Error("The export ran past its 240 s limit; nothing was filed."));
    const res = await cron(`Bearer ${CRON}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false });
    expect(reportBackup).toHaveBeenCalledWith("error", expect.any(Error), "daily");
  });
});

describe("the event-day trigger door", () => {
  it("refuses no header, a wrong secret, the cron's secret, and a short or missing trigger secret", async () => {
    expect((await trigger()).status).toBe(401);
    expect((await trigger(`Bearer ${CRON}`)).status).toBe(401);
    process.env.BACKUP_TRIGGER_SECRET = "short";
    expect((await trigger("Bearer short")).status).toBe(401);
    delete process.env.BACKUP_TRIGGER_SECRET;
    expect((await trigger("Bearer ")).status).toBe(401);
    expect(aTournamentIsOnToday).not.toHaveBeenCalled();
    expect(runBackup).not.toHaveBeenCalled();
  });

  it("refuses on a preview deployment", async () => {
    process.env.VERCEL_ENV = "preview";
    expect((await trigger(`Bearer ${TRIGGER}`)).status).toBe(403);
  });

  it("takes nothing when no club is playing today, and asks the store nothing", async () => {
    aTournamentIsOnToday.mockResolvedValue(false);
    const res = await trigger(`Bearer ${TRIGGER}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ran: false });
    expect(lastBackupAt).not.toHaveBeenCalled();
    expect(runBackup).not.toHaveBeenCalled();
  });

  it("takes nothing within 30 minutes of the last copy (429)", async () => {
    lastBackupAt.mockResolvedValue(new Date(Date.now() - 29 * 60 * 1000));
    const res = await trigger(`Bearer ${TRIGGER}`);
    expect(res.status).toBe(429);
    expect(runBackup).not.toHaveBeenCalled();
  });

  it("takes an event-day copy when a club is playing and the last copy is older", async () => {
    lastBackupAt.mockResolvedValue(new Date(Date.now() - 31 * 60 * 1000));
    const res = await trigger(`Bearer ${TRIGGER}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ran: true, ...OUTCOME });
    expect(runBackup).toHaveBeenCalledWith("event-day", expect.any(Date));
  });

  it("does not answer a GET", async () => {
    const mod = (await import("@/app/api/backup/run/route")) as Record<string, unknown>;
    expect(mod.GET).toBeUndefined();
  });
});

describe("the status door", () => {
  it("refuses without the trigger secret, and with the cron's", async () => {
    expect((await status()).status).toBe(401);
    expect((await status(`Bearer ${CRON}`)).status).toBe(401);
  });

  it("answers only fresh: true for a copy under 30 hours old, false otherwise", async () => {
    lastBackupAt.mockResolvedValue(new Date(Date.now() - 29 * 3600 * 1000));
    let res = await status(`Bearer ${TRIGGER}`);
    expect(await res.json()).toEqual({ fresh: true });
    lastBackupAt.mockResolvedValue(new Date(Date.now() - 31 * 3600 * 1000));
    res = await status(`Bearer ${TRIGGER}`);
    expect(await res.json()).toEqual({ fresh: false });
    lastBackupAt.mockResolvedValue(null);
    res = await status(`Bearer ${TRIGGER}`);
    expect(await res.json()).toEqual({ fresh: false });
    lastBackupAt.mockRejectedValue(new Error("Vercel Blob head answered 403 (store_suspended)."));
    res = await status(`Bearer ${TRIGGER}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fresh: false });
  });
});

describe("the schedule", () => {
  it("vercel.json runs the backup at 02:00 UTC, an hour before expire-rounds deletes", async () => {
    const { readFileSync } = await import("node:fs");
    const crons = (JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] }).crons;
    expect(crons.find((c) => c.path === "/api/cron/backup")?.schedule).toBe("0 2 * * *");
    expect(crons.find((c) => c.path === "/api/cron/expire-rounds")?.schedule).toBe("0 3 * * *");
  });
});
