import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import type { BackupManifest, Sql, TableFigure } from "./dump";
import { isPlainTableName } from "./tables";

/**
 * THE RESTORE'S LOADER: the export's lines, put back into an EMPTY, migrated
 * database, inside the caller's transaction.
 *
 * The caller has already:
 *   - made the database (it must have had no tables at all), and run
 *     `prisma migrate deploy` on it from a checkout of the backup's commit;
 *   - opened ONE transaction and set `session_replication_role = replica` in
 *     it, so foreign keys load in any order (Postgres still checks every type
 *     and every unique index).
 *
 * Every line is checked against the export's own figures as it goes: a table's
 * row count and SHA-256 at its `E` line, and the whole list again at the
 * closing manifest. Anything out of place throws, and the transaction rolls
 * the load back: a restore is all of the backup or none of it.
 *
 * The migration history is the first table in every backup. It is compared
 * with what this checkout's migrations made BEFORE any data is loaded, so a
 * backup from a different schema is refused with the commit to check out,
 * rather than half-loaded into the wrong columns.
 */

export class RestoreRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreRefused";
  }
}

/** The plaintext, a line at a time. Splits on "\n" only: the JSON escapes every other line break. */
export async function* linesOf(input: Readable): AsyncGenerator<string> {
  const decoder = new StringDecoder("utf8");
  let carry = "";
  for await (const chunk of input) {
    carry += typeof chunk === "string" ? chunk : decoder.write(chunk as Buffer);
    let at = carry.indexOf("\n");
    while (at !== -1) {
      yield carry.slice(0, at);
      carry = carry.slice(at + 1);
      at = carry.indexOf("\n");
    }
  }
  carry += decoder.end();
  if (carry.length) yield carry;
}

const quoted = (name: string) => `"${name}"`;
const MIGRATIONS = "_prisma_migrations";

export interface LoadOptions {
  /** JSON per INSERT statement. */
  batchBytes?: number;
}

export interface LoadResult {
  manifest: BackupManifest;
  loaded: { name: string; rows: number }[];
}

function appliedNames(rowsJson: string[]): string[] {
  return rowsJson
    .map((j) => JSON.parse(j) as { migration_name: string; finished_at: string | null; rolled_back_at: string | null })
    .filter((r) => r.finished_at && !r.rolled_back_at)
    .map((r) => r.migration_name)
    .sort();
}

