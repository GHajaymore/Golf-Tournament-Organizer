/**
 * How many rows, in every table with an `eventId`, `stageId` or `playerId`
 * column, point at an event, round or player that no longer exists.
 *
 * READ-ONLY: one SELECT per table and column, counts only, no names, ids or
 * scores. There is no update, create or delete in this file.
 *
 * WHY. Deleting a round or a tournament used to leave behind the rows whose
 * column has no foreign key (cards, handicaps, honours entries, SMS records ...).
 * `services/purge.ts` now removes them; this says how many are already there,
 * so a cleanup can be sized before it is written.
 *
 * The tables and columns are read from prisma/schema.prisma, so a model added
 * tomorrow is counted too. A blank ("" or NULL) column means "not tied to one"
 * (an expense for the whole outing) and is not an orphan.
 *
 *   node --env-file=.env scripts/rmstage-report-orphan-cards.mjs
 *
 * REFUSES any database that is not localhost unless `--i-am-ops` is given.
 * NOTE for HonoursEntry.playerId: a champion who has since left the roster is
 * an expected orphan by that table's design; the eventId line is the one that
 * matters there.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL ?? "";
let host = "";
try {
  host = new URL(url).hostname;
} catch {
  host = "";
}
const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
if (!local && !process.argv.includes("--i-am-ops")) {
  console.error(`Refusing: DATABASE_URL host is ${host ? "not localhost" : "unreadable"}. Pass --i-am-ops to read a non-local database (counts only).`);
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "prisma", "schema.prisma"), "utf8");
const PARENT = { eventId: "Event", stageId: "Stage", playerId: "Player" };

const targets = [];
for (const [, name, body] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  const fields = body.split("\n").map((l) => l.trim());
  for (const column of Object.keys(PARENT)) {
    if (name === PARENT[column]) continue;
    // `String` / `String?` only: a column that is a real name for the id.
    if (fields.some((l) => new RegExp(`^${column}\\s+String\\??(\\s|$)`).test(l))) targets.push({ table: name, column });
  }
}

const prisma = new PrismaClient();

async function count({ table, column }) {
  // Table and column names come from the schema file above, never from input.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "${table}" t WHERE t."${column}" IS NOT NULL AND t."${column}" <> '' ` +
      `AND NOT EXISTS (SELECT 1 FROM "${PARENT[column]}" p WHERE p.id = t."${column}")`,
  );
  return rows[0].n;
}

try {
  console.log(`database host: ${local ? "localhost" : "NON-LOCAL (--i-am-ops)"}`);
  let total = 0;
  for (const t of targets) {
    const n = await count(t);
    total += n;
    console.log(`${`${t.table}.${t.column}`.padEnd(34)} ${n} orphaned`);
  }
  console.log(`columns checked: ${targets.length}; total orphaned rows: ${total}`);
} finally {
  await prisma.$disconnect();
}
