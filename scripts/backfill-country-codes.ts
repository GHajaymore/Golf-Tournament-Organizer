/**
 * Put the catalogue's country column into one vocabulary: ISO 3166-1 alpha-2.
 *
 * WHY. Two providers, two habits. OpenGolfAPI sends `country_iso` and was
 * always stored as "GB"; GolfCourseAPI sends the country's NAME, so the same
 * country accumulated twice — 187 rows of "GB" beside 10 of "United Kingdom",
 * "KR" beside "Republic of Korea". The importer now normalises on the way in
 * (`countryCode`), and this clears the rows written before it did.
 *
 * It re-uses `countryCode` rather than reimplementing the map, so a name the
 * importer would leave alone is left alone here too — CLAUDE.md's lesson from
 * the yardage re-validation that cleared 33 good cards with an ad-hoc checker.
 * Anything unmapped is REPORTED, not guessed at, and the row is left as it is.
 *
 * Only the `country` column of `CourseCatalog` is written. Nothing else, and
 * no event data of any kind.
 *
 * Run:
 *   npx tsx scripts/backfill-country-codes.ts           # dry run, changes nothing
 *   npx tsx scripts/backfill-country-codes.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { countryCode } from "../src/lib/domain/course-directory";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  // `country` is a non-nullable column defaulting to "", so every row is read
  // and the blanks are skipped below rather than filtered in the query.
  const rows = await prisma.courseCatalog.findMany({
    select: { id: true, name: true, country: true },
  });

  const changes: { id: string; name: string; from: string; to: string }[] = [];
  const unmapped = new Map<string, number>();

  for (const r of rows) {
    const from = (r.country ?? "").trim();
    if (!from) continue;
    const to = countryCode(from);
    if (to === from) continue;
    // Still not a code: countryCode declined to guess. Report, do not write.
    if (!/^[A-Z]{2}$/.test(to)) {
      unmapped.set(from, (unmapped.get(from) ?? 0) + 1);
      continue;
    }
    changes.push({ id: r.id, name: r.name, from, to });
  }

  const byPair = new Map<string, number>();
  for (const c of changes) {
    const k = `${c.from} -> ${c.to}`;
    byPair.set(k, (byPair.get(k) ?? 0) + 1);
  }

  console.log(`${rows.length} rows carry a country. ${changes.length} would change.`);
  for (const [pair, n] of [...byPair.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${pair}`);
  }

  if (unmapped.size) {
    console.log("\nLeft alone — no code for these, and a guess is worse than untidy:");
    for (const [name, n] of unmapped) console.log(`  ${String(n).padStart(4)}  ${name}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Nothing written. Re-run with --apply.");
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const c of changes) {
    await prisma.courseCatalog.update({ where: { id: c.id }, data: { country: c.to } });
    written++;
  }
  console.log(`\n${written} rows updated.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
