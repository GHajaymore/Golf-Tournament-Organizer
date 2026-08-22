import "server-only";
import { prisma } from "../db";
import { courseHandicapMap } from "../domain/handicap";
import { handicapToFreeze } from "../domain/round-handicap";

/**
 * Freezing what a round is scored against, the moment it starts being scored.
 *
 * The rule itself lives in `src/lib/domain/round-handicap.ts`; this is the one
 * place that writes it down. Everything here is a COURSE handicap, the same
 * unit the board resolves and the same one the round's allowance is applied to
 * afterwards.
 *
 * WHEN: at the round's first card, not at its completion. Ten cards scored
 * against a handicap that is still moving is exactly the thing this feature
 * exists to prevent, and the app puts a card on the board as soon as it is
 * entered — no board here filters on `Scorecard.status` — so entry is the
 * moment the number starts counting.
 *
 * WHAT VALUE: whatever the board was already using for that player in that
 * round, taken through the same `courseHandicapMap` the read path uses. A
 * freeze that computed the number a different way would re-score the very card
 * that triggered it, which is the one thing it must never do.
 *
 * WHO: every confirmed player in the round, not only the player whose card
 * arrived. The round is what freezes. A field where one card is in and the
 * rest are on the way is the ordinary case, and the last card in must not be
 * priced differently from the first.
 */

/**
 * Write `frozen` for every player in a round that does not already have one.
 *
 * Idempotent and safe to call on every card write: a round whose players are
 * all frozen costs two indexed reads and writes nothing. Call it AFTER the card
 * is stored, so a card that fails validation never freezes a round that was
 * not played.
 *
 * Returns how many players were frozen by this call — 0 on every call after
 * the first.
 */
export async function freezeRoundHandicaps(eventId: string, stageId: string): Promise<number> {
  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    select: { holes: true },
  });
  if (!stage) return 0;

  const [rows, players] = await Promise.all([
    prisma.roundHandicap.findMany({
      where: { eventId, stageId },
      select: { playerId: true, override: true, frozen: true },
    }),
    prisma.player.findMany({
      where: { eventId, status: "confirmed" },
      select: { id: true, handicap: true, handicapType: true, teeId: true },
    }),
  ]);

  const byPlayer = new Map(rows.map((r) => [r.playerId, r]));
  const pending = players.filter((p) => (byPlayer.get(p.id)?.frozen ?? null) === null);
  if (pending.length === 0) return 0;

  // Only read the tees once there is something to freeze. Steady state — every
  // later card in the round — stops at the line above.
  const tees = await prisma.tee.findMany({
    // This club's tees only, the same scoping `handicapsForRound` needs: an
    // unscoped read lets a player's teeId resolve to another organization's
    // rating and quietly changes the number being written into history.
    where: { course: { events: { some: { eventId } } } },
    orderBy: [{ position: "asc" }],
  });
  const holes = stage.holes === 9 ? 9 : 18;
  const teeRatings = new Map(
    tees.map((t) => [t.id, { courseRating: t.courseRating, slopeRating: t.slopeRating, par: t.par }]),
  );
  const courseHcp = courseHandicapMap(players, teeRatings, tees[0]?.id ?? null, holes);

  const frozenAt = new Date();
  const valueFor = (p: (typeof pending)[number]) =>
    handicapToFreeze({
      override: byPlayer.get(p.id)?.override ?? null,
      // The board's own fallback: an unrated field has no conversion to make,
      // so the roster number is the Course Handicap.
      member: courseHcp.get(p.id) ?? p.handicap,
    });

  const missing = pending.filter((p) => !byPlayer.has(p.id));
  const held = pending.filter((p) => byPlayer.has(p.id));

  // `frozen: null` in the update and `skipDuplicates` on the insert are the
  // guard, not the `pending` filter above: two cards saved at the same instant
  // both read an unfrozen round, and the database is the only thing that can
  // decide which of them wins. Neither statement can overwrite a frozen row.
  await prisma.$transaction([
    ...(missing.length
      ? [
          prisma.roundHandicap.createMany({
            data: missing.map((p) => ({ eventId, stageId, playerId: p.id, frozen: valueFor(p), frozenAt })),
            skipDuplicates: true,
          }),
        ]
      : []),
    ...held.map((p) =>
      prisma.roundHandicap.updateMany({
        where: { eventId, stageId, playerId: p.id, frozen: null },
        data: { frozen: valueFor(p), frozenAt },
      }),
    ),
  ]);

  return pending.length;
}
