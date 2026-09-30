import "server-only";
import { prisma } from "../db";
import { golfBeganAt, closesAtFrom, holesEntered, PLANS_THAT_DELETE } from "../domain/close-terms";

/**
 * A PAR TOURNAMENT CLOSES ON ITS OWN — the half of the Par terms that holds
 * whether or not anybody presses Complete (Ajay, 2026-09-29).
 *
 * The SECOND scheduled delete in the product, after `round-sweep.ts`, and
 * built the way that one explains: the thing that decides a row may be
 * destroyed is a column (`closesAt`), set once, and the delete repeats every
 * condition inside its own statement so nothing that changed in between — an
 * upgrade, a hold, a club found to predate the terms — can be run over.
 *
 * Two steps, run in this order by the daily cron:
 *   1. `stampParClocks` — the first time golf is SEEN on a Par tournament,
 *      write `closesAt`, fourteen days on. Once: it never touches a stamped row,
 *      so a score entered every week buys nothing.
 *   2. `sweepClosedPar` — delete what is due.
 */

/** Never touch more than this in one pass. */
const SWEEP_LIMIT = 200;

/** The tournaments held to the Par terms — the same rule `wipesOnClose` states. */
const onParTerms = {
  shape: { not: "match" },
  organization: { subscription: { planTermsApply: true, plan: { in: PLANS_THAT_DELETE } } },
};

/** Has anything been played? Any card, any match hole or forfeit, any tie won or reported. */
async function resultRecorded(eventId: string): Promise<boolean> {
  const [cards, teamCards, matches, ties, reports] = await Promise.all([
    prisma.scorecard.findMany({ where: { eventId }, select: { strokes: true } }),
    prisma.teamScorecard.findMany({ where: { eventId }, select: { strokes: true } }),
    prisma.match.findMany({ where: { eventId }, select: { holes: true, forfeitedBy: true } }),
    prisma.bracketWinner.count({ where: { eventId } }),
    // A knockout result a player reported, even before anybody approves it.
    prisma.bracketReport.count({ where: { eventId } }),
  ]);
  return (
    ties > 0 ||
    reports > 0 ||
    cards.some((c) => holesEntered(c.strokes)) ||
    teamCards.some((c) => holesEntered(c.strokes)) ||
    matches.some((m) => holesEntered(m.holes) || m.forfeitedBy !== "")
  );
}

export async function stampParClocks(now: Date = new Date()): Promise<number> {
  const open = await prisma.event.findMany({
    where: { ...onParTerms, closesAt: null, status: { not: "completed" } },
    select: { id: true, stages: { select: { playedOn: true } } },
    take: SWEEP_LIMIT,
  });
  let stamped = 0;
  for (const e of open) {
    const seen = (await resultRecorded(e.id)) ? now : null;
    const began = golfBeganAt(
      e.stages.map((s) => s.playedOn),
      seen,
      now,
    );
    if (!began) continue;
    // `closesAt: null` in the WHERE, so two overlapping passes cannot stamp
    // twice and a stamped clock is never moved.
    const r = await prisma.event.updateMany({
      where: { id: e.id, closesAt: null },
      data: { closesAt: closesAtFrom(began) },
    });
    stamped += r.count;
  }
  return stamped;
}

export interface ParSweepResult {
  deleted: number;
  more: boolean;
}

export async function sweepClosedPar(now: Date = new Date()): Promise<ParSweepResult> {
  // Every condition, repeated in the delete itself for each row.
  const due = {
    ...onParTerms,
    closesAt: { not: null, lte: now },
    OR: [{ retainUntil: null }, { retainUntil: { lte: now } }],
  };
  const rows = await prisma.event.findMany({
    where: due,
    select: { id: true },
    orderBy: { closesAt: "asc" },
    take: SWEEP_LIMIT + 1,
  });
  let deleted = 0;
  for (const r of rows.slice(0, SWEEP_LIMIT)) {
    const d = await prisma.event.deleteMany({ where: { id: r.id, ...due } });
    deleted += d.count;
  }
  return { deleted, more: rows.length > SWEEP_LIMIT };
}
