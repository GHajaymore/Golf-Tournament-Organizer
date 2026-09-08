import { prisma } from "@/lib/db";

/**
 * Deleting the casual rounds that have run out of time.
 *
 * THE ONLY SCHEDULED DELETE IN THE PRODUCT. It runs unattended, against
 * production, with nobody reading the result — so the whole of this file is
 * about the query being unable to name a row it should not.
 *
 * The condition is `expiresAt` not null AND in the past. Not "and shape is
 * match", not "and it has no scores", not "and it is old": one column, set by
 * one caller, null on every tournament that has ever existed. Extra conditions
 * would read as extra safety and are the opposite — each one is a thing that
 * can be got wrong, and none of them can make the query safer than a column
 * that a tournament does not have.
 *
 * `Event` cascades to everything hanging off it — players, stages, matches,
 * teams, cards, pots — so the row goes whole. That is what makes this
 * irreversible and why `keepRound` exists.
 */

/** Never remove more than this in one pass. */
const SWEEP_LIMIT = 200;

export interface SweepResult {
  deleted: number;
  /** Names are NOT returned. See the note in `sweepExpiredRounds`. */
  ids: string[];
  /** True when the limit was hit and more remain for the next pass. */
  more: boolean;
}

/**
 * Delete every casual round whose time is up.
 *
 * Capped, and the cap is not about performance. An unbounded DELETE driven by
 * a clock is a single wrong comparison away from emptying a table, and a
 * capped one leaves 200 rows of damage and a number that looks wrong on the
 * very first run instead of all of it. The remainder is picked up next pass;
 * nothing is lost by going slowly.
 *
 * IDs, never names. This runs in production and its output goes to logs — and
 * a casual round is named after the people playing it, so logging the name
 * writes real players' names somewhere they were never meant to go.
 */
export async function sweepExpiredRounds(now: Date = new Date()): Promise<SweepResult> {
  const due = await prisma.event.findMany({
    where: { expiresAt: { not: null, lte: now } },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: SWEEP_LIMIT + 1,
  });

  const batch = due.slice(0, SWEEP_LIMIT);
  const ids: string[] = [];
  for (const row of batch) {
    /**
     * Re-checked at the moment of deletion, one row at a time.
     *
     * The read above and the delete below are not one statement, and in
     * between them somebody may have pressed "Keep this round" — which is
     * exactly the person whose data must not be destroyed. `deleteMany` with
     * the condition repeated makes the check and the delete atomic for that
     * row, so a round kept a second ago survives a sweep already in flight.
     */
    const gone = await prisma.event.deleteMany({
      where: { id: row.id, expiresAt: { not: null, lte: now } },
    });
    if (gone.count > 0) ids.push(row.id);
  }

  return { deleted: ids.length, ids, more: due.length > SWEEP_LIMIT };
}
