import "server-only";
import { prisma } from "../db";
import { resolveCourse } from "../courses";
import { holeStrokesReceived, stablefordPointsForHole, modifiedStablefordForHole, allocationHoles } from "../domain";
import { aggregateStroke, emptyAgg, netOf } from "../domain/stroke-agg";
import { skinsPotFor, type SkinsPotView } from "./skins-pot";
import { isSkinsScope, skinsGameLabel, type SkinsScope } from "../domain/skins-pot";
import { roundIsStroke } from "../stage-types";
import {
  loadEventState,
  playingStages,
  parseStrokeCards,
  chainRoundStandings,
  parseMatchTiebreakers,
  matchSettled,
  settingsOf,
} from "./tournament";
import { movementBetween, type WeekRow } from "../domain/week-movement";
import { resolveAttendance, tracksPerRound, type AttendanceMode } from "../domain/attendance";
import { isManualFormat, needsTeams, boardKind, stablefordTableFor } from "../formats";
import { skinsBoard, nassauBoard, type SkinsBoard, type NassauMatchRow } from "./points-standings";
import { teamStandings, type TeamStanding } from "./teams";
import {
  weekBasis,
  compareOnBasis,
  levelOnBasis,
  valueOnBasis,
  directionOnBasis,
  type WeekBasis,
} from "../domain/week-basis";
import { cleanIsoDate, shortDate } from "../domain/round-dates";
import { placesByValue } from "../domain/flight-places";

/**
 * One week of a league, gathered in the order a member reads it.
 *
 * A league is not a tournament that happens to have several rounds. Nobody
 * asks "how am I doing across the season" first — they ask "what happened
 * last night", then "what did that do to me", then "did I win any money".
 * Those three answers currently live on three screens, and an organizer
 * standing in the bar reads them out from three tabs.
 *
 * So this assembles the week: the night's results, what it moved in the
 * standings, and the money. The movement column is the part the incumbents
 * don't show — a position is a fact, but a position CHANGE is the thing
 * everybody actually argues about.
 */

export interface WeekResult {
  playerId: string;
  name: string;
  gross: number;
  net: number;
  points: number;
  thru: number;
  /** Position on the night, ties sharing a place. */
  position: number;
}

/**
 * A side's night, with its place on it.
 *
 * `position` is null for a side that has returned nothing. A side yet to hand
 * a card in is not last — it is out on the course or it did not play, the same
 * distinction the player table draws by dropping the absent, and printing
 * "8th" against a side with no score is a result the club never played for.
 */
export type WeekSide = TeamStanding & { position: number | null };

/** One skins game on one round: which game it is, and how it finished. */
export interface SkinsGame {
  net: boolean;
  scope: SkinsScope;
  /** Named once, in `skinsGameLabel`, so every screen calls it the same. */
  label: string;
  view: SkinsPotView;
}

