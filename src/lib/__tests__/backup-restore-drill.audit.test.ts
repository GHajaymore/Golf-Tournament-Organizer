import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { sealedExport } from "@/lib/backup/run";
import { dumpLines } from "@/lib/backup/dump";
import { BACKED_UP_TABLES, EXCLUDED_TABLES } from "@/lib/backup/tables";
import { checkRestored, databaseUrlNamed, isLocalHost, loadSealed, prismaMigrate, restoreInto } from "@/lib/backup/restore";
import { BackupRefused } from "@/lib/backup/sealed";
import { RestoreRefused } from "@/lib/backup/load";

/**
 * DRILL A — THE BACKUP RESTORES, PROVED ON INVENTED DATA (B21).
 *
 * The whole path production takes, on throwaway databases made here and
 * dropped in `afterAll`, on THIS machine's Postgres (CI's, or the local
 * development server — never its `tourneyhq_dev` database, which this neither
 * reads nor writes; Hard rules 1 and 6). Production is never touched.
 *
 *   1. `…_src` is migrated from empty and given three invented rows in EVERY
 *      table — made from each column's type, so a table added tomorrow is
 *      seeded tomorrow — with the awkward values a copy can get wrong: a tab,
 *      a newline, quotes, a backslash, an emoji, U+2028, a bigint past 2^53, a
 *      NULL, an empty array, JSON with nesting.
 *   2. It is exported exactly as the cron does (`sealedExport`), with a page of
 *      two rows so every table goes through the cursor, and sealed to a key
 *      pair made here and never written.
 *   3. `restoreInto` puts it into `…_dst`: migrate, load, check.
 *   4. Every table: the same row count AND the same SHA-256 of every row; the
 *      migration status clean; the left-out tables empty.
 *
 * And the controls that prove the drill can fail: a flipped byte, a wrong key,
 * a file cut short — each refused with NOTHING loaded — and a table emptied
 * after the restore, which the check names.
 */

const SERVER = process.env.DATABASE_URL ?? "";
const STAMP = Date.now();
const NAME = (part: string) => `tourneyhq_restore_drill_${STAMP}_${part}`;
const made: string[] = [];
const MARK = "zz-restore-drill";

let admin: PrismaClient;
let srcUrl = "";
let publicPem = "";
let privateKey: KeyObject;
let otherKey: KeyObject;
let file: Buffer;
let manifest: Awaited<ReturnType<typeof sealedExport>>["manifest"];

async function createDatabase(part: string, template?: string): Promise<string> {
  const name = NAME(part);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"${template ? ` TEMPLATE "${NAME(template)}"` : ""}`);
  made.push(name);
  return databaseUrlNamed(SERVER, name);
}

interface Column {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  character_maximum_length: number | null;
  is_generated: string;
}

/** An invented value for a column, from its type alone. Row 1 carries the awkward ones; row 2 the NULLs. */
function inventedValue(table: string, c: Column, i: number, enumLabels: Map<string, string[]>): unknown {
  if (i === 2 && c.is_nullable === "YES") return null;
  const t = c.data_type;
  const text = (s: string) => (c.character_maximum_length ? s.slice(0, c.character_maximum_length) : s);
  if (t === "text" || t === "character varying" || t === "character") {
    const base = `${MARK} ${table}.${c.column_name} #${i}`;
    return text(i === 1 ? `${base} tab\tnewline\nquote" apostrophe' back\\slash emoji⛳ sep end` : base);
  }
  if (t === "integer" || t === "smallint") return i === 1 ? -7 : i + 1;
  if (t === "bigint") return i === 1 ? "9007199254740993" : String(i + 1);
  if (t === "double precision" || t === "real") return i === 1 ? 0.30000000000000004 : i + 0.5;
  if (t === "numeric") return i === 1 ? "12345.6789" : String(i);
  if (t === "boolean") return i % 2 === 0;
  if (t.startsWith("timestamp")) return `2026-11-1${i}T0${i}:3${i}:00.12${i}`;
  if (t === "date") return `2026-11-1${i}`;
  if (t === "jsonb" || t === "json") return { mark: MARK, i, nested: ["a", 1, null, { deep: true }], quote: 'he said "hi"' };
  if (t === "bytea") return "\\x00ff10";
  if (t === "uuid") return randomUUID();
  if (t === "USER-DEFINED") {
    const labels = enumLabels.get(c.udt_name) ?? [];
    return labels[i % labels.length];
  }
  if (t === "ARRAY") {
    if (i === 2) return [];
    const inner = c.udt_name.slice(1);
    if (inner === "text" || inner === "varchar") return [`${MARK} a`, "b,c", 'd"e', "f\\g"];
    if (inner === "int4" || inner === "int2" || inner === "int8") return [1, -2, 3];
    if (inner === "float8") return [1.5, 0.1];
    const labels = enumLabels.get(inner);
    if (labels) return [labels[0]];
  }
  throw new Error(`The drill does not know how to invent a ${t} (${c.udt_name}) for ${table}.${c.column_name}: teach inventedValue.`);
}

