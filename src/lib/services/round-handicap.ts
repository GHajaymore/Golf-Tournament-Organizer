import "server-only";
import { playedOnBy } from "./courses";
import { roundCourseHandicaps as roundHandicaps, flightTeeByPlayer } from "./handicaps";
import { prisma } from "../db";
import { type IndexHolder } from "../domain/handicap";
import {
  acceptsHandicapChange,
  handicapToFreeze,
  isReturnedCard,
  resolveRoundHandicap,
  type HandicapSource,
} from "../domain/round-handicap";

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
 * WHAT THE TWO FUNCTIONS BELOW NEED IN ORDER TO PRICE ONE ROUND — loaded here,
 * converted by `roundCourseHandicaps` in `handicaps.ts`.
 *
 * Both had the whole thing inline and both had it EVENT-WIDE: the tee came from
 * `teeSetupFor`, a single `Event.defaultTeeId` for the tournament, and the
 * ratings map was built without `courseId`, which `courseHandicapMap` reads as
 * "this caller cannot be judged, keep behaving as it did" and so lets every rung
 * through. `loadEventState` resolved both properly, per round, so on a
 * tournament played over two clubs the board and these two disagreed by eleven
 * strokes, the board being right.
 *
 * WHICH WOULD BE A SCREEN DEFECT IF ONE OF THEM DID NOT WRITE. The freeze puts
 * its answer in `RoundHandicap.frozen`, permanently, at the round's first card,
 * and `resolveRoundHandicap` prefers `frozen` over everything — so the wrong
 * number did not merely display, it OVERRULED the board's correct one for the
 * life of the tournament. Measured on the two-venue fixture: 17 playing strokes
 * where 7 is right.
 *
 * The QUERIES stay here rather than moving with the rule, because the freeze
 * must be able to decide not to make them: it runs on every card write, and a
 * round whose players are all frozen has to stop at two indexed reads.
 *
 * Deliberately NOT `loadEventState`, which resolves the same thing for the
 * boards — that runs inside a card write too, and loading a whole tournament to
 * price one round is the expensive way to ask a cheap question. The two are
 * pinned to each other by
 * `round-handicaps-follow-the-round-venue.audit.test.ts` rather than merged,
 * because two readers that agree by construction agree whether or not they are
 * right.
 */
async function roundCourseHandicaps(
  eventId: string,
  stage: { holes: number; teeId: string | null; courseId: string | null },
  /**
   * WITHOUT `flightTeeId` — this function supplies it. `IndexHolder` requires it
   * on purpose (eight callers once omitted it and every flight was priced off
   * the default set), so taking the whole type here would ask each caller for
   * the one field the whole point of this function is to resolve for them.
   */
  players: Omit<IndexHolder, "flightTeeId">[],
): Promise<Map<string, number>> {
  const [event, tees, flightTee] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      select: { teePolicy: true, defaultTeeId: true, courseId: true },
    }),
    prisma.tee.findMany({
      // This club's tees only: an unscoped read lets a player's `teeId` resolve
      // to another organization's rating and quietly changes the number being
      // written into history.
      where: { course: playedOnBy(eventId) },
      orderBy: [{ position: "asc" }],
    }),
    /**
     * The tees each player's FLIGHT plays from, under the `flight` policy.
     * Without it the freeze wrote the DEFAULT set's number into history
     * permanently, and the round's own screen showed a different handicap from
     * the card the player was handed.
     */
    flightTeeByPlayer(eventId),
  ]);

  /**
   * THE ARITHMETIC ITSELF IS `roundCourseHandicaps` IN `handicaps.ts`.
   *
   * This function was that arithmetic when it was written, for two callers. The
   * sweep that followed found six more, three of which WRITE what they compute,
   * so the rule moved to where `teeForPlay` lives and this became its loader:
   * the queries stay here, where the freeze can decide not to make them until
   * there is something to freeze, and the conversion is shared.
   *
   * Two copies of it would have been the defect this whole class is — one rule,
   * transcribed, drifting. `a-card-is-priced-by-its-own-round.test.ts` is what
   * noticed: it flagged this file for building a ratings map by hand, which was
   * correct even though the map was right.
   */
  return roundHandicaps({
    tees,
    players,
    flightTeeOf: flightTee,
    stage,
    event,
  });
}

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
    // `teeId` and `courseId` because the number being written into history is a
    // conversion off THIS ROUND'S tees — see `roundCourseHandicaps`.
    select: { holes: true, teeId: true, courseId: true },
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

  // Only resolve the tees once there is something to freeze. Steady state —
  // every later card in the round — stops at the line above.
  const courseHcp = await roundCourseHandicaps(eventId, stage, players);

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

