import type { Match } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sideNamesOf } from "@/lib/services/side-names";
import { loadEventState } from "@/lib/services/tournament";
import { COURSE_REF, courseForMatch, cardForMatch } from "@/lib/services/course-resolution";
import { distanceUnitFor } from "@/lib/services/round-card";
import { firstHoleOf } from "@/lib/domain/hole-number";
import { isNetBasis } from "@/lib/domain/match-entry";
import { matchStrokesGiven } from "@/lib/domain/match";
import { matchStrokesPerHole } from "@/lib/domain/team";
import { holesPlayed } from "@/lib/domain/handicap";
import { isCupSession } from "@/lib/domain/cup-lineup";
import type { HoleResult } from "@/lib/domain";
import type { DistanceUnit } from "@/lib/domain/distance-unit";

/**
 * One match as its card shows it: side A is the match's A side in draw order,
 * whoever is holding the phone (`matchSideLabels` has the cup it came from).
 */
export interface KeptMatch {
  id: string;
  aId: string;
  bId: string;
  /** Full names, A first: a player, or a side's own name. */
  aName: string;
  bName: string;
  /** Each side's players, full names — what the answers are named from. */
  aPlayers: string[];
  bPlayers: string[];
  /** In a team cup, the cup team each side plays for ("Oaks", "Pines"). Empty elsewhere. */
  aTeam: string;
  bTeam: string;
  aHandicap: number;
  bHandicap: number;
  /** Who won each hole, A-relative, exactly as stored. */
  holes: HoleResult[];
  /** A match between two sides (a four-ball or foursomes pair). */
  side?: boolean;
  /** A net side match: each of the four players and their shots per hole (index 0 = the card's first hole), side A's first. */
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
  /** A net singles match's shots per hole, side A's and side B's. */
  matchShots: { a: number[]; b: number[] } | null;
  /** The card's distances in its own course's unit. */
  unit: DistanceUnit;
}

/**
 * ONE MATCH CARD, AND IT IS THE SAME WHOEVER IS HOLDING THE PHONE.
 *
 * The card a round-code holder keeps their match on — one hole at a time, who
 * won it — was praised at the first real cup, and Ajay asked for the same card
 * in the player app ("keep it in player app … it was very simple today and I
 * want to keep it that way"). Every page builds it here, from the same reads,
 * so they cannot drift: the round-code page (`/play`), a signed-in player's own
 * match (`/me/match`) and the desk's Score entry.
 *
 * It used to be told who held it and put THEIR side first, flipping the stored
 * holes for a holder on side B. At the same cup two scorers tapped an opposing
 * player's name, the card turned round to face the other pair, and they pressed
 * the place their own side's button had been: the board took every hole they
 * won as the other side's (2026-11-04). So it is no longer told. Side A is the
 * match's A side in draw order, the holes are shown exactly as stored, and the
 * answers name the sides (`matchSideLabels`). One orientation, so nothing is
 * flipped anywhere and nothing has to be flipped back.
 *
 * The tournament is loaded HERE, with the course it points at joined
 * (`COURSE_REF`), rather than taken from the caller: a card resolved from an
 * event read without its course scores against the name beside it
 * (`course-by-id.test.ts`).
 */