export interface WeekView {
  weeks: Array<{ stageId: string; label: string; date: string; format: string; holes: number; played: boolean }>;
  stageId: string;
  label: string;
  /** "Tue 19 May", or "" when the round has no fixed day. */
  date: string;
  format: string;
  holes: number;
  /** Ranked by the round's own basis: Stableford by points, otherwise by net. */
  results: WeekResult[];
  /**
   * The SIDES, on a night played in teams — empty on every other night.
   *
   * Not an alternative presentation of `results`: on a foursomes there is no
   * individual score to present, and on a four-ball an individual score is
   * half of what the side scored. Both are ranked by side on the leaderboard
   * and were ranked nowhere at all here.
   */
  sides: WeekSide[];
  /**
   * The night's own board, for a round the gross-and-net table cannot show.
   *
   * Null on every ordinary night. A skins round pays holes and a Nassau is
   * three bets — neither has a place to print — so this sheet showed the wrong
   * kind of answer for both until it carried theirs.
   */
  nightBoard:
    | { kind: "skins"; net: boolean; board: SkinsBoard }
    | { kind: "nassau"; rows: NassauMatchRow[] }
    | null;
  /**
   * What the night is decided on — see `week-basis.ts`.
   *
   * This was a boolean, `stableford`, and everything that was not Stableford
   * was ranked and labelled as NET. A round set to gross was therefore ranked
   * by net on the one screen a league reads every week, while the ordinary
   * leaderboard ranked the same round by gross.
   */
  basis: WeekBasis;
  /** Standings after this week, with movement since the week before. */
  standings: WeekRow[];
  /**
   * Whether THIS week's result is in the table above, or the table is the
   * season as it stood walking into it.
   *
   * `standingsWithMovement` has known the difference since it was corrected on
   * 2026-09-12 and says so in its own words — a medal night in a match league
   * "earns no match points, so it shows the season as it stands going INTO
   * that night". The heading over it did not know, and read "Standings after
   * this week" regardless.
   *
   * Read off the demo league's Week 2, a Stroke Play Round in a match-play
   * season: seven gross scores on the night, and beneath them a points table
   * with a movement column reading "—" for all thirty-three. The numbers are
   * right; the heading says the night has been counted and the dashes say it
   * has not, and the natural reading is that the app lost a week.
   */
  standingsIncludeThisWeek: boolean;
  /**
   * The skins games this round actually ran, in the order they are read.
   *
   * A list rather than a gross/net pair, because a league night runs four —
   * front and back, each gross and net. The old pair asked for two whole-round
   * pots; the other two held real money and appeared on no screen.
   */
  skins: SkinsGame[];
  /** True when no score has been entered for this week yet. */
  empty: boolean;
  /**
   * Who was expected, and how many of them have handed a card in.
   *
   * Null outside a weekly league — a tournament has no "in for this round" and
   * the whole field is expected every time.
   *
   * The sheet drops anybody who did not play, deliberately: "somebody who did
   * not play this week is not last, they are absent". Correct for the RANKING
   * and silent about the question an organizer actually has at nine o'clock,
   * which is whether the night is finished. Sixteen rows on a week eighteen
   * were in for is two cards outstanding and somebody to ring; sixteen rows on
   * a week sixteen were in for is done. The sheet looked identical either way.
   */
  attendance: { expected: number; returned: number; out: number } | null;
  /**
   * Whether the night's gross/net results table has rows.
   *
   * A played MATCH week has none — its result is match points, which the
   * season table carries — so this is not the same question as `empty`.
   */
  hasScoreTable: boolean;
  /**
   * This week's round is scored by hand, so there is no ranking to show.
   *
   * The leaderboard has refused to rank these since the format was added; this
   * screen had to be taught the same thing, because it aggregates cards
   * directly and would otherwise have ranked a Flag day on net strokes.
   */
  manual: boolean;
}

/**
 * Rank with ties sharing a place.
 *
 * Two players round the same score and both finish second; the next finishes
 * fourth. Handing out 2nd and 3rd arbitrarily is the kind of small wrongness
 * that gets a club arguing at the bar and stops them trusting the app.
 */
function positionWithTies<T>(rows: T[], same: (a: T, b: T) => boolean): Array<T & { position: number }> {
  return rows.map((r, i) => {
    let pos = i + 1;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (!same(rows[j], r)) break;
      pos = j + 1;
    }
    return { ...r, position: pos };
  });
}