/**
 * Whether this round has a card with a score on it — in any of the three
 * shapes a round can be scored in.
 *
 * The question `acceptsHandicapChange` was always meant to be asked. Asking
 * "is there a frozen row" instead gives the same answer for every round played
 * since the freeze existed, and the WRONG answer for every round played before
 * it: those have cards and no frozen row, so the screen would offer to change a
 * handicap that re-scores cards already in.
 */
export async function roundHasReturnedCard(eventId: string, stageId: string): Promise<boolean> {
  const [stroke, match, team] = await Promise.all([
    prisma.scorecard.findMany({ where: { eventId, stageId }, select: { strokes: true } }),
    prisma.matchScorecard.findMany({
      where: { eventId, match: { stageId } },
      select: { strokes: true },
    }),
    prisma.teamScorecard.findMany({ where: { eventId, stageId }, select: { strokes: true } }),
  ]);
  return [...stroke, ...match, ...team].some((c) => {
    try {
      return isReturnedCard(JSON.parse(c.strokes) as (number | null)[]);
    } catch {
      // A card nobody can parse is not a score.
      return false;
    }
  });
}

/** What one round says about its players: the committee's decision and the frozen fact. */
export type RoundHandicapRows = Map<string, { frozen: number | null; override: number | null }>;

/**
 * What a round says about each of its players, for the scoring paths that
 * build their own handicaps.
 *
 * `loadEventState` supplies the same rows to the board through
 * `strokeHandicapResolver`. Net match play, the team engines and the net
 * importer each convert their own handicaps, so each of them needs this too —
 * otherwise an organizer sets an override and one round type quietly ignores
 * it, which is worse than not offering the control at all.
 *
 * Empty for a round nobody has said anything about, and `roundHandicapOf` then
 * hands back the roster number unchanged.
 */
export async function roundHandicapRows(eventId: string, stageId: string): Promise<RoundHandicapRows> {
  const rows = await prisma.roundHandicap.findMany({
    where: { eventId, stageId },
    select: { playerId: true, override: true, frozen: true },
  });
  return new Map(rows.map((r) => [r.playerId, { frozen: r.frozen, override: r.override }]));
}

/** One player's handicap for one round, as the round configuration screen shows it. */
export interface RoundHandicapView {
  playerId: string;
  name: string;
  /** What the roster says today, converted for this round's tees and holes. */
  member: number;
  /** The committee's decision for this round, or null. */
  override: number | null;
  /** What the round was scored against, once its first card landed. */
  frozen: number | null;
  /** The number this round actually uses — a Course Handicap, before allowance. */
  handicap: number;
  source: HandicapSource;
  /** False once the round is frozen: the screen says why rather than disabling a box. */
  editable: boolean;
  /** What today's number would be, when a frozen round disagrees with it. */
  differsFromCurrent: number | null;
}

/**
 * Every player's handicap for one round, resolved.
 *
 * Through `resolveRoundHandicap`, the same reader the board uses, so the number
 * an organizer is shown here is the number their cards are being priced off. A
 * screen computing its own would be the 2026-08-12 defect all over again: two
 * places pricing one card, and only one of them right.
 *
 * In roster order, because that is the order the organizer just read the
 * handicaps in on the previous screen.
 */
export async function roundHandicapsFor(eventId: string, stageId: string): Promise<RoundHandicapView[]> {
  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    // As the freeze does, and for the same reason: the number shown here is the
    // number the round's cards are priced off, converted for THIS round's tees.
    select: { holes: true, teeId: true, courseId: true },
  });
  if (!stage) return [];

  // Scored, whether or not anything is frozen. A round played before the freeze
  // existed has cards and no rows, and offering to change its handicaps would
  // be offering to re-score them.
  const returned = await roundHasReturnedCard(eventId, stageId);

  const [rows, players] = await Promise.all([
    prisma.roundHandicap.findMany({
      where: { eventId, stageId },
      select: { playerId: true, override: true, frozen: true },
    }),
    prisma.player.findMany({
      where: { eventId, status: "confirmed" },
      select: { id: true, name: true, handicap: true, handicapType: true, teeId: true },
      orderBy: { seed: "asc" },
    }),
  ]);

  const courseHcp = await roundCourseHandicaps(eventId, stage, players);
  const byPlayer = new Map(rows.map((r) => [r.playerId, r]));

  return players.map((p) => {
    const row = byPlayer.get(p.id) ?? null;
    const member = courseHcp.get(p.id) ?? p.handicap;
    const resolved = resolveRoundHandicap({ frozen: row?.frozen, override: row?.override, member });
    return {
      playerId: p.id,
      name: p.name,
      member,
      override: row?.override ?? null,
      frozen: row?.frozen ?? null,
      handicap: resolved.handicap,
      source: resolved.source,
      editable: resolved.editable && acceptsHandicapChange(returned),
      differsFromCurrent: resolved.differsFromCurrent,
    };
  });
}
