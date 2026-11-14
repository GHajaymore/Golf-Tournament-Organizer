import { createHash } from "node:crypto";
import { isPlainTableName } from "./tables";

/**
 * THE EXPORT: every listed table, read from ONE snapshot, as lines of text.
 *
 * The caller opens a REPEATABLE READ transaction and hands its client in; the
 * first statement here makes it READ ONLY. Every table then comes from the same
 * instant — a card saved halfway through the export is either in every table
 * it touches or in none — and nothing in the export can write.
 *
 * Each row is Postgres's own `row_to_json`, so the copy needs no knowledge of
 * the columns and a column added tomorrow is copied tomorrow. The restore puts
 * it back with `json_populate_recordset`, which reads the same text with each
 * column's own type.
 *
 * Rows are taken in a fixed order — the primary key's text in the "C"
 * collation — so the same data always gives the same bytes, and a restored
 * database exported again gives the same SHA-256 per table. ("C", because two
 * servers with different default collations would otherwise sort the same ids
 * differently and every checksum would disagree for no reason.)
 *
 * A small table is one statement. A table larger than a page is read through a
 * cursor, a page at a time, so memory holds one page however large the table.
 * (Prisma Postgres counts each statement as an operation; about one a table.)
 *
 * The lines, one per line, tab-separated:
 *
 *   H <json>                       the export's header
 *   T <table>                      a table begins
 *   R <json>                       one row
 *   E <table> <rows> <sha256>      a table ends: its row count, and SHA-256 over its R lines' JSON + "\n"
 *   M <json>                       the manifest, last: every table's figures again
 *
 * Nothing here logs, and nothing it returns holds a row: the manifest is table
 * names, counts and checksums.
 */

