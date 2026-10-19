import type { Match } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadEventState } from "@/lib/services/tournament";
import { COURSE_REF, courseForMatch, cardForMatch } from "@/lib/services/course-resolution";
import { distanceUnitFor } from "@/lib/services/round-card";
import { firstHoleOf } from "@/lib/domain/hole-number";
import { isNetBasis } from "@/lib/domain/match-entry";
import { matchStrokesGiven } from "@/lib/domain/match";
import { matchStrokesPerHole } from "@/lib/domain/team";
import { holesPlayed } from "@/lib/domain/handicap";
import type { HoleResult } from "@/lib/domain";
import type { DistanceUnit } from "@/lib/domain/distance-unit";

/** One match as the person keeping it sees it: their own side is always A. */
export interface KeptMatch {
  id: string;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  aHandicap: number;
  bHandicap: number;
  holes: HoleResult[];
  /** True when the holder is stored as side B — results are flipped back before saving. */
  flipped: boolean;
  /** A match between two sides (a four-ball pair): the holder keeps it for their side. */
  side?: boolean;
  /** A net side match: each of the four players and their shots per hole (index 0 = the card's first hole). */
  sideShots?: Array<{ name: string; perHole: number[]; playerId?: string }> | null;
}

/** Everything the match card (`MatchKeeper`) is drawn from. */
export interface MatchCardData {
  match: KeptMatch;
  holes: number;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  cardStrokeIndex?: number[];
  firstHole: number;
  netMode: boolean;
  matchShots: { mine: number[]; theirs: number[] } | null;
  /** The card's distances in its own course's unit. */
  unit: DistanceUnit;
}

/**
 * ONE MATCH CARD, WHOEVER IS HOLDING THE PHONE (2026-10-18).
 *
 * The card a round-code holder keeps their match on — one hole at a time, who
 * won it — was praised at the first real cup, and Ajay asked for the same card
 * in the player app ("keep it in player app … it was very simple today and I
 * want to keep it that way"). Both pages build it here, from the same reads,
 * so the two cannot drift: the round-code page (`/play`) and a signed-in
 * player's own match (`/me/match`). Lifted unchanged out of `/play`.
 *
 * `holderId` is the player keeping the match, `holderSides` the sides (four-ball
 * pairs) they are on in this match's round. Side A on the card is always
 * theirs. The tournament is loaded HERE, with the course it points at joined
 * (`COURSE_REF`), rather than taken from the caller: a card resolved from an
 * event read without its course scores against the name beside it
 * (`course-by-id.test.ts`).
 */