export async function weekViewFor(eventId: string, wantedStageId?: string): Promise<WeekView | null> {
  const state = await loadEventState(eventId);
  if (!state) return null;

  const weeks = playingStages(state.stages);
  /**
   * THE NIGHT JUST PLAYED, which is this file's own opening premise.
   *
   * The header above says a league member "asks 'what happened last night'"
   * first — and the default here was `activeStage`, the match-points chain's
   * position, which for any league holding a Round Robin is a Round Robin. On
   * the Demo Cup the sheet opened on Week 1 with Week 2 played and its cards
   * in.
   *
   * Only the DEFAULT. An explicit `wantedStageId` still wins, which is the
   * whole of the week strip.
   */
  const stage = weeks.find((s) => s.id === wantedStageId) ?? state.boardStage ?? weeks[0] ?? null;
  if (!stage) return null;

  const cards = await prisma.scorecard.findMany({ where: { eventId } });
  // The other card table. A side's round is filed here and nowhere else, so
  // every question this file asks of `cards` has a team-round answer only if
  // it also asks this one. `stageId` alone: what is wanted is which nights
  // have a card on them, not what is on it.
  const teamCards = await prisma.teamScorecard.findMany({
    where: { eventId },
    select: { stageId: true },
  });
  const course = await resolveCourse(state.event);
  // Event level on purpose, and the only thing still resolved that way here:
  // this orders MATCH tiebreaks across a whole season's chain, not one round's
  // card. Anything that scores a card goes through `state.strokeCourseFor`.
  const holeDifficulty = course.strokeIndex ?? [];

  // The resolvers loadEventState built, not copies of them. Rebuilding either
  // here is exactly the drift handicap-wiring.test.ts exists to stop: both
  // screens would look right and quietly disagree about a net score.
  //
  // The handicap has been read from the state since that comment was written.
  // The COURSE was rebuilt from `resolveCourse(event)` directly underneath it
  // for just as long, under the heading "one week is one round at one venue,
  // so every card here shares a course" — true of the venue, and silent about
  // the NINE. A league playing the back nine got a handicap for nine holes and
  // a card for eighteen, so a player owed 9 strokes drew 5.
  const handicapFor = state.strokeHandicapFor;
  const courseFor = state.strokeCourseFor;

  // Checked before anything is aggregated. A hand-scored round has cards, and
  // adding them up would produce a ranking the club never played for.
  const manual = isManualFormat(stage.format);

  const thisWeek = manual ? [] : parseStrokeCards(cards.filter((c) => c.stageId === stage.id));
  const agg = aggregateStroke(thisWeek, {
    courseFor,
    handicapFor,
    holeStrokesReceived,
    // Modified Stableford is a different table, and this week's board ranks on
    // whatever these points are — so scoring them on the standard one puts a
    // league night in a different order from the round's own leaderboard.
    stablefordPointsForHole: stablefordTableFor(
      () => stage.format,
      stablefordPointsForHole,
      modifiedStablefordForHole,
    ),
    allocationHoles,
  });

  /**
   * A TEAM NIGHT RANKS SIDES, and the table it ranks them in is this one.
   *
   * `teamStandings` is the reader the organizer's own leaderboard and the
   * public board both use, so the sides named here are the sides named there.
   *
   * A four-ball comes through here too. It is a team format that files a card
   * per player, so a per-player table would be half of each side's story, and
   * the leaderboard has ranked it by side since the format was added.
   */
  const team = !manual && needsTeams(stage.format);
  const stageCard = courseFor(stage.id);
  const sideRows: TeamStanding[] = team
    ? await teamStandings(
        eventId,
        stage.id,
        stage.format,
        stageCard.pars,
        stageCard.holeDifficulty,
        stage.scoringBasis ?? "net",
        stage.handicapAllowance,
        stage.allowanceWeights,
        stage.countBest,
      )
    : [];
  /**
   * PLACED THE WAY THE TEAM LEADERBOARD PLACES THEM, which is not the way the
   * player table above places players.
   *
   * `placesByValue` ties on the ranked figure alone; `levelOnBasis`, which the
   * player rows use, breaks a net tie on gross. Both conventions are live in
   * this app on purpose (see the shared-places decision, still open), and the
   * comparison a club actually makes is this table against the leaderboard's
   * table of THE SAME SIDES ON THE SAME NIGHT.
   *
   * Written after reading the seeded club's foursomes: three sides on net 60,
   * shown as a three-way tie for first on the leaderboard and as 1st, 2nd and
   * 3rd here. One of those is wrong on any convention, and it is the new one.
   *
   * The figure is `teamStandings`' own sort key — points for a Stableford,
   * otherwise net — so the places run in the order the rows are already in.
   */
  const sides: WeekSide[] = (() => {
    // `valueOnBasis`, so a gross team round places on gross. Written as
    // "points or net" until 2026-09-20, which is the same two-branch reading
    // `teamStandings` sorted by and the board numbered with — three copies of
    // one rule, all three missing the same third case.
    const places = placesByValue(
      sideRows,
      (s) => valueOnBasis(weekBasis(stage.scoringBasis), s),
      (s) => s.played > 0,
    );
    return sideRows.map((s, i) => ({ ...s, position: places[i] ?? null }));
  })();

  /**
   * WHETHER A NIGHT HAS BEEN PLAYED, ASKED THE WAY THAT NIGHT IS SCORED.
   *
   * `results` below is built from CARDS, and a match-play week keeps its
   * results on the matches — so on a weekly match-play league every player's
   * `thru` is nought, `results` is empty, and the screen declared the night
   * unplayed. Demo Cup showed "No scores are in for week 1 yet" over
   * forty-seven completed matches.
   *
   * That blanked the whole screen, including the season table underneath it,
   * which HAS a match branch (`chainRoundStandings`) and had the points all
   * along. The one section that could answer the question was hidden by the
   * one that could not.
   *
   * The same fault as `PlayerLeaderboard` reading `thru > 0` for a match
   * board, fixed earlier in this file's history and never carried across.
   *
   * `matchSettled` is one hole or a forfeit — deliberately loose. This decides
   * whether to SHOW a screen, not whether to release money, and the round card
   * uses the same looseness for "which round are we on".
   */
  /**
   * THE WEEK'S OWN TYPE, not the tournament's format.
   *
   * `WEEKLY_ROUND_TYPES` is Round Robin AND Stroke Play Round, so a league's
   * weeks can genuinely be of both kinds — and this asked `state.isStroke`,
   * which is one value for the whole season. A match-play league that plays
   * one medal week therefore looked for MATCHES on it and found none, however
   * many cards were in.
   *
   * Seen on the Demo Cup on 2026-09-12: week 2 is a Stroke Play Round with
   * seven cards returned, and the strip wore the "no scores yet" dot.
   */
  /**
   * AND THE THIRD KIND, WHICH NEITHER BRANCH ABOVE CAN SEE.
   *
   * Both of them read the individual table or the matches, and a side files
   * `TeamScorecard` — one row per side for a shared ball, one per player for a
   * four-ball. So a foursomes league night found no cards and no matches and
   * declared itself unplayed for ever.
   *
   * Measured on the seeded club 2026-09-20: the leaderboard read "Foursomes ·
   * 8 sides · lowest net wins" with all eight round in eighteen, and the week
   * sheet for that same night read "No scores are in for week 2 yet."
   *
   * Asked as "a card has been filed", which is exactly what the stroke branch
   * beside it asks of the individual table — and asked of the same list the
   * week STRIP uses below, so a night cannot be played in the header and
   * undotted in the strip.
   */
  /**
   * AND ASKED IN ONE PLACE, because there were two and they drifted.
   *
   * The sheet's own `empty` and the week strip's dot are the same question,
   * and this file's history is three corrections applied to one of them and
   * then to the other: the match branch, the per-week type, the team table.
   * The fourth arrived the same way — a Nassau is recorded as MATCHES on a
   * stroke-type stage, so both readings looked for scorecards, found none and
   * called a night of eight settled matches unplayed.
   *
   * Four kinds of night, one function, both callers.
   */
  const wasPlayed = (s: { id: string; type: string; format: string }): boolean => {
    if (needsTeams(s.format)) return teamCards.some((c) => c.stageId === s.id);
    // A Nassau's three bets live on the match, whatever the stage type says.
    if (boardKind(s.format) === "nassau") {
      return state.matches.some((m) => m.stageId === s.id && matchSettled(m));
    }
    if (roundIsStroke(s.type, s.format)) return cards.some((c) => c.stageId === s.id);
    return state.matches.some((m) => m.stageId === s.id && matchSettled(m));
  };
  const played = wasPlayed(stage);

  const basis = weekBasis(stage.scoringBasis);
  const scored = state.confirmed
    .map((p) => {
      const a = agg.get(p.id) ?? emptyAgg();
      return {
        playerId: p.id,
        name: p.name,
        gross: a.gross,
        net: netOf(a),
        points: a.points,
        thru: a.thru,
        /**
         * The card is IN — not merely started.
         *
         * `thru > 0` is the right filter for the ranking below (somebody who
         * played is on the sheet) and the wrong one for "have they handed it
         * in". A player on the 10th tee has a card with nine holes on it.
         *
         * `stoppedShort` counts as in: a card that is finished with holes
         * never played — a conceded match — is not coming back.
         */
        complete: a.stoppedShort || a.thru >= stage.holes,
      };
    })
    // Somebody who did not play this week is not last — they are absent, and
    // a league where missing a Tuesday puts you bottom of the sheet is a
    // league nobody comes back to.
    .filter((r) => r.thru > 0)
    .sort((x, y) => compareOnBasis(basis, x, y));

  /**
   * A NIGHT THIS TABLE CANNOT SHOW IS NOT RANKED IN IT.
   *
   * `positionsExist` in `formats.ts` says it plainly — "a skins round pays
   * holes, not places; a Nassau is three bets, not a position" — and the
   * leaderboard has rendered those two on their own boards since they were
   * added. This sheet ranked them on NET STROKES anyway, so a skins league
   * night read "1st · 57 net" here and "3 skins" on the board, for different
   * players. Seen on the seeded festival's skins round, 2026-09-20.
   *
   * `scored` above is left alone: those cards are real, and the attendance
   * line counting who has handed one in is right whatever decides the night.
   */
  const nightKind = boardKind(stage.format);
  const ranksPlayers = nightKind === "standard" || nightKind === "modified-stableford";
  const results = ranksPlayers ? positionWithTies(scored, (a, b) => levelOnBasis(basis, a, b)) : [];

  /**
   * And the board that DOES decide it, read from the same service the
   * organizer's leaderboard reads — not a second opinion about who won.
   */
  let nightBoard: WeekView["nightBoard"] = null;
  if (nightKind === "skins") {
    const net = stage.scoringBasis !== "gross";
    nightBoard = {
      kind: "skins",
      net,
      board: await skinsBoard(eventId, stage.id, stage.holes, net, stageCard.holeDifficulty),
    };
  } else if (nightKind === "nassau") {
    nightBoard = { kind: "nassau", rows: await nassauBoard(eventId, stage.id) };
  }

  /**
   * Who was expected, and how many have handed a card in.
   *
   * `scored` above drops anybody who did not play, which is right for the
   * ranking and silent about whether the night is FINISHED. Counted here,
   * against the week's own field rather than the season roster, so the number
   * is "cards still to come" and not "members who were never coming".
   *
   * A card counts as returned when it is COMPLETE, not when it has been
   * started. This used to be `thru > 0`, matching the filter the ranking uses,
   * and the sentence justifying it described the bug it had: "counting it
   * would tell an organizer the night was done while a scorer was still
   * walking up 18." That is precisely what it did — a player on the 10th tee
   * has a card with nine holes on it, and the sheet read "4 of 4 in have
   * returned a card" with one still out on the course.
   *
   * Seen on the fixture 2026-09-18, beside a table that printed "thru 9" for
   * that same player two lines below the sentence claiming everybody was in.
   */
  const attendanceMode = settingsOf(state.event).attendanceMode as AttendanceMode;
  let attendance: WeekView["attendance"] = null;
  if (tracksPerRound(attendanceMode)) {
    const explicit = await prisma.roundAttendance.findMany({
      where: { eventId, stageId: stage.id },
    });
    const resolved = resolveAttendance(
      attendanceMode,
      state.confirmed.map((p) => p.id),
      explicit.map((e) => ({ playerId: e.playerId, status: e.status, decidedBy: e.decidedBy })),
    );
    const inIds = new Set(resolved.rows.filter((r) => r.status === "in").map((r) => r.playerId));
    attendance = {
      expected: resolved.in,
      returned: scored.filter((r) => inIds.has(r.playerId) && r.complete).length,
      out: resolved.out,
    };
  }

  // Standings after this week against standings after the one before, so the
  // movement column means "because of last night" and nothing else.
  const idx = weeks.findIndex((s) => s.id === stage.id);
  // A hand-scored week has no table of its own to show either: the standings
  // "after this week" would be the standings after the week before, presented
  // as though this one had been counted.
  const standings = manual
    ? []
    : await standingsWithMovement(state, weeks, idx, cards, {
        holeDifficulty,
        handicapFor,
        basis,
      });
  /**
   * Does this week's result reach the season table?
   *
   * Asked of the LIST THAT BUILDS THE TABLE rather than of the stage's type.
   * A match league's table comes from `chainRoundStandings(state.rrStages, …)`,
   * so membership of `rrStages` is the question exactly — and a second reading
   * of it, phrased as `type === "Round Robin"`, is how the heading would come
   * to disagree with the rows underneath it the next time either changes.
   *
   * A stroke league sums every counted week, so all of them feed it.
   */
  //
  // AND A TEAM NIGHT REACHES NEITHER. `standingsWithMovement` sums individual
  // cards, which a side's round does not file, so a foursomes week contributes
  // nothing to the table however the league is scored — and the heading would
  // have said "after this week" over a column of dashes, which is the fault
  // the comment above was written for, arriving by a different door.
  const standingsIncludeThisWeek =
    !team && (state.isStroke || state.rrStages.some((s) => s.id === stage.id));

  /**
   * Every skins game this round actually ran, not a fixed gross-and-net pair.
   *
   * A league night runs four — front and back, each gross and net — and this
   * used to ask for exactly two, over the whole round. The other two existed,
   * held money, and appeared on no screen.
   *
   * Enumerated from the rows rather than assumed, so a medal with one pot
   * shows one and a league with four shows four, with no setting deciding it.
   */
  const potRows = await prisma.skinsPot.findMany({
    // The club's own pots. A fourball's private game is theirs and lives on
    // Group games; without this filter the week sheet rendered the FIELD's
    // pot once per group pot on the round — the same card twice — and showed
    // no group pot at all.
    where: { stageId: stage.id, groupKey: "" },
    select: { net: true, scope: true },
    orderBy: [{ scope: "asc" }, { net: "asc" }],
  });
  const skins = (
    await Promise.all(
      potRows.map(async (p) => {
        const scope = isSkinsScope(p.scope) ? p.scope : "full";
        const view = await skinsPotFor(eventId, stage.id, p.net, scope, "");
        return view
          ? { net: p.net, scope, label: skinsGameLabel(p.net, scope, stage.holes), view }
          : null;
      }),
    )
  ).filter((g): g is NonNullable<typeof g> => g !== null);

  return {
    weeks: weeks.map((s, i) => ({
      stageId: s.id,
      label: `Week ${i + 1}`,
      // The date a member recognises the night by. A league is "Tuesday the
      // 19th" long before it is "week 4".
      date: shortDate(cleanIsoDate(s.playedOn)),
      format: s.format,
      holes: s.holes,
      // Asked the way THAT WEEK is scored, same as `played` above — and the
      // emphasis is the correction. This already said "the way that week is
      // scored" and then asked `state.isStroke`, which is the way the SEASON
      // is scored: one value for every week in it. A league with a medal week
      // among its match nights wore the "no scores yet" dot on that week for
      // ever, because it went looking for matches on it.
      // The same function the sheet's own `empty` uses, so the dot and the
      // page cannot disagree about whether a night happened.
      played: wasPlayed(s),
    })),
    stageId: stage.id,
    label: `Week ${idx + 1}`,
    date: shortDate(cleanIsoDate(stage.playedOn)),
    format: stage.format,
    holes: stage.holes,
    results,
    nightBoard,
    sides,
    basis,
    standings,
    standingsIncludeThisWeek,
    skins,
    // A manual week is not "empty" — it has a result, just not one this app
    // knows. The screen says which, and they read differently.
    empty: !manual && !played,
    /**
     * Whether the night's own RESULTS table has anything to put in it.
     *
     * Separate from `empty` on purpose. That table is gross and net, which a
     * match night does not have — its result is the points already in the
     * table below. So a played match week is not empty AND has no scores
     * table, and the screen needs to tell those apart rather than blanking.
     */
    hasScoreTable: results.length > 0,
    manual,
    attendance,
  };
}

