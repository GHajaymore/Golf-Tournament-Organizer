import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { linesOf, loadLines, RestoreRefused } from "../backup/load";
import type { Sql } from "../backup/dump";

/**
 * THE RESTORE'S LOADER REFUSES WHAT IS OUT OF PLACE (B21) — before it loads a
 * wrong row. A stand-in database answers the loader's few questions; the drill
 * (`backup-restore-drill.audit.test.ts`) runs the loader against a real one.
 */

const MIGRATION = (name: string) => JSON.stringify({ id: name, migration_name: name, finished_at: "2026-11-01T00:00:00", rolled_back_at: null });
const sha = (rows: string[]) => {
  const h = createHash("sha256");
  for (const r of rows) h.update(`${r}\n`);
  return h.digest("hex");
};

function backup(tables: Record<string, string[]>, opts: { badCount?: string; noManifest?: boolean; extra?: string } = {}): string[] {
  const lines = [`H\t${JSON.stringify({ format: "thq-backup", version: 1, commit: "abc1234" })}`];
  const figures = [];
  for (const [name, rows] of Object.entries(tables)) {
    lines.push(`T\t${name}`, ...rows.map((r) => `R\t${r}`));
    const count = name === opts.badCount ? rows.length + 1 : rows.length;
    lines.push(`E\t${name}\t${count}\t${sha(rows)}`);
    figures.push({ name, rows: rows.length, sha256: sha(rows) });
  }
  if (!opts.noManifest) lines.push(`M\t${JSON.stringify({ format: "thq-backup", version: 1, tables: figures })}`);
  if (opts.extra) lines.push(opts.extra);
  return lines;
}

function fakeDb(opts: { migrations?: string[]; tables?: string[]; nonEmpty?: string[] } = {}) {
  const inserts: { sql: string; rows: number }[] = [];
  const sql: Sql = {
    async $queryRawUnsafe<T>(query: string): Promise<T> {
      if (query.includes("FROM pg_tables")) return (opts.tables ?? ["_prisma_migrations", "User", "Event"]).map((tablename) => ({ tablename })) as T;
      if (query.includes('FROM "_prisma_migrations" t')) return (opts.migrations ?? ["00_init", "A001_x"]).map((m) => ({ j: MIGRATION(m) })) as T;
      if (query.startsWith("SELECT EXISTS")) return [{ any: (opts.nonEmpty ?? []).some((t) => query.includes(`"${t}"`)) }] as T;
      throw new Error(`unexpected query: ${query}`);
    },
    async $executeRawUnsafe(query: string, ...values: unknown[]) {
      if (query.startsWith("INSERT")) inserts.push({ sql: query, rows: JSON.parse(String(values[0])).length });
      return 0;
    },
  };
  return { sql, inserts };
}

async function* from(lines: string[]) {
  for (const l of lines) yield l;
}

const GOOD = {
  _prisma_migrations: [MIGRATION("00_init"), MIGRATION("A001_x")],
  User: ['{"id":"u1"}', '{"id":"u2"}'],
  Event: ['{"id":"e1"}'],
};

async function refusal(lines: string[], db = fakeDb()): Promise<string> {
  try {
    await loadLines(db.sql, from(lines));
  } catch (e) {
    return e instanceof RestoreRefused ? e.message : `not a refusal: ${String(e)}`;
  }
  return "loaded";
}

describe("the loader", () => {
  it("loads every table, the migration history replaced by the backup's own", async () => {
    const db = fakeDb();
    const result = await loadLines(db.sql, from(backup(GOOD)));
    expect(result.loaded).toEqual([
      { name: "_prisma_migrations", rows: 2 },
      { name: "User", rows: 2 },
      { name: "Event", rows: 1 },
    ]);
    expect(db.inserts.map((i) => [i.sql.split(" ")[2], i.rows])).toEqual([
      ['"_prisma_migrations"', 2],
      ['"User"', 2],
      ['"Event"', 1],
    ]);
  });

  it("refuses a backup from another schema, with the commit to check out, BEFORE loading a row", async () => {
    const db = fakeDb({ migrations: ["00_init", "A001_x", "A002_newer_here"] });
    expect(await refusal(backup(GOOD), db)).toMatch(/0 of its migrations are missing here and 1 here are not in it\. Check out the backup's commit \(abc1234\)/);
    expect(db.inserts).toEqual([]);
  });

  it("refuses a table this checkout does not have", async () => {
    expect(await refusal(backup({ ...GOOD, Gone: ['{"id":"g"}'] }))).toMatch(/table Gone, which this checkout's migrations did not make/);
  });

  it("refuses to load into a table that already holds rows", async () => {
    expect(await refusal(backup(GOOD), fakeDb({ nonEmpty: ["User"] }))).toMatch(/Table User already holds rows/);
  });

  it("refuses a table whose rows do not match its own count", async () => {
    expect(await refusal(backup(GOOD, { badCount: "User" }))).toMatch(/Table User does not match its own figures/);
  });

  it("refuses a file without its manifest (cut short at a line)", async () => {
    expect(await refusal(backup(GOOD, { noManifest: true }))).toMatch(/ends before its manifest/);
  });

  it("refuses anything after the manifest, a stray line, a row outside a table, and a name it will not put into SQL", async () => {
    expect(await refusal(backup(GOOD, { extra: 'R\t{"id":"late"}' }))).toMatch(/runs on past its manifest/);
    const lines = backup(GOOD);
    expect(await refusal([lines[0], "X\twhat"])).toMatch(/does not read/);
    expect(await refusal([lines[0], 'R\t{"id":"x"}'])).toMatch(/outside any table/);
    expect(await refusal([lines[0], 'T\tUser"; DROP TABLE "User'])).toMatch(/will not put into SQL/);
    expect(await refusal(['R\t{"id":"x"}'])).toMatch(/does not begin with its header/);
  });

  it("refuses a manifest that disagrees with the tables it closes", async () => {
    const lines = backup(GOOD);
    const m = JSON.parse(lines[lines.length - 1].slice(2));
    m.tables[1].rows = 5;
    lines[lines.length - 1] = `M\t${JSON.stringify(m)}`;
    expect(await refusal(lines)).toMatch(/manifest does not match/);
  });
});

describe("linesOf", () => {
  it("splits on newlines only, across chunk edges and inside a multi-byte character", async () => {
    const text = 'R\t{"a":"⛳ sep end"}\nR\t{"b":2}\n';
    const bytes = Buffer.from(text, "utf8");
    const chunks = Array.from(bytes).map((b) => Buffer.from([b])); // one byte at a time
    const out: string[] = [];
    for await (const l of linesOf(Readable.from(chunks))) out.push(l);
    expect(out).toEqual(['R\t{"a":"⛳ sep end"}', 'R\t{"b":2}']);
  });
});
