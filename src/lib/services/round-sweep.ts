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
 * The rounds whose time is up, oldest first.
 *
 * Exported as its own step so the gap between deciding and deleting is a real
 * seam rather than an internal detail — see `deleteIfStillDue` for what lives
 * in that gap, and why a test that cannot get inside it proves nothing about
 * the race it claims to cover.
 *
 * Takes one more than the cap so the caller can tell "exactly full" from
 * "there are more".
 */
export async function dueRounds(now: Date = new Date()): Promise<string[]> {
  const rows = await prisma.event.findMany({
    where: { expiresAt: { not: null, lte: now } },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: SWEEP_LIMIT + 1,
  });
  return rows.map((r) => r.id);
}

/**
 * Delete one round, but only if it is STILL due at the moment of deletion.
 *
 * The read and the delete are two statements, and in between them somebody may
 * have pressed "Keep this round" — which is exactly the person whose data must
 * not be destroyed. Repeating the condition inside `deleteMany` makes the
 * check and the delete atomic for that row, so a round kept a second ago
 * survives a sweep already in flight.
 *
 * SEPARATE FROM THE SELECT ON PURPOSE, and the reason is a test that lied.
 * The race was originally covered by clearing `expiresAt` and then running the
 * whole sweep — which never reproduces anything, because the select simply
 * does not return the row. That test passed with the re-check deleted, and
 * passed again with the select widened to every event in the database: it
 * looked exactly like coverage of the interleaving and could not observe it at
 * all. Two callable halves let a test sit in the gap where the race actually
 * happens.
 *
 * Returns whether the row was removed.
 */
export async function deleteIfStillDue(id: string, now: Date = new Date()): Promise<boolean> {
  const gone = await prisma.event.deleteMany({
    where: { id, expiresAt: { not: null, lte: now } },
  });
  return gone.count > 0;
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
  const due = await dueRounds(now);
  const batch = due.slice(0, SWEEP_LIMIT);

  const ids: string[] = [];
  for (const id of batch) {
    if (await deleteIfStillDue(id, now)) ids.push(id);
  }

  return { deleted: ids.length, ids, more: due.length > SWEEP_LIMIT };
}
