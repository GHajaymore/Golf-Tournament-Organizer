import { PrismaClient, Prisma } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { pipeline, type Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import type { KeyObject } from "node:crypto";
import { figuresOf, type BackupManifest } from "./dump";
import { compareFigures, linesOf, loadLines, resetSequences, RestoreRefused, type TableCheck } from "./load";
import { openStream } from "./sealed";
import { EXCLUDED_TABLES } from "./tables";

/**
 * PUTTING A BACKUP BACK: into an EMPTY database, never over one (B21).
 *
 * `scripts/backup-restore.ts` is the command; this is what it does, so the
 * drill (`backup-restore-drill.audit.test.ts`) runs exactly the same code.
 *
 *   1. The target must have NO tables. That one check is what makes it
 *      impossible to restore over production, the development database or
 *      anything else in use: they all have tables.
 *   2. `prisma migrate deploy` makes the schema, from this checkout.
 *   3. One transaction: the sealed file is opened, unzipped and loaded as it
 *      streams (`load.ts`) — plaintext is never written to disk — with foreign
 *      keys loading in any order; then every serial sequence is reset.
 *      Anything wrong, and the whole load rolls back.
 *   4. A fresh export of the restored database is compared with the backup's
 *      manifest, table by table: the row count AND the SHA-256 of every row.
 *
 * What it prints is the caller's business; what it returns is table names and
 * counts. No row ever leaves this module.
 */

export function databaseUrlNamed(serverUrl: string, database: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

export function isLocalHost(databaseUrl: string): boolean {
  const host = new URL(databaseUrl).hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export async function tableCount(databaseUrl: string): Promise<number> {
  const client = new PrismaClient({ datasourceUrl: databaseUrl, log: ["error"] });
  try {
    const rows = await client.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public'`);
    return Number(rows[0]?.n ?? 0);
  } finally {
    await client.$disconnect();
  }
}

/** `prisma migrate deploy` (or `status`) against `databaseUrl`, which goes in the environment, never on a command line. */
export function prismaMigrate(command: "deploy" | "status", databaseUrl: string, cwd = process.cwd()): { ok: boolean; output: string } {
  const run = spawnSync("npx", ["prisma", "migrate", command], {
    cwd,
    shell: process.platform === "win32",
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: databaseUrl, PRISMA_DATABASE_URL: databaseUrl },
    timeout: 10 * 60 * 1000,
  });
  return { ok: run.status === 0, output: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

export interface RestoreResult {
  manifest: BackupManifest;
  loaded: { name: string; rows: number }[];
  checks: TableCheck[];
  seconds: number;
}

/**
 * Restores `sealed` into the empty database at `databaseUrl` and checks it.
 * Throws `RestoreRefused` / `BackupRefused` (from the envelope) on anything wrong.
 */
export async function restoreInto(
  databaseUrl: string,
  sealed: Readable,
  privateKey: KeyObject,
  options: { migrate?: (url: string) => void; now?: () => Date } = {},
): Promise<RestoreResult> {
  const started = Date.now();
  if ((await tableCount(databaseUrl)) !== 0) {
    throw new RestoreRefused("The target database already has tables. A restore only ever goes into an EMPTY database.");
  }
  const migrate =
    options.migrate ??
    ((url: string) => {
      const run = prismaMigrate("deploy", url);
      if (!run.ok) throw new RestoreRefused(`prisma migrate deploy failed on the target:\n${run.output}`);
    });
  migrate(databaseUrl);

  const client = new PrismaClient({ datasourceUrl: databaseUrl, log: ["error"] });
  try {
    const { manifest, loaded } = await loadSealed(client, sealed, privateKey);
    const checks = await checkRestored(client, manifest, options.now ?? (() => new Date()));
    return { manifest, loaded, checks, seconds: Math.round((Date.now() - started) / 100) / 10 };
  } finally {
    await client.$disconnect();
  }
}

/**
 * Step 3 alone: open, unzip and load `sealed` into a migrated database whose
 * tables are empty, in ONE transaction. Anything wrong rolls all of it back.
 */
export async function loadSealed(client: PrismaClient, sealed: Readable, privateKey: KeyObject) {
  const plain = pipeline(sealed, openStream(privateKey), createGunzip(), () => {
    // Errors reach the reader in loadLines: pipeline destroys the last stream with them.
  });
  return client.$transaction((tx) => loadInTransaction(tx, plain), { maxWait: 60_000, timeout: 60 * 60 * 1000 });
}

/** Inside the load's one transaction: foreign keys in any order, every line, then the sequences. */
async function loadInTransaction(tx: Prisma.TransactionClient, plain: Readable) {
  await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
  const result = await loadLines(tx, linesOf(plain));
  await resetSequences(tx);
  return result;
}

/** Step 4 alone: export the restored database again and compare it with the manifest, table by table. */
export async function checkRestored(client: PrismaClient, manifest: BackupManifest, now: () => Date): Promise<TableCheck[]> {
  // The comparison is pure arithmetic on two manifests; only the export reaches the database, on `tx`.
  return client
    .$transaction(
      (tx) =>
        figuresOf(tx, {
          tables: manifest.tables.map((t) => t.name),
          excluded: Object.keys(EXCLUDED_TABLES),
          startedAt: new Date(manifest.startedAt),
          commit: manifest.commit,
          now,
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 60_000, timeout: 60 * 60 * 1000 },
    )
    .then((found) => compareFigures(manifest, found));
}
