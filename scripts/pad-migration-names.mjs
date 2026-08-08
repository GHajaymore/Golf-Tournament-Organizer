// Renames applied-migration rows to their zero-padded folder names.
//
// The first twenty-eight migrations were numbered 0_ through 27_, and Prisma
// replays a migrations directory in lexicographic order — so a fresh database
// applied them as 0, 1, 10, 11 … 19, 2, 20 …, and died the first time a later
// migration touched a table an earlier-numbered one hadn't created yet. The
// folders are now zero-padded, which fixes every *new* database.
//
// Existing databases — the development one, and production — record applied
// migrations BY NAME in _prisma_migrations. After the folder rename, those
// rows point at names that no longer exist, and `migrate deploy` would try to
// re-apply history from the top. This script renames the rows to match,
// idempotently, and runs before `migrate deploy` in the build so production
// heals itself on its next deploy with nothing to remember.
//
// A brand-new database has no _prisma_migrations table; that is the no-op
// path, and it must stay silent — CI creates a fresh database on every run.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const exists = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('_prisma_migrations') IS NOT NULL AS present`,
  );
  if (!exists?.[0]?.present) {
    console.log("pad-migration-names: fresh database, nothing to rename");
    return;
  }

  const rows = await prisma.$queryRawUnsafe(
    `SELECT migration_name FROM _prisma_migrations`,
  );
  let renamed = 0;
  for (const { migration_name } of rows) {
    const m = /^(\d)_(.+)$/.exec(migration_name);
    if (!m) continue; // already padded, or not ours
    const padded = `0${m[1]}_${m[2]}`;
    await prisma.$executeRawUnsafe(
      `UPDATE _prisma_migrations SET migration_name = $1 WHERE migration_name = $2`,
      padded,
      migration_name,
    );
    renamed += 1;
  }
  console.log(`pad-migration-names: ${renamed} row(s) renamed`);
}

main()
  .catch((e) => {
    console.error("pad-migration-names failed:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
