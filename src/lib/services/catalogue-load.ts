import "server-only";
import { prisma } from "@/lib/db";
import { judgeRow, NO_COUNTS, CHUNK_ROWS, type CatalogueRow, type LoadCounts } from "@/lib/domain/catalogue-load";
import { cardRefusal } from "@/lib/domain/scorecard-parse";

/**
 * ONE REQUEST'S WORTH OF THE CATALOGUE LOAD (see `domain/catalogue-load.ts`).
 *
 * ADD AND UPDATE ONLY — nothing here deletes. Every incoming row has already been judged usable, so a
 * refused card never reaches the table; and as a second line, a row is never written over an existing
 * USABLE card unless the incoming one is usable too (it always is here; the check is what keeps the
 * promise if `judgeRow` is ever edited). Rows that already say the same are not written.
 */

export const CATALOGUE_LOG_KEY = "catalogue-load-log";
const KEEP_LINES = 30;
const FIELDS = ["name", "city", "state", "country", "website", "address", "par", "pars", "yards", "strokeIndex", "tees", "cardProblem"] as const;

function usable(c: { pars: string; strokeIndex: string; cardProblem: string }): boolean {
  if (c.cardProblem !== "" || !c.pars || !c.strokeIndex) return false;
  try {
    const pars = JSON.parse(c.pars) as number[];
    const si = JSON.parse(c.strokeIndex) as number[];
    return cardRefusal(pars, [], si, pars.length) === null;
  } catch {
    return false;
  }
}

export async function loadCatalogueRows(raw: unknown[]): Promise<LoadCounts> {
  const counts = { ...NO_COUNTS };
  const fresh = new Map<string, CatalogueRow>();
  // A request is bounded: rows past three chunks' worth are not read at all (the client sends one).
  for (const r of raw.slice(0, CHUNK_ROWS * 3)) {
    const v = judgeRow(r);
    if (v.ok) fresh.set(v.row.id, v.row);
    else if (v.kind === "gca") counts.refusedGca++;
    else counts.skipped++;
  }
  const have = await prisma.courseCatalog.findMany({ where: { id: { in: [...fresh.keys()] } } });
  const existing = new Map(have.map((h) => [h.id, h]));
  const toCreate: CatalogueRow[] = [];
  for (const row of fresh.values()) {
    const was = existing.get(row.id);
    if (!was) {
      toCreate.push(row);
      continue;
    }
    if (FIELDS.every((k) => was[k] === row[k])) {
      counts.unchanged++;
      continue;
    }
    if (usable(was) && !usable(row)) {
      counts.skipped++;
      continue;
    }
    const { id, ...data } = row;
    await prisma.courseCatalog.update({ where: { id }, data });
    counts.updated++;
  }
  if (toCreate.length) {
    const made = await prisma.courseCatalog.createMany({ data: toCreate, skipDuplicates: true });
    counts.loaded += made.count;
  }
  return counts;
}

/** What the owner's card shows beside the press: how many courses with a card, and the last audit line. */
export async function catalogueStatus(): Promise<{ withCards: number; lastLine: string }> {
  const [withCards, row] = await Promise.all([
    prisma.courseCatalog.count({ where: { cardProblem: "", NOT: { pars: "" } } }),
    prisma.platformSetting.findUnique({ where: { key: CATALOGUE_LOG_KEY } }),
  ]);
  const lines = row?.value ? row.value.split("\n") : [];
  return { withCards, lastLine: lines[lines.length - 1] ?? "" };
}

/** The audit line: who, when, what — kept as the last 30 lines of one settings row. */
export async function noteCatalogueLoad(who: string, counts: LoadCounts, at: Date): Promise<void> {
  const line = `${at.toISOString()} ${who}: ${counts.loaded} loaded, ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.skipped} skipped, ${counts.refusedGca} refused (gca)`;
  const row = await prisma.platformSetting.findUnique({ where: { key: CATALOGUE_LOG_KEY } });
  const lines = (row?.value ? row.value.split("\n") : []).concat(line).slice(-KEEP_LINES);
  await prisma.platformSetting.upsert({
    where: { key: CATALOGUE_LOG_KEY },
    update: { value: lines.join("\n") },
    create: { key: CATALOGUE_LOG_KEY, value: lines.join("\n") },
  });
  console.log(`[catalogue-load] ${line}`);
}
