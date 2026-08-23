import "server-only";
import { prisma } from "../db";
import { COURSE_REF, courseForRound, applyNine, cleanNine } from "./course-resolution";
import { teeRatingFor } from "./handicaps";
import { courseHandicap } from "../domain/handicap";
import { resolveRoundHandicap } from "../domain/round-handicap";
import {
  handicapRecordFrom,
  maySuggestFor,
  type HandicapRecord,
  type RoundForRecord,
} from "../domain/handicap-record";

/**
 * Gather one member's returned cards and work out what handicap they support.
 *
 * The database half. Every judgement lives in `domain/handicap-record.ts`,
 * where it is tested against the Rules without a database — this only decides
 * WHICH cards are eligible and resolves what each was played off.
 *
 * Nothing here writes. The result is a suggestion a committee may accept; see
 * the note on `maySuggestFor` for why it is never applied on its own.
 */

/** Only a card the committee has accepted counts toward a handicap. */
const COUNTS_TOWARD_HANDICAP = "approved";

export interface MemberRecord extends HandicapRecord {
  memberId: string;
  /** The roster handicap as it stands, for the comparison on screen. */
  current: number;
  /** False where an association holds this member's handicap. */
  maySuggest: boolean;
  /** Cards found before eligibility was considered — so "we have 14 of your
   *  rounds and 3 of them count" can be said rather than implied. */
  cardsFound: number;
}

/**
 * A member's record across every event their club has run.
 *
 * Rounds reach a member through `Player.memberId`, which is how one person's
 * twelve event entries become one record — the linkage that exists precisely
 * so the app can answer "what has this member played?".
 *
 * Only APPROVED cards count. `Scorecard.status` says why in its own comment:
 * "approved — the committee has accepted it. Only now is it a result." A
 * handicap built from cards nobody has signed off would move on a typo.
 */
export async function memberHandicapRecord(
  organizationId: string,
  memberId: string,
): Promise<MemberRecord | null> {
  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true, handicap: true, handicapSource: true },
  });
  if (!member) return null;

  // Every entry this member has made, scoped to their own club's events.
  const entries = await prisma.player.findMany({
    where: { memberId, event: { organizationId } },
    select: { id: true, eventId: true, handicap: true, teeId: true },
  });
  if (entries.length === 0) {
    return {
      memberId,
      current: member.handicap,
      maySuggest: maySuggestFor(member.handicapSource),
      cardsFound: 0,
      ...handicapRecordFrom([]),
    };
  }

  const playerIds = entries.map((p) => p.id);
  const cards = await prisma.scorecard.findMany({
    where: { playerId: { in: playerIds }, status: COUNTS_TOWARD_HANDICAP },
    select: { playerId: true, stageId: true, strokes: true },
  });
  if (cards.length === 0) {
    return {
      memberId,
      current: member.handicap,
      maySuggest: maySuggestFor(member.handicapSource),
      cardsFound: 0,
      ...handicapRecordFrom([]),
    };
  }

  const entryById = new Map(entries.map((p) => [p.id, p]));
  const eventIds = [...new Set(entries.map((p) => p.eventId))];
  const stageIds = [...new Set(cards.map((c) => c.stageId))];

  const [stages, events, venues, tees, frozen] = await Promise.all([
    prisma.stage.findMany({
      where: { id: { in: stageIds } },
      select: { id: true, eventId: true, holes: true, playedOn: true, courseId: true, nine: true },
    }),
    prisma.event.findMany({ where: { id: { in: eventIds } }, include: COURSE_REF }),
    prisma.course.findMany({ where: { events: { some: { eventId: { in: eventIds } } } } }),
    prisma.tee.findMany({ where: { course: { events: { some: { eventId: { in: eventIds } } } } } }),
    // What each round was actually played off, where it has been frozen. This
    // is the point of the freeze: a differential must be computed from the
    // handicap in force ON THE DAY, not from whatever the roster says now.
    prisma.roundHandicap.findMany({
      where: { stageId: { in: stageIds }, playerId: { in: playerIds } },
      select: { stageId: true, playerId: true, frozen: true, override: true },
    }),
  ]);

  const stageById = new Map(stages.map((s) => [s.id, s]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  const venueById = new Map(venues.map((c) => [c.id, c]));
  const teeById = new Map(tees.map((t) => [t.id, t]));
  const frozenBy = new Map(frozen.map((r) => [`${r.stageId}:${r.playerId}`, r]));

  const rounds: RoundForRecord[] = [];

  for (const card of cards) {
    const stage = stageById.get(card.stageId);
    const entry = entryById.get(card.playerId);
    if (!stage || !entry) continue;

    const event = eventById.get(stage.eventId);
    if (!event) continue;

    const holes = stage.holes === 9 ? 9 : 18;
    const venue = stage.courseId ? venueById.get(stage.courseId) ?? null : null;
    const resolved = courseForRound(venue, event);
    if (!resolved) continue;
    const card18 = applyNine(resolved, cleanNine(stage.nine), holes);

    // The tee this player was entered off, and the rating that goes with it.
    // No tee, or an unrated one, and `handicapRecordFrom` counts the round out
    // with a reason rather than inventing a rating.
    const tee = entry.teeId ? teeById.get(entry.teeId) ?? null : null;
    const rating = teeRatingFor(tee, holes);

    // What this player played off THAT DAY. The frozen value first, then the
    // committee's override, then the entry's own snapshot — the same order
    // `resolveRoundHandicap` uses everywhere else, so a differential cannot
    // disagree with the net score the board showed.
    const row = frozenBy.get(`${stage.id}:${entry.id}`);
    const played = resolveRoundHandicap({
      frozen: row?.frozen,
      override: row?.override,
      member: rating ? courseHandicap(entry.handicap, rating) : entry.handicap,
    });

    let strokes: (number | null)[] = [];
    try {
      strokes = JSON.parse(card.strokes) as (number | null)[];
    } catch {
      // A corrupt card is not a round of zeros. Skipped entirely.
      continue;
    }

    rounds.push({
      playedOn: stage.playedOn || event.dates || "",
      strokes,
      pars: card18.pars,
      strokeIndex: card18.strokeIndex,
      holes,
      courseHandicap: played.handicap,
      tee: rating,
    });
  }

  return {
    memberId,
    current: member.handicap,
    maySuggest: maySuggestFor(member.handicapSource),
    cardsFound: cards.length,
    ...handicapRecordFrom(rounds),
  };
}