export async function loadLines(sql: Sql, lines: AsyncIterable<string>, options: LoadOptions = {}): Promise<LoadResult> {
  const batchBytes = options.batchBytes ?? 1 << 20;
  const present = new Set(
    (await sql.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).map(
      (r) => r.tablename,
    ),
  );

  let header: { format?: string; version?: number; commit?: string } | null = null;
  let manifest: BackupManifest | null = null;
  const ended: TableFigure[] = [];
  const loaded: { name: string; rows: number }[] = [];

  let table: string | null = null;
  let hash = createHash("sha256");
  let rows = 0;
  let batch: string[] = [];
  let batchSize = 0;
  let migrationRows: string[] = [];

  const flush = async () => {
    if (!table || !batch.length) return;
    if (table !== MIGRATIONS) {
      await sql.$executeRawUnsafe(
        `INSERT INTO ${quoted(table)} SELECT * FROM json_populate_recordset(NULL::${quoted(table)}, $1::json)`,
        `[${batch.join(",")}]`,
      );
    }
    batch = [];
    batchSize = 0;
  };

  for await (const line of lines) {
    if (manifest) throw new RestoreRefused("The backup runs on past its manifest.");
    const kind = line.slice(0, 2);
    const rest = line.slice(2);

    if (!header) {
      if (kind !== "H\t") throw new RestoreRefused("This backup does not begin with its header.");
      header = JSON.parse(rest);
      if (header?.format !== "thq-backup" || header.version !== 1) {
        throw new RestoreRefused("This backup's contents are not a version this checkout reads.");
      }
      continue;
    }

    if (kind === "R\t") {
      if (!table) throw new RestoreRefused("A row outside any table.");
      hash.update(rest);
      hash.update("\n");
      rows += 1;
      if (table === MIGRATIONS) {
        migrationRows.push(rest);
        continue;
      }
      batch.push(rest);
      batchSize += rest.length;
      if (batchSize >= batchBytes) await flush();
      continue;
    }

    if (kind === "T\t") {
      if (table) throw new RestoreRefused(`Table ${table} never ended.`);
      if (!isPlainTableName(rest)) throw new RestoreRefused("A table name the restore will not put into SQL.");
      if (!present.has(rest)) {
        throw new RestoreRefused(
          `The backup holds table ${rest}, which this checkout's migrations did not make. Check out the backup's commit (${header.commit || "see its manifest"}) and run again.`,
        );
      }
      if (rest !== MIGRATIONS) {
        const has = await sql.$queryRawUnsafe<{ any: boolean }[]>(`SELECT EXISTS (SELECT 1 FROM ${quoted(rest)}) AS any`);
        if (has[0]?.any) throw new RestoreRefused(`Table ${rest} already holds rows: a restore only ever loads an empty database.`);
      }
      table = rest;
      hash = createHash("sha256");
      rows = 0;
      migrationRows = [];
      continue;
    }

    if (kind === "E\t") {
      const [name, count, sha256] = rest.split("\t");
      if (name !== table) throw new RestoreRefused(`Table ${table ?? "(none)"} ended as ${name}.`);
      const digest = hash.digest("hex");
      if (Number(count) !== rows || sha256 !== digest) {
        throw new RestoreRefused(`Table ${name} does not match its own figures in the backup.`);
      }
      if (table === MIGRATIONS) {
        const theirs = appliedNames(migrationRows);
        const ours = appliedNames(
          (await sql.$queryRawUnsafe<{ j: string }[]>(`SELECT row_to_json(t)::text AS j FROM ${quoted(MIGRATIONS)} t`)).map((r) => r.j),
        );
        if (theirs.join("\n") !== ours.join("\n")) {
          const missingHere = theirs.filter((m) => !ours.includes(m));
          const extraHere = ours.filter((m) => !theirs.includes(m));
          throw new RestoreRefused(
            `The backup's schema is not this checkout's: ${missingHere.length} of its migrations are missing here and ${extraHere.length} here are not in it. Check out the backup's commit (${header.commit || "see its manifest"}) and run again.`,
          );
        }
        // The history itself, exactly as production had it (its timestamps and checksums), replaces the one
        // the migrate run just wrote.
        await sql.$executeRawUnsafe(`DELETE FROM ${quoted(MIGRATIONS)}`);
        for (let i = 0; i < migrationRows.length; i += 500) {
          await sql.$executeRawUnsafe(
            `INSERT INTO ${quoted(MIGRATIONS)} SELECT * FROM json_populate_recordset(NULL::${quoted(MIGRATIONS)}, $1::json)`,
            `[${migrationRows.slice(i, i + 500).join(",")}]`,
          );
        }
      } else {
        await flush();
      }
      ended.push({ name, rows, sha256: digest });
      loaded.push({ name, rows });
      table = null;
      continue;
    }

    if (kind === "M\t") {
      if (table) throw new RestoreRefused(`Table ${table} never ended.`);
      const m = JSON.parse(rest) as BackupManifest;
      const said = JSON.stringify(m.tables);
      if (said !== JSON.stringify(ended)) throw new RestoreRefused("The backup's manifest does not match the tables it holds.");
      manifest = m;
      continue;
    }

    throw new RestoreRefused("A line the restore does not read.");
  }

  if (!manifest) throw new RestoreRefused("The backup ends before its manifest: it was cut short.");
  return { manifest, loaded };
}

/**
 * After a load, every serial column's sequence is moved past its largest value,
 * so the next row the app inserts does not collide with a restored one.
 */
export async function resetSequences(sql: Sql): Promise<number> {
  const serials = await sql.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'`,
  );
  for (const { table_name, column_name } of serials) {
    if (!isPlainTableName(table_name) || !isPlainTableName(column_name)) continue;
    await sql.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${quoted(table_name)}', '${column_name}'),
              COALESCE(MAX(${quoted(column_name)}), 1), MAX(${quoted(column_name)}) IS NOT NULL)
         FROM ${quoted(table_name)}`,
    );
  }
  return serials.length;
}

export interface TableCheck {
  name: string;
  expected: number;
  found: number;
  match: boolean;
}

/** Each table of the manifest against a fresh export of the restored database: rows and SHA-256 alike. */
export function compareFigures(expected: BackupManifest, found: BackupManifest): TableCheck[] {
  const byName = new Map(found.tables.map((t) => [t.name, t]));
  return expected.tables.map((t) => {
    const f = byName.get(t.name);
    return { name: t.name, expected: t.rows, found: f?.rows ?? 0, match: !!f && f.rows === t.rows && f.sha256 === t.sha256 };
  });
}
