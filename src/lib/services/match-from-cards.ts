/**
 * A MATCH'S RESULT, WORKED OUT FROM ITS CARDS — one place, whoever sent them.
 *
 * These lived inside `src/app/actions/tournament.ts`, unexported, because a
 * `"use server"` export is a public endpoint and they take a match row on
 * trust. They moved here on 2026-10-19, unchanged, so the round-code card
 * (`savePlayMatchCard` in `actions/play.ts`) can store a match kept on stroke
 * cards through the SAME arithmetic as the console — a second copy is how two
 * writers of one result come to disagree. This module is not `"use server"`,
 * so nothing here is callable from a browser; every caller checks who is
 * asking before it gets here.
 */
import type { Match as MatchRow } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COURSE_REF, roundCard, cardForMatch, courseForMatch } from "@/lib/services/course-resolution";
import { playedOnBy } from "@/lib/services/courses";
import { roundCourseHandicaps, flightTeeByPlayer, confirmedField, FIELD_PLAYER } from "@/lib/services/handicaps";
import { roundHandicapRows } from "@/lib/services/round-handicap";
import { roundHandicapExactOf } from "@/lib/domain/round-handicap";
import { playingHandicapInRound } from "@/lib/round-allowance";
import { sidePlayingHandicap, effectiveCountBest } from "@/lib/services/teams";
import { findFormat } from "@/lib/formats";
import { holesPlayed } from "@/lib/domain/handicap";
import { matchHolesOffTheLow } from "@/lib/domain/team";
import { resolveMatch, deriveNetHoles } from "@/lib/domain";
import { isNetBasis } from "@/lib/domain/match-entry";
import { oneCardPerSide } from "@/lib/domain/team-entry";
import { keepsConcession } from "@/lib/domain/cup-lineup";

/**
 * The `forfeitedBy` a score write leaves behind: cleared, except in a cup,
 * where a concession is the organizer's and outlives the cards the players go
 * on saving. Spread into the write — `{}` keeps whatever is stored.
 */
export async function clearsConcession(matchId: string): Promise<{ forfeitedBy?: string }> {
  const m = await prisma.match.findUnique({ where: { id: matchId }, select: { stage: { select: { type: true } } } });
  return keepsConcession(m?.stage?.type ?? "") ? {} : { forfeitedBy: "" };
}

/**
 * A MATCH'S HOLE RESULTS, DERIVED FROM ITS TWO PLAYERS' CARDS — net of their
 * handicaps where the round is.
 *
 * This was the second half of `saveMatchScorecard`, and the only code that
 * could turn a card into a match result. A file of cards imported into a
 * match-play round therefore could not: it wrote `Scorecard` rows — the table
 * a stroke round files in — which no match reads, and the night's matches
 * stayed unplayed under a message saying the cards were in (sweep 1, b14,
 * 2026-10-10). The import files its cards on the fixture and calls this, so
 * a typed card and an imported one are the same result by construction.
 *
 * Not exported: a `"use server"` export is a public endpoint, and this takes
 * a match row on trust.
 */
