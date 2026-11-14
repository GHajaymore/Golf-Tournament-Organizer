import { PrismaClient, Prisma } from "@prisma/client";
import type { KeyObject } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { dumpLines, type BackupManifest } from "./dump";
import { readPublicKey, sealStream, keyIdOf } from "./sealed";
import { BACKED_UP_TABLES, EXCLUDED_TABLES } from "./tables";
import { BACKUP_PREFIX, LATEST, backupPaths, choosePruning, type BackupKind } from "./retention";
import { vercelBlobStore, type BlobStore } from "./blob-store";

/**
 * ONE BACKUP OF PRODUCTION, start to finish (B21; docs/operations/backups.md).
 *
 *   1. ONE connection on `DATABASE_URL` — the direct one Vercel already holds
 *      (the pooled endpoint caps a response at 5 MB) — and ONE transaction,
 *      REPEATABLE READ and READ ONLY: every table from the same instant, and
 *      nothing written.
 *   2. The export (`dump.ts`) through gzip and the envelope (`sealed.ts`),
 *      sealed to `BACKUP_PUBLIC_KEY`. Plaintext exists only a page at a time
 *      and only in this function's memory; what is held whole is the SEALED
 *      file, which is compressed.
 *   3. Filed in PRIVATE Vercel Blob (`BLOB_READ_WRITE_TOKEN`): the file, its
 *      manifest, and `latest.json`.
 *   4. Old copies pruned (`retention.ts`).
 *
 * WHAT IT HANDLES. The export stops itself at `EXPORT_DEADLINE_MS` (Vercel
 * Hobby ends a function at 300 s) and the sealed file may not pass
 * `MAX_SEALED_BYTES`: past either, the run fails loudly — nothing is filed, so
 * there is never a partial backup — Sentry hears of it, and the status check
 * goes stale within 30 hours. Measured on this design (backups.md has the
 * figures), the time limit is the far side of a gigabyte of rows; the limit
 * that comes first is Blob's 1 GB on Hobby, which fits 35 copies only while
 * one is under ~25 MB sealed. Past that, retention shortens itself and says so.
 *
 * What it returns, and so what reaches the logs, is counts: tables, rows,
 * bytes, seconds. Never a row, a name, a key or an address.
 */

export const EXPORT_DEADLINE_MS = 240_000;
export const MAX_SEALED_BYTES = 256 * 1024 * 1024;
/** The event-day trigger takes no copy within this long of the last one. */
export const TRIGGER_MIN_GAP_MS = 30 * 60 * 1000;
/** The status check calls a copy fresh for this long: a day, the cron's hour of slack, and some. */
export const FRESH_FOR_MS = 30 * 60 * 60 * 1000;

export interface BackupOutcome {
  tables: number;
  rows: number;
  bytes: number;
  seconds: number;
  kept: number;
  deleted: number;
  shortened: boolean;
}

export class BackupNotConfigured extends Error {
  constructor(missing: string[]) {
    // Names only: which settings are absent, never a value.
    super(`The backup is not configured: ${missing.join(", ")} not set.`);
    this.name = "BackupNotConfigured";
  }
}

export class BackupFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupFailed";
  }
}

export interface BackupSettings {
  databaseUrl: string;
  blobToken: string;
  publicKey: string;
  commit: string;
}

export function backupSettings(env: NodeJS.ProcessEnv = process.env): BackupSettings {
  const wanted = {
    DATABASE_URL: env.DATABASE_URL?.trim() ?? "",
    BLOB_READ_WRITE_TOKEN: env.BLOB_READ_WRITE_TOKEN?.trim() ?? "",
    BACKUP_PUBLIC_KEY: env.BACKUP_PUBLIC_KEY?.trim() ?? "",
  };
  const missing = Object.entries(wanted)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new BackupNotConfigured(missing);
  return {
    databaseUrl: wanted.DATABASE_URL,
    blobToken: wanted.BLOB_READ_WRITE_TOKEN,
    publicKey: wanted.BACKUP_PUBLIC_KEY,
    commit: env.VERCEL_GIT_COMMIT_SHA ?? "",
  };
}

/** The store, or null when no token is set (the status check then answers "not fresh"). */
export function backupStore(env: NodeJS.ProcessEnv = process.env): BlobStore | null {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  return token ? vercelBlobStore(token) : null;
}

/** When the newest backup was filed, or null if there is none (or no store). */
export async function lastBackupAt(store: BlobStore | null): Promise<Date | null> {
  if (!store) return null;
  return (await store.head(LATEST))?.uploadedAt ?? null;
}

export interface SealedExport {
  file: Buffer;
  manifest: BackupManifest;
}

/**
 * The export, sealed, from any database the caller names: production's in the
 * route, a throwaway in the drill. Opens and closes its own client.
 */
