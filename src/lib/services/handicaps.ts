import "server-only";
import { prisma } from "../db";
import { courseHandicap, nineHoleTee, isRated, explainHandicap, indexForHoles, type TeeRating, teeIdFor } from "../domain/handicap";
import { parseHoleArray } from "../courses";

/**
 * Turning a roster of Handicap Indexes into the strokes each player receives
 * for one particular round.
 *
 * The conversion needs three things the Player row doesn't carry: which tees
 * they are on, what those tees are rated, and how many holes are being played.
 * This resolves all three and hands the scoring engines a Course Handicap,
 * which is what every one of them already assumes it is being given.
 */

export interface PlayerHandicap {
  playerId: string;
  name: string;
  /** As held on the roster — portable, course-independent. */
  index: number;
  /** What that index is worth on these tees. */
  courseHandicap: number;
  teeName: string;
  /** False when nobody has entered a rating, so the index is used as-is. */
  rated: boolean;
  /** The arithmetic in words, for when a golfer queries their strokes. */
  detail: string;
}

/** The tees for a round, with the holes actually being played accounted for. */
export function teeRatingFor(
  tee: { courseRating: number; slopeRating: number; par: number } | null,
  holes: number,
): TeeRating | null {
  if (!tee) return null;
  const full: TeeRating = {
    courseRating: tee.courseRating,
    slopeRating: tee.slopeRating,
    par: tee.par,
  };
  return holes === 9 ? nineHoleTee(full) : full;
}

/**
 * Every player's strokes for a round.
 *
 * `defaultTeeId` is the round's tees, used for anyone who hasn't been put on a
 * specific set — which is most fields most of the time. A player's own teeId
 * wins, because mixed tees are the case that makes this whole calculation
 * necessary.
 */
export async function handicapsForRound(
  eventId: string,
  holes: number,
  defaultTeeId: string | null,
  allowancePct = 100,
): Promise<PlayerHandicap[]> {
  const [players, tees] = await Promise.all([
    prisma.player.findMany({
      where: { eventId, status: "confirmed" },
      select: { id: true, name: true, handicap: true, handicapType: true, teeId: true },
      orderBy: { seed: "asc" },
    }),
    prisma.tee.findMany({
      // This club's tees only. An unscoped read let a player's teeId resolve
      // to another organization's rating, quietly changing their handicap.
      where: { course: { events: { some: { eventId } } } },
      orderBy: [{ position: "asc" }],
    }),
  ]);
  const teeById = new Map(tees.map((t) => [t.id, t]));

  /**
   * The competition's tee policy, read here rather than threaded in.
   *
   * This function already knows the event, so asking callers to pass the
   * policy would be a check every one of them has to remember — and one that
   * forgets it scores a single-tee competition off whatever tees players
   * happen to have on their records, with nothing on screen wrong.
   */
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { teePolicy: true },
  });
  const policy = event?.teePolicy ?? "own";

  return players.map((p) => {
    const tee = teeById.get(teeIdFor(policy, p.teeId, defaultTeeId)) ?? null;
    const rating = teeRatingFor(tee, holes);
    // Index and rating are each converted to the holes being played, once.
    // The old conversion only handled stored 9-hole indexes; an ordinary
    // 18-hole index in a 9-hole round was never halved and got double strokes.
    const index = indexForHoles(p.handicap, p.handicapType, holes);
    const e = explainHandicap(index, rating, allowancePct);
    return {
      playerId: p.id,
      name: p.name,
      index,
      courseHandicap: e.courseHandicap,
      teeName: tee?.name ?? "",
      rated: e.rated,
      detail: e.detail,
    };
  });
}

/**
 * Which tee each player is on, by name, for putting on a card.
 *
 * Every card — the printed one a group carries out, and the one on screen at
 * score entry — should say what each player is playing from, because that is
 * the thing a marker checks before anyone hits. Built on `handicapsForRound`
 * so the name on the card is the tee the round was actually SCORED from,
 * policy and all. A second resolution here would eventually print one tee and
 * score another, which is worse than printing nothing.
 *
 * Empty string for a player on no rated tee — the card then simply says
 * nothing rather than inventing a set.
 */
export async function teeNamesForRound(
  eventId: string,
  holes: number,
  defaultTeeId: string | null,
): Promise<Map<string, string>> {
  const rows = await handicapsForRound(eventId, holes, defaultTeeId);
  return new Map(rows.map((r) => [r.playerId, r.teeName]));
}

/**
 * The competition's tee policy, for the paths that convert handicaps
 * themselves rather than going through `handicapsForRound`.
 *
 * One reader, so those paths cannot each decide the question differently.
 * Falls back to "own", which is the behaviour every tournament had before the
 * setting existed — a missing event must not silently make a field play off
 * one tee it never agreed to.
 */
export async function teePolicyFor(eventId: string): Promise<string> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { teePolicy: true },
  });
  return event?.teePolicy ?? "own";
}