export async function deriveMatchFromItsCards(
  eventId: string,
  match: MatchRow,
  enteredBy: { name: string; playerId: string },
): Promise<void> {
  const matchId = match.id;
  const [cardA, cardB, playerA, playerB, event, stage] = await Promise.all([
    prisma.matchScorecard.findUnique({ where: { matchId_slot: { matchId, slot: "A" } } }),
    prisma.matchScorecard.findUnique({ where: { matchId_slot: { matchId, slot: "B" } } }),
    prisma.player.findUnique({ where: { id: match.playerAId } }),
    prisma.player.findUnique({ where: { id: match.playerBId } }),
    prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF }),
    prisma.stage.findUnique({ where: { id: match.stageId } }),
  ]);
  /**
   * The card THIS MATCH was played on: match → round → event.
   *
   * This resolved the EVENT's card and nothing else, so `Match.courseId` and
   * `Stage.courseId` were both ignored — a match played at another venue, or a
   * round moved to one, was scored against a course nobody played, and the
   * per-hole winners derived from it were STORED. Meanwhile `/live` read the
   * same match through `courseForMatch` and showed the right answer, so the
   * board and the record disagreed with no way to tell which was which.
   *
   * `resolveCourse` also never fails: it falls back to a demo preset. That is
   * right for a screen, which would otherwise crash, and wrong here, because a
   * fabricated par and stroke index decided who won each hole and the result
   * was written down. `courseForMatch` returns null when there is genuinely no
   * card, and the net path below refuses rather than inventing one.
   */
  const [matchVenue, stageVenue] = await Promise.all([
    match.courseId ? prisma.course.findUnique({ where: { id: match.courseId } }) : null,
    stage?.courseId ? prisma.course.findUnique({ where: { id: stage.courseId } }) : null,
  ]);
  const resolved = courseForMatch(matchVenue, stageVenue, {
    course: event?.course ?? "",
    city: event?.city ?? "",
    customPars: event?.customPars ?? "",
    customYards: event?.customYards ?? "",
    customStrokeIndex: event?.customStrokeIndex ?? "",
    // Passed explicitly: this site builds the fields by hand rather than
    // handing the row over, so without this line it would go on resolving by
    // name however the query above changed.
    courseRef: event?.courseRef ?? null,
  });
  // Handicap strokes only apply when the round is scored Net — a Gross round
  // uses the same card, decided scratch (lower strokes wins the hole).
  //
  // Through `isNetBasis`, which `resolveMatchEntry` already uses, so the two
  // paths into a match result cannot disagree about what the round is. The
  // hand-rolled `=== "net"` here said GROSS for a "both" round while the
  // resolver said net.
  const netMode = isNetBasis(stage?.scoringBasis ?? "");
  const strokesA = cardA ? (JSON.parse(cardA.strokes) as (number | null)[]) : [];
  const strokesB = cardB ? (JSON.parse(cardB.strokes) as (number | null)[]) : [];
  // Net match play allocates off Course Handicaps, not roster Indexes. Two
  // players on the same index but different tees are owed different strokes,
  // and deriveNetHoles works from the difference between them.
  const holeCount = holesPlayed(stage?.holes);
  const netTees = await prisma.tee.findMany({
    where: { course: playedOnBy(eventId) },
    orderBy: [{ position: "asc" }],
  });
  // Net match play under the `flight` policy: each side plays off their own
  // flight's tees, which this never asked for.
  const netFlightTee = await flightTeeByPlayer(eventId);
  /**
   * MATCH, THEN ROUND, THEN EVENT — and the venue scoping with it.
   *
   * This asked `roundTeeId(netTees, event?.defaultTeeId)`, which is the EVENT's
   * configured set and nothing else. Two rungs were missing above it: this
   * match's own set, which `nameMatchVenue` collects from the scorer, and this
   * round's. So the venue resolution directly above — which walks match → round
   * → event, and whose comment describes the exact damage — was reading one
   * chain while the HANDICAPS were read off another.
   *
   * It is the worse half of that pair, because the per-hole winners derived from
   * these strokes are STORED. The comment this replaces says so itself: "the
   * match result was decided by a handicap no screen was showing". That was true
   * of the tee POSITION fallback it fixed and stayed true of the venue.
   */
  const netHcp = roundCourseHandicaps({
    tees: netTees,
    players: [playerA, playerB]
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((p) => ({ id: p.id, handicap: p.handicap, handicapType: p.handicapType, teeId: p.teeId, gender: p.gender })),
    // The lowest par being played is the field's, not this pair's (Rule 6.2b).
    field: await confirmedField(eventId),
    flightTeeOf: netFlightTee,
    match,
    stage,
    event,
    holes: holeCount,
  });
  // What this ROUND says they play off, which is not always what the roster
  // says. This path converts its own handicaps rather than going through the
  // board's resolver, so without these two lines a net match is the one round
  // type that ignores an override — silently, and after the organizer has been
  // shown a control that appeared to work.
  const netRound = await roundHandicapRows(eventId, match.stageId);
  //
  // And the PLAYING handicap, as the screens show it (`matchHandicapFor`): the
  // allowance, and the strokes for tees of a higher par (Rule 6.2b). This took
  // the round's figure alone, so a player shown a stroke for the pars had her
  // win stored as a half.
  const netFor = (p: { id: string; handicap: number } | null) =>
    p
      ? playingHandicapInRound(stage, netRound.get(p.id), {
          whole: netHcp.get(p.id) ?? p.handicap,
          exact: netHcp.exact(p.id) ?? p.handicap,
          parStrokes: netHcp.parStrokes(p.id),
        })
      : 0;
  /**
   * A net match cannot be scored without a card, and must not pretend to be.
   *
   * Handicap strokes are allocated by stroke index. With no card there is no
   * index, so every hole was decided scratch — and then stored as the NET
   * result. The organizer sees a settled match, correctly formatted, decided
   * by a rule the round is not being played under.
   *
   * Gross match play is untouched: it needs no par and no stroke index, and a
   * community league with no fixed venue is exactly the case the app supports.
   */
  if (netMode && !resolved) {
    throw new Error(
      "This round is scored Net, and there is no course card to allocate strokes from. Set the round's course before entering scores.",
    );
  }
  // The card the MATCH is actually played on: its own nine when it has one,
  // otherwise the round's, with the stroke indexes re-ranked 1..9. Passing the
  // full eighteen allocated strokes off the wrong holes AND sized the match at
  // eighteen holes, so a nine-hole match could never be closed out.
  const course = resolved ?? { name: "", pars: [], yards: [], strokeIndex: [] };
  const roundCard = cardForMatch(course, match, stage);
  const holes = deriveNetHoles(
    strokesA,
    strokesB,
    netMode ? netFor(playerA) : 0,
    netMode ? netFor(playerB) : 0,
    roundCard.strokeIndex,
    holeCount,
  );
  const complete = resolveMatch(holes).complete;

  await prisma.match.update({
    where: { id: matchId },
    data: { holes: JSON.stringify(holes), ...(await clearsConcession(matchId)), scoreStatus: "pending", scoredAt: complete ? new Date() : null, confirmedById: null, confirmedBy: "", enteredBy: enteredBy.name, enteredById: enteredBy.playerId, attestedBy: "[]" },
  });
}