/**
 * Cumulative standings through a given week, and the same through the week
 * before it, reduced to a position and a change.
 *
 * Match-play leagues already have this chained for them; stroke leagues are
 * summed here from the same aggregator, cards filtered by which weeks count.
 */
async function standingsWithMovement(
  state: NonNullable<Awaited<ReturnType<typeof loadEventState>>>,
  // `format` too, because summing several weeks means each of them chooses
  // its own Stableford table.
  weeks: Array<{ id: string; format: string }>,
  idx: number,
  cards: Array<{ playerId: string; stageId: string; strokes: string }>,
  opts: {
    // No `pars`: the stroke card comes from `state.strokeCourseFor`, per round.
    // This one is the match-play tiebreak order, which is an event-level chain.
    holeDifficulty: number[];
    handicapFor: (playerId: string, stageId: string) => number;
    basis: WeekBasis;
  },
): Promise<WeekRow[]> {
  const nameOf = new Map(state.confirmed.map((p) => [p.id, p.name]));

  if (!state.isStroke) {
    // A match-play league carries points week to week; chainRoundStandings is
    // the same math the leaderboard uses, so the two cannot disagree.
    const chained = chainRoundStandings(
      state.rrStages,
      state.matches,
      state.domainPlayers,
      state.scoring,
      opts.holeDifficulty,
      parseMatchTiebreakers(state.event.matchTiebreakers),
    );
    /**
     * TWO LISTS, AND THEY ARE NOT THE SAME LIST.
     *
     * `chained` is parallel to `state.rrStages` — Round Robins only — and `idx`
     * counts WEEKS, which is `WEEKLY_ROUND_TYPES`: Round Robin AND Stroke Play
     * Round. They line up only in a league whose every week is a round robin,
     * and silently slip by one the moment a medal night appears before a match
     * night.
     *
     * Measured on 2026-09-12 on a two-week league, medal first:
     *
     *   week 1 (the MEDAL)  -> standings 2.5/0   <- week 2's match points
     *   week 2 (the MATCH)  -> standings (none)  <- its own, missing
     *
     * A league's season table shown against the wrong night, and absent from
     * the right one. Same family as `ranking-then-renumbering`: an answer that
     * knows which row it belongs to, handed to a reader that re-derives it from
     * a position.
     *
     * Counted by STAGE now. A medal week earns no match points, so it shows the
     * season as it stands going INTO that night — which is the honest answer
     * and the one a member reading the sheet wants — and a week before any
     * round robin at all shows nothing, because nothing has been won yet.
     */
    const rrThroughHere = state.rrStages.filter((s) => {
      const at = weeks.findIndex((w) => w.id === s.id);
      return at >= 0 && at <= idx;
    }).length;
    const after = rrThroughHere > 0 ? chained[rrThroughHere - 1] ?? [] : [];
    const before = rrThroughHere > 1 ? chained[rrThroughHere - 2] ?? [] : [];
    /**
     * THE RANK COMES WITH THE ROW, not from the points column.
     *
     * The comment above is right that this is the leaderboard's math — and
     * then only `totalPoints` was handed on, so the place was worked out
     * again downstream from that one number and the tiebreak was thrown
     * away. Demo Cup, 2026-09-11: four players level on 10.5 were 3/4/5/6 on
     * the leaderboard and 3/3/3/3 here, in that order, on the same night.
     *
     * `rankPlayers` shares a place when nothing separates two players and
     * splits them when the club's chain does. Carrying its answer is the only
     * way the two screens can keep the promise this function already made.
     *
     * Both weeks, because movement is the difference between two positions
     * and one of them derived a different way would invent an arrow.
     */
    return movementBetween(
      after.map((r) => ({
        playerId: r.player.id,
        name: nameOf.get(r.player.id) ?? r.player.name,
        value: r.stats.totalPoints,
        rank: r.rank,
      })),
      before.map((r) => ({ playerId: r.player.id, value: r.stats.totalPoints, rank: r.rank })),
      "desc",
    );
  }

  const through = (n: number) => {
    const ids = new Set(weeks.slice(0, n + 1).map((s) => s.id));
    const agg = aggregateStroke(parseStrokeCards(cards.filter((c) => ids.has(c.stageId))), {
      // Per stage, and here it matters twice over: this totals SEVERAL weeks,
      // so one card for all of them is wrong the moment a season plays two
      // venues or mixes a nine among the eighteens.
      courseFor: state.strokeCourseFor,
      handicapFor: opts.handicapFor,
      holeStrokesReceived,
      // Per week, because this totals several of them and a league can run a
      // modified round among ordinary ones.
      stablefordPointsForHole: stablefordTableFor(
        (stageId) => weeks.find((w) => w.id === stageId)?.format,
        stablefordPointsForHole,
        modifiedStablefordForHole,
      ),
      allocationHoles,
    });
    return state.confirmed
      .map((p) => {
        const a = agg.get(p.id) ?? emptyAgg();
        return {
          playerId: p.id,
          name: p.name,
          // The season total is on the same figure the night was decided on,
          // or the table under the sheet ranks the league on something the
          // round was never set to.
          value: valueOnBasis(opts.basis, { gross: a.gross, net: netOf(a), points: a.points }),
          thru: a.thru,
        };
      })
      .filter((r) => r.thru > 0);
  };

  // Stableford totals rank high-to-low; strokes low-to-high.
  const dir = directionOnBasis(opts.basis);
  return movementBetween(through(idx), idx > 0 ? through(idx - 1) : [], dir);
}