/** What the export needs of a database client: Prisma's raw calls, inside a transaction. */
export interface Sql {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

export interface TableFigure {
  name: string;
  rows: number;
  sha256: string;
}

export interface BackupManifest {
  format: "thq-backup";
  version: 1;
  startedAt: string;
  finishedAt: string;
  /** The deployment's commit (`VERCEL_GIT_COMMIT_SHA`), or "" off Vercel. */
  commit: string;
  /** The newest applied migration: a restore needs a checkout with exactly these migrations. */
  migrationHead: string;
  tables: TableFigure[];
  /** Tables the database has that are in neither list: copied by nobody, reported by name. */
  unlisted: string[];
  /** Listed tables the database does not have. */
  missing: string[];
  plaintextBytes: number;
}

export interface DumpOptions {
  tables: readonly string[];
  excluded: readonly string[];
  startedAt: Date;
  commit: string;
  /** The clock for `finishedAt`; passed in. */
  now: () => Date;
  /** Rows per statement. */
  pageRows?: number;
  /** Called before every statement; throws to stop the export (the route's time limit). */
  checkDeadline?: () => void;
}

export const DEFAULT_PAGE_ROWS = 2000;
const CURSOR = "thq_backup_rows";

const quoted = (name: string) => `"${name}"`;

/** The ORDER BY that gives the same order on any server. */
function orderFor(pk: string[]): string {
  if (!pk.length) return `(row_to_json(t)::text) COLLATE "C"`;
  return pk.map((column) => `(t.${quoted(column)})::text COLLATE "C"`).join(", ");
}

async function primaryKeys(sql: Sql): Promise<Map<string, string[]>> {
  const rows = await sql.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT c.relname AS table_name, a.attname AS column_name
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey::int2[])
      WHERE i.indisprimary AND n.nspname = 'public'
      ORDER BY c.relname, array_position(i.indkey::int2[], a.attnum)`,
  );
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.table_name, [...(out.get(r.table_name) ?? []), r.column_name]);
  return out;
}

async function tablesInDatabase(sql: Sql): Promise<Set<string>> {
  const rows = await sql.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  return new Set(rows.map((r) => r.tablename));
}

/** Applied, not rolled back. */
function appliedMigration(json: string): string | null {
  try {
    const row = JSON.parse(json) as { migration_name?: string; finished_at?: string | null; rolled_back_at?: string | null };
    return row.migration_name && row.finished_at && !row.rolled_back_at ? row.migration_name : null;
  } catch {
    return null;
  }
}

/**
 * Yields the export as text chunks (whole lines) and returns the manifest.
 * Must be the first thing to run in its transaction.
 */
export async function* dumpLines(sql: Sql, options: DumpOptions): AsyncGenerator<string, BackupManifest, undefined> {
  const pageRows = options.pageRows ?? DEFAULT_PAGE_ROWS;
  const check = options.checkDeadline ?? (() => {});
  for (const name of [...options.tables, ...options.excluded]) {
    if (!isPlainTableName(name)) throw new Error(`Not a table name the backup will put into SQL: ${JSON.stringify(name)}`);
  }

  await sql.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);
  check();
  const present = await tablesInDatabase(sql);
  const keys = await primaryKeys(sql);
  const listed = new Set([...options.tables, ...options.excluded]);

  let bytes = 0;
  const out = (text: string) => {
    bytes += Buffer.byteLength(text, "utf8");
    return text;
  };

  yield out(`H\t${JSON.stringify({ format: "thq-backup", version: 1, startedAt: options.startedAt.toISOString(), commit: options.commit })}\n`);

  const figures: TableFigure[] = [];
  const missing: string[] = [];
  let migrationHead = "";

  for (const table of options.tables) {
    if (!present.has(table)) {
      missing.push(table);
      continue;
    }
    const hash = createHash("sha256");
    let rows = 0;
    const select = `SELECT row_to_json(t)::text AS j FROM ${quoted(table)} t ORDER BY ${orderFor(keys.get(table) ?? [])}`;

    const emit = (page: { j: string }[]): string => {
      let text = "";
      for (const { j } of page) {
        hash.update(j);
        hash.update("\n");
        if (table === "_prisma_migrations") {
          const applied = appliedMigration(j);
          if (applied && applied > migrationHead) migrationHead = applied;
        }
        text += `R\t${j}\n`;
      }
      rows += page.length;
      return text;
    };

    yield out(`T\t${table}\n`);
    check();
    const first = await sql.$queryRawUnsafe<{ j: string }[]>(`${select} LIMIT ${pageRows + 1}`);
    if (first.length <= pageRows) {
      if (first.length) yield out(emit(first));
    } else {
      yield out(emit(first.slice(0, pageRows)));
      check();
      await sql.$executeRawUnsafe(`DECLARE ${CURSOR} NO SCROLL CURSOR FOR ${select} OFFSET ${pageRows}`);
      for (;;) {
        check();
        const page = await sql.$queryRawUnsafe<{ j: string }[]>(`FETCH ${pageRows} FROM ${CURSOR}`);
        if (page.length) yield out(emit(page));
        if (page.length < pageRows) break;
      }
      await sql.$executeRawUnsafe(`CLOSE ${CURSOR}`);
    }
    const sha256 = hash.digest("hex");
    figures.push({ name: table, rows, sha256 });
    yield out(`E\t${table}\t${rows}\t${sha256}\n`);
  }

  const manifest: BackupManifest = {
    format: "thq-backup",
    version: 1,
    startedAt: options.startedAt.toISOString(),
    finishedAt: options.now().toISOString(),
    commit: options.commit,
    migrationHead,
    tables: figures,
    unlisted: [...present].filter((t) => !listed.has(t)).sort(),
    missing,
    plaintextBytes: 0,
  };
  // The figure counts everything before the manifest line, which cannot count itself.
  manifest.plaintextBytes = bytes;
  yield `M\t${JSON.stringify(manifest)}\n`;
  return manifest;
}

/** Runs the export to the end and keeps only its figures: the restore's check, and the drill's. */
export async function figuresOf(sql: Sql, options: DumpOptions): Promise<BackupManifest> {
  const lines = dumpLines(sql, options);
  for (;;) {
    const next = await lines.next();
    if (next.done) return next.value;
  }
}
