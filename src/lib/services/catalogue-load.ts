import "server-only";
import { prisma } from "@/lib/db";
import { judgeRow, holesRefusal, NO_COUNTS, CHUNK_ROWS, type CatalogueRow, type LoadCounts } from "@/lib/domain/catalogue-load";

/**
 * ONE REQUEST'S WORTH OF THE CATALOGUE LOAD (see `domain/catalogue-load.ts`).
 *
 * ADD, AND FILL WHAT IS NOT USABLE — nothing here deletes, and nothing here overwrites a card that
 * already works. Production's own import writes the same OpenGolfAPI ids, so a stored row with a
 * USABLE card is left exactly as it is and counted "unchanged" (a development copy that is thinner
 * must not blank its city, website, address, yardage or tees). A stored row whose card is NOT usable
 * is filled from the incoming one, and an empty incoming value never replaces a non-empty stored one.
 */

export const CATALOGUE_LOG_KEY = "catalogue-load-log";
const KEEP_LINES = 30;
const FIELDS = ["name", "city", "state", "country", "website", "address", "par", "pars", "yards", "strokeIndex", "tees", "cardProblem"] as const;

function usable(c: { pars: string; strokeIndex: string; cardProblem: string }): boolean {
  if (c.cardProblem !== "" || !c.pars || !c.strokeIndex) return false;
  try {
    const pars = JSON.parse(c.pars) as number[];
    const si = JSON.parse(c.strokeIndex) as number[];
    return Array.isArray(pars) && Array.isArray(si) && holesRefusal(pars, si) === null;
  } catch {
    return false;
  }
}

/** The incoming row laid over a stored one that has no usable card: never an empty over a non-empty. */
function filled(was: CatalogueRow, row: CatalogueRow): Omit<CatalogueRow, "id"> {
  const keep = <K extends "name" | "city" | "state" | "country" | "website" | "address" | "yards">(k: K) => row[k] || was[k];
  return {
    name: keep("name"),
    city: keep("city"),
    state: keep("state"),
    country: keep("country"),
    website: keep("website"),
    address: keep("address"),
    par: row.par || was.par,
    pars: row.pars,
    yards: keep("yards"),
    strokeIndex: row.strokeIndex,
    tees: row.tees !== "[]" ? row.tees : was.tees,
    cardProblem: "",
  };
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
    // A card that already works is never touched.
    if (usable(was)) {
      counts.unchanged++;
      continue;
    }
    const data = filled(was, row);
    if (FIELDS.every((k) => was[k] === data[k])) {
      counts.unchanged++;
      continue;
    }
    await prisma.courseCatalog.update({ where: { id: row.id }, data });
    counts.updated++;
  }
  if (toCreate.length) {
    const made = await prisma.courseCatalog.createMany({ data: toCreate, skipDuplicates: true });
    counts.loaded += made.count;
  }
  return counts;
}

/** What the owner's card shows beside the press: how many courses have a card on file, and the last audit line. */
export async function catalogueStatus(): Promise<{ withCards: number; lastLine: string }> {
  const [withCards, row] = await Promise.all([
    prisma.courseCatalog.count({ where: { cardProblem: "", NOT: { pars: "" } } }),
    prisma.platformSetting.findUnique({ where: { key: CATALOGUE_LOG_KEY } }),
  ]);
  const lines = row?.value ? row.value.split("\n") : [];
  return { withCards, lastLine: lines[lines.length - 1] ?? "" };
}

const LINE = /^(\S+) (\S+) \[load (\w+)\]: (\d+) loaded, (\d+) updated, (\d+) unchanged, (\d+) skipped, (\d+) refused \(gca\)/;

/**
 * The audit line: who, when, what — ONE line per load, however many requests it took. A request that
 * carries the same load id as the last line adds its counts to that line instead of starting another.
 * Kept as the last 30 lines of one settings row.
 */
export async function noteCatalogueLoad(who: string, counts: LoadCounts, at: Date, loadId: string, part: number, of: number): Promise<void> {
  const row = await prisma.platformSetting.findUnique({ where: { key: CATALOGUE_LOG_KEY } });
  const lines = row?.value ? row.value.split("\n") : [];
  let total = counts;
  const last = lines[lines.length - 1]?.match(LINE);
  if (last && last[3] === loadId && last[2] === who) {
    lines.pop();
    total = {
      loaded: counts.loaded + Number(last[4]),
      updated: counts.updated + Number(last[5]),
      unchanged: counts.unchanged + Number(last[6]),
      skipped: counts.skipped + Number(last[7]),
      refusedGca: counts.refusedGca + Number(last[8]),
    };
  }
  const line = `${at.toISOString()} ${who} [load ${loadId}]: ${total.loaded} loaded, ${total.updated} updated, ${total.unchanged} unchanged, ${total.skipped} skipped, ${total.refusedGca} refused (gca), request ${part} of ${of}`;
  const value = lines.concat(line).slice(-KEEP_LINES).join("\n");
  await prisma.platformSetting.upsert({
    where: { key: CATALOGUE_LOG_KEY },
    update: { value },
    create: { key: CATALOGUE_LOG_KEY, value },
  });
  console.log(`[catalogue-load] ${line}`);
}