/** One player's course handicap, for the paths that only need a single number. */
export async function courseHandicapForPlayer(
  playerId: string,
  holes: number,
  defaultTeeId: string | null,
): Promise<number> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    // The event's policy comes with the player, so this path applies the same
    // rule as the round-wide one. Resolving the tee two different ways is how
    // one screen ends up disagreeing with another about a net score.
    select: {
      handicap: true,
      handicapType: true,
      teeId: true,
      event: { select: { teePolicy: true } },
    },
  });
  if (!player) return 0;
  const teeId = teeIdFor(player.event?.teePolicy ?? "own", player.teeId, defaultTeeId) || null;
  const tee = teeId ? await prisma.tee.findUnique({ where: { id: teeId } }) : null;
  const index = indexForHoles(player.handicap, player.handicapType, holes);
  return courseHandicap(index, teeRatingFor(tee, holes));
}

export interface TeeView {
  id: string;
  courseId: string;
  name: string;
  gender: string;
  courseRating: number;
  slopeRating: number;
  par: number;
  rated: boolean;
  /** Per-hole data, falling back to the course's own where the tee has none. */
  pars: number[];
  yards: number[];
  strokeIndex: number[];
}

/**
 * The tees a tournament can be played from, with per-hole data resolved.
 *
 * A tee usually inherits the course's card and overrides only its ratings;
 * championship tees that genuinely play a different par or index carry their
 * own. Resolving it here means nothing downstream has to know the difference.
 */
export async function teesForEvent(eventId: string): Promise<TeeView[]> {
  const courses = await prisma.course.findMany({
    where: { events: { some: { eventId } } },
    include: { tees: { orderBy: [{ position: "asc" }, { name: "asc" }] } },
  });

  const out: TeeView[] = [];
  for (const c of courses) {
    // parseHoleArray returns null for anything unparseable, and an empty array
    // is the honest representation of "no data" for every consumer here.
    const coursePars = parseHoleArray(c.pars) ?? [];
    const courseYards = parseHoleArray(c.yards) ?? [];
    const courseSi = parseHoleArray(c.strokeIndex) ?? [];
    for (const t of c.tees) {
      const pars = parseHoleArray(t.pars) ?? [];
      const yards = parseHoleArray(t.yards) ?? [];
      const si = parseHoleArray(t.strokeIndex) ?? [];
      out.push({
        id: t.id,
        courseId: c.id,
        name: t.name,
        gender: t.gender,
        courseRating: t.courseRating,
        slopeRating: t.slopeRating,
        par: t.par,
        rated: isRated(t),
        pars: pars.length ? pars : coursePars,
        yards: yards.length ? yards : courseYards,
        strokeIndex: si.length ? si : courseSi,
      });
    }
  }
  return out;
}

/**
 * Whether a tournament is scoring net results off unrated tees.
 *
 * Worth surfacing rather than silently approximating: a club that has entered
 * its ratings expects them used, and one that hasn't should know its net
 * results are running on raw indexes.
 */
export async function unratedWarning(eventId: string, basis: string): Promise<string | null> {
  if (basis === "gross") return null; // gross play needs no handicap at all
  const tees = await teesForEvent(eventId);
  if (tees.length === 0) {
    return "No tees have been set up for this course, so net scores use each player's raw handicap index. Add a set of tees with its Course Rating and Slope to score properly.";
  }
  const unrated = tees.filter((t) => !t.rated);
  if (unrated.length === 0) return null;
  return `${unrated.map((t) => t.name).join(", ")} ${unrated.length === 1 ? "has" : "have"} no Course Rating or Slope, so players off ${unrated.length === 1 ? "it" : "them"} are scored on their raw index. That understates strokes on a hard course and overstates them on an easy one.`;
}

/**
 * The same unrated-tee problem, as it affects the draw rather than the score.
 *
 * A handicap-balanced draw is balanced on Course Handicaps — so with no
 * ratings it is balanced on raw indexes instead, and the flights come out
 * subtly uneven with nothing on screen to say why. Distinct from
 * `unratedWarning`, which is about net *scoring*: this one fires regardless of
 * scoring basis, because the draw uses handicaps even in a gross event.
 */
export async function unratedFlightWarning(
  eventId: string,
  formationRule: string,
): Promise<string | null> {
  // Only the handicap rule reads handicaps. Seeding, random and manual don't
  // care what anyone plays off.
  if (formationRule !== "handicap") return null;
  const tees = await teesForEvent(eventId);
  if (tees.length === 0) {
    return "No tees have been set up, so flights are balanced on raw handicap indexes rather than Course Handicaps. Add a set of tees with its Course Rating and Slope for an even draw.";
  }
  const unrated = tees.filter((t) => !t.rated);
  if (unrated.length === 0) return null;
  return `${unrated.map((t) => t.name).join(", ")} ${unrated.length === 1 ? "has" : "have"} no Course Rating or Slope, so players off ${unrated.length === 1 ? "it" : "them"} are balanced on their raw index. Flights will be slightly uneven.`;
}
