#!/usr/bin/env node
/**
 * HOW MANY TOURNAMENTS THE OLD BLANKET UNLOCK STILL HOLDS OPEN — counts only, read-only.
 *
 * State machine PR 5b retires "Unlock configuration". A production event that is
 * live today with `configUnlocked = true` would find its setup read as the legacy
 * correction (still open) — the Ops risk of panel 8.5 — so Ops counts those rows
 * BEFORE the PR merges, through the owner's tools:
 *
 *   node --env-file=.env scripts/count-unlocked-events.mjs
 *   node --env-file=.env.production scripts/count-unlocked-events.mjs --i-am-ops
 *
 * It prints COUNTS, never a name, an id or an address (hard rules 1 and 2). It
 * writes nothing. It refuses a database that is not on this machine unless
 * `--i-am-ops` is given, checked on the HOST, as `scripts/seed-club.mjs` does.
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.error("No DATABASE_URL — run with --env-file=.env");
  process.exit(2);
}
let host;
try {
  host = new URL(url).hostname.toLowerCase();
} catch {
  console.error("DATABASE_URL is not a URL this script can read the host from. Refusing.");
  process.exit(2);
}
const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
const ops = process.argv.includes("--i-am-ops");
if (!local && !ops) {
  console.error(`Refusing to read a database at "${host}" without --i-am-ops. This script only counts, but production is Ops' to read.`);
  process.exit(2);
}

const prisma = new PrismaClient();
try {
  const [unlocked, byStatus, liveToday, corrections, total] = await Promise.all([
    prisma.event.count({ where: { configUnlocked: true } }),
    prisma.event.groupBy({ by: ["status"], where: { configUnlocked: true }, _count: true }),
    // Live (launched, not completed) and unlocked: the rows an Organizer would find read as a legacy correction mid-event.
    prisma.event.count({ where: { configUnlocked: true, status: "live" } }),
    prisma.event.count({ where: { correctionScope: { not: null } } }).catch(() => null),
    prisma.event.count(),
  ]);
  console.log(`database host: ${host}${local ? " (local)" : " (NOT local — read as Ops)"}`);
  console.log(`tournaments: ${total}`);
  console.log(`configUnlocked = true: ${unlocked}`);
  for (const row of byStatus.sort((a, b) => a.status.localeCompare(b.status))) console.log(`  status ${row.status}: ${row._count}`);
  console.log(`live and unlocked (the Ops risk, panel 8.5): ${liveToday}`);
  console.log(`committee corrections open: ${corrections === null ? "n/a (A040 not applied here)" : corrections}`);
} finally {
  await prisma.$disconnect();
}
