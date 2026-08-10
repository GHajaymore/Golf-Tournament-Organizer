import "server-only";
import { prisma } from "../db";
import { playSkins } from "../domain/skins";
import {
  skinsPot,
  settle,
  scopeRange,
  isSkinsScope,
  type PotResult,
  type Transfer,
  type SkinsScope,
} from "../domain/skins-pot";
import { resolveCourse } from "../courses";

/**
 * A week's skins pot, resolved into money.
 *
 * The arithmetic lives in domain/skins-pot.ts and the golf in domain/skins.ts;
 * this only fetches, slices the right nine, and hands the two together.
 *
 * TourneyHQ calculates and records this money. It never moves it.
 */

export interface SkinsPotView {
  potId: string | null;
  buyInCents: number;
  net: boolean;
  scope: SkinsScope;
  /** Players staff have entered into the pot. */
  entrantIds: string[];
  /** Everyone who could be entered, for the picker. */
  field: Array<{ id: string; name: string; playing: boolean }>;
  /** Null until at least one player is entered — there is no pot before that. */
  result: PotResult | null;
  transfers: Transfer[];
  nameById: Record<string, string>;
  /** Per-hole detail, so the working is visible rather than asserted. */
  holes: Array<{ hole: number; playerId: string | null; value: number; carried: boolean }>;
}

/**
 * Everything the skins screen needs for one round.
 *
 * Returns a view even when no pot exists yet, so the screen can offer to
 * start one without a separate "does it exist" round-trip.
 */
export async function skinsPotFor(
  eventId: string,
  stageId: string,
  /** Which game: gross for the low handicaps, net so everybody has a chance.
   *  A club commonly runs both on the same night, so they are separate pots
   *  with separate entrants and separate money. */
  net: boolean,
): Promise<SkinsPotView | null> {
  const [pot, stage, event] = await Promise.all([
    prisma.skinsPot.findUnique({ where: { stageId_net: { stageId, net } }, include: { entrants: true } }),
    prisma.stage.findUnique({ where: { id: stageId }, select: { id: true, eventId: true, holes: true } }),
    prisma.event.findUnique({ where: { id: eventId } }),
  ]);
  if (!stage || stage.eventId !== eventId || !event) return null;

  const [players, cards] = await Promise.all([
    prisma.player.findMany({
      where: { eventId, status: "confirmed" },
      select: { id: true, name: true, handicap: true },
      orderBy: { seed: "asc" },
    }),
    prisma.scorecard.findMany({ where: { eventId, stageId } }),
  ]);

  const scope: SkinsScope = pot && isSkinsScope(pot.scope) ? pot.scope : "full";
  const { from, to } = scopeRange(scope, stage.holes);
  const course = resolveCourse(event);
  const strokeIndex = course.strokeIndex.slice(from, to);

  const parse = (s: string): (number | null)[] => {
    try {
      return JSON.parse(s) as (number | null)[];
    } catch {
      return [];
    }
  };
  const strokesBy = new Map(cards.map((c) => [c.playerId, parse(c.strokes)]));
  const returned = (id: string) => (strokesBy.get(id) ?? []).some((s) => s != null);

  const entrantIds = (pot?.entrants ?? []).map((e) => e.playerId);
  const nameById = Object.fromEntries(players.map((p) => [p.id, p.name]));

  // Only entrants play for the money. Someone can play the round and stay out
  // of the pot, which is exactly why entrants are stored rather than inferred.
  const inPot = players.filter((p) => entrantIds.includes(p.id));
  const holeCount = to - from;
  const outcome = playSkins(
    inPot.map((p) => ({
      playerId: p.id,
      strokes: (strokesBy.get(p.id) ?? []).slice(from, to),
      courseHandicap: p.handicap,
    })),
    holeCount,
    { net, strokeIndex },
  );

  // A hole nobody has returned a score for hasn't been played yet, and a
  // settlement built on it would be a guess.
  const unplayed = Array.from({ length: holeCount }, (_, h) =>
    inPot.some((p) => (strokesBy.get(p.id) ?? []).slice(from, to)[h] != null) ? 0 : 1,
  ).reduce((a: number, b: number) => a + b, 0);

  const result =
    inPot.length > 0
      ? skinsPot(outcome, pot?.buyInCents ?? 0, inPot.map((p) => p.id), unplayed)
      : null;

  return {
    potId: pot?.id ?? null,
    buyInCents: pot?.buyInCents ?? 0,
    net,
    scope,
    entrantIds,
    field: players.map((p) => ({ id: p.id, name: p.name, playing: returned(p.id) })),
    result,
    transfers: result ? settle(result.shares.map((s) => ({ playerId: s.playerId, netCents: s.netCents }))) : [],
    nameById,
    holes: outcome.holes.map((h) => ({
      hole: h.hole + from,
      playerId: h.playerId,
      value: h.value,
      carried: h.carried,
    })),
  };
}