export async function matchCardFor(input: { match: Match }): Promise<MatchCardData> {
  const { match } = input;
  const event = await prisma.event.findUniqueOrThrow({ where: { id: match.eventId }, include: COURSE_REF });
  // A match between two sides (a four-ball or foursomes pair), rather than two players.
  const sideMatch = match.teamAId !== "" && match.teamBId !== "" && match.playerAId === "" && match.playerBId === "";
  const sideNames = sideMatch ? await sideNamesOf(event.id, [match.teamAId, match.teamBId]) : null;

  const [singles, members, stage] = await Promise.all([
    sideMatch
      ? []
      : prisma.player.findMany({
          where: { id: { in: [match.playerAId, match.playerBId].filter((id) => id !== "") }, eventId: event.id },
          select: { id: true, name: true, handicap: true, group: { select: { name: true } } },
        }),
    sideMatch
      ? prisma.teamMember.findMany({
          where: { teamId: { in: [match.teamAId, match.teamBId] } },
          orderBy: [{ teamId: "asc" }, { position: "asc" }],
          select: { teamId: true, playerId: true, player: { select: { name: true, group: { select: { name: true } } } } },
        })
      : [],
    prisma.stage.findUnique({
      where: { id: match.stageId },
      select: { type: true, holes: true, scoringBasis: true, nine: true, courseId: true },
    }),
  ]);
  const playerA = singles.find((p) => p.id === match.playerAId) ?? null;
  const playerB = singles.find((p) => p.id === match.playerBId) ?? null;
  // Each side's players in the side's own order, side A's first: draw order, end to end.
  const membersA = members.filter((x) => x.teamId === match.teamAId);
  const membersB = members.filter((x) => x.teamId === match.teamBId);
  /**
   * The cup team a side plays for, in a team cup: the one team all its players
   * are on (`Player.group`, which is what a cup's two teams are). The answers
   * are then "Oaks won" and "Pines won" — the words a scorer at a cup uses.
   */
  const cupTeam = (groups: Array<string | undefined>) => {
    if (!stage || !isCupSession(stage)) return "";
    const named = new Set(groups.map((g) => (g ?? "").trim()));
    return named.size === 1 ? [...named][0] : "";
  };
  const aTeam = sideMatch ? cupTeam(membersA.map((x) => x.player.group?.name)) : cupTeam([playerA?.group?.name]);
  const bTeam = sideMatch ? cupTeam(membersB.map((x) => x.player.group?.name)) : cupTeam([playerB?.group?.name]);

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

  /**
   * WHO GETS A SHOT WHERE, in a net match (2026-10-07).
   *
   * A player keeping a net match taps who won each hole, and that depends on
   * the shots — which the console's card shows as dots and this screen did
   * not, leaving the allocation to be done in somebody's head on the 14th tee.
   * Through the console's own two readers, so the two screens cannot disagree:
   * `matchHandicapFor` (the PLAYING handicap for this match, not the roster
   * index a player row carries) and `matchStrokesGiven`, over the card this
   * screen already shows. Side A's first, as drawn.
   */
  const netMatch = isNetBasis(stage?.scoringBasis ?? "");
  let matchShots: { a: number[]; b: number[] } | null = null;
  // One player against one: a side of two has four players' shots, which two
  // rows of dots cannot say, so a side's card shows none rather than one
  // player's as if it were the side's.
  if (!sideMatch && netMatch && card?.strokeIndex?.length) {
    const state = await loadEventState(event.id);
    const given = matchStrokesGiven(
      state?.matchHandicapFor(match.playerAId, match.id) ?? 0,
      state?.matchHandicapFor(match.playerBId, match.id) ?? 0,
      card.strokeIndex,
    );
    matchShots = { a: given.toA, b: given.toB };
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
    const ordered = [...membersA, ...membersB];
    const playing = ordered.map((x) => state?.matchHandicapFor(x.playerId, match.id) ?? 0);
    const low = playing.length ? Math.min(...playing) : 0;
    const index = card.strokeIndex;
    sideShots = ordered.map((x, i) => ({ name: x.player.name, playerId: x.playerId, perHole: matchStrokesPerHole(playing[i], low, index) }));
  }

  return {
    match: {
      id: match.id,
      aId: match.playerAId,
      bId: match.playerBId,
      aName: sideNames?.get(match.teamAId) ?? playerA?.name ?? "Side A",
      bName: sideNames?.get(match.teamBId) ?? playerB?.name ?? "Side B",
      aPlayers: sideMatch ? membersA.map((x) => x.player.name) : playerA ? [playerA.name] : [],
      bPlayers: sideMatch ? membersB.map((x) => x.player.name) : playerB ? [playerB.name] : [],
      aTeam,
      bTeam,
      side: sideMatch,
      sideShots,
      aHandicap: playerA?.handicap ?? 0,
      bHandicap: playerB?.handicap ?? 0,
      // Exactly as stored: A-relative, and A is the match's A side.
      holes,
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
    // The ball being kept is this slot's, so its shots are this slot's: the card itself is never turned.
    return { strokes: parse(row?.strokes), shots: (slot === "A" ? data.matchShots?.a : data.matchShots?.b) ?? [], sideBall: false };
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