export async function matchCardFor(input: { match: Match; holderId: string; holderSides: string[] }): Promise<MatchCardData> {
  const { match, holderId, holderSides } = input;
  const event = await prisma.event.findUniqueOrThrow({ where: { id: match.eventId }, include: COURSE_REF });
  // A match between two sides: the holder's side is A when they are on it.
  const sideMatch = match.teamAId !== "" && match.teamBId !== "" && match.playerAId === "" && match.playerBId === "";
  const iAmA = sideMatch ? holderSides.includes(match.teamAId) : match.playerAId === holderId;
  const sideNames = sideMatch
    ? new Map(
        (
          await prisma.team.findMany({
            where: { id: { in: [match.teamAId, match.teamBId] }, eventId: event.id },
            select: { id: true, name: true },
          })
        ).map((t) => [t.id, t.name]),
      )
    : null;

  const [opponent, stage] = await Promise.all([
    sideMatch
      ? null
      : prisma.player.findUnique({
          where: { id: match.playerAId === holderId ? match.playerBId : match.playerAId },
          select: { name: true, handicap: true },
        }),
    prisma.stage.findUnique({
      where: { id: match.stageId },
      select: { holes: true, scoringBasis: true, nine: true, courseId: true },
    }),
  ]);

  const holeCount = holesPlayed(stage?.holes);

  /**
   * The card this match is played on, narrowed to the holes it is played over.
   *
   * This handed the player the EVENT's whole eighteen, which broke the screen
   * in two ways at once for a nine-hole match. `PlayClient` sized its grid
   * from the length of this array, so it drew eighteen cells for a nine-hole
   * match; the submit button then read "Fill all 18 holes to submit" and
   * stayed disabled forever, because only nine of them can ever be filled. A
   * player with a round code had no way to hand in their card at all.
   *
   * And the card itself was the wrong one — the event's, ignoring the match's
   * venue and the round's, and never narrowed to the nine. Same chain as
   * `saveMatchScorecard`, read the same way, so the screen and the save agree.
   */
  const [matchVenue, stageVenue] = await Promise.all([
    match.courseId ? prisma.course.findUnique({ where: { id: match.courseId } }) : null,
    stage?.courseId ? prisma.course.findUnique({ where: { id: stage.courseId } }) : null,
  ]);
  const resolved = courseForMatch(matchVenue, stageVenue, event);
  const card = resolved ? cardForMatch(resolved, match, stage) : null;
  let holes: HoleResult[];
  try {
    holes = JSON.parse(match.holes) as HoleResult[];
  } catch {
    holes = new Array(holeCount).fill(null);
  }

  const me = await prisma.player.findUnique({
    where: { id: holderId },
    select: { name: true, handicap: true },
  });

  /**
   * WHO GETS A SHOT WHERE, in a net match (2026-10-07).
   *
   * A player keeping a net match taps who won each hole, and that depends on
   * the shots — which the console's card shows as dots and this screen did
   * not, leaving the allocation to be done in somebody's head on the 14th tee.
   * Through the console's own two readers, so the two screens cannot disagree:
   * `matchHandicapFor` (the PLAYING handicap for this match, not the roster
   * index `me.handicap` carries) and `matchStrokesGiven`, over the card this
   * screen already shows. From the holder's side: "mine" first.
   */
  const netMatch = isNetBasis(stage?.scoringBasis ?? "");
  let matchShots: { mine: number[]; theirs: number[] } | null = null;
  // One player against one: a side of two has four players' shots, which two
  // rows of dots cannot say, so a side's card shows none rather than one
  // player's as if it were the side's.
  if (!sideMatch && netMatch && card?.strokeIndex?.length) {
    const state = await loadEventState(event.id);
    const opponentId = iAmA ? match.playerBId : match.playerAId;
    const given = matchStrokesGiven(
      state?.matchHandicapFor(holderId, match.id) ?? 0,
      state?.matchHandicapFor(opponentId, match.id) ?? 0,
      card.strokeIndex,
    );
    matchShots = { mine: given.toA, theirs: given.toB };
  }

  /**
   * A SIDE'S SHOTS, named per player (2026-10-17). Four players' strokes do not
   * fit two rows of dots, so a four-ball card says under each hole who gets a
   * shot there — off the lowest of the four, through `matchStrokesPerHole`,
   * the one definition the engine and the printed card use too.
   */
  let sideShots: Array<{ name: string; perHole: number[]; playerId?: string }> | null = null;
  if (sideMatch && netMatch && card?.strokeIndex?.length) {
    const state = await loadEventState(event.id);
    const members = await prisma.teamMember.findMany({
      where: { teamId: { in: [match.teamAId, match.teamBId] } },
      orderBy: [{ teamId: "asc" }, { position: "asc" }],
      select: { teamId: true, playerId: true, player: { select: { name: true } } },
    });
    const ordered = [
      ...members.filter((x) => x.teamId === (iAmA ? match.teamAId : match.teamBId)),
      ...members.filter((x) => x.teamId === (iAmA ? match.teamBId : match.teamAId)),
    ];
    const playing = ordered.map((x) => state?.matchHandicapFor(x.playerId, match.id) ?? 0);
    const low = playing.length ? Math.min(...playing) : 0;
    const index = card.strokeIndex;
    sideShots = ordered.map((x, i) => ({ name: x.player.name, playerId: x.playerId, perHole: matchStrokesPerHole(playing[i], low, index) }));
  }

  return {
    match: {
      id: match.id,
      // Slot A is always the holder, so the card reads from their point of
      // view rather than from the database's ordering.
      aId: iAmA ? match.playerAId : match.playerBId,
      bId: iAmA ? match.playerBId : match.playerAId,
      aName: sideNames?.get(iAmA ? match.teamAId : match.teamBId) ?? me?.name ?? "You",
      bName: sideNames?.get(iAmA ? match.teamBId : match.teamAId) ?? opponent?.name ?? "Opponent",
      side: sideMatch,
      sideShots,
      aHandicap: me?.handicap ?? 0,
      bHandicap: opponent?.handicap ?? 0,
      // Results are stored A-relative; flip them when the holder is B so
      // "you won this hole" means the same thing on screen and in the data.
      holes: iAmA ? holes : holes.map((h) => (h === "A" ? "B" : h === "B" ? "A" : h)),
      flipped: !iAmA,
    },
    // The round's own hole count, sent explicitly rather than inferred from
    // the length of the card. A card can be absent, or a different length
    // from the round — neither is a reason to draw the wrong number of holes.
    holes: holeCount,
    pars: card?.pars ?? [],
    yards: card?.yards ?? [],
    strokeIndex: card?.strokeIndex ?? [],
    // The CLUB's stroke index for the holes of this nine, to print: the card
    // above is re-ranked 1–9 for allocating shots on a nine, and a golfer
    // reading "S.I. 9" off the 10th while the club card says 18 thinks the
    // app has the wrong course. The order is the same, so the dots agree.
    cardStrokeIndex:
      resolved && holeCount === 9 ? resolved.strokeIndex.slice(firstHoleOf(card) - 1, firstHoleOf(card) - 1 + 9) : undefined,
    firstHole: firstHoleOf(card),
    // The same predicate the console and the server use, so a player and an
    // organizer cannot be shown a different basis for one round.
    netMode: netMatch,
    matchShots,
    unit: await distanceUnitFor(resolved, event.organizationId),
  };
}

