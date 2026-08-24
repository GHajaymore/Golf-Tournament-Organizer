import "server-only";
import { COURSE_REF } from "./course-resolution";
import { teeSetupFor } from "./handicaps";
import { prisma } from "../db";
import { playSkins } from "../domain/skins";
import { rankStrokeIndex } from "../domain/stroke";
import { courseHandicapMap } from "../domain/handicap";
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
  /**
   * And over which holes: the front nine, the back nine, or all of them.
   *
   * Required rather than defaulted, because a default would read the wrong
   * game's money without complaining. A league night has four pots on one
   * round and only the pair (net, scope) tells them apart.
   */
  scope: SkinsScope,
): Promise<SkinsPotView | null> {
  const [pot, stage, event] = await Promise.all([
    prisma.skinsPot.findUnique({
      where: { stageId_net_scope: { stageId, net, scope } },
      include: { entrants: true },
    }),
    prisma.stage.findUnique({ where: { id: stageId }, select: { id: true, eventId: true, holes: true } }),
    prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF }),
  ]);
  if (!stage || stage.eventId !== eventId || !event) return null;

  const [players, cards, tees] = await Promise.all([
    prisma.player.findMany({
      where: { eventId, status: "confirmed" },
      /**
       * `teeId`, NOT `preferredTee`.
       *
       * They are different columns: `teeId` is the set this entry plays from,
       * a relation; `preferredTee` is free text a golfer typed at
       * registration ("white", "the blues"). This selected the text and
       * passed it where an id was wanted, into a map keyed by id — so it
       * never matched, every entrant silently fell back to the round's tees,
       * and net skins paid out on the wrong Course Handicap for anyone
       * assigned a different set. The same name-for-an-id fault that had a
       * tournament scoring against another course's stroke index.
       */
      select: { id: true, name: true, handicap: true, handicapType: true, teeId: true },
      orderBy: { seed: "asc" },
    }),
    prisma.scorecard.findMany({ where: { eventId, stageId } }),
    prisma.tee.findMany({
      where: { course: { events: { some: { eventId } } } },
      orderBy: [{ position: "asc" }],
    }),
  ]);

  // The scope now comes from the CALLER, because it is part of which pot was
  // asked for rather than something read back off whichever row turned up.
  // Deriving it from the row was safe only while one row could exist per
  // (stage, net); with four games on a round it would answer about the wrong
  // one. The stored value is still checked, so a bad row cannot widen a nine
  // into an eighteen.
  const stored = pot && isSkinsScope(pot.scope) ? pot.scope : scope;
  const { from, to } = scopeRange(stored, stage.holes);
  const course = resolveCourse(event);
  /**
   * Ranked 1..N for the holes actually being played.
   *
   * A slice of an eighteen-hole index still carries 1..18 values — the front
   * nine of a normal card is 1,3,5,…,17 — while the allocation compares them
   * against 1..9. See rankStrokeIndex for what that did to the pot.
   */
  const strokeIndex = rankStrokeIndex(course.strokeIndex.slice(from, to));

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

  /**
   * A real Course Handicap, not the Index off the player row.
   *
   * `Player.handicap` is a Handicap Index — a portable number that means
   * nothing until it is put against a set of tees. Passing it straight in
   * charged everyone the same strokes whatever they played off, and got the
   * nine-hole case wrong twice over: an eighteen-hole Index allocated across
   * nine holes gives roughly double the strokes a nine-hole competition
   * should. `courseHandicapMap` is the conversion the stroke-play board,
   * the team scoring and the regrouper already share — it converts the Index
   * AND the tee to the holes being played, once each.
   */
  const teeSetup = await teeSetupFor(eventId, tees);
  const teeRatings = new Map(
    tees.map((t) => [t.id, { courseRating: t.courseRating, slopeRating: t.slopeRating, par: t.par }]),
  );
  const courseHcp = courseHandicapMap(
    inPot.map((p) => ({
      id: p.id,
      handicap: p.handicap,
      handicapType: p.handicapType,
      teeId: p.teeId,
    })),
    teeRatings,
    teeSetup.defaultTeeId,
    holeCount === 9 ? 9 : 18,
    // Net skins are priced off the same tees the round is scored from. A
    // single-tee competition that allocated skins strokes off a player's
    // stored preference would pay money on a handicap nobody played to.
    teeSetup.policy,
  );

  const outcome = playSkins(
    inPot.map((p) => ({
      playerId: p.id,
      strokes: (strokesBy.get(p.id) ?? []).slice(from, to),
      // Falls back to the Index only when the course has no tees on file at
      // all, which is the old behaviour and the best available guess.
      courseHandicap: courseHcp.get(p.id) ?? p.handicap,
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

export interface SkinsSeasonRow {
  playerId: string;
  name: string;
  netCents: number;
  weeksPlayed: number;
}

/**
 * Where everybody stands across the season's skins.
 *
 * A league plays weekly and settles weekly, so this is a record of what
 * happened rather than a debt: the money has already changed hands each week.
 * It answers the question a league actually asks in the bar — who is up on
 * the year — and nothing more.
 *
 * Summed from each week's own result rather than recomputed from scratch, so
 * a week already settled cannot change because a later one was played.
 */
export async function skinsSeasonFor(eventId: string): Promise<SkinsSeasonRow[]> {
  const pots = await prisma.skinsPot.findMany({
    where: { eventId },
    // The scope too: a league night runs four pots on one round, and reading
    // (stageId, net) alone asked for the same one twice and missed the rest —
    // which for a season total is money that never appears.
    select: { stageId: true, net: true, scope: true },
  });
  if (pots.length === 0) return [];

  const weeks = await Promise.all(
    pots.map((p) =>
      skinsPotFor(eventId, p.stageId, p.net, isSkinsScope(p.scope) ? p.scope : "full"),
    ),
  );
  const results = weeks.filter((w): w is SkinsPotView => !!w && !!w.result).map((w) => w.result!);
  const nameById = weeks.find((w) => w)?.nameById ?? {};

  const totals = new Map<string, { netCents: number; weeksPlayed: number }>();
  for (const week of results) {
    for (const s of week.shares) {
      const t = totals.get(s.playerId) ?? { netCents: 0, weeksPlayed: 0 };
      t.netCents += s.netCents;
      t.weeksPlayed += 1;
      totals.set(s.playerId, t);
    }
  }

  return [...totals.entries()]
    .map(([playerId, t]) => ({ playerId, name: nameById[playerId] ?? "—", ...t }))
    .sort((a, b) => b.netCents - a.netCents || a.name.localeCompare(b.name));
}