/** Rebuild a team match's hole results from the two sides' cards. */
export async function recomputeTeamMatch(
  eventId: string,
  match: { id: string; stageId: string; teamAId: string; teamBId: string },
  formatName: string,
  holeCount: number,
): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF });
  if (!event) return;
  const format = findFormat(formatName);
  // The round's own handicap settings, not just the format's defaults. This
  // used to score off `format.allowance` and an unoverridden side handicap,
  // which meant a committee that set its own allowance saw it honoured on the
  // leaderboard and ignored here — the same round settled two ways.
  //
  // `holes` and `nine` are selected for the same reason: which nine a round is
  // played over decides both the pars and where a stroke lands, and this path
  // was reading the front nine of the raw card whatever the round said.
  const stage = await prisma.stage.findUnique({
    where: { id: match.stageId },
    select: {
      handicapAllowance: true,
      allowanceWeights: true,
      countBest: true,
      holes: true,
      nine: true,
      // And WHERE it was played. The three fields above were added because
      // the round's own settings decide how a side is scored; the venue is
      // one of those settings and was the one still missing, so this path
      // could not have read the right card even if it had asked for it.
      courseId: true,
      // And off WHICH SET, which is the same settings list one column along:
      // the venue decided which card was read and the tees decide what the
      // side plays off it. Reading the card from the round and the rating from
      // the tournament is two chains for one act.
      teeId: true,
      // A cup session keeps an organizer's concession through a card save.
      type: true,
      // Whether each side returned one card — see `oneCardPerSide`.
      scoreInput: true,
      scoringBasis: true,
    },
  });
  /**
   * AND THE FIXTURE'S OWN VENUE, because a team match can name one.
   *
   * `nameMatchVenue` serves team matches deliberately — its player check reads
   * the TEAM columns for exactly that reason — so a four-ball that played
   * somewhere else has it on the row. The `match` argument is a narrow object
   * built by several callers and widening it would put this question to all of
   * them; one read here asks it once, on a path that already writes.
   */
  const matchVenue = await prisma.match.findUnique({
    where: { id: match.id },
    select: { teeId: true, courseId: true },
  });
  /**
   * The round's card, for the same reason the net import needs it.
   *
   * This scored a team match off `resolveCourse(event)` — the tournament's
   * venue — so a side playing a round somewhere else received its strokes on
   * the holes that are hardest at HOME. The comment above already establishes
   * the principle for the allowance and the nine ("the round's own handicap
   * settings, not just the format's defaults"); the venue belongs with them.
   */
  const roundVenue = stage?.courseId
    ? await prisma.course.findFirst({
        where: { id: stage.courseId, ...playedOnBy(eventId) },
      })
    : null;
  const course = roundCard(stage, event, roundVenue);
  // The format this match is scored under, which may be the tournament's where
  // the round names none — so the round, with that format.
  const teamPricing = stage ? { ...stage, format: formatName } : null;

  /**
   * What each player on a side plays off in this round.
   *
   * Course Handicaps, and the round's own numbers on top of them. This scored
   * off `Player.handicap` — the roster INDEX, unconverted — while the Teams
   * screen priced the identical side through `teamsForStage`, which converts
   * for the tees. So a club that rates its tees saw one side handicap on
   * screen and was scored by another: the 2026-08-12 audit's defect exactly,
   * in the one place it had not been looked for. Both read the same rule now.
   */
  const teeRows = await prisma.tee.findMany({
    where: { course: playedOnBy(eventId) },
    orderBy: [{ position: "asc" }],
  });
  const teamRound = await roundHandicapRows(eventId, match.stageId);
  // One field for BOTH sides. Each side's handicaps are worked out from its own
  // members below, and the strokes for tees of a higher par (Rule 6.2b) are a
  // difference from the lowest par the field is playing — which two maps of
  // two players each would otherwise each find for themselves.
  const teamField = await confirmedField(eventId);

  const sideCard = async (teamId: string) => {
    const [cards, members] = await Promise.all([
      prisma.teamScorecard.findMany({ where: { stageId: match.stageId, matchId: match.id, teamId } }),
      prisma.teamMember.findMany({
        where: { teamId },
        include: {
          player: { select: FIELD_PLAYER },
        },
      }),
    ]);
    const teamFlightTee = await flightTeeByPlayer(eventId);
    // Match, then round, then event, venue-scoped — the same chain as the net
    // match path above, and the same reason: what this writes down is a result.
    const teamHcp = roundCourseHandicaps({
      tees: teeRows,
      players: members.map((m) => m.player),
      field: teamField,
      flightTeeOf: teamFlightTee,
      match: matchVenue,
      stage,
      event,
      holes: holeCount,
    });
    // Before rounding: both uses below take an allowance of it (Rule 6.2a).
    const playsOffExact = (p: { id: string; handicap: number }) =>
      roundHandicapExactOf(teamRound.get(p.id), teamHcp.get(p.id) ?? p.handicap, teamHcp.exact(p.id) ?? p.handicap);
    const parse = (s: string): (number | null)[] => {
      try {
        return JSON.parse(s) as (number | null)[];
      } catch {
        return [];
      }
    };
    // Which holes this ball picked up on. Anything unreadable reads as none.
    const picks = (s: string | undefined): boolean[] => {
      try {
        const v = JSON.parse(s ?? "[]") as unknown;
        return Array.isArray(v) ? v.map((x) => x === true) : [];
      } catch {
        return [];
      }
    };
    /**
     * THE SIDE AS BALLS, because this is a MATCH.
     *
     * This built a `TeamCard` per side with full allowances and compared the
     * two net better balls. That is the net-medal method; a match is played
     * off the lowest handicap in it. See `matchHolesOffTheLow`, which carries
     * the measurement of how far the two diverge and why it lands on the
     * hardest holes.
     *
     * A shared ball is ONE ball at the side's own playing handicap, which is
     * the same figure `singleBallTeamCard` scores it on — so foursomes match
     * play comes off the low side rather than the low player, correctly.
     */
    if (format.ball === "single") {
      const one = cards.find((c) => c.playerId === "");
      const hcp = sidePlayingHandicap(
        members.map((m) => playsOffExact(m.player)),
        formatName,
        stage?.handicapAllowance ?? 0,
        stage?.allowanceWeights,
      );
      return [{ strokes: one ? parse(one.strokes) : [], playingHandicap: hcp, pickedUp: picks(one?.pickedUp) }];
    }
    // A two-ball round the committee entered as one card for the side: that
    // card is the side's gross (the choice exists only on gross), so it plays
    // off nothing — as the board reads it.
    if (oneCardPerSide(formatName, stage?.scoreInput, stage?.scoringBasis)) {
      const one = cards.find((c) => c.playerId === "");
      return [{ strokes: one ? parse(one.strokes) : [], playingHandicap: 0, pickedUp: picks(one?.pickedUp) }];
    }
    return members.map((m) => {
      const card = cards.find((c) => c.playerId === m.playerId);
      return {
        strokes: parse(card?.strokes ?? "[]"),
        playingHandicap: playingHandicapInRound(teamPricing, teamRound.get(m.player.id), {
          whole: teamHcp.get(m.player.id) ?? m.player.handicap,
          exact: teamHcp.exact(m.player.id) ?? m.player.handicap,
          parStrokes: teamHcp.parStrokes(m.player.id),
        }),
        pickedUp: picks(card?.pickedUp),
      };
    });
  };

  const [a, b] = await Promise.all([sideCard(match.teamAId), sideCard(match.teamBId)]);
  const holes = matchHolesOffTheLow(
    a,
    b,
    course.strokeIndex,
    course.pars.length,
    effectiveCountBest(formatName, stage?.countBest ?? 0),
  );
  const complete = resolveMatch(holes).complete;

  await prisma.match.update({
    where: { id: match.id },
    data: {
      holes: JSON.stringify(holes),
      // A real result supersedes a forfeit. Without this, an organizer who
      // forfeited against the wrong name and then entered the true card would
      // see the card on screen and the forfeit in the standings — the entered
      // result silently discarded. Except in a cup, where the concession is
      // the organizer's and outlives the cards — see `keepsConcession`.
      ...(keepsConcession(stage?.type ?? "") ? {} : { forfeitedBy: "" }),
      scoreStatus: "pending",
      scoredAt: complete ? new Date() : null,
      confirmedById: null,
    },
  });
}