/** The holder's own stroke card for a match kept on cards (`matchKeptBy`). */
export interface MatchStrokeCard {
  /** What is already saved for this ball — a card is never opened blank over strokes already in. */
  strokes: (number | null)[];
  /** Shots this ball receives per hole in the match, or none where the side plays one ball. */
  shots: number[];
  /** True where the side plays one ball and keeps one card between them. */
  sideBall: boolean;
}

/**
 * The ball a code holder or a signed-in player keeps on a stroke card in a
 * match: their slot in a singles match, their own card in a four-ball, or the
 * side's one card where the side plays one ball. The same rows the console's
 * Score entry writes (`MatchScorecard`, `TeamScorecard`), so a card started at
 * the desk opens here with its strokes.
 */
export async function matchStrokeCardFor(input: {
  match: Match;
  holderId: string;
  data: MatchCardData;
  oneBallPerSide: boolean;
}): Promise<MatchStrokeCard> {
  const { match, holderId, data, oneBallPerSide } = input;
  const parse = (raw: string | undefined): (number | null)[] => {
    try {
      const v = JSON.parse(raw ?? "[]") as unknown;
      return Array.isArray(v) ? v.map((x) => (typeof x === "number" ? x : null)) : [];
    } catch {
      return [];
    }
  };
  if (!data.match.side) {
    const slot = match.playerAId === holderId ? "A" : "B";
    const row = await prisma.matchScorecard.findUnique({ where: { matchId_slot: { matchId: match.id, slot } } });
    return { strokes: parse(row?.strokes), shots: data.matchShots?.mine ?? [], sideBall: false };
  }
  const mine = await prisma.teamMember.findFirst({
    where: { playerId: holderId, teamId: { in: [match.teamAId, match.teamBId] } },
    select: { teamId: true },
  });
  const row = mine
    ? await prisma.teamScorecard.findFirst({
        where: { stageId: match.stageId, matchId: match.id, teamId: mine.teamId, playerId: oneBallPerSide ? "" : holderId },
        select: { strokes: true },
      })
    : null;
  return {
    strokes: parse(row?.strokes),
    // A side's one ball takes the side's strokes, which the app works out; a
    // four-ball partner's own ball takes their own, off the lowest of the four.
    shots: oneBallPerSide ? [] : (data.match.sideShots?.find((s) => s.playerId === holderId)?.perHole ?? []),
    sideBall: oneBallPerSide,
  };
}