export async function sealedExport(
  databaseUrl: string,
  publicKeyText: string,
  options: { startedAt: Date; commit: string; now: () => Date; deadlineMs?: number; maxBytes?: number; pageRows?: number; segmentBytes?: number },
): Promise<SealedExport> {
  const publicKey = readPublicKey(publicKeyText);
  const deadline = Date.now() + (options.deadlineMs ?? EXPORT_DEADLINE_MS);
  const maxBytes = options.maxBytes ?? MAX_SEALED_BYTES;
  const client = new PrismaClient({ datasourceUrl: databaseUrl, log: ["error"] });
  try {
    // Every statement of the export goes down `tx`: the generator is bound to it, and the transaction
    // stays open until `sealLines` has read the last line (transactions-stay-on-their-own-connection).
    return await client.$transaction(
      (tx) =>
        sealLines(
          dumpLines(tx, {
            tables: BACKED_UP_TABLES,
            excluded: Object.keys(EXCLUDED_TABLES),
            startedAt: options.startedAt,
            commit: options.commit,
            now: options.now,
            pageRows: options.pageRows,
            checkDeadline: () => {
              if (Date.now() > deadline) {
                throw new BackupFailed(`The export ran past its ${Math.round((options.deadlineMs ?? EXPORT_DEADLINE_MS) / 1000)} s limit; nothing was filed.`);
              }
            },
          }),
          publicKey,
          { maxBytes, segmentBytes: options.segmentBytes },
        ),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 20_000,
        timeout: (options.deadlineMs ?? EXPORT_DEADLINE_MS) + 40_000,
      },
    );
  } finally {
    await client.$disconnect();
  }
}

/**
 * The export's lines through gzip and the envelope, held as one sealed file (never past `maxBytes`).
 * It is handed the lines, not a client: the database work is the generator's, on its transaction.
 */
export async function sealLines(
  lines: AsyncGenerator<string, BackupManifest, undefined>,
  publicKey: KeyObject,
  options: { maxBytes: number; segmentBytes?: number },
): Promise<SealedExport> {
  const got: { manifest?: BackupManifest } = {};
  async function* asBytes() {
    for (;;) {
      const next = await lines.next();
      if (next.done) {
        got.manifest = next.value;
        return;
      }
      yield Buffer.from(next.value, "utf8");
    }
  }
  const chunks: Buffer[] = [];
  let size = 0;
  await pipeline(
    Readable.from(asBytes(), { objectMode: false }),
    createGzip({ level: 6 }),
    sealStream(publicKey, options.segmentBytes),
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > options.maxBytes) {
          done(new BackupFailed(`The sealed backup passed ${Math.round(options.maxBytes / 1024 / 1024)} MB; nothing was filed.`));
          return;
        }
        chunks.push(chunk);
        done();
      },
    }),
  );
  if (!got.manifest) throw new BackupFailed("The export ended without its manifest.");
  return { file: Buffer.concat(chunks), manifest: got.manifest };
}

/** Takes one backup of production and files it. Throws on any failure; the route reports it. */
export async function runBackup(kind: BackupKind, at: Date, deps: { store?: BlobStore; env?: NodeJS.ProcessEnv } = {}): Promise<BackupOutcome> {
  const env = deps.env ?? process.env;
  const settings = backupSettings(env);
  const store = deps.store ?? vercelBlobStore(settings.blobToken);
  const started = Date.now();

  const { file, manifest } = await sealedExport(settings.databaseUrl, settings.publicKey, {
    startedAt: at,
    commit: settings.commit,
    now: () => new Date(),
  });

  const paths = backupPaths(at, kind);
  const filed = JSON.stringify(
    { ...manifest, kind, file: paths.data, sealedBytes: file.length, keyId: keyIdOf(readPublicKey(settings.publicKey)) },
    null,
    1,
  );
  await store.put(paths.data, file, { contentType: "application/octet-stream", overwrite: false });
  await store.put(paths.manifest, Buffer.from(filed, "utf8"), { contentType: "application/json", overwrite: false });
  await store.put(LATEST, Buffer.from(filed, "utf8"), { contentType: "application/json", overwrite: true });

  const pruning = choosePruning(await store.list(BACKUP_PREFIX), at);
  if (pruning.remove.length) await store.del(pruning.remove);

  if (manifest.unlisted.length || manifest.missing.length) {
    await reportBackup(
      "warning",
      new Error(`Backup table lists are out of date: in neither list ${JSON.stringify(manifest.unlisted)}; listed but missing ${JSON.stringify(manifest.missing)}.`),
      kind,
    );
  }
  if (pruning.shortened) {
    await reportBackup("warning", new Error(`Backup retention was shortened to ${pruning.kept} copies to keep the store under its budget.`), kind);
  }

  return {
    tables: manifest.tables.length,
    rows: manifest.tables.reduce((n, t) => n + t.rows, 0),
    bytes: file.length,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    kept: pruning.kept,
    deleted: pruning.remove.length,
    shortened: pruning.shortened,
  };
}

/**
 * To Sentry, tagged `backup`, when error reporting is on (`SENTRY_DSN`); the
 * owner's alert rule mails on that tag. The SDK is loaded only then, as
 * `src/instrumentation.ts` does, and every event goes through its `scrubReport`.
 * The messages above are names of settings and tables, counts and limits.
 */
export async function reportBackup(level: "error" | "warning", error: unknown, kind: BackupKind): Promise<void> {
  if (!process.env.SENTRY_DSN?.trim()) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error, { level, tags: { backup: kind } });
    await Sentry.flush(2000);
  } catch {
    // Reporting must never be the reason a response is not sent.
  }
}
