import type { PrismaClient } from "@prisma/client";

/**
 * EVERY ROW IN THE DATABASE, WATCHED FOR CHANGE.
 *
 * A security test that asks "did the call return an error?" is asking the
 * caller. This asks the database: fingerprint every table, make the call,
 * fingerprint again, and name each row that was added, changed or deleted —
 * whichever table it is in, including the ones nobody thought to check.
 *
 * A whole-database fingerprint is one query and takes about half a second on
 * the development database (measured 2026-10-11: 56 tables, 82,655 rows,
 * 432ms), so it can be taken after every single call.
 */

export interface RowChange {
  table: string;
  key: string;
  change: "added" | "changed" | "deleted";
}

interface Table {
  name: string;
  hasId: boolean;
}

export class DbWatch {
  private tables: Table[] = [];
  private hashes = new Map<string, string>();
  private rows = new Map<string, Map<string, string>>();

  constructor(
    private prisma: PrismaClient,
    /** Tables that change for every caller and say nothing about whose data moved. */
    private ignore: ReadonlySet<string>,
  ) {}

  private keyOf(t: Table) {
    return t.hasId ? "x.id::text" : "md5(x::text)";
  }

  async start(): Promise<void> {
    const found = await this.prisma.$queryRawUnsafe<{ t: string; hasid: bigint }[]>(
      `select c.relname as t,
              (select count(*) from information_schema.columns k
                where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'id') as hasid
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    this.tables = found
      .filter((r) => r.t !== "_prisma_migrations" && !this.ignore.has(r.t))
      .map((r) => ({ name: r.t, hasId: Number(r.hasid) > 0 }));
    await this.absorb();
  }

  get tableCount(): number {
    return this.tables.length;
  }

  get rowCount(): number {
    let n = 0;
    for (const m of this.rows.values()) n += m.size;
    return n;
  }

  /** Every row there is now, by table. A copy — the caller keeps it. */
  keys(): Map<string, Set<string>> {
    return new Map([...this.rows].map(([t, m]) => [t, new Set(m.keys())]));
  }

  /** What changed since the last look, and take the new state as the baseline. */
  async absorb(): Promise<RowChange[]> {
    const parts = this.tables.map(
      (t) =>
        `select '${t.name}' as t, md5(coalesce(string_agg(md5(x::text), '' order by md5(x::text)), '')) as h from "${t.name}" x`,
    );
    const now = await this.prisma.$queryRawUnsafe<{ t: string; h: string }[]>(parts.join(" union all "));
    const changes: RowChange[] = [];
    for (const { t, h } of now) {
      if (this.hashes.get(t) === h) continue;
      this.hashes.set(t, h);
      const table = this.tables.find((x) => x.name === t)!;
      const fresh = await this.prisma.$queryRawUnsafe<{ k: string; h: string }[]>(
        `select ${this.keyOf(table)} as k, md5(x::text) as h from "${t}" x`,
      );
      const before = this.rows.get(t) ?? new Map<string, string>();
      const after = new Map(fresh.map((r) => [r.k, r.h]));
      for (const [k, hash] of after) {
        if (!before.has(k)) changes.push({ table: t, key: k, change: "added" });
        else if (before.get(k) !== hash) changes.push({ table: t, key: k, change: "changed" });
      }
      for (const k of before.keys()) if (!after.has(k)) changes.push({ table: t, key: k, change: "deleted" });
      this.rows.set(t, after);
    }
    return changes;
  }

  /** The rows themselves, as JSON, for saying what a change was. */
  async read(table: string, keys: string[]): Promise<Map<string, Record<string, unknown>>> {
    const t = this.tables.find((x) => x.name === table);
    if (!t || keys.length === 0) return new Map();
    const got = await this.prisma.$queryRawUnsafe<{ k: string; j: Record<string, unknown> }[]>(
      `select ${this.keyOf(t)} as k, row_to_json(x) as j from "${table}" x where ${this.keyOf(t)} = any($1::text[])`,
      keys,
    );
    return new Map(got.map((r) => [r.k, r.j]));
  }
}

/** Which columns differ between two readings of one row. */
export function columnsChanged(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): string[] {
  if (!before || !after) return [];
  return Object.keys({ ...before, ...after }).filter((c) => JSON.stringify(before[c]) !== JSON.stringify(after[c]));
}