async function seedEveryTable(url: string): Promise<void> {
  const client = new PrismaClient({ datasourceUrl: url, log: ["error"] });
  try {
    const enums = await client.$queryRawUnsafe<{ typname: string; labels: string[] }[]>(
      `SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS labels
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname`,
    );
    const enumLabels = new Map(enums.map((e) => [e.typname, e.labels]));
    await client.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
        for (const table of [...BACKED_UP_TABLES, ...Object.keys(EXCLUDED_TABLES)]) {
          if (table === "_prisma_migrations") continue; // migrate wrote it: real rows, the drill's first table
          const columns = await tx.$queryRawUnsafe<Column[]>(
            `SELECT column_name, data_type, udt_name, is_nullable, character_maximum_length, is_generated
               FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
            table,
          );
          for (let i = 0; i < 3; i++) {
            const row: Record<string, unknown> = {};
            for (const c of columns) if (c.is_generated !== "ALWAYS") row[c.column_name] = inventedValue(table, c, i, enumLabels);
            await tx.$executeRawUnsafe(`INSERT INTO "${table}" SELECT * FROM json_populate_record(NULL::"${table}", $1::json)`, JSON.stringify(row));
          }
        }
      },
      { timeout: 120_000 },
    );
  } finally {
    await client.$disconnect();
  }
}

const migrationFolders = () =>
  readdirSync(join(process.cwd(), "prisma/migrations")).filter((n) => statSync(join(process.cwd(), "prisma/migrations", n)).isDirectory());

async function rowsIn(url: string, table: string): Promise<number> {
  const client = new PrismaClient({ datasourceUrl: url, log: ["error"] });
  try {
    const r = await client.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}"`);
    return Number(r[0].n);
  } finally {
    await client.$disconnect();
  }
}

async function loadInto(url: string, sealed: Buffer, key: KeyObject): Promise<unknown> {
  const client = new PrismaClient({ datasourceUrl: url, log: ["error"] });
  try {
    await loadSealed(client, Readable.from([sealed]), key);
    return null;
  } catch (e) {
    return e;
  } finally {
    await client.$disconnect();
  }
}

beforeAll(async () => {
  expect(SERVER, "DATABASE_URL names the local Postgres to make throwaway databases on").not.toBe("");
  expect(isLocalHost(SERVER), "the drill runs only on this machine's Postgres").toBe(true);
  admin = new PrismaClient({ datasourceUrl: databaseUrlNamed(SERVER, "postgres"), log: ["error"] });
  // A drill killed half-way leaves its databases; take any older than an hour.
  const stale = await admin.$queryRawUnsafe<{ datname: string }[]>(
    `SELECT datname FROM pg_database WHERE datname LIKE 'tourneyhq\\_restore\\_drill\\_%'`,
  );
  for (const { datname } of stale) {
    const at = Number(datname.split("_")[3]);
    if (Number.isFinite(at) && at < STAMP - 3600_000) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
  }

  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  privateKey = pair.privateKey;
  otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

  srcUrl = await createDatabase("src");
  const migrated = prismaMigrate("deploy", srcUrl);
  expect(migrated.ok, migrated.output).toBe(true);
  // An empty migrated copy, for the refusal controls (a template copy is quicker than migrating again).
  await createDatabase("empty", "src");
  await seedEveryTable(srcUrl);

  ({ file, manifest } = await sealedExport(srcUrl, publicPem, {
    startedAt: new Date("2026-11-14T02:00:00Z"),
    commit: "zz-drill",
    now: () => new Date("2026-11-14T02:00:09Z"),
    pageRows: 2,
    // Small segments, so a refused file has had earlier segments opened and loaded — and rolled back.
    segmentBytes: 4096,
  }));
}, 600_000);

afterAll(async () => {
  if (!admin) return;
  for (const name of made.reverse()) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.$disconnect();
}, 120_000);

describe("the export of a database with every table filled", () => {
  it("copies every listed table, and the migrated database has no table in neither list", () => {
    expect(manifest.tables.map((t) => t.name)).toEqual([...BACKED_UP_TABLES]);
    expect(manifest.unlisted).toEqual([]);
    expect(manifest.missing).toEqual([]);
  });

  it("three invented rows a table, the whole migration history, and the newest migration as its head", () => {
    const folders = migrationFolders().sort();
    for (const t of manifest.tables) expect([t.name, t.rows]).toEqual([t.name, t.name === "_prisma_migrations" ? folders.length : 3]);
    expect(manifest.migrationHead).toBe(folders[folders.length - 1]);
  });

  it("is sealed: none of the invented text is readable in the file", () => {
    expect(file.includes(Buffer.from(MARK))).toBe(false);
    expect(file.length).toBeGreaterThan(1000);
  });

  it("reads ONE snapshot: a row written during the export is not in it", async () => {
    const client = new PrismaClient({ datasourceUrl: srcUrl, log: ["error"] });
    const other = new PrismaClient({ datasourceUrl: srcUrl, log: ["error"] });
    try {
      const figures = await client.$transaction(
        async (tx) => {
          const lines = dumpLines(tx, {
            tables: BACKED_UP_TABLES,
            excluded: Object.keys(EXCLUDED_TABLES),
            startedAt: new Date(),
            commit: "",
            now: () => new Date(),
          });
          await lines.next(); // the header: the snapshot is taken
          await other.$executeRawUnsafe(
            `INSERT INTO "User" SELECT * FROM json_populate_record(NULL::"User",
               (SELECT row_to_json(u)::jsonb || '{"id":"zz-restore-drill-late","email":"zz-late@example.invalid"}'::jsonb FROM "User" u LIMIT 1)::json)`,
          );
          for (;;) {
            const next = await lines.next();
            if (next.done) return next.value;
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000 },
      );
      expect(figures.tables.find((t) => t.name === "User")?.rows).toBe(3);
      expect(await rowsIn(srcUrl, "User")).toBe(4);
    } finally {
      await other.$executeRawUnsafe(`DELETE FROM "User" WHERE id = 'zz-restore-drill-late'`);
      await client.$disconnect();
      await other.$disconnect();
    }
  });

  it("writes nothing: the export's transaction refuses a write", async () => {
    const client = new PrismaClient({ datasourceUrl: srcUrl, log: ["error"] });
    try {
      const attempt = client.$transaction(
        async (tx) => {
          const lines = dumpLines(tx, { tables: ["User"], excluded: [], startedAt: new Date(), commit: "", now: () => new Date() });
          await lines.next();
          await tx.$executeRawUnsafe(`UPDATE "User" SET email = email`);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      await expect(attempt).rejects.toThrow(/read-only transaction/);
    } finally {
      await client.$disconnect();
    }
  });
});

describe("the restore", () => {
  let dstUrl = "";

  it("puts every table back: the same rows and the same SHA-256 in every one", async () => {
    dstUrl = await createDatabase("dst");
    const result = await restoreInto(dstUrl, Readable.from([file]), privateKey);
    expect(result.checks.length).toBe(BACKED_UP_TABLES.length);
    expect(result.checks.filter((c) => !c.match)).toEqual([]);
    expect(result.loaded).toEqual(manifest.tables.map((t) => ({ name: t.name, rows: t.rows })));
  }, 600_000);

  it("leaves a database whose migrations Prisma calls up to date", () => {
    const status = prismaMigrate("status", dstUrl);
    expect(status.ok, status.output).toBe(true);
    expect(status.output).toMatch(/up to date/i);
  }, 120_000);

  it("leaves out the short-lived secrets: those tables are empty in the copy", async () => {
    for (const t of Object.keys(EXCLUDED_TABLES)) {
      expect(await rowsIn(srcUrl, t)).toBe(3);
      expect([t, await rowsIn(dstUrl, t)]).toEqual([t, 0]);
    }
  });

  it("CONTROL: a table emptied after the restore is named by the check", async () => {
    const client = new PrismaClient({ datasourceUrl: dstUrl, log: ["error"] });
    try {
      await client.$executeRawUnsafe(`SET session_replication_role = replica`);
      await client.$executeRawUnsafe(`DELETE FROM "Scorecard"`);
      await client.$executeRawUnsafe(`UPDATE "Player" SET "name" = "name" || ' changed' WHERE "id" = (SELECT min("id") FROM "Player")`);
      const checks = await checkRestored(client, manifest, () => new Date());
      expect(checks.filter((c) => !c.match).map((c) => [c.name, c.expected, c.found])).toEqual([
        ["Player", 3, 3], // same count, different row: the checksum sees it
        ["Scorecard", 3, 0],
      ]);
    } finally {
      await client.$disconnect();
    }
  });

  it("refuses to restore over a database that has tables", async () => {
    await expect(restoreInto(srcUrl, Readable.from([file]), privateKey)).rejects.toThrow(RestoreRefused);
  });

  it("THE OWNER'S COMMAND (Drill B): --verify, key pasted on stdin, prints counts and 'match' — never a row — and drops its database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zz-restore-drill-"));
    const path = join(dir, "drill.thqbak");
    writeFileSync(path, file);
    try {
      const run = spawnSync(
        process.execPath,
        [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "scripts/backup-restore.ts", "--verify", path, "--key", "-"],
        {
          cwd: process.cwd(),
          input: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
          encoding: "utf8",
          env: { ...process.env, RESTORE_SERVER_URL: SERVER },
          timeout: 300_000,
        },
      );
      const out = `${run.stdout}${run.stderr}`;
      expect(run.status, out).toBe(0);
      expect(out).toMatch(new RegExp(`${BACKED_UP_TABLES.length} tables, \\d+ rows, every table matches`));
      expect(out).toMatch(/^Scorecard\s+3\s+3\s+match$/m);
      expect(out).not.toContain(MARK);
      expect(out).not.toContain("BEGIN");
      const name = /throwaway database (tourneyhq_restore_drill_\d+) dropped/.exec(out)?.[1];
      expect(name).toBeTruthy();
      const still = await admin.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM pg_database WHERE datname = $1`, name);
      expect(still).toEqual([]);

      // And the same command with the wrong key does nothing, and says why.
      const wrong = spawnSync(
        process.execPath,
        [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "scripts/backup-restore.ts", "--verify", path, "--key", "-"],
        { cwd: process.cwd(), input: otherKey.export({ type: "pkcs8", format: "pem" }).toString(), encoding: "utf8", env: { ...process.env, RESTORE_SERVER_URL: SERVER }, timeout: 120_000 },
      );
      expect(wrong.status).toBe(1);
      expect(`${wrong.stdout}${wrong.stderr}`).toMatch(/sealed to key [0-9a-f]{16}; the key given is [0-9a-f]{16}\. Nothing was done\./);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 600_000);
});

describe("CONTROLS: what the restore refuses, with nothing loaded", () => {
  const refused = async (sealed: Buffer, key: KeyObject, part: string) => {
    const url = await createDatabase(part, "empty");
    const error = await loadInto(url, sealed, key);
    return { error, users: await rowsIn(url, "User"), accounts: await rowsIn(url, "Account"), migrations: await rowsIn(url, "_prisma_migrations") };
  };

  it("a flipped byte in the middle of the file", async () => {
    const bad = Buffer.from(file);
    bad[Math.floor(bad.length * 0.6)] ^= 0x04;
    const r = await refused(bad, privateKey, "flipped");
    expect(r.error).toBeInstanceOf(BackupRefused);
    expect((r.error as BackupRefused).reason).toBe("tampered");
    expect([r.users, r.accounts]).toEqual([0, 0]);
  });

  it("the wrong private key", async () => {
    const r = await refused(file, otherKey, "wrongkey");
    expect((r.error as BackupRefused).reason).toBe("wrong-key");
    expect([r.users, r.accounts]).toEqual([0, 0]);
  });

  it("a file cut short", async () => {
    const r = await refused(file.subarray(0, file.length - 40), privateKey, "short");
    expect((r.error as BackupRefused).reason).toBe("truncated");
    expect([r.users, r.accounts]).toEqual([0, 0]);
    // The migration history the migrate run wrote is still there: the load rolled back as one.
    expect(r.migrations).toBe(migrationFolders().length);
  });
});
