/**
 * One-off data migration: copy tournaments from the legacy SQLite database
 * (prisma/dev.db, used before the switch to Postgres) into whatever Postgres
 * database DATABASE_URL points at.
 *
 * Switching the Prisma datasource to Postgres created an *empty* Postgres
 * database — it did not carry data across. Tournaments created before that
 * switch still live only in the SQLite file, which is why this exists.
 *
 * Usage (from the repo root):
 *   # see what would happen, without writing anything
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-sqlite-to-postgres.ts --dry-run
 *
 *   # actually copy
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-sqlite-to-postgres.ts
 *
 *   # copy only specific tournaments (repeatable, case-insensitive substring)
 *   ... --only "Ajay More" --only "CDG"
 *
 * Safety:
 *   - Opens SQLite read-only; the source file is never modified.
 *   - Skips any Event whose id already exists in the target, so re-running
 *     never duplicates or overwrites.
 *   - Inserts in foreign-key dependency order.
 *   - Reads SQLite via Node's built-in `node:sqlite` (Node 22.5+), so there's
 *     no dependency on a sqlite3 CLI or a second Prisma Client.
 */
import { PrismaClient } from "@prisma/client";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ONLY: string[] = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--only" && args[i + 1]) ONLY.push(args[i + 1].toLowerCase());
}
const SQLITE_PATH = process.env.SQLITE_PATH ?? path.join("prisma", "dev.db");

type Row = Record<string, unknown>;

/** SQLite has no real booleans (0/1) or dates (ms ints / ISO strings). */
function coerce(row: Row, boolFields: string[] = [], dateFields: string[] = []): Row {
  const out: Row = { ...row };
  for (const f of boolFields) {
    if (f in out && out[f] !== null && out[f] !== undefined) out[f] = Boolean(out[f]);
  }
  for (const f of dateFields) {
    const v = out[f];
    if (v === null || v === undefined) continue;
    out[f] = typeof v === "number" ? new Date(v) : new Date(String(v));
  }
  return out;
}

async function main() {
  if (!existsSync(SQLITE_PATH)) {
    throw new Error(`SQLite file not found at ${SQLITE_PATH}. Set SQLITE_PATH if it lives elsewhere.`);
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set — refusing to run.");

  const db = new DatabaseSync(SQLITE_PATH, { readOnly: true });
  const read = (table: string): Row[] => db.prepare(`SELECT * FROM "${table}"`).all() as Row[];

  const pg = new PrismaClient();

  const allEvents = read("Event");
  const existingIds = new Set((await pg.event.findMany({ select: { id: true } })).map((e) => e.id));

  let candidates = allEvents.filter((e) => !existingIds.has(String(e.id)));
  if (ONLY.length) {
    candidates = candidates.filter((e) =>
      ONLY.some((frag) => String(e.name).toLowerCase().includes(frag)),
    );
  }

  console.log(`Source (SQLite) events : ${allEvents.length}`);
  for (const e of allEvents) {
    const already = existingIds.has(String(e.id));
    const selected = candidates.some((c) => c.id === e.id);
    const mark = already ? "already in target" : selected ? "WILL COPY" : "skipped (--only filter)";
    console.log(`   ${String(e.name).padEnd(38)} ${mark}`);
  }

  if (DRY_RUN) {
    console.log(`\n--dry-run: would copy ${candidates.length} event(s). Nothing written.`);
    db.close();
    await pg.$disconnect();
    return;
  }
  if (candidates.length === 0) {
    console.log("\nNothing to copy.");
    db.close();
    await pg.$disconnect();
    return;
  }

  // Events now belong to an organization (the billing tenant). The legacy
  // SQLite schema predates that, so imported tournaments are parked in one
  // clearly-named organization rather than guessing an owner.
  const legacyOrg = await pg.organization.upsert({
    where: { id: "imported-legacy" },
    update: {},
    create: {
      id: "imported-legacy",
      name: "Imported tournaments",
      kind: "personal",
      subscription: { create: { plan: "free", status: "active" } },
    },
  });

  const keep = new Set(candidates.map((e) => String(e.id)));
  const scoped = (table: string) => read(table).filter((r) => keep.has(String(r.eventId)));
  const counts: Record<string, number> = {};
  const insert = async (label: string, fn: () => Promise<{ count: number }>) => {
    const { count } = await fn();
    counts[label] = count;
  };

  // Foreign-key dependency order.
  await insert("Event", () =>
    pg.event.createMany({
      data: candidates.map((r) => ({
        ...coerce(r, ["configUnlocked"], ["launchedAt", "createdAt", "updatedAt"]),
        organizationId: legacyOrg.id,
      })) as never,
      skipDuplicates: true,
    }),
  );
  await insert("Account", () => pg.account.createMany({ data: scoped("Account") as never, skipDuplicates: true }));
  await insert("Group", () => pg.group.createMany({ data: scoped("Group") as never, skipDuplicates: true }));
  await insert("Player", () => pg.player.createMany({ data: scoped("Player") as never, skipDuplicates: true }));
  await insert("Stage", () =>
    pg.stage.createMany({
      data: scoped("Stage").map((r) => coerce(r, ["carryForwardEnabled", "cutEnabled"])) as never,
      skipDuplicates: true,
    }),
  );
  await insert("Match", () =>
    pg.match.createMany({
      data: scoped("Match").map((r) => coerce(r, [], ["scoredAt"])) as never,
      skipDuplicates: true,
    }),
  );
  await insert("MatchScorecard", () =>
    pg.matchScorecard.createMany({ data: scoped("MatchScorecard") as never, skipDuplicates: true }),
  );
  await insert("Scorecard", () => pg.scorecard.createMany({ data: scoped("Scorecard") as never, skipDuplicates: true }));
  await insert("BracketWinner", () =>
    pg.bracketWinner.createMany({ data: scoped("BracketWinner") as never, skipDuplicates: true }),
  );
  await insert("Prize", () => pg.prize.createMany({ data: scoped("Prize") as never, skipDuplicates: true }));
  await insert("Announcement", () =>
    pg.announcement.createMany({
      data: scoped("Announcement").map((r) => coerce(r, ["pinned"], ["createdAt"])) as never,
      skipDuplicates: true,
    }),
  );
  await insert("Commentary", () =>
    pg.commentary.createMany({
      data: scoped("Commentary").map((r) => coerce(r, [], ["createdAt"])) as never,
      skipDuplicates: true,
    }),
  );

  // Users are global rather than per-event: bring across any that are missing
  // so the copied tournaments' organizers can still sign in.
  const users = read("User");
  if (users.length) {
    await insert("User", () =>
      pg.user.createMany({
        data: users.map((r) => coerce(r, [], ["createdAt"])) as never,
        skipDuplicates: true,
      }),
    );
  }

  console.log("\nRows copied:");
  for (const [table, n] of Object.entries(counts)) console.log(`   ${table.padEnd(16)} ${n}`);

  const after = await pg.event.findMany({ select: { name: true }, orderBy: { createdAt: "asc" } });
  console.log(`\nTarget now has ${after.length} event(s):`);
  for (const e of after) console.log(`   - ${e.name}`);

  db.close();
  await pg.$disconnect();
}

main().catch((e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
